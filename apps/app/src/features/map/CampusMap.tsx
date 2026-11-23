import { getBuildingOutlineForLevel } from '@campo/core';
import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FeatureCollection, Point } from 'geojson';
import { OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../../map/style.ts';
import { routeBounds, routeLine } from './model.ts';
import { floorLines } from './indoor.ts';
import { Image } from 'expo-image';
import type { MapProps, RoadviewPreview } from './mapTypes.ts';
export function CampusMap({ center, label, route, from, to, places, graph, buildingId, level, position, flow, onPoint, onPlace, focus = null, selected = null, fitPadding = DEFAULT_PADDING,
  photoSpots = [], onPhotoSpot, stepGroups = [], onStepGroup, preview = null, onOpenPreview }: MapProps) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(16);
  const [failed, setFailed] = useState(false);
  const line = useMemo(() => routeLine(route?.polyline ?? []), [route]);
  const indoor = useMemo(() => floorLines(graph, buildingId, level, route), [graph, buildingId, level, route]);
  const spotData: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: photoSpots.map((spot, i) => ({ type: 'Feature', properties: { i, count: spot.count }, geometry: { type: 'Point', coordinates: spot.lngLat } })) }), [photoSpots]);
  const groupData: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: stepGroups.map((group, i) => ({ type: 'Feature', properties: { i, twice: group.entries.length > 1 }, geometry: { type: 'Point', coordinates: group.lngLat } })) }), [stepGroups]);
  const dots: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: places.map((place) => ({ type: 'Feature', properties: { id: place.id }, geometry: { type: 'Point', coordinates: [place.lng, place.lat] } })) }), [places]);
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
    if (loaded && focus) camera.current?.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(zoom, 17), duration: 450 });
  }, [focus?.key, loaded]);
  const building = buildingId ? graph?.buildings.get(buildingId) : null;
  const outline = building ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: getBuildingOutlineForLevel(building, level) } } : null;
  const color = flow === 'queue' ? '#BA6700' : flow === 'exit' ? '#596579' : '#1F5EFF';
  const visible = (place: MapProps['from']) => place && (buildingId === null || place.buildingId === buildingId && place.level === level);
  return <View accessibilityLabel={label} style={styles.frame}>
    <Map style={styles.map} mapStyle={OSM_RASTER_STYLE}
      onRegionDidChange={(event) => setZoom(event.nativeEvent.zoom)}
      onPress={(event) => { const [lng, lat] = event.nativeEvent.lngLat; onPoint({ lng, lat }); }}
      onDidFinishLoadingMap={() => { setLoaded(true); setFailed(false); }} onDidFailLoadingMap={() => setFailed(true)}>
      <Camera ref={camera} initialViewState={{ center: [center.lng, center.lat], zoom: 16 }} />
      {outline && <GeoJSONSource id="app-building-outline" data={outline}><Layer id="app-building-fill" type="fill" paint={{ 'fill-color': '#E4EAF1', 'fill-opacity': 0.85 }} /><Layer id="app-building-border" type="line" paint={{ 'line-color': '#63788D', 'line-width': 2 }} /></GeoJSONSource>}
      {line && buildingId === null && <GeoJSONSource id="app-route" data={line}>
        <Layer id="app-route-outline" type="line" paint={{ 'line-color': '#FFFFFF', 'line-width': 9 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="app-route-line" type="line" paint={{ 'line-color': color, 'line-width': 5 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>}
      {buildingId !== null && <GeoJSONSource id="app-indoor" data={indoor}>
        <Layer id="app-floor-network" type="line" filter={['==', ['get', 'route'], false]} paint={{ 'line-color': '#708397', 'line-width': 3 }} />
        <Layer id="app-floor-route" type="line" filter={['==', ['get', 'route'], true]} paint={{ 'line-color': color, 'line-width': 6 }} />
      </GeoJSONSource>}
      <GeoJSONSource id="app-places" data={dots} onPress={(event) => {
        const id = event.nativeEvent.features[0]?.properties?.['id'];
        const place = places.find((p) => p.id === id);
        if (place) { event.stopPropagation(); onPlace(place); }
      }}><Layer id="app-place-dots" type="circle" paint={{ 'circle-radius': 6, 'circle-color': '#18744D', 'circle-stroke-color': 'white', 'circle-stroke-width': 2 }} /></GeoJSONSource>
      {zoom >= 17 && places.slice(0, 30).map((place) => <Marker key={`label:${place.id}`} id={`place-label:${place.id}`} lngLat={[place.lng, place.lat]} anchor="top" onPress={() => onPlace(place)}><View style={{ backgroundColor: '#FFFFFFEE', padding: 4, borderRadius: 5, marginTop: 8 }}><Text style={styles.label}>{place.name}</Text></View></Marker>)}
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
      {preview && <PreviewBubble preview={preview} onOpen={(entry) => onOpenPreview?.(entry)} />}
      {position && <Marker id="current-position" lngLat={[position.lng, position.lat]}><View style={styles.current} /></Marker>}
    </Map>
    {failed && <Text accessibilityLiveRegion="polite" style={styles.error}>배경 지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. 수동 길찾기는 계속 이용할 수 있습니다.</Text>}
    <Text pointerEvents="none" style={styles.attribution}>{OSM_ATTRIBUTION}</Text>
  </View>;
}
const DEFAULT_PADDING = { top: 40, bottom: 40, left: 35, right: 35 };
const HITBOX = { top: 16, right: 16, bottom: 16, left: 16 };
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
  label: { fontSize: 12, color: '#142A44', fontWeight: '600' },
  // Bottom offsets leave room for the sheet that overlaps the map edge.
  attribution: { position: 'absolute', bottom: 22, left: 8, fontSize: 10, color: '#142A44', backgroundColor: '#FFFFFFDD', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
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
  error: { position: 'absolute', bottom: 48, left: 12, right: 72, padding: 10, backgroundColor: '#FFF5DF', color: '#8A5200', borderRadius: 10, fontSize: 13 },
});
