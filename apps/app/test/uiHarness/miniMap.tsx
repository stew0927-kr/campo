// Test-only roadview mini map: the native MapLibre mini map is replaced by text that reports what it would draw.
import type { RoadviewMiniMapProps } from '../../src/features/map/roadviewTypes.ts';
import { headingLabel } from '../../src/photos/demoPhotoArt.ts';
import { Body } from '../../src/ui/kit.tsx';
import { View } from './native.tsx';
export function RoadviewMiniMap(p: RoadviewMiniMapProps) {
  return <View accessible accessibilityLabel={`${p.label}. ${headingLabel(p.headingDeg)} 방향을 보고 있습니다`} style={{ flex: 1, padding: 12 }}>
    <Body>{`검사 미니 지도: ${p.label} · ${headingLabel(p.headingDeg)} · 지점 ${p.stops?.length ?? 0}개`}</Body>
  </View>;
}
