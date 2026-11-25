/* 지도 위 시설 아이콘·이름표·건물 아이콘. 아이콘 폰트나 SVG 없이 View/Text로만 그린다. MapLibre는 import하지 않는다. */
import { StyleSheet, Text, View } from 'react-native';
import { floating, theme as t } from '../../ui/theme.ts';
import type { MarkerKind, MarkerTone } from './mapLabels.ts';
import { BUILDING_FONT_PX, BUILDING_LABEL_MAX_LINES, BUILDING_LABEL_MAX_WIDTH_PX, BUILDING_LINE_PX, ICON_SIZE_PX, LABEL_MAX_WIDTH_PX } from './mapLabels.ts';

const TONE_COLOR: Record<Exclude<MarkerTone, 'normal'>, string> = { start: t.color.start, end: t.color.end, selected: t.color.primary };

/** 시설 글리프(14px 안): 문 / 엘리베이터 / 계단 / 화장실 / 출입구 / 일반 점. */
function Glyph({ kind, color }: { kind: MarkerKind; color: string }) {
  switch (kind) {
    case 'door':
      // 문짝과 손잡이.
      return <View style={[g.door, { borderColor: color }]}><View style={[g.knob, { backgroundColor: color }]} /></View>;
    case 'elevator':
      // 위·아래 삼각형.
      return <View style={g.lift}>
        <View style={[g.triUp, { borderBottomColor: color }]} />
        <View style={[g.triDown, { borderTopColor: color }]} />
      </View>;
    case 'stairs':
      // 오르는 계단 세 칸.
      return <View style={g.stairs}>{[4, 7, 10].map((h) => <View key={h} style={[g.step, { height: h, backgroundColor: color }]} />)}</View>;
    case 'restroom':
      return <Text accessible={false} style={[g.wc, { color }]}>WC</Text>;
    case 'entrance':
      // 문틀 안으로 들어가는 화살표.
      return <View style={g.entrance}>
        <View style={[g.entranceBar, { backgroundColor: color }]} />
        <View style={[g.entranceArrow, { borderLeftColor: color }]} />
        <View style={[g.entranceFrame, { borderColor: color }]} />
      </View>;
    default:
      return <View style={[g.dot, { backgroundColor: color }]} />;
  }
}

/** 지점 좌표 가운데에 놓는 원형 시설 아이콘(흰 바탕 + 얇은 테두리). */
export function FacilityIcon({ kind }: { kind: MarkerKind }) {
  const color = t.facility[kind];
  return <View style={[g.icon, { borderColor: color }]}><Glyph kind={kind} color={color} /></View>;
}

/** 지점 위쪽에 띄우는 이름표. 왼쪽 점은 시설 종류, 강조(출발·도착·선택)는 색 바탕. */
export function MapLabel({ name, kind, tone }: { name: string; kind: MarkerKind; tone: MarkerTone }) {
  const strong = tone !== 'normal' ? TONE_COLOR[tone] : null;
  return <View style={[g.label, strong ? { backgroundColor: strong, borderColor: strong } : null]}>
    <View style={[g.labelDot, { backgroundColor: strong ? t.color.surface : t.facility[kind] }]} />
    <Text numberOfLines={1} ellipsizeMode="tail" style={[g.labelText, strong ? { color: t.color.surface } : null]}>{name}</Text>
  </View>;
}

/**
 * 건물 위에 얹는 이름 글자(네이버지도 식): 바탕 없이 흰 테두리 글자, 화면 기준 수평. 지도가 돌아가도 React Native 뷰라 눕지 않는다.
 * 겹치지 않게 놓는 계산(buildingLabelSize)이 같은 폭·줄 수를 가정한다.
 */
export function BuildingName({ name, picked = false }: { name: string; picked?: boolean }) {
  return <Text numberOfLines={BUILDING_LABEL_MAX_LINES} ellipsizeMode="tail" style={[g.buildingName, picked && g.buildingNamePicked]}>{name}</Text>;
}

/** 건물 모양 아이콘: 건물 몸체와 창문 2×3, 바닥선. */
export function BuildingIcon({ color = t.color.text }: { color?: string }) {
  return <View style={g.building}>
    <View style={[g.buildingBody, { borderColor: color }]}>
      {[0, 1, 2].map((row) => <View key={row} style={g.windowRow}>
        <View style={[g.window, { backgroundColor: color }]} /><View style={[g.window, { backgroundColor: color }]} />
      </View>)}
    </View>
    <View style={[g.ground, { backgroundColor: color }]} />
  </View>;
}

const g = StyleSheet.create({
  icon: { width: ICON_SIZE_PX - 2, height: ICON_SIZE_PX - 2, borderRadius: (ICON_SIZE_PX - 2) / 2, borderWidth: 1.5, backgroundColor: t.color.surface, alignItems: 'center', justifyContent: 'center', shadowColor: floating.shadowColor, shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  door: { width: 7, height: 10, borderWidth: 1.5, borderRadius: 1, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 0.5 },
  knob: { width: 1.5, height: 1.5, borderRadius: 1 },
  lift: { alignItems: 'center', gap: 1.5 },
  triUp: { width: 0, height: 0, borderLeftWidth: 3.5, borderRightWidth: 3.5, borderBottomWidth: 4, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  triDown: { width: 0, height: 0, borderLeftWidth: 3.5, borderRightWidth: 3.5, borderTopWidth: 4, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  stairs: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: 10 },
  step: { width: 3, borderRadius: 0.5 },
  wc: { fontSize: 7.5, lineHeight: 9, fontWeight: '900', letterSpacing: -0.4 },
  entrance: { width: 11, height: 10, justifyContent: 'center' },
  entranceBar: { position: 'absolute', left: 0, width: 5, height: 1.8, borderRadius: 1 },
  entranceArrow: { position: 'absolute', left: 4, width: 0, height: 0, borderTopWidth: 3, borderBottomWidth: 3, borderLeftWidth: 3.5, borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  entranceFrame: { position: 'absolute', right: 0, width: 4, height: 10, borderWidth: 1.5, borderLeftWidth: 0, borderRadius: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: LABEL_MAX_WIDTH_PX, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: t.color.border, backgroundColor: t.color.surface, shadowColor: floating.shadowColor, shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  labelDot: { width: 6, height: 6, borderRadius: 3 },
  labelText: { flexShrink: 1, fontSize: t.type.micro, lineHeight: 15, fontWeight: '600', color: t.color.text },
  buildingName: { maxWidth: BUILDING_LABEL_MAX_WIDTH_PX, textAlign: 'center', fontSize: BUILDING_FONT_PX, lineHeight: BUILDING_LINE_PX, fontWeight: '700', color: t.facility.building, textShadowColor: '#FFFFFF', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 }, includeFontPadding: false },
  buildingNamePicked: { color: t.color.primary },
  building: { width: 20, height: 20, alignItems: 'center', justifyContent: 'flex-end' },
  buildingBody: { width: 13, height: 16, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 2, borderTopRightRadius: 2, paddingTop: 2, gap: 2, alignItems: 'center' },
  windowRow: { flexDirection: 'row', gap: 2.5 },
  window: { width: 2.5, height: 2.5, borderRadius: 0.5 },
  ground: { width: 18, height: 2, borderRadius: 1 },
});
