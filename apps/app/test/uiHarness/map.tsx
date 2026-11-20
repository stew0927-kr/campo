import type { MapProps } from '../../src/features/map/mapTypes.ts';
import { screenLayout } from '../../src/ui/layout.ts';
import { Button, Body } from '../../src/ui/kit.tsx';
import { View, useWindowDimensions } from './native.tsx';
export function MapCanvas(p: MapProps) {
  const w = useWindowDimensions();
  return <View style={{ height: screenLayout(w.width, w.height, w.fontScale).mapHeight, backgroundColor: '#E8EEE9', overflow: 'auto', padding: 12, gap: 8 }}>
    <Body>검사용 지도 대체 화면 · 실제 지도·타일은 미검증입니다.</Body><Body>{p.label}</Body>
    <Button title="검사: 지도 임의 점 선택" onPress={() => p.onPoint({ lat: p.center.lat, lng: p.center.lng })} />
    <Button title="검사: 캠퍼스 밖 선택" onPress={() => p.onPoint({ lat: 0, lng: 0 })} />
    {p.places.map((place) => <Button key={place.id} title={`검사 지점: ${place.name}`} onPress={() => p.onPlace(place)} />)}
    {p.route && <Body>검사 경로 좌표 {p.route.polyline.length}개 · {Math.round(p.route.distanceM)}m</Body>}
  </View>;
}
