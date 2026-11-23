import type { MapProps } from '../../src/features/map/mapTypes.ts';
import { Button, Body } from '../../src/ui/kit.tsx';
import { View } from './native.tsx';
// Full-screen stand-in. Test controls sit below the floating search bar so overlays never cover them.
export function MapCanvas(p: MapProps) {
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: '#E8EEE9', overflow: 'auto', paddingTop: 150, paddingLeft: 12, paddingRight: 76, paddingBottom: 40, gap: 8 }}>
    <Body>검사용 지도 대체 화면 · 실제 지도·타일은 미검증입니다.</Body><Body>{p.label}</Body>
    {p.focus && <Body>{`검사 카메라 이동 ${p.focus.key}회`}</Body>}
    {p.selected && <Body>{`검사 선택 장소: ${p.selected.name}`}</Body>}
    <Button title="검사: 지도 임의 점 선택" onPress={() => p.onPoint({ lat: p.center.lat, lng: p.center.lng })} />
    <Button title="검사: 캠퍼스 밖 선택" onPress={() => p.onPoint({ lat: 0, lng: 0 })} />
    {p.places.map((place) => <Button key={place.id} title={`검사 지점: ${place.name}`} onPress={() => p.onPlace(place)} />)}
    {p.highlightBuildings && <Body>{`검사 건물 강조 ${p.mappedBuildingIds?.length ?? 0}곳`}</Body>}
    {p.markedBuildingId && <Body>{`검사 검색 건물: ${p.markedBuildingId}`}</Body>}
    {p.buildingId && <Body>{`검사 실내: ${p.buildingId} ${p.level}층`}</Body>}
    {p.highlightBuildings && p.mappedBuildingIds?.map((id) => <Button key={id} title={`검사 건물 누르기: ${id}`} onPress={() => p.onBuildingPress?.(id)} />)}
    {p.route && <Body>검사 경로 좌표 {p.route.polyline.length}개 · {Math.round(p.route.distanceM)}m</Body>}
  </View>;
}
