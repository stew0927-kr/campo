import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CampusPlace, CampusRouteView, RoutePoint } from '../../contracts.ts';
import { OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../../map/style.ts';
import { routeBounds, routeLine } from './model.ts';

export function CampusMap({ center, route, from, to }: { center: RoutePoint; route: CampusRouteView | null; from: CampusPlace | null; to: CampusPlace | null }) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const line = useMemo(() => routeLine(route?.polyline ?? []), [route]);
  useEffect(() => {
    if (!loaded) return;
    const bounds = routeBounds(route?.polyline ?? []);
    if (bounds) camera.current?.fitBounds(bounds, { padding: { top: 45, bottom: 45, left: 45, right: 45 }, duration: 600 });
  }, [route, loaded]);
  return <View style={styles.frame}>
    <Map style={styles.map} mapStyle={OSM_RASTER_STYLE} onDidFinishLoadingMap={() => { setLoaded(true); setFailed(false); }} onDidFailLoadingMap={() => setFailed(true)}>
      <Camera ref={camera} initialViewState={{ center: [center.lng, center.lat], zoom: 16 }} />
      {line && <GeoJSONSource id="app-route" data={line}>
        <Layer id="app-route-outline" type="line" paint={{ 'line-color': '#FFFFFF', 'line-width': 9 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="app-route-line" type="line" paint={{ 'line-color': '#1465E8', 'line-width': 5 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>}
      {from && <Marker id="route-start" lngLat={[from.lng, from.lat]} anchor="bottom"><View style={[styles.pin, styles.start]}><Text style={styles.pinText}>출발</Text></View></Marker>}
      {to && <Marker id="route-end" lngLat={[to.lng, to.lat]} anchor="bottom"><View style={[styles.pin, styles.end]}><Text style={styles.pinText}>도착</Text></View></Marker>}
    </Map>
    <View pointerEvents="none" style={styles.campus}><Text style={styles.label}>한양대학교 서울캠퍼스</Text></View>
    {failed && <Text accessibilityLiveRegion="polite" style={styles.error}>배경 지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. 수동 길찾기는 계속 이용할 수 있습니다.</Text>}
    <Text pointerEvents="none" style={styles.attribution}>{OSM_ATTRIBUTION}</Text>
  </View>;
}
const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 180, backgroundColor: '#E8EEE9' }, map: { flex: 1 },
  campus: { position: 'absolute', top: 12, left: 12, padding: 8, borderRadius: 8, backgroundColor: '#FFFFFFEE' }, label: { fontSize: 12, color: '#183451', fontWeight: '600' },
  attribution: { position: 'absolute', bottom: 4, left: 6, fontSize: 10, color: '#183451', backgroundColor: '#FFFFFFDD', padding: 3 },
  pin: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 2, borderColor: 'white' }, start: { backgroundColor: '#18744D' }, end: { backgroundColor: '#1465E8' }, pinText: { color: 'white', fontWeight: '700' },
  error: { position: 'absolute', top: 50, left: 12, right: 12, padding: 10, backgroundColor: '#FFF2DA', color: '#7A4300', borderRadius: 8 },
});
