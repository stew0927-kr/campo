import { getBuildingOutlineForLevel } from '@campo/core';
import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../../map/style.ts';
import { CAMPUS_MAX_BOUNDS, CAMPUS_MAX_ZOOM, CAMPUS_MIN_ZOOM } from '../../map/campusCamera.ts';
import { compassState, coordinateBounds, outsideMask, routeBounds, routeConnectors, routeLine } from './model.ts';
import { floorLines } from './indoor.ts';
import { outdoorLines, outdoorPlazas } from './outdoor.ts';
import { Image } from 'expo-image';
import type { MapProps, RoadviewPreview } from './mapTypes.ts';
import { buildMarkers, DECLUTTER_THROTTLE_MS, DeclutterScheduler, floorFacilityNodes, labelLift, MARKER_KIND_LABEL, type MapMarker, type MapView, type PlacedMarker } from './mapLabels.ts';
import type { CampusPlace } from '../../contracts.ts';
import { buildingShapes } from './buildings.ts';
import { FacilityIcon, MapLabel } from './MapGlyphs.tsx';
import { theme as t } from '../../ui/theme.ts';
import { WAY_WIDTH } from '../../map/wayWidth.ts';
export { WAY_WIDTH };
export function CampusMap({ center, label, route, from, to, places, graph, buildingId, level, position, flow, onPoint, onPlace, focus = null, selected = null, fitPadding = DEFAULT_PADDING,
  photoSpots = [], onPhotoSpot, stepGroups = [], onStepGroup, preview = null, onOpenPreview,
  highlightBuildings = false, mappedBuildingIds = [], onBuildingPress, markedBuildingId = null, highlight = null }: MapProps) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  // Current viewport (center, zoom, bearing, size). Kept in a ref: a region event must not re-render the whole map;
  // only a changed marker layout (from the scheduler) does.
  const viewRef = useRef<MapView>({ lng: center.lng, lat: center.lat, zoom: 16, bearing: 0, width: 0, height: 0 });
  const scheduler = useRef<DeclutterScheduler | null>(null);
  scheduler.current ??= new DeclutterScheduler();
  const [placed, setPlaced] = useState<PlacedMarker[]>([]);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest onPlace without changing the memoised markers' props on every parent render.
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const handlePlace = useCallback((place: CampusPlace) => onPlaceRef.current(place), []);
  const [failed, setFailed] = useState(false);
  const line = useMemo(() => routeLine(route?.polyline ?? []), [route]);
  // Only a point picked on the map is snapped onto a way; a campus node is the line's own end.
  const loose = (place: CampusPlace | null) => (place && (place.nodeType === 'point' || place.nodeType === 'gps') ? place : null);
  const fromPoint = loose(from), toPoint = loose(to);
  const connectors = useMemo(() => routeConnectors(route?.polyline ?? [], fromPoint, toPoint),
    [route, fromPoint?.lng, fromPoint?.lat, toPoint?.lng, toPoint?.lat]);
  const highlightLine: Feature<LineString> | null = useMemo(() => (highlight && highlight.coordinates.length >= 2
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: highlight.coordinates } } : null), [highlight]);
  // Compass needle state lives in its own component: a region event updates only the compass, not the whole map.
  const compass = useRef<((bearing: number, pitch: number) => void) | null>(null);
  const indoor = useMemo(() => floorLines(graph, buildingId, level, route), [graph, buildingId, level, route]);
  const wayAreas = useMemo(() => outdoorPlazas(graph), [graph]);
  const wayLines = useMemo(() => outdoorLines(graph), [graph]);
  const spotData: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: photoSpots.map((spot, i) => ({ type: 'Feature', properties: { i, count: spot.count }, geometry: { type: 'Point', coordinates: spot.lngLat } })) }), [photoSpots]);
  const groupData: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: stepGroups.map((group, i) => ({ type: 'Feature', properties: { i, twice: group.entries.length > 1 }, geometry: { type: 'Point', coordinates: group.lngLat } })) }), [stepGroups]);
  const dots: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: places.map((place) => ({ type: 'Feature', properties: { id: place.id }, geometry: { type: 'Point', coordinates: [place.lng, place.lat] } })) }), [places]);
  const indoorView = buildingId !== null;
  const facilities = useMemo(() => floorFacilityNodes(graph, buildingId, level), [graph, buildingId, level]);
  const routeNodeIds = route?.nodeIds ?? null;
  const markers = useMemo(() => {
    const inScope = (place: MapProps['from']) => (place && (buildingId === null ? place.buildingId === null : place.buildingId === buildingId && place.level === level) ? place : null);
    return buildMarkers({ places, facilities, from: inScope(from), to: inScope(to), selected: inScope(selected), routeNodeIds });
  }, [places, facilities, from, to, selected, routeNodeIds, buildingId, level]);
  // New markers or indoor/outdoor: lay out again now. setPlaced bails out when the scheduler returns the same array.
  useEffect(() => { setPlaced(scheduler.current!.setMarkers(markers, indoorView)); }, [markers, indoorView]);
  useEffect(() => () => { if (trailing.current) clearTimeout(trailing.current); }, []);
  const regionView = (event: { nativeEvent: { center: [number, number] | number[]; zoom: number; bearing: number; pitch?: number } }): MapView => {
    const { center: [lng, lat], zoom: z, bearing, pitch = 0 } = event.nativeEvent;
    compass.current?.(bearing, pitch);
    return (viewRef.current = { ...viewRef.current, lng: lng!, lat: lat!, zoom: z, bearing });
  };
  /**
   * While panning/zooming: throttled layout. If movement pauses with a deferred layout and no settle event follows,
   * a debounced trailing layout catches up (it never fires while events keep coming, so it adds no work mid-gesture).
   */
  const onMoving = (event: Parameters<typeof regionView>[0]) => {
    const s = scheduler.current!;
    setPlaced(s.moving(regionView(event), Date.now()));
    if (trailing.current) { clearTimeout(trailing.current); trailing.current = null; }
    if (s.pending) trailing.current = setTimeout(() => { trailing.current = null; setPlaced(s.flush(Date.now())); }, DECLUTTER_THROTTLE_MS);
  };
  /** Settled: exact layout. */
  const onSettled = (view: MapView) => {
    if (trailing.current) { clearTimeout(trailing.current); trailing.current = null; }
    setPlaced(scheduler.current!.settle(view, Date.now()));
  };
  const icons = useMemo(() => (indoorView ? placed.filter((p) => p.marker.tone === 'normal').map((p) => p.marker) : []), [placed, indoorView]);
  const labels = useMemo(() => placed.filter((p) => p.label && p.marker.name).map((p) => p.marker), [placed]);
  const shapes = useMemo(() => buildingShapes(graph, highlightBuildings ? mappedBuildingIds : [], buildingId), [graph, highlightBuildings, mappedBuildingIds, buildingId]);
  const marked = useMemo(() => buildingShapes(graph, markedBuildingId ? [markedBuildingId] : []), [graph, markedBuildingId]);
  useEffect(() => {
    if (loaded) camera.current?.jumpTo({ center: [center.lng, center.lat], zoom: 16 });
  }, [center.lng, center.lat, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const floorPoints = places.map((p) => ({ lng: p.lng, lat: p.lat }));
    const bounds = routeBounds(buildingId ? floorPoints : route?.polyline ?? []);
    // fitPadding is read on each fit; changing overlays alone must not refit the camera.
    if (bounds) camera.current?.fitBounds(bounds, { padding: fitPadding, duration: 500 });
  }, [route, loaded, buildingId, level, places]);
  useEffect(() => {
    // Only a new focus request moves the camera; zoom changes from the user must not.
    if (loaded && focus) camera.current?.easeTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? Math.max(viewRef.current.zoom, 17), duration: 450 });
  }, [focus?.key, loaded]);
  useEffect(() => {
    // A newly highlighted route section (a slope card): fit it with room to spare around the overlays.
    const bounds = highlight ? coordinateBounds(highlight.coordinates) : null;
    if (loaded && bounds) camera.current?.fitBounds(bounds, { padding: { top: fitPadding.top + 24, bottom: fitPadding.bottom + 24, left: fitPadding.left + 24, right: fitPadding.right + 24 }, duration: 500 });
  }, [highlight?.key, loaded]);
  // easeTo needs a center: keep the current one (last region event) so only bearing and pitch change.
  const northUp = useCallback(() => camera.current?.easeTo({ center: [viewRef.current.lng, viewRef.current.lat], bearing: 0, pitch: 0, duration: 400 }), []);
  const building = buildingId ? graph?.buildings.get(buildingId) : null;
  const outline = building ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: getBuildingOutlineForLevel(building, level) } } : null;
  // Indoors: veil everything outside this building, so it reads as the only place that can be picked now.
  const mask = useMemo(() => (outline ? outsideMask(MASK_BOUNDS, outline.geometry.coordinates) : null), [building, level]);
  const color = flow === 'queue' ? '#BA6700' : flow === 'exit' ? '#596579' : '#1F5EFF';
  const visible = (place: MapProps['from']) => place && (buildingId === null || place.buildingId === buildingId && place.level === level);
  return <View accessibilityLabel={label} style={styles.frame} onLayout={(event) => { const { width, height } = event.nativeEvent.layout; onSettled((viewRef.current = { ...viewRef.current, width, height })); }}>
    <Map style={styles.map} mapStyle={OSM_RASTER_STYLE}
      onRegionIsChanging={onMoving} onRegionDidChange={(event) => onSettled(regionView(event))}
      onPress={(event) => { const [lng, lat] = event.nativeEvent.lngLat; onPoint({ lng, lat }); }}
      onDidFinishLoadingMap={() => { setLoaded(true); setFailed(false); }} onDidFailLoadingMap={() => setFailed(true)}>
      <Camera ref={camera} initialViewState={{ center: [center.lng, center.lat], zoom: 16 }}
        maxBounds={CAMPUS_MAX_BOUNDS} minZoom={CAMPUS_MIN_ZOOM} maxZoom={CAMPUS_MAX_ZOOM} />
      {buildingId === null && <GeoJSONSource id="app-outdoor-plazas" data={wayAreas}>
        <Layer id="app-outdoor-plaza-fill" type="fill" paint={{ 'fill-color': '#E2E6EB', 'fill-opacity': 1 }} />
        <Layer id="app-outdoor-plaza-line" type="line" paint={{ 'line-color': '#CFD6DF', 'line-width': 0.8 }} layout={{ 'line-join': 'round' }} />
      </GeoJSONSource>}
      {buildingId === null && <GeoJSONSource id="app-outdoor-ways" data={wayLines}>
        <Layer id="app-outdoor-way-walk" type="line" filter={['==', ['get', 'kind'], 'walk']} paint={{ 'line-color': '#DCE1E7', 'line-width': WAY_WIDTH }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="app-outdoor-way-ramp" type="line" filter={['==', ['get', 'kind'], 'ramp']} paint={{ 'line-color': '#C7DDD1', 'line-width': WAY_WIDTH }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="app-outdoor-way-stairs" type="line" filter={['==', ['get', 'kind'], 'stairs']} paint={{ 'line-color': '#E1D0BA', 'line-width': WAY_WIDTH }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="app-outdoor-way-stairs-ticks" type="line" filter={['==', ['get', 'kind'], 'stairs']} paint={{ 'line-color': '#B89E7E', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 2.2], 'line-dasharray': [1.2, 1.8] }} layout={{ 'line-join': 'round' }} />
      </GeoJSONSource>}
      {shapes.features.length > 0 && <GeoJSONSource id="app-mapped-buildings" data={shapes} hitbox={HITBOX} onPress={(event) => {
        const id = event.nativeEvent.features[0]?.properties?.['id'];
        if (typeof id === 'string' && onBuildingPress) { event.stopPropagation(); onBuildingPress(id); }
      }}>
        <Layer id="app-mapped-building-fill" type="fill" paint={{ 'fill-color': t.color.primary, 'fill-opacity': ['case', ['get', 'current'], 0, 0.14] }} />
        <Layer id="app-mapped-building-line" type="line" paint={{ 'line-color': t.color.primary, 'line-width': 2, 'line-opacity': 0.9 }} layout={{ 'line-join': 'round' }} />
      </GeoJSONSource>}
      {marked.features.length > 0 && <GeoJSONSource id="app-marked-building" data={marked}>
        <Layer id="app-marked-building-line" type="line" paint={{ 'line-color': t.color.primary, 'line-width': 2, 'line-dasharray': [2, 1.5] }} />
      </GeoJSONSource>}
      {mask && <GeoJSONSource id="app-indoor-mask" data={mask}><Layer id="app-indoor-mask-fill" type="fill" paint={{ 'fill-color': '#000000', 'fill-opacity': 0.35 }} /></GeoJSONSource>}
      {outline && <GeoJSONSource id="app-building-outline" data={outline}><Layer id="app-building-fill" type="fill" paint={{ 'fill-color': '#E4EAF1', 'fill-opacity': 0.85 }} /><Layer id="app-building-border" type="line" paint={{ 'line-color': '#63788D', 'line-width': 2 }} /></GeoJSONSource>}
      {buildingId === null && connectors.features.length > 0 && <GeoJSONSource id="app-route-connectors" data={connectors}>
        <Layer id="app-route-connector-line" type="line" paint={{ 'line-color': '#1F5EFF', 'line-width': 3, 'line-opacity': 0.65, 'line-dasharray': [1.5, 1.5] }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>}
      {line && buildingId === null && <GeoJSONSource id="app-route" data={line}>
        <Layer id="app-route-outline" type="line" paint={{ 'line-color': '#FFFFFF', 'line-width': 9 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="app-route-line" type="line" paint={{ 'line-color': color, 'line-width': 5 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>}
      {highlightLine && buildingId === null && <GeoJSONSource id="app-route-highlight" data={highlightLine}>
        <Layer id="app-route-highlight-outline" type="line" paint={{ 'line-color': '#FFFFFF', 'line-width': 11 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="app-route-highlight-line" type="line" paint={{ 'line-color': HIGHLIGHT_COLOR, 'line-width': 7 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>}
      {buildingId !== null && <GeoJSONSource id="app-indoor" data={indoor}>
        <Layer id="app-floor-network" type="line" filter={['==', ['get', 'route'], false]} paint={{ 'line-color': '#708397', 'line-width': 3 }} />
        <Layer id="app-floor-route" type="line" filter={['==', ['get', 'route'], true]} paint={{ 'line-color': color, 'line-width': 6 }} />
      </GeoJSONSource>}
      <GeoJSONSource id="app-places" data={dots} onPress={(event) => {
        const id = event.nativeEvent.features[0]?.properties?.['id'];
        const place = places.find((p) => p.id === id);
        if (place) { event.stopPropagation(); onPlace(place); }
      }}>
        {/* Indoors the facility icons carry the meaning; the dots stay small as tap targets for places the icons leave out. */}
        <Layer id="app-place-dots" type="circle" paint={{ 'circle-radius': indoorView ? 3.5 : 6, 'circle-color': indoorView ? '#8A97A8' : '#18744D', 'circle-stroke-color': 'white', 'circle-stroke-width': indoorView ? 1.5 : 2 }} />
      </GeoJSONSource>
      {icons.map((marker) => <FacilityMarker key={`icon:${marker.id}`} marker={marker} onPlace={handlePlace} />)}
      {labels.map((marker) => <LabelMarker key={`label:${marker.id}`} marker={marker} />)}
      {photoSpots.length > 0 && stepGroups.length === 0 && <GeoJSONSource id="app-photo-spots" data={spotData} hitbox={HITBOX} onPress={(event) => {
        const i = event.nativeEvent.features[0]?.properties?.['i'];
        const spot = typeof i === 'number' ? photoSpots[i] : undefined;
        if (spot && onPhotoSpot) { event.stopPropagation(); onPhotoSpot(spot); }
      }}><Layer id="app-photo-spot-dots" type="circle" paint={{ 'circle-radius': 8, 'circle-color': '#1FBF7A', 'circle-stroke-color': 'white', 'circle-stroke-width': 3 }} /></GeoJSONSource>}
      {stepGroups.length > 0 && <GeoJSONSource id="app-step-photos" data={groupData} hitbox={HITBOX} onPress={(event) => {
        const i = event.nativeEvent.features[0]?.properties?.['i'];
        const group = typeof i === 'number' ? stepGroups[i] : undefined;
        if (group && onStepGroup) { event.stopPropagation(); onStepGroup(group); }
      }}>
        <Layer id="app-step-photo-dots" type="circle" paint={{ 'circle-radius': 9, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#1FBF7A', 'circle-stroke-width': 4 }} />
        <Layer id="app-step-photo-twice" type="circle" filter={['==', ['get', 'twice'], true]} paint={{ 'circle-radius': 4, 'circle-color': '#7A4FD6' }} />
      </GeoJSONSource>}
      {selected && visible(selected) && selected.id !== from?.id && selected.id !== to?.id && <Marker id="selected-place" lngLat={[selected.lng, selected.lat]} anchor="bottom"><View style={styles.selectedPin}><View style={styles.selectedDot} /></View></Marker>}
      {visible(from) && from && <EndpointPin id="route-start" kind="from" lngLat={[from.lng, from.lat]} />}
      {visible(to) && to && <EndpointPin id="route-end" kind="to" lngLat={[to.lng, to.lat]} />}
      {preview && <PreviewBubble key={preview.key} preview={preview} onOpen={(entry) => onOpenPreview?.(entry)} />}
      {position && <Marker id="current-position" lngLat={[position.lng, position.lat]}><View style={styles.current} /></Marker>}
    </Map>
    {failed && <Text accessibilityLiveRegion="polite" style={styles.error}>배경 지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. 수동 길찾기는 계속 이용할 수 있습니다.</Text>}
    <Text pointerEvents="none" style={styles.attribution}>{OSM_ATTRIBUTION}</Text>
    <CompassButton bind={compass} onPress={northUp} />
  </View>;
}
/** Steep-section highlight on the route (a slope card in the sheet). */
export const HIGHLIGHT_COLOR = '#E68A00';
/** The indoor veil covers the whole camera range (the camera cannot leave CAMPUS_MAX_BOUNDS), with a margin. */
const MASK_BOUNDS: [number, number, number, number] = [CAMPUS_MAX_BOUNDS[0] - 0.05, CAMPUS_MAX_BOUNDS[1] - 0.05, CAMPUS_MAX_BOUNDS[2] + 0.05, CAMPUS_MAX_BOUNDS[3] + 0.05];
const COMPASS = 44;

/**
 * Bottom-left compass above the attribution. The needle follows the map's bearing while it moves and at rest
 * (`bind` receives every region event); tapping eases back to north-up and flat. North-up: quiet; rotated or tilted: accented.
 */
function CompassButton({ bind, onPress }: { bind: { current: ((bearing: number, pitch: number) => void) | null }; onPress: () => void }) {
  const [state, setState] = useState(() => compassState(0));
  useEffect(() => {
    bind.current = (bearing, pitch) => {
      const next = compassState(bearing, pitch);
      // Whole degrees are enough for the needle; this keeps re-renders to visible changes.
      setState((old) => (Math.round(old.rotation) === Math.round(next.rotation) && old.northUp === next.northUp ? old : next));
    };
    return () => { bind.current = null; };
  }, [bind]);
  const degrees = Math.round(Math.abs(state.rotation));
  return <Pressable accessibilityRole="button" accessibilityLabel="나침반, 누르면 정북으로 정렬"
    accessibilityValue={{ text: state.northUp ? '지금 북쪽이 위입니다' : `지도가 ${degrees}도 돌아가 있습니다` }}
    hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.compass, !state.northUp && styles.compassRotated, pressed && styles.compassPressed]}>
    <View pointerEvents="none" style={[styles.needle, { transform: [{ rotate: `${state.rotation}deg` }] }]}>
      <Text style={[styles.compassN, !state.northUp && { color: '#F2473F' }]}>N</Text>
      <View style={styles.needleNorth} />
      <View style={styles.needleSouth} />
    </View>
  </Pressable>;
}
const DEFAULT_PADDING = { top: 40, bottom: 40, left: 35, right: 35 };
const ATTRIBUTION_BOTTOM = 22;
const HITBOX = { top: 16, right: 16, bottom: 16, left: 16 };

/**
 * One facility icon centred on its coordinate. Registered places are tappable (44pt hit area); bare stairs/lifts are not.
 * Memoised on the marker object (stable while the marker list is), so a pan that keeps an icon does not rebuild it.
 */
const FacilityMarker = memo(function FacilityMarker({ marker, onPlace }: { marker: MapMarker; onPlace: (place: CampusPlace) => void }) {
  const place = marker.place;
  const kind = MARKER_KIND_LABEL[marker.kind];
  return <Marker id={`facility:${marker.id}`} lngLat={[marker.lng, marker.lat]} anchor="center">
    {place ? <Pressable accessibilityRole="button" accessibilityLabel={`${place.name}, ${kind}`} hitSlop={11} onPress={() => onPlace(place)}><FacilityIcon kind={marker.kind} /></Pressable>
      : <View accessible accessibilityLabel={kind}><FacilityIcon kind={marker.kind} /></View>}
  </Marker>;
});
/** Name label above a marker; memoised like FacilityMarker. */
const LabelMarker = memo(function LabelMarker({ marker }: { marker: MapMarker }) {
  return <Marker id={`place-label:${marker.id}`} lngLat={[marker.lng, marker.lat]} anchor="bottom" offset={[0, -labelLift(marker.tone)]}>
    <View pointerEvents="none"><MapLabel name={marker.name!} kind={marker.kind} tone={marker.tone} /></View>
  </Marker>;
});
const DOT = 14;
const STEM = 22;

/**
 * Exact start/end pin: a small colored dot centred on the coordinate (green start, red end), and above it a thin stem
 * with the 출발/도착 badge. Two markers so the dot's centre, not the badge, sits on the point.
 */
function EndpointPin({ id, kind, lngLat }: { id: string; kind: 'from' | 'to'; lngLat: [number, number] }) {
  const color = kind === 'from' ? '#10A85E' : '#F2473F';
  const text = kind === 'from' ? '출발' : '도착';
  return <>
    <Marker id={`${id}-label`} lngLat={lngLat} anchor="bottom" offset={[0, -DOT / 2]}>
      <View style={styles.pinLabel} pointerEvents="none">
        <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText}>{text}</Text></View>
        <View style={[styles.stem, { backgroundColor: color }]} />
      </View>
    </Marker>
    <Marker id={`${id}-dot`} lngLat={lngLat} anchor="center">
      <View accessible accessibilityLabel={`${text} 지점`} style={[styles.dot, { backgroundColor: color }]} />
    </Marker>
  </>;
}

/** Speech bubble with the roadview thumbnail. One entry: tap to open. Two or more: pick 가는 길 / 오는 길. */
function PreviewBubble({ preview, onOpen }: { preview: RoadviewPreview; onOpen: (entry: number | null) => void }) {
  const single = preview.entries.length <= 1;
  return <Marker id={`roadview-preview-${preview.key}`} lngLat={preview.lngLat} anchor="bottom" offset={[0, -12]}>
    <View style={styles.bubbleWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${preview.title} 로드뷰 보기`} disabled={!single} onPress={() => onOpen(preview.entries[0]?.index ?? null)} style={styles.bubble}>
        {preview.thumbUrl ? <Image source={{ uri: preview.thumbUrl }} contentFit="cover" style={styles.bubbleThumb} /> : <View style={[styles.bubbleThumb, { backgroundColor: '#596579' }]} />}
        <View style={styles.bubbleBody}>
          <Text numberOfLines={1} style={styles.bubbleTitle}>{preview.title}</Text>
          <Text numberOfLines={1} style={styles.bubbleSub}>{single ? `${preview.subtitle} · 눌러서 로드뷰` : '두 번 지나는 지점입니다'}</Text>
          {!single && <View style={styles.bubbleChoices}>{preview.entries.map((entry) => <Pressable key={entry.index} accessibilityRole="button" accessibilityLabel={`${entry.label} 로드뷰 보기`} onPress={() => onOpen(entry.index)} style={styles.bubbleChoice}>
            <Text style={styles.bubbleChoiceText}>{entry.label}</Text>
          </Pressable>)}</View>}
        </View>
      </Pressable>
      <View style={styles.bubbleTail} />
    </View>
  </Marker>;
}
const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#E8EEE9' }, map: { flex: 1 },
  // Bottom offsets leave room for the sheet that overlaps the map edge.
  attribution: { position: 'absolute', bottom: ATTRIBUTION_BOTTOM, left: 8, fontSize: 10, color: '#142A44', backgroundColor: '#FFFFFFDD', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2.5, borderColor: 'white', elevation: 5, shadowColor: '#0B1F3A', shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  pinLabel: { alignItems: 'center' },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1.5, borderColor: 'white', elevation: 4 },
  badgeText: { color: 'white', fontWeight: '800', fontSize: 12 },
  stem: { width: 2, height: STEM },
  bubbleWrap: { alignItems: 'center' },
  bubble: { flexDirection: 'row', width: 236, backgroundColor: 'white', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#D5DCE5', elevation: 6 },
  bubbleThumb: { width: 88, height: 72 },
  bubbleBody: { flex: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 3, justifyContent: 'center' },
  bubbleTitle: { fontSize: 13, fontWeight: '800', color: '#142A44' },
  bubbleSub: { fontSize: 11, color: '#596579' },
  bubbleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  bubbleChoice: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#EEF3FF', borderWidth: 1, borderColor: '#1F5EFF' },
  bubbleChoiceText: { fontSize: 11, fontWeight: '800', color: '#1F5EFF' },
  bubbleTail: { width: 12, height: 12, marginTop: -7, backgroundColor: 'white', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#D5DCE5', transform: [{ rotate: '45deg' }] },
  selectedPin: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#142A44', borderWidth: 3, borderColor: 'white', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  selectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'white' },
  current: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#1F5EFF', borderWidth: 4, borderColor: 'white', elevation: 4 },
  // Clear of the compass at the bottom left.
  compass: { position: 'absolute', left: 8, bottom: ATTRIBUTION_BOTTOM + 24, width: COMPASS, height: COMPASS, borderRadius: COMPASS / 2, backgroundColor: 'white', borderWidth: 1, borderColor: '#D5DCE5', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#0B1F3A', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  compassRotated: { borderColor: '#1F5EFF', borderWidth: 2 },
  compassPressed: { backgroundColor: '#EEF3FF' },
  needle: { width: COMPASS - 8, height: COMPASS - 8, alignItems: 'center', justifyContent: 'center' },
  compassN: { position: 'absolute', top: -1, fontSize: 9, fontWeight: '900', color: '#596579' },
  needleNorth: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#F2473F' },
  needleSouth: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#9AA6B5' },
  error: { position: 'absolute', bottom: 48, left: 60, right: 72, padding: 10, backgroundColor: '#FFF5DF', color: '#8A5200', borderRadius: 10, fontSize: 13 },
});
