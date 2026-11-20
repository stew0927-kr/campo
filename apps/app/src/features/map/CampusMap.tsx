import { getBuildingOutlineForLevel } from '@campo/core';
import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { FeatureCollection, Point } from 'geojson';
import { OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../../map/style.ts';
import { routeBounds, routeLine } from './model.ts';
import { floorLines } from './indoor.ts';
import { RoutePhotoMarkers } from '../../photos/RoutePhotoMarkers.tsx';
import type { MapProps } from './mapTypes.ts';
export function CampusMap({ center, label, route, from, to, places, graph, buildingId, level, position, flow, onPoint, onPlace, stepPhotos = [], onOpenPhoto }: MapProps) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(16);
  const [failed, setFailed] = useState(false);
  const line = useMemo(() => routeLine(route?.polyline ?? []), [route]);
  const indoor = useMemo(() => floorLines(graph, buildingId, level, route), [graph, buildingId, level, route]);
  const dots: FeatureCollection<Point> = useMemo(() => ({ type: 'FeatureCollection', features: places.map((place) => ({ type: 'Feature', properties: { id: place.id }, geometry: { type: 'Point', coordinates: [place.lng, place.lat] } })) }), [places]);
  useEffect(() => {
    if (loaded) camera.current?.jumpTo({ center: [center.lng, center.lat], zoom: 16 });
  }, [center.lng, center.lat, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const floorPoints = places.map((p) => ({ lng: p.lng, lat: p.lat }));
    const bounds = routeBounds(buildingId ? floorPoints : route?.polyline ?? []);
    if (bounds) camera.current?.fitBounds(bounds, { padding: { top: 40, bottom: 40, left: 35, right: 35 }, duration: 500 });
  }, [route, loaded, buildingId, level, places]);
  const building = buildingId ? graph?.buildings.get(buildingId) : null;
  const outline = building ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: getBuildingOutlineForLevel(building, level) } } : null;
  const color = flow === 'queue' ? '#BA6700' : flow === 'exit' ? '#596579' : '#1465E8';
  const visible = (place: MapProps['from']) => place && (buildingId === null || place.buildingId === buildingId && place.level === level);
  return <View style={styles.frame}>
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
      {onOpenPhoto && <RoutePhotoMarkers stepPhotos={stepPhotos} onOpen={onOpenPhoto} />}
      {visible(from) && from && <Marker id="route-start" lngLat={[from.lng, from.lat]} anchor="bottom"><View style={[styles.pin, styles.start]}><Text style={styles.pinText}>출발</Text></View></Marker>}
      {visible(to) && to && <Marker id="route-end" lngLat={[to.lng, to.lat]} anchor="bottom"><View style={[styles.pin, styles.end]}><Text style={styles.pinText}>도착</Text></View></Marker>}
      {position && <Marker id="current-position" lngLat={[position.lng, position.lat]}><View style={styles.current} /></Marker>}
    </Map>
    <View pointerEvents="none" style={styles.campus}><Text style={styles.label}>{label}</Text></View>
    {failed && <Text accessibilityLiveRegion="polite" style={styles.error}>배경 지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. 수동 길찾기는 계속 이용할 수 있습니다.</Text>}
    <Text pointerEvents="none" style={styles.attribution}>{OSM_ATTRIBUTION}</Text>
  </View>;
}
const styles = StyleSheet.create({
  frame: { height: 300, backgroundColor: '#E8EEE9' }, map: { flex: 1 },
  campus: { position: 'absolute', top: 12, left: 12, padding: 8, borderRadius: 8, backgroundColor: '#FFFFFFEE' }, label: { fontSize: 12, color: '#183451', fontWeight: '600' },
  attribution: { position: 'absolute', bottom: 4, left: 6, fontSize: 10, color: '#183451', backgroundColor: '#FFFFFFDD', padding: 3 },
  pin: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 2, borderColor: 'white' }, start: { backgroundColor: '#18744D' }, end: { backgroundColor: '#1465E8' }, pinText: { color: 'white', fontWeight: '700' },
  current: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#1465E8', borderWidth: 3, borderColor: 'white' },
  error: { position: 'absolute', top: 50, left: 12, right: 12, padding: 10, backgroundColor: '#FFF2DA', color: '#7A4300', borderRadius: 8 },
});
