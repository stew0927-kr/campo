import type { MapProps } from '../../src/features/map/mapTypes.ts';
import { Button, Body } from '../../src/ui/kit.tsx';
import { View } from './native.tsx';
// Full-screen stand-in. Test controls sit below the floating search bar so overlays never cover them.
// It reports the props the real CampusMap would draw (camera requests, selection, buildings, route, roadview bubble)
// as text and exposes the map taps as buttons. Native gestures, tiles and marker layout are not simulated.
export function MapCanvas(p: MapProps) {
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: '#E8EEE9', overflow: 'auto', paddingTop: 150, paddingLeft: 12, paddingRight: 76, paddingBottom: 40, gap: 8 }}>
    <Body>검사용 지도 대체 화면 · 실제 지도·타일은 미검증입니다.</Body><Body>{p.label}</Body>
    {p.focus && <Body>{`검사 카메라 이동 ${p.focus.key}회`}</Body>}
    {p.focus && <Body>{`검사 카메라 위치 ${p.focus.lat.toFixed(5)},${p.focus.lng.toFixed(5)}${p.focus.zoom ? ` 배율 ${p.focus.zoom}` : ''}`}</Body>}
    {p.selected && <Body>{`검사 선택 장소: ${p.selected.name}`}</Body>}
    <Body>{`검사 지도 장소 ${p.places.length}곳`}</Body>
    <Button title="검사: 지도 임의 점 선택" onPress={() => p.onPoint({ lat: p.center.lat, lng: p.center.lng })} />
    <Button title="검사: 캠퍼스 밖 선택" onPress={() => p.onPoint({ lat: 0, lng: 0 })} />
    {p.places.map((place) => <Button key={place.id} title={`검사 지점: ${place.name}`} onPress={() => p.onPlace(place)} />)}
    {p.highlightBuildings && <Body>{`검사 건물 강조 ${p.mappedBuildingIds?.length ?? 0}곳`}</Body>}
    {p.markedBuildingId && <Body>{`검사 검색 건물: ${p.markedBuildingId}`}</Body>}
    {p.buildingId && <Body>{`검사 실내: ${p.buildingId} ${p.level}층`}</Body>}
    {p.highlightBuildings && p.mappedBuildingIds?.map((id) => <Button key={id} title={`검사 건물 누르기: ${id}`} onPress={() => p.onBuildingPress?.(id)} />)}
    {p.route && <Body>검사 경로 좌표 {p.route.polyline.length}개 · {Math.round(p.route.distanceM)}m</Body>}
    {(p.photoSpots ?? []).map((spot) => <Button key={spot.nodeId} title={`검사 사진 지점: ${spot.nodeId}`} onPress={() => p.onPhotoSpot?.(spot)} />)}
    {(p.stepGroups ?? []).map((group) => <Button key={group.key} title={`검사 경로 사진 묶음: ${group.entries.map((e) => e.label).join(' / ')}`} onPress={() => p.onStepGroup?.(group)} />)}
    {p.preview && <View accessibilityLabel="검사 로드뷰 말풍선" style={{ gap: 4, padding: 8, backgroundColor: 'white' }}>
      <Body>{`검사 말풍선: ${p.preview.title}`}</Body>
      {p.preview.entries.length <= 1
        ? <Button title={`${p.preview.title} 로드뷰 보기`} onPress={() => p.onOpenPreview?.(p.preview!.entries[0]?.index ?? null)} />
        : p.preview.entries.map((entry) => <Button key={entry.index} title={`${entry.label} 로드뷰 보기`} onPress={() => p.onOpenPreview?.(entry.index)} />)}
    </View>}
  </View>;
}
