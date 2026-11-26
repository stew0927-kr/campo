// MapLibre mini map for the split roadview: the viewed point, its field-of-view cone (heading_deg ± hfov/2) and the route.
import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../../map/style.ts';
import { viewCone } from '../../photos/roadviewModel.ts';
import { routeLine } from './model.ts';
import { validLngLatTuple } from './markerCoords.ts';
import type { RoadviewMiniMapProps } from './roadviewTypes.ts';

export function RoadviewMiniMapNative({ lngLat, headingDeg, hfovDeg, route, stops = [], label }: RoadviewMiniMapProps) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  const cone = useMemo(() => (lngLat ? viewCone(lngLat, headingDeg, hfovDeg) : null), [lngLat?.[0], lngLat?.[1], headingDeg, hfovDeg]);
  const line = useMemo(() => routeLine(route ?? []), [route]);
  const stopData = useMemo(() => ({ type: 'FeatureCollection' as const, features: stops.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [p[0], p[1]] } })) }), [stops]);
  useEffect(() => { if (loaded && lngLat) camera.current?.easeTo({ center: lngLat, zoom: 18.5, duration: 350 }); }, [loaded, lngLat?.[0], lngLat?.[1]]);
  return <View style={s.frame} accessibilityLabel={label}>
    <Map style={s.map} mapStyle={OSM_RASTER_STYLE} onDidFinishLoadingMap={() => setLoaded(true)}>
      <Camera ref={camera} initialViewState={{ center: lngLat ?? [127.045, 37.5572], zoom: 18.5 }} />
      {line && <GeoJSONSource id="rv-route" data={line}>
        <Layer id="rv-route-outline" type="line" paint={{ 'line-color': '#FFFFFF', 'line-width': 7 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        <Layer id="rv-route-line" type="line" paint={{ 'line-color': '#1F5EFF', 'line-width': 4 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>}
      <GeoJSONSource id="rv-stops" data={stopData}><Layer id="rv-stop-dots" type="circle" paint={{ 'circle-radius': 4, 'circle-color': '#596579', 'circle-stroke-color': 'white', 'circle-stroke-width': 1.5 }} /></GeoJSONSource>
      {cone && <GeoJSONSource id="rv-cone" data={cone}>
        <Layer id="rv-cone-fill" type="fill" paint={{ 'fill-color': '#1FBF7A', 'fill-opacity': 0.4 }} />
        <Layer id="rv-cone-edge" type="line" paint={{ 'line-color': '#119A5E', 'line-width': 1.5 }} />
      </GeoJSONSource>}
      {lngLat && validLngLatTuple(lngLat) && <Marker id="rv-here" lngLat={lngLat} anchor="center"><View style={s.here} /></Marker>}
    </Map>
    <Text pointerEvents="none" style={s.attribution}>{OSM_ATTRIBUTION}</Text>
  </View>;
}
const s = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#E8EEE9' }, map: { flex: 1 },
  here: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#1F5EFF', borderWidth: 3, borderColor: 'white', elevation: 4 },
  attribution: { position: 'absolute', top: 6, left: 6, fontSize: 10, color: '#142A44', backgroundColor: '#FFFFFFDD', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
});
