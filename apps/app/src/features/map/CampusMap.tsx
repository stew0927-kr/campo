import { getBuildingOutlineForLevel } from '@campo/core';
import { Camera, GeoJSONSource, Layer, Map, Marker as RnMarker, type CameraRef, type CircleLayerSpecification, type FillExtrusionLayerSpecification, type FillLayerSpecification, type FilterSpecification, type LineLayerSpecification } from '@maplibre/maplibre-react-native';
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../../map/style.ts';
import { CAMPUS_MAX_BOUNDS, CAMPUS_MAX_ZOOM, CAMPUS_MIN_ZOOM } from '../../map/campusCamera.ts';
import { validLngLat, validLngLatTuple } from './markerCoords.ts';
import { compassState, coordinateBounds, outsideMask, routeBounds, routeConnectors, routeLine } from './model.ts';
import { floorLines } from './indoor.ts';
import { outdoorLines, outdoorPlazas } from './outdoor.ts';
import { Image } from 'expo-image';
import type { MapProps, RoadviewPreview } from './mapTypes.ts';
import { buildMarkers, DECLUTTER_THROTTLE_MS, DeclutterScheduler, floorFacilityNodes, labelLift, MARKER_KIND_LABEL, type MapMarker, type MapView, type PlacedMarker } from './mapLabels.ts';
import type { CampusPlace, RoutePoint } from '../../contracts.ts';
import type { MarkerGroup, PhotoSpot } from '../../photos/roadviewModel.ts';
import { buildingLabels, buildingShapes } from './buildings.ts';
import { buildingNameFeatures, nameBuckets, NAME_LAYOUT, NAME_PAINT } from './buildingNames.ts';
import { navCamera, NAV_PITCH_DEG } from './navModel.ts';
import { stack3d, STACK_EDGE_COLOR, STACK_FLOOR_COLOR, STACK_PITCH_DEG } from './stack3d.ts';
import { FacilityIcon, MapLabel } from './MapGlyphs.tsx';
import { theme as t } from '../../ui/theme.ts';
import { WAY_WIDTH } from '../../map/wayWidth.ts';
export { WAY_WIDTH };
/**
 * Public entry. Callbacks from the screen are usually inline arrows, so this thin wrapper hands the memoised map stable
 * proxies (reading the latest callback from a ref) and value-stable center/padding. A screen re-render that changes no map
 * input (typing in the search field, a sheet drag, a message) then skips the whole map tree instead of re-sending every
 * source and layer prop to native.
 */
export function CampusMap(props: MapProps) {
  const latest = useRef(props);
  latest.current = props;
  const stable = useMemo(() => ({
    onPoint: (point: RoutePoint) => latest.current.onPoint(point),
    onPlace: (place: CampusPlace) => latest.current.onPlace(place),
    onPhotoSpot: (spot: PhotoSpot) => latest.current.onPhotoSpot?.(spot),
    onStepGroup: (group: MarkerGroup) => latest.current.onStepGroup?.(group),
    onOpenPreview: (entry: number | null) => latest.current.onOpenPreview?.(entry),
    onBuildingPress: (id: string) => latest.current.onBuildingPress?.(id),
    onCenter: (point: RoutePoint) => latest.current.onCenter?.(point),
    onLongPress: (point: RoutePoint) => latest.current.onLongPress?.(point),
  }), []);
  const { lng, lat } = props.center;
  const center = useMemo(() => ({ lng, lat }), [lng, lat]);
  const pressLng = props.pressPin?.lng, pressLat = props.pressPin?.lat;
  const pressPin = useMemo(() => (pressLng !== undefined && pressLat !== undefined ? { lng: pressLng, lat: pressLat } : null), [pressLng, pressLat]);
  const pad = props.fitPadding ?? DEFAULT_PADDING;
  const fitPadding = useMemo(() => ({ top: pad.top, bottom: pad.bottom, left: pad.left, right: pad.right }), [pad.top, pad.bottom, pad.left, pad.right]);
  return <CampusMapView {...props} {...stable} hasBuildingPress={props.onBuildingPress !== undefined} center={center} fitPadding={fitPadding} pressPin={pressPin}
    photoSpots={props.photoSpots?.length ? props.photoSpots : NO_SPOTS} stepGroups={props.stepGroups?.length ? props.stepGroups : NO_GROUPS} />;
}
const NO_SPOTS: readonly PhotoSpot[] = [];
const NO_GROUPS: readonly MarkerGroup[] = [];
type ViewProps = Omit<MapProps, 'fitPadding' | 'photoSpots' | 'stepGroups' | 'onPhotoSpot' | 'onStepGroup' | 'onOpenPreview' | 'onBuildingPress' | 'onCenter' | 'onLongPress'> & {
  fitPadding: NonNullable<MapProps['fitPadding']>; photoSpots: readonly PhotoSpot[]; stepGroups: readonly MarkerGroup[];
  onPhotoSpot: (spot: PhotoSpot) => void; onStepGroup: (group: MarkerGroup) => void; onOpenPreview: (entry: number | null) => void;
  onBuildingPress: (id: string) => void; hasBuildingPress: boolean; onCenter: (point: RoutePoint) => void; onLongPress: (point: RoutePoint) => void;
};
/** Region events from the native map, fanned out to the parts that follow the camera without re-rendering the map. */
interface ViewSink { moving: (view: MapView) => void; settled: (view: MapView) => void }
const CampusMapView = memo(function CampusMapView({ center, label, route, from, to, places, graph, buildingId, level, position, flow, onPoint, onPlace, focus = null, selected = null, fitPadding,
  photoSpots, onPhotoSpot, stepGroups, onStepGroup, preview = null, onOpenPreview,
  highlightBuildings = false, mappedBuildingIds = NO_IDS, onBuildingPress, hasBuildingPress, pickedBuildingId = null, markedBuildingId = null, highlight = null, stepFocus = null, onCenter,
  threeD = false, onLongPress, pressPin = null }: ViewProps) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  // Current viewport (center, zoom, bearing, size). Kept in a ref: a region event must not re-render the map. The marker
  // layer and the compass subscribe through `sinks` and re-render on their own.
  const viewRef = useRef<MapView>({ lng: center.lng, lat: center.lat, zoom: 16, bearing: 0, width: 0, height: 0 });
  const markerSink = useRef<ViewSink | null>(null);
  const compass = useRef<((bearing: number, pitch: number, settled: boolean) => void) | null>(null);
  const [failed, setFailed] = useState(false);
  const line = useMemo(() => routeLine(route?.polyline ?? []), [route]);
  // Only a point picked on the map is snapped onto a way; a campus node is the line's own end.
  const loose = (place: CampusPlace | null) => (place && (place.nodeType === 'point' || place.nodeType === 'gps') ? place : null);
  const fromPoint = loose(from), toPoint = loose(to);
  const connectors = useMemo(() => routeConnectors(route?.polyline ?? [], fromPoint, toPoint),
    [route, fromPoint?.lng, fromPoint?.lat, toPoint?.lng, toPoint?.lat]);
  const highlightLine: Feature<LineString> | null = useMemo(() => (highlight && highlight.coordinates.length >= 2
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: highlight.coordinates } } : null), [highlight]);
  const stepLine: Feature<LineString> | null = useMemo(() => (stepFocus && stepFocus.coordinates.length >= 2
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: stepFocus.coordinates } } : null), [stepFocus]);
  const indoor = useMemo(() => floorLines(graph, buildingId, level, route), [graph, buildingId, level, route]);
  const wayAreas = useMemo(() => outdoorPlazas(graph), [graph]);
  const wayLines = useMemo(() => outdoorLines(graph), [graph]);
  const dots: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: places.map((place) => ({ type: 'Feature', properties: { id: place.id }, geometry: { type: 'Point', coordinates: [place.lng, place.lat] } })) }), [places]);
  const indoorView = buildingId !== null;
  const facilities = useMemo(() => floorFacilityNodes(graph, buildingId, level), [graph, buildingId, level]);
  const routeNodeIds = route?.nodeIds ?? null;
  // Building names: a native symbol layer (drawn in the map's own frame, so it never trails a pan or zoom), outdoors only.
  // A name is tapped through its building's footprint (app-mapped-buildings) below it.
  const nameLabels = useMemo(() => buildingLabels(graph), [graph]);
  const nameData = useMemo(() => buildingNameFeatures(buildingId === null ? nameLabels : [], highlightBuildings ? pickedBuildingId : null), [nameLabels, buildingId, highlightBuildings, pickedBuildingId]);
  // One layer per zoom bucket (a building's name appears once it is 48 px wide); larger buildings' layers on top, placed first.
  const nameLayers = useMemo(() => nameBuckets(nameData).reverse(), [nameData]);
  const markers = useMemo(() => {
    const inScope = (place: MapProps['from']) => (place && (buildingId === null ? place.buildingId === null : place.buildingId === buildingId && place.level === level) ? place : null);
    return buildMarkers({ places, facilities, from: inScope(from), to: inScope(to), selected: inScope(selected), routeNodeIds });
  }, [places, facilities, from, to, selected, routeNodeIds, buildingId, level]);
  // 3D 보기: the building entered (else the one whose floor picker is open) stands floor by floor; the others keep only their outline.
  const stack = useMemo(() => (threeD ? stack3d(graph, buildingId ?? (highlightBuildings ? pickedBuildingId : null), buildingId ? level : null, pickedBuildingId) : null),
    [threeD, graph, buildingId, level, highlightBuildings, pickedBuildingId]);
  // Region handlers are stable: the Map's props never change because of a camera move.
  /** Pitch at the last region event (the declutter view has no pitch). */
  const pitchRef = useRef(0);
  /** Step focus key of the step during which the user turned the map by hand (kept until the step changes). */
  const stepKey = useRef<string | null>(null);
  const userTurned = useRef<string | null>(null);
  const regionView = useCallback((event: RegionEvent, settled: boolean): MapView => {
    const { center: [lng, lat], zoom: z, bearing, pitch = 0, userInteraction } = event.nativeEvent;
    compass.current?.(bearing, pitch, settled);
    if (userInteraction && stepKey.current !== null && (Math.abs(bearing - (viewRef.current.bearing ?? 0)) > 0.5 || Math.abs(pitch - pitchRef.current) > 0.5)) userTurned.current = stepKey.current;
    pitchRef.current = pitch;
    return (viewRef.current = { ...viewRef.current, lng: lng!, lat: lat!, zoom: z, bearing });
  }, []);
  const onMoving = useCallback((event: RegionEvent) => markerSink.current?.moving(regionView(event, false)), [regionView]);
  const onSettled = useCallback((event: RegionEvent) => {
    const view = regionView(event, true);
    markerSink.current?.settled(view);
    onCenter({ lng: view.lng, lat: view.lat });
  }, [regionView, onCenter]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    markerSink.current?.settled((viewRef.current = { ...viewRef.current, width, height }));
  }, []);
  const onMapPress = useCallback((event: { nativeEvent: { lngLat: [number, number] | number[] } }) => {
    if (Date.now() - pinPressedAt.current < PIN_TAP_GUARD_MS) return;
    const [lng, lat] = event.nativeEvent.lngLat; onPoint({ lng: lng!, lat: lat! });
  }, [onPoint]);
  const onMapLongPress = useCallback((event: { nativeEvent: { lngLat: [number, number] | number[] } }) => { const [lng, lat] = event.nativeEvent.lngLat; onLongPress({ lng: lng!, lat: lat! }); }, [onLongPress]);
  const onLoaded = useCallback(() => {
    setLoaded(true); setFailed(false);
    onCenter({ lng: viewRef.current.lng, lat: viewRef.current.lat });
  }, [onCenter]);
  const onFailed = useCallback(() => setFailed(true), []);
  const shapes = useMemo(() => buildingShapes(graph, highlightBuildings ? mappedBuildingIds : [], buildingId, pickedBuildingId), [graph, highlightBuildings, mappedBuildingIds, buildingId, pickedBuildingId]);
  const marked = useMemo(() => buildingShapes(graph, markedBuildingId ? [markedBuildingId] : []), [graph, markedBuildingId]);
  // Press handlers read the latest data through refs so they stay stable across renders.
  const pressData = useRef({ places, photoSpots, stepGroups, hasBuildingPress });
  pressData.current = { places, photoSpots, stepGroups, hasBuildingPress };
  const onBuildingShape = useCallback((event: FeaturePressEvent) => {
    const id = event.nativeEvent.features[0]?.properties?.['id'];
    if (typeof id === 'string' && pressData.current.hasBuildingPress) { event.stopPropagation(); onBuildingPress(id); }
  }, [onBuildingPress]);
  const onPlaceDot = useCallback((event: FeaturePressEvent) => {
    const id = event.nativeEvent.features[0]?.properties?.['id'];
    const place = pressData.current.places.find((p) => p.id === id);
    if (place) { event.stopPropagation(); onPlace(place); }
  }, [onPlace]);
  // Photo pins are React Native markers (PhotoPinMarker): the pin is drawn and tapped there (a Pressable, which a pan never
  // fires). A tap marks the time, and a map tap that the same touch also produced is ignored, so it cannot close the bubble
  // the pin just opened. There is no native dot layer under them any more (the green dots were dropped: the pin is the mark).
  const pinPressedAt = useRef(0);
  /** A finger went down on a pin or the bubble: the map tap this same touch produces is ignored (it would close the bubble first). */
  const markPinTouch = useCallback(() => { pinPressedAt.current = Date.now(); }, []);
  const openSpot = useCallback((i: number) => {
    const spot = pressData.current.photoSpots[i];
    if (!spot) return false;
    pinPressedAt.current = Date.now(); onPhotoSpot(spot); return true;
  }, [onPhotoSpot]);
  const openGroup = useCallback((i: number) => {
    const group = pressData.current.stepGroups[i];
    if (!group) return false;
    pinPressedAt.current = Date.now(); onStepGroup(group); return true;
  }, [onStepGroup]);
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
  useEffect(() => {
    // 위치 안내의 단계가 바뀌면 그 구간으로 부드럽게 이동한다(실내 층 맞춤 effect보다 뒤라 이 이동이 이긴다).
    // 진행 방위가 있는 단계: 그 방위가 화면 위쪽이 되게 돌리고 기울인다. 엘리베이터·계단처럼 제자리에서 층만 바뀌는 단계와
    // 실내 도면 단계: 정북·평면(3D 보기면 3D 기울기)으로 구간을 맞춘다. 같은 단계에서 사용자가 손으로 돌렸으면 그 방위를 지킨다.
    if (!loaded || !stepFocus) { stepKey.current = null; userTurned.current = null; return; }
    const sameStep = stepKey.current === stepFocus.key;
    stepKey.current = stepFocus.key;
    if (!sameStep) userTurned.current = null;
    const keep = userTurned.current === stepFocus.key;
    const view = navCamera(stepFocus.coordinates, stepFocus.bearingDeg ?? null, viewRef.current.height - fitPadding.top - fitPadding.bottom);
    if (view) {
      camera.current?.easeTo({ center: view.center, zoom: view.zoom, bearing: keep ? viewRef.current.bearing ?? view.bearing : view.bearing, pitch: keep ? pitchRef.current : NAV_PITCH_DEG, padding: fitPadding, duration: 700 });
      return;
    }
    const bounds = coordinateBounds(stepFocus.coordinates);
    if (bounds) camera.current?.fitBounds(bounds, { padding: { top: fitPadding.top + 16, bottom: fitPadding.bottom + 16, left: fitPadding.left + 16, right: fitPadding.right + 16 },
      bearing: keep ? viewRef.current.bearing ?? 0 : 0, pitch: keep ? pitchRef.current : threeD ? STACK_PITCH_DEG : 0, duration: 700 });
  }, [stepFocus?.key, loaded, buildingId, level]);
  // Navigation over: back to north-up and flat (or the 3D tilt).
  const navigating = stepFocus !== null;
  const wasNavigating = useRef(false);
  useEffect(() => {
    if (wasNavigating.current && !navigating && loaded) camera.current?.easeTo({ center: [viewRef.current.lng, viewRef.current.lat], bearing: 0, pitch: threeD ? STACK_PITCH_DEG : 0, duration: 500 });
    wasNavigating.current = navigating;
  }, [navigating, loaded]);
  // 3D 보기 on/off: tilt so the stacked floors read as floors (and back to flat).
  const shownThreeD = useRef(false);
  useEffect(() => {
    if (!loaded || shownThreeD.current === threeD) return;
    shownThreeD.current = threeD;
    camera.current?.easeTo({ center: [viewRef.current.lng, viewRef.current.lat], pitch: threeD ? STACK_PITCH_DEG : 0, duration: 500 });
  }, [threeD, loaded]);
  // easeTo needs a center: keep the current one (last region event) so only bearing and pitch change.
  const northUp = useCallback(() => camera.current?.easeTo({ center: [viewRef.current.lng, viewRef.current.lat], bearing: 0, pitch: 0, duration: 400 }), []);
  const building = buildingId ? graph?.buildings.get(buildingId) : null;
  const outline = useMemo(() => (building ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: getBuildingOutlineForLevel(building, level) } } : null), [building, level]);
  // Indoors: veil everything outside this building, so it reads as the only place that can be picked now.
  const mask = useMemo(() => (outline ? outsideMask(MASK_BOUNDS, outline.geometry.coordinates) : null), [outline]);
  const color = flow === 'queue' ? '#BA6700' : flow === 'exit' ? '#596579' : '#1F5EFF';
  const routePaint = useMemo((): LinePaint => ({ 'line-color': color, 'line-width': 5 }), [color]);
  const floorRoutePaint = useMemo((): LinePaint => ({ 'line-color': color, 'line-width': 6 }), [color]);
  const visible = (place: MapProps['from']) => place && (buildingId === null || place.buildingId === buildingId && place.level === level);
  return <View accessibilityLabel={label} style={styles.frame} onLayout={onLayout}>
    {/* The native compass, attribution button and logo are off: the app draws its own compass (bottom left) and OSM_ATTRIBUTION below. */}
    <Map style={styles.map} mapStyle={OSM_RASTER_STYLE} compass={false} attribution={false} logo={false}
      onRegionIsChanging={onMoving} onRegionDidChange={onSettled}
      onPress={onMapPress} onLongPress={onMapLongPress}
      onDidFinishLoadingMap={onLoaded} onDidFailLoadingMap={onFailed}>
      <Camera ref={camera} initialViewState={{ center: [center.lng, center.lat], zoom: 16 }}
        maxBounds={CAMPUS_MAX_BOUNDS} minZoom={CAMPUS_MIN_ZOOM} maxZoom={CAMPUS_MAX_ZOOM} />
      {buildingId === null && <GeoJSONSource id="app-outdoor-plazas" data={wayAreas}>
        <Layer id="app-outdoor-plaza-fill" type="fill" paint={P.plazaFill} />
        <Layer id="app-outdoor-plaza-line" type="line" paint={P.plazaLine} layout={ROUND_JOIN} />
      </GeoJSONSource>}
      {buildingId === null && <GeoJSONSource id="app-outdoor-ways" data={wayLines}>
        <Layer id="app-outdoor-way-walk" type="line" filter={F.walk} paint={P.walk} layout={ROUND} />
        <Layer id="app-outdoor-way-ramp" type="line" filter={F.ramp} paint={P.ramp} layout={ROUND} />
        <Layer id="app-outdoor-way-stairs" type="line" filter={F.stairs} paint={P.stairs} layout={ROUND} />
        <Layer id="app-outdoor-way-stairs-ticks" type="line" filter={F.stairs} paint={P.stairTicks} layout={ROUND_JOIN} />
      </GeoJSONSource>}
      {/* Mapped buildings stay tappable everywhere (an all but invisible fill: an opacity of 0 may not be rendered, and so not hit);
          only the building whose floor picker is open is drawn, with a strong border and fill. */}
      {shapes.features.length > 0 && <GeoJSONSource id="app-mapped-buildings" data={shapes} hitbox={HITBOX} onPress={onBuildingShape}>
        <Layer id="app-mapped-building-fill" type="fill" paint={P.mappedFill} />
        <Layer id="app-mapped-building-line" type="line" filter={F.picked} paint={P.mappedLine} layout={ROUND_JOIN} />
      </GeoJSONSource>}
      {marked.features.length > 0 && <GeoJSONSource id="app-marked-building" data={marked}>
        <Layer id="app-marked-building-line" type="line" paint={P.markedLine} />
      </GeoJSONSource>}
      {/* Layer order. MapLibre adds a layer on top when it is mounted, whatever its place here, so the indoor veil, the floor
          outline and the 3D glass are always mounted (empty when unused) and keep this order from the first frame; the route,
          indoor network and step lines mount later and so always draw over the glass (2D layers after a fill-extrusion paint
          over it), and the RN markers sit above all of them. */}
      <GeoJSONSource id="app-indoor-mask" data={mask ?? EMPTY}><Layer id="app-indoor-mask-fill" type="fill" paint={P.mask} /></GeoJSONSource>
      <GeoJSONSource id="app-building-outline" data={outline ?? EMPTY}><Layer id="app-building-fill" type="fill" paint={threeD ? P.buildingFill3d : P.buildingFill} /><Layer id="app-building-border" type="line" paint={P.buildingBorder} /></GeoJSONSource>
      {/* 3D 보기: glass floors. Faint slabs (two tiers: the floor just above, then fainter), dark rims along each slab's top and
          bottom edges so the plates read, and thin lift (purple) / stair (orange) vertical lines through them. */}
      <GeoJSONSource id="app-3d-floors" data={stack?.slabs ?? EMPTY}>
        <Layer id="app-3d-floor-slabs" type="fill-extrusion" filter={F.tierNear} paint={buildingId ? P.slabsNear : P.slabsOutdoor} />
        <Layer id="app-3d-floor-slabs-far" type="fill-extrusion" filter={F.tierFar} paint={P.slabsFar} />
      </GeoJSONSource>
      <GeoJSONSource id="app-3d-rims" data={stack?.rims ?? EMPTY}>
        <Layer id="app-3d-floor-rims" type="fill-extrusion" filter={F.tierNear} paint={P.rimsNear} />
        <Layer id="app-3d-floor-rims-far" type="fill-extrusion" filter={F.tierFar} paint={P.rimsFar} />
      </GeoJSONSource>
      <GeoJSONSource id="app-3d-links" data={stack?.links ?? EMPTY}>
        <Layer id="app-3d-link-lines" type="fill-extrusion" paint={P.links} />
      </GeoJSONSource>
      {stack && stack.outlines.features.length > 0 && <GeoJSONSource id="app-3d-outlines" data={stack.outlines}>
        <Layer id="app-3d-outline-line" type="line" paint={P.stackOutline} layout={ROUND_JOIN} />
      </GeoJSONSource>}
      {buildingId === null && connectors.features.length > 0 && <GeoJSONSource id="app-route-connectors" data={connectors}>
        <Layer id="app-route-connector-line" type="line" paint={P.connector} layout={ROUND} />
      </GeoJSONSource>}
      {line && buildingId === null && <GeoJSONSource id="app-route" data={line}>
        <Layer id="app-route-outline" type="line" paint={P.routeOutline} layout={ROUND} />
        <Layer id="app-route-line" type="line" paint={routePaint} layout={ROUND} />
      </GeoJSONSource>}
      {highlightLine && buildingId === null && <GeoJSONSource id="app-route-highlight" data={highlightLine}>
        <Layer id="app-route-highlight-outline" type="line" paint={P.highlightOutline} layout={ROUND} />
        <Layer id="app-route-highlight-line" type="line" paint={P.highlightLine} layout={ROUND} />
      </GeoJSONSource>}
      {buildingId !== null && <GeoJSONSource id="app-indoor" data={indoor}>
        <Layer id="app-floor-network" type="line" filter={F.offRoute} paint={P.floorNetwork} />
        <Layer id="app-floor-route" type="line" filter={F.onRoute} paint={floorRoutePaint} />
      </GeoJSONSource>}
      {stepLine && <GeoJSONSource id="app-nav-step" data={stepLine}>
        <Layer id="app-nav-step-outline" type="line" paint={P.stepOutline} layout={ROUND} />
        <Layer id="app-nav-step-line" type="line" paint={P.stepLine} layout={ROUND} />
      </GeoJSONSource>}
      {nameLayers.length > 0 && <GeoJSONSource id="app-building-names" data={nameData}>
        {nameLayers.map((bucket) => <Layer key={bucket} id={`app-building-name-${bucket}`} type="symbol" minzoom={bucket} filter={['==', ['get', 'bucket'], bucket]} layout={NAME_LAYOUT} paint={NAME_PAINT} />)}
      </GeoJSONSource>}
      <GeoJSONSource id="app-places" data={dots} onPress={onPlaceDot}>
        {/* Indoors the facility icons carry the meaning; the dots stay small as tap targets for places the icons leave out. */}
        <Layer id="app-place-dots" type="circle" paint={indoorView ? P.placeDotIndoor : P.placeDotOutdoor} />
      </GeoJSONSource>
      <MarkerLayer markers={markers} indoorView={indoorView} onPlace={onPlace} sink={markerSink} viewRef={viewRef} />
      {stepGroups.length === 0 && photoSpots.map((spot, i) => <PhotoPinMarker key={`spot:${spot.nodeId}`} id={`photo-pin:spot:${spot.nodeId}`} lngLat={spot.lngLat} index={i} count={spot.count} label={`사진 지점, 사진 ${spot.count}장. 눌러서 로드뷰 보기`} onOpen={openSpot} onTouch={markPinTouch} />)}
      {stepGroups.map((group, i) => <PhotoPinMarker key={`group:${group.key}`} id={`photo-pin:group:${group.key}`} lngLat={group.lngLat} index={i} count={group.entries.length}
        label={group.entries.length > 1 ? `경로 사진, ${group.entries.map((e) => e.label).join(' / ')}. 눌러서 고르기` : `경로 사진, ${group.entries[0]?.label ?? ''}. 눌러서 로드뷰 보기`} onOpen={openGroup} onTouch={markPinTouch} />)}
      {selected && visible(selected) && selected.id !== from?.id && selected.id !== to?.id && <SafeMarker id="selected-place" lngLat={validLngLat(selected.lng, selected.lat)} anchor="bottom"><View style={styles.selectedPin}><View style={styles.selectedDot} /></View></SafeMarker>}
      {visible(from) && from && <EndpointPin id="route-start" kind="from" lng={from.lng} lat={from.lat} />}
      {visible(to) && to && <EndpointPin id="route-end" kind="to" lng={to.lng} lat={to.lat} />}
      {preview && <PreviewBubble key={preview.key} preview={preview} onOpen={onOpenPreview} onTouch={markPinTouch} />}
      {pressPin && <SafeMarker id="press-pin" lngLat={validLngLat(pressPin.lng, pressPin.lat)} anchor="bottom">
        <View accessible accessibilityLabel="길게 눌러 고른 위치" style={styles.pressPin} pointerEvents="none">
          <View style={styles.pressPinHead}><View style={styles.pressPinHole} /></View>
          <View style={styles.pressPinTip} />
        </View>
      </SafeMarker>}
      {position && <SafeMarker id="current-position" lngLat={validLngLat(position.lng, position.lat)}><View style={styles.current} /></SafeMarker>}
    </Map>
    {failed && <Text accessibilityLiveRegion="polite" style={styles.error}>배경 지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. 수동 길찾기는 계속 이용할 수 있습니다.</Text>}
    <Text pointerEvents="none" style={styles.attribution}>{OSM_ATTRIBUTION}</Text>
    <CompassButton bind={compass} onPress={northUp} />
  </View>;
});
type RegionEvent = { nativeEvent: { center: [number, number] | number[]; zoom: number; bearing: number; pitch?: number; userInteraction?: boolean } };
type FeaturePressEvent = { nativeEvent: { features: { properties?: Record<string, unknown> | null }[] }; stopPropagation: () => void };
const NO_IDS: readonly string[] = [];
/**
 * Facility icons and name labels. The declutter layout lives here, not in the map: while a finger moves the map, a new
 * layout re-renders only these markers (never the sources and layers above), and that render runs as a transition so it
 * yields to the next gesture frame. Mid-gesture layouts are throttled (MOVING_LAYOUT_MS) and skipped while nothing moved
 * enough; when the map settles the exact layout is applied at once.
 */
const MarkerLayer = memo(function MarkerLayer({ markers, indoorView, onPlace, sink, viewRef }: {
  markers: readonly MapMarker[]; indoorView: boolean; onPlace: (place: CampusPlace) => void;
  sink: { current: ViewSink | null }; viewRef: { current: MapView };
}) {
  const scheduler = useRef<DeclutterScheduler | null>(null);
  scheduler.current ??= new DeclutterScheduler({ throttleMs: MOVING_LAYOUT_MS });
  const [placed, setPlaced] = useState<PlacedMarker[]>([]);
  const shown = useRef(placed);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Re-render only when the scheduler produced a different layout (it returns the same array otherwise). */
  const apply = useCallback((next: PlacedMarker[], urgent: boolean) => {
    if (next === shown.current) return;
    shown.current = next;
    if (urgent) setPlaced(next); else startTransition(() => setPlaced(next));
  }, []);
  // New markers or indoor/outdoor: lay out again now.
  useEffect(() => { apply(scheduler.current!.setMarkers(markers, indoorView), true); }, [markers, indoorView, apply]);
  useEffect(() => {
    const s = scheduler.current!;
    const clear = () => { if (trailing.current) { clearTimeout(trailing.current); trailing.current = null; } };
    sink.current = {
      // While panning/zooming: throttled layout. If movement pauses with a deferred layout and no settle event follows,
      // a debounced trailing layout catches up (it never fires while events keep coming, so it adds no work mid-gesture).
      moving: (view) => {
        apply(s.moving(view, Date.now()), false);
        clear();
        if (s.pending) trailing.current = setTimeout(() => { trailing.current = null; apply(s.flush(Date.now()), false); }, MOVING_LAYOUT_MS);
      },
      // Settled (or resized): exact layout.
      settled: (view) => { clear(); apply(s.settle(view, Date.now()), true); },
    };
    // The frame may have been measured before this layer subscribed.
    if (viewRef.current.width > 0) apply(s.settle(viewRef.current, Date.now()), true);
    return () => { sink.current = null; clear(); };
  }, [sink, viewRef, apply]);
  const icons = useMemo(() => (indoorView ? placed.filter((p) => p.marker.tone === 'normal').map((p) => p.marker) : []), [placed, indoorView]);
  const labels = useMemo(() => placed.filter((p) => p.label && p.marker.name).map((p) => p.marker), [placed]);
  return <>
    {icons.map((marker) => <FacilityMarker key={`icon:${marker.id}`} marker={marker} onPlace={onPlace} />)}
    {labels.map((marker) => <LabelMarker key={`label:${marker.id}`} marker={marker} />)}
  </>;
});
/** Mid-gesture re-layout interval. Longer than the scheduler default: markers re-mount less often while a finger moves. */
const MOVING_LAYOUT_MS = Math.max(DECLUTTER_THROTTLE_MS, 120);
/** Steep-section highlight on the route (a slope card in the sheet). */
export const HIGHLIGHT_COLOR = '#E68A00';
type ExtrusionPaint = NonNullable<FillExtrusionLayerSpecification['paint']>;
type LinePaint = NonNullable<LineLayerSpecification['paint']>; type FillPaint = NonNullable<FillLayerSpecification['paint']>; type CirclePaint = NonNullable<CircleLayerSpecification['paint']>; type LineLayout = NonNullable<LineLayerSpecification['layout']>;
/** Slab, rim and link heights from the feature (stack3d.ts); flat colour, no vertical gradient (glass, not a block). */
const SLAB_HEIGHT = { 'fill-extrusion-base': ['get', 'baseM'], 'fill-extrusion-height': ['get', 'topM'], 'fill-extrusion-vertical-gradient': false } satisfies ExtrusionPaint;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const ROUND: LineLayout = { 'line-cap': 'round', 'line-join': 'round' };
const ROUND_JOIN: LineLayout = { 'line-join': 'round' };
/** Layer filters and paints are module constants: the same object every render, so nothing is re-sent to native. */
const F: Record<'walk' | 'ramp' | 'stairs' | 'offRoute' | 'onRoute' | 'picked' | 'tierNear' | 'tierFar', FilterSpecification> = {
  walk: ['==', ['get', 'kind'], 'walk'], ramp: ['==', ['get', 'kind'], 'ramp'], stairs: ['==', ['get', 'kind'], 'stairs'],
  offRoute: ['==', ['get', 'route'], false], onRoute: ['==', ['get', 'route'], true],
  picked: ['==', ['get', 'picked'], true], tierNear: ['==', ['get', 'tier'], 0], tierFar: ['==', ['get', 'tier'], 1],
};
const P = {
  plazaFill: { 'fill-color': '#E2E6EB', 'fill-opacity': 1 }, plazaLine: { 'line-color': '#CFD6DF', 'line-width': 0.8 },
  walk: { 'line-color': '#DCE1E7', 'line-width': WAY_WIDTH }, ramp: { 'line-color': '#C7DDD1', 'line-width': WAY_WIDTH }, stairs: { 'line-color': '#E1D0BA', 'line-width': WAY_WIDTH },
  stairTicks: { 'line-color': '#B89E7E', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 2.2], 'line-dasharray': [1.2, 1.8] },
  // Mapped buildings: nothing drawn by default (a 0.01 fill keeps them tappable); the one whose floor picker is open: strong.
  mappedFill: { 'fill-color': t.color.primary, 'fill-opacity': ['case', ['get', 'current'], 0, ['get', 'picked'], 0.28, 0.01] },
  mappedLine: { 'line-color': '#0B3FC4', 'line-width': 4 },
  markedLine: { 'line-color': t.color.primary, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  mask: { 'fill-color': '#000000', 'fill-opacity': 0.35 },
  buildingFill: { 'fill-color': '#E4EAF1', 'fill-opacity': 0.85 }, buildingFill3d: { 'fill-color': '#FCE9A8', 'fill-opacity': 0.9 }, buildingBorder: { 'line-color': '#63788D', 'line-width': 2 },
  connector: { 'line-color': '#1F5EFF', 'line-width': 3, 'line-opacity': 0.65, 'line-dasharray': [1.5, 1.5] },
  routeOutline: { 'line-color': '#FFFFFF', 'line-width': 9 },
  highlightOutline: { 'line-color': '#FFFFFF', 'line-width': 11 }, highlightLine: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 7 },
  stepOutline: { 'line-color': '#FFFFFF', 'line-width': 12 }, stepLine: { 'line-color': '#0B3FC4', 'line-width': 8 },
  floorNetwork: { 'line-color': '#708397', 'line-width': 3 },
  placeDotIndoor: { 'circle-radius': 3.5, 'circle-color': '#8A97A8', 'circle-stroke-color': 'white', 'circle-stroke-width': 1.5 },
  placeDotOutdoor: { 'circle-radius': 6, 'circle-color': '#18744D', 'circle-stroke-color': 'white', 'circle-stroke-width': 2 },
  // 3D 보기 as glass (stack3d.ts). fill-extrusion-opacity is one value per layer and the colour's alpha is ignored, so each
  // density is its own layer: the floor just above the chosen one, the floors above that (fainter), and outdoors every floor.
  // The rims carry the plates' edges (the editor's wireframe); lift and stair lines are hairline-thin columns (LINK_W_M) drawn near-opaque so they read through the glass.
  slabsNear: { 'fill-extrusion-color': STACK_FLOOR_COLOR, 'fill-extrusion-opacity': 0.2, ...SLAB_HEIGHT },
  slabsFar: { 'fill-extrusion-color': STACK_FLOOR_COLOR, 'fill-extrusion-opacity': 0.1, ...SLAB_HEIGHT },
  slabsOutdoor: { 'fill-extrusion-color': ['case', ['get', 'picked'], '#8FB0F5', STACK_FLOOR_COLOR], 'fill-extrusion-opacity': 0.3, ...SLAB_HEIGHT },
  rimsNear: { 'fill-extrusion-color': STACK_EDGE_COLOR, 'fill-extrusion-opacity': 0.55, ...SLAB_HEIGHT },
  rimsFar: { 'fill-extrusion-color': STACK_EDGE_COLOR, 'fill-extrusion-opacity': 0.3, ...SLAB_HEIGHT },
  links: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-opacity': 0.95, ...SLAB_HEIGHT },
  stackOutline: { 'line-color': STACK_EDGE_COLOR, 'line-width': 1.2, 'line-opacity': 0.55 },
} satisfies Record<string, LinePaint | FillPaint | CirclePaint | ExtrusionPaint>;
/** The indoor veil covers the whole camera range (the camera cannot leave CAMPUS_MAX_BOUNDS), with a margin. */
const MASK_BOUNDS: [number, number, number, number] = [CAMPUS_MAX_BOUNDS[0] - 0.05, CAMPUS_MAX_BOUNDS[1] - 0.05, CAMPUS_MAX_BOUNDS[2] + 0.05, CAMPUS_MAX_BOUNDS[3] + 0.05];
const COMPASS = 44;

/**
 * Bottom-left compass above the attribution. The needle follows the map's bearing while it moves and at rest
 * (`bind` receives every region event); tapping eases back to north-up and flat. North-up: quiet; rotated or tilted: accented.
 * The needle turns through an Animated value set directly, so a rotating map never re-renders this component; it renders
 * only when north-up flips, and the spoken degrees update when the map settles.
 */
const CompassButton = memo(function CompassButton({ bind, onPress }: { bind: { current: ((bearing: number, pitch: number, settled: boolean) => void) | null }; onPress: () => void }) {
  const [state, setState] = useState(() => ({ northUp: true, degrees: 0 }));
  const rotation = useRef(new Animated.Value(0)).current;
  const spin = useMemo(() => rotation.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }), [rotation]);
  useEffect(() => {
    let last = 0;
    bind.current = (bearing, pitch, settled) => {
      const next = compassState(bearing, pitch);
      // Whole degrees are enough for the needle.
      const whole = Math.round(next.rotation);
      if (whole !== last) { last = whole; rotation.setValue(next.rotation); }
      const degrees = settled ? Math.round(Math.abs(next.rotation)) : null;
      setState((old) => (old.northUp === next.northUp && (degrees === null || degrees === old.degrees) ? old : { northUp: next.northUp, degrees: degrees ?? old.degrees }));
    };
    return () => { bind.current = null; };
  }, [bind, rotation]);
  return <Pressable accessibilityRole="button" accessibilityLabel="나침반, 누르면 정북으로 정렬"
    accessibilityValue={{ text: state.northUp ? '지금 북쪽이 위입니다' : `지도가 ${state.degrees}도 돌아가 있습니다` }}
    hitSlop={4} onPress={onPress} style={state.northUp ? compassStyle : compassRotatedStyle}>
    <Animated.View pointerEvents="none" style={[styles.needle, { transform: [{ rotate: spin }] }]}>
      <Text style={state.northUp ? styles.compassN : compassNRotated}>N</Text>
      <View style={styles.needleNorth} />
      <View style={styles.needleSouth} />
    </Animated.View>
  </Pressable>;
});
const compassStyle = ({ pressed }: { pressed: boolean }) => [styles.compass, pressed && styles.compassPressed];
const compassRotatedStyle = ({ pressed }: { pressed: boolean }) => [styles.compass, styles.compassRotated, pressed && styles.compassPressed];
const DEFAULT_PADDING = { top: 40, bottom: 40, left: 35, right: 35 };
const ATTRIBUTION_BOTTOM = 22;
const HITBOX = { top: 16, right: 16, bottom: 16, left: 16 };
/**
 * A map tap this soon after a finger went down on a pin or the bubble is the same touch: ignored, so the map's own tap
 * (which closes the bubble) can never unmount the bubble before its Pressable fires. Long enough for a slow tap.
 */
export const PIN_TAP_GUARD_MS = 700;
/** Extra touch margin around a pin / the bubble: a finger that wobbles a little (right after a pan or pinch) still counts as a tap. */
const PIN_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
/** Touch target of a photo pin's Marker (pt). */
const PIN_TOUCH = 48;
/** Visible photo pin disc (pt). */
const PHOTO_PIN = 28;

/**
 * A photo point: a small white disc with a drawn photo glyph (navy frame and lens), centred on the point, and a navy count
 * badge when the point has two or more photos (or the route passes it twice). The 48pt Pressable around it is the touch
 * target: it fires only on a short tap, never on a pan, and its touch does not reach the map. Memoised on its values.
 */
const PhotoPinMarker = memo(function PhotoPinMarker({ id, lngLat, index, count, label, onOpen, onTouch }: { id: string; lngLat: [number, number] | null; index: number; count: number; label: string; onOpen: (i: number) => boolean; onTouch: () => void }) {
  return <SafeMarker id={id} lngLat={validLngLatTuple(lngLat)} anchor="center">
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPressIn={onTouch} onPress={() => { onOpen(index); }} hitSlop={PIN_SLOP} pressRetentionOffset={PIN_SLOP} style={pinTouchStyle}>
      <View pointerEvents="none" style={styles.photoPin}>
        <View style={styles.photoGlyph}><View style={styles.photoLens} /></View>
        {count > 1 && <View style={styles.photoCount}><Text style={styles.photoCountText}>{count > 99 ? '99+' : count}</Text></View>}
      </View>
    </Pressable>
  </SafeMarker>;
});

/**
 * One facility icon centred on its coordinate. Registered places are tappable (44pt hit area); bare stairs/lifts are not.
 * Memoised on the marker object (stable while the marker list is), so a pan that keeps an icon does not rebuild it.
 */
const FacilityMarker = memo(function FacilityMarker({ marker, onPlace }: { marker: MapMarker; onPlace: (place: CampusPlace) => void }) {
  const place = marker.place;
  const kind = MARKER_KIND_LABEL[marker.kind];
  return <SafeMarker id={`facility:${marker.id}`} lngLat={validLngLat(marker.lng, marker.lat)} anchor="center">
    {place ? <Pressable accessibilityRole="button" accessibilityLabel={`${place.name}, ${kind}`} hitSlop={11} onPress={() => onPlace(place)}><FacilityIcon kind={marker.kind} /></Pressable>
      : <View accessible accessibilityLabel={kind}><FacilityIcon kind={marker.kind} /></View>}
  </SafeMarker>;
});
/** Name label above a marker; memoised like FacilityMarker. */
const LabelMarker = memo(function LabelMarker({ marker }: { marker: MapMarker }) {
  return <SafeMarker id={`place-label:${marker.id}`} lngLat={validLngLat(marker.lng, marker.lat)} anchor="bottom" offset={[0, -labelLift(marker.tone)]}>
    <View pointerEvents="none"><MapLabel name={marker.name!} kind={marker.kind} tone={marker.tone} /></View>
  </SafeMarker>;
});
type RnMarkerProps = Parameters<typeof RnMarker>[0];
/** Marker that renders nothing for a missing/non-finite coordinate: a native Marker throws on NaN and kills the screen. */
function SafeMarker({ lngLat, ...rest }: Omit<RnMarkerProps, 'lngLat'> & { lngLat: [number, number] | null | undefined }) {
  const safe = validLngLatTuple(lngLat);
  return safe === null ? null : <RnMarker lngLat={safe} {...rest} />;
}
const DOT = 14;
const STEM = 22;

/**
 * Exact start/end pin: a small colored dot centred on the coordinate (green start, red end), and above it a thin stem
 * with the 출발/도착 badge. Two markers so the dot's centre, not the badge, sits on the point.
 */
const EndpointPin = memo(function EndpointPin({ id, kind, lng, lat }: { id: string; kind: 'from' | 'to'; lng: number; lat: number }) {
  const lngLat = useMemo(() => validLngLat(lng, lat), [lng, lat]);
  const color = kind === 'from' ? '#10A85E' : '#F2473F';
  const text = kind === 'from' ? '출발' : '도착';
  return <>
    <SafeMarker id={`${id}-label`} lngLat={lngLat} anchor="bottom" offset={[0, -DOT / 2]}>
      <View style={styles.pinLabel} pointerEvents="none">
        <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText}>{text}</Text></View>
        <View style={[styles.stem, { backgroundColor: color }]} />
      </View>
    </SafeMarker>
    <SafeMarker id={`${id}-dot`} lngLat={lngLat} anchor="center">
      <View accessible accessibilityLabel={`${text} 지점`} style={[styles.dot, { backgroundColor: color }]} />
    </SafeMarker>
  </>;
});

/** Speech bubble with the roadview thumbnail. One entry: tap to open. Two or more: pick 가는 길 / 오는 길. */
const PreviewBubble = memo(function PreviewBubble({ preview, onOpen, onTouch }: { preview: RoadviewPreview; onOpen: (entry: number | null) => void; onTouch: () => void }) {
  const single = preview.entries.length <= 1;
  return <SafeMarker id={`roadview-preview-${preview.key}`} lngLat={validLngLatTuple(preview.lngLat)} anchor="bottom" offset={[0, -12]}>
    <View style={styles.bubbleWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${preview.title} 로드뷰 보기`} disabled={!single} onPressIn={onTouch} onPress={() => onOpen(preview.entries[0]?.index ?? null)} pressRetentionOffset={PIN_SLOP} style={styles.bubble}>
        {preview.thumbUrl ? <Image source={{ uri: preview.thumbUrl }} contentFit="cover" style={styles.bubbleThumb} /> : <View style={[styles.bubbleThumb, { backgroundColor: '#596579' }]} />}
        <View style={styles.bubbleBody}>
          <Text numberOfLines={1} style={styles.bubbleTitle}>{preview.title}</Text>
          <Text numberOfLines={1} style={styles.bubbleSub}>{single ? `${preview.subtitle} · 눌러서 로드뷰` : '두 번 지나는 지점입니다'}</Text>
          {!single && <View style={styles.bubbleChoices}>{preview.entries.map((entry) => <Pressable key={entry.index} accessibilityRole="button" accessibilityLabel={`${entry.label} 로드뷰 보기`} onPressIn={onTouch} onPress={() => onOpen(entry.index)} style={styles.bubbleChoice}>
            <Text style={styles.bubbleChoiceText}>{entry.label}</Text>
          </Pressable>)}</View>}
        </View>
      </Pressable>
      <View style={styles.bubbleTail} />
    </View>
  </SafeMarker>;
});
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
  pinTouch: { width: PIN_TOUCH, height: PIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  photoPin: { width: PHOTO_PIN, height: PHOTO_PIN, borderRadius: PHOTO_PIN / 2, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#0B1F3A', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  pinTouchPressed: { opacity: 0.6 },
  photoGlyph: { width: 14, height: 11, borderRadius: 3, borderWidth: 1.8, borderColor: t.color.text, alignItems: 'center', justifyContent: 'center' },
  photoLens: { width: 4.5, height: 4.5, borderRadius: 2.25, backgroundColor: t.color.text },
  photoCount: { position: 'absolute', top: -6, right: -9, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: t.color.text, borderWidth: 1.5, borderColor: t.color.surface, alignItems: 'center', justifyContent: 'center' },
  photoCountText: { color: 'white', fontSize: 10, lineHeight: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pressPin: { alignItems: 'center' },
  pressPinHead: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#142A44', borderWidth: 3, borderColor: 'white', alignItems: 'center', justifyContent: 'center', elevation: 5 },
  pressPinHole: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'white' },
  pressPinTip: { width: 0, height: 0, marginTop: -2, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#142A44' },
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
const compassNRotated = [styles.compassN, { color: '#F2473F' }];
const pinTouchStyle = ({ pressed }: { pressed: boolean }) => [styles.pinTouch, pressed && styles.pinTouchPressed];
