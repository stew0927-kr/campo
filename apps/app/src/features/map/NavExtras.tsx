// 위치 안내 화면의 작은 부품: 경과 시간 시계, 경로 '사진 보기' 칩, 안내 종료 요약 카드.
// 값 계산은 navSummary.ts / routePhotos.ts(순수 모듈)에 있고, 여기서는 그리기만 한다.
import { memo, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../ui/kit.tsx';
import { theme as t } from '../../ui/theme.ts';
import { elapsedSec, formatClimb, formatClock, formatDistance, formatDuration, NOT_MEASURED, type Measure, type NavSummary } from './navSummary.ts';

/**
 * MM:SS since `startMs`. Re-renders only itself once a second (never the map screen), and always shows now − start, so a
 * phone that slept or an app that was in the background shows the true time when it wakes.
 */
export const NavClock = memo(function NavClock({ startMs }: { startMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startMs]);
  const clock = formatClock(elapsedSec(startMs, now));
  return <View style={s.clock} accessible accessibilityRole="timer" accessibilityLabel={`안내 시작 후 ${clock.replace(':', '분 ')}초`}>
    <ClockGlyph size={14} color={t.color.primary} />
    <Text style={s.clockText}>{clock}</Text>
  </View>;
});

/** Small chip: photo glyph + count. Off: quiet outline; on: the route's soft blue. A switch for screen readers. */
export function PhotoChip({ on, count, onPress }: { on: boolean; count: number; onPress: () => void }) {
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={`경로 사진 보기, 사진 ${count}장`} hitSlop={6} onPress={onPress}
    style={({ pressed }) => [s.chip, on && s.chipOn, pressed && (on ? s.chipOnPressed : s.chipPressed)]}>
    <PhotoGlyph color={on ? t.color.primary : t.color.muted} />
    <Text style={[s.chipText, on && s.chipTextOn]}>{count}장</Text>
  </Pressable>;
}

/**
 * 안내 종료 요약: 걸린 시간 · 이동 거리 · 오르막 — three columns of a big number with a small unit, a glyph above and a label
 * below, split by hairlines (one surface, no card inside the card). A value that could not be measured says so in place.
 */
export function NavSummaryCard({ summary, destination, onDone }: { summary: NavSummary; destination: string | null; onDone: () => void }) {
  const missing = summary.distanceM === null || summary.climbM === null;
  return <View style={s.summary} accessibilityLabel="위치 안내 요약">
    <View style={s.summaryHead}>
      <Text accessibilityRole="header" style={s.summaryTitle}>위치 안내를 마쳤습니다</Text>
      {destination && <Text numberOfLines={1} style={s.summarySub}>{destination}까지</Text>}
    </View>
    <View style={s.metrics}>
      <Metric label="걸린 시간" glyph={<ClockGlyph size={16} color={t.color.muted} />} parts={formatDuration(summary.elapsedSec)} />
      <View style={s.metricRule} />
      <Metric label="이동 거리" glyph={<DistanceGlyph />} parts={summary.distanceM === null ? null : [formatDistance(summary.distanceM)]} />
      <View style={s.metricRule} />
      <Metric label="오르막" glyph={<ClimbGlyph />} parts={summary.climbM === null ? null : [formatClimb(summary.climbM)]} />
    </View>
    {missing && <Text style={s.summaryNote}>위치나 기압 센서 값을 받지 못한 항목은 '{NOT_MEASURED}'으로 표시했습니다.</Text>}
    <Button title="확인" onPress={onDone} />
  </View>;
}

function Metric({ label, glyph, parts }: { label: string; glyph: ReactNode; parts: Measure[] | null }) {
  const spoken = parts ? parts.map((p) => `${p.value}${p.unit}`).join(' ') : NOT_MEASURED;
  return <View style={s.metric} accessible accessibilityLabel={`${label} ${spoken}`}>
    <View style={s.metricGlyph}>{glyph}</View>
    {parts
      ? <View style={s.metricValue}>{parts.map((p, i) => <View key={i} style={s.metricPart}><Text style={s.metricNumber}>{p.value}</Text><Text style={s.metricUnit}>{p.unit}</Text></View>)}</View>
      : <Text style={s.metricMissing}>{NOT_MEASURED}</Text>}
    <Text style={s.metricLabel}>{label}</Text>
  </View>;
}

/* ---------- glyphs (drawn with views; one stroke weight, 16 grid) ---------- */
/** A dial with two hands meeting at its centre (positions are inside the border, so measured from the inner box). */
function ClockGlyph({ size, color }: { size: number; color: string }) {
  const stroke = size >= 16 ? 1.8 : 1.5;
  const inner = size - stroke * 2, c = inner / 2, long = inner * 0.36, short = inner * 0.28;
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color }}>
    <View style={{ position: 'absolute', left: c - stroke / 2, top: c - long, width: stroke, height: long + stroke / 2, backgroundColor: color, borderRadius: stroke }} />
    <View style={{ position: 'absolute', left: c - stroke / 2, top: c - stroke / 2, width: short + stroke / 2, height: stroke, backgroundColor: color, borderRadius: stroke }} />
  </View>;
}
function PhotoGlyph({ color }: { color: string }) {
  return <View style={[s.photoFrame, { borderColor: color }]}><View style={[s.photoLens, { backgroundColor: color }]} /></View>;
}
/** Two stops joined by a line, slanted: a stretch walked. */
function DistanceGlyph() {
  return <View style={s.glyph16}>
    <View style={[s.distLine, { transform: [{ rotate: '-40deg' }] }]} />
    <View style={[s.distStop, { left: 0, bottom: 0 }]} />
    <View style={[s.distStop, { right: 0, top: 0, backgroundColor: t.color.muted }]} />
  </View>;
}
/** An upward chevron over a base line: height gained. */
function ClimbGlyph() {
  return <View style={s.glyph16}>
    <View style={s.climbChevron} />
    <View style={s.climbBase} />
  </View>;
}

const s = StyleSheet.create({
  clock: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, height: 32, borderRadius: t.radii.pill, backgroundColor: t.color.soft },
  clockText: { fontSize: t.type.small, fontWeight: '800', color: t.color.primary, fontVariant: ['tabular-nums'], letterSpacing: 0.2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: t.radii.pill, borderWidth: 1, borderColor: t.color.border, backgroundColor: t.color.surface },
  chipOn: { backgroundColor: t.color.soft, borderColor: t.color.primary },
  chipPressed: { backgroundColor: t.color.sunken },
  chipOnPressed: { backgroundColor: '#DCE6FF' },
  chipText: { fontSize: t.type.small, fontWeight: '700', color: t.color.muted, fontVariant: ['tabular-nums'] },
  chipTextOn: { color: t.color.primary },
  photoFrame: { width: 14, height: 11, borderRadius: 3, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  photoLens: { width: 4, height: 4, borderRadius: 2 },
  summary: { gap: t.space.md },
  summaryHead: { gap: 2 },
  summaryTitle: { fontSize: 20, lineHeight: 27, fontWeight: '800', color: t.color.text, letterSpacing: -0.3 },
  summarySub: { fontSize: 14, lineHeight: 20, color: t.color.muted },
  metrics: { flexDirection: 'row', alignItems: 'stretch', paddingVertical: t.space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.color.divider },
  metric: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  metricRule: { width: 1, backgroundColor: t.color.divider },
  metricGlyph: { height: 16, justifyContent: 'center' },
  metricValue: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexWrap: 'wrap', justifyContent: 'center' },
  metricPart: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  metricNumber: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: t.color.text, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  metricUnit: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: t.color.muted },
  metricMissing: { fontSize: 15, lineHeight: 34, fontWeight: '700', color: t.color.muted },
  metricLabel: { fontSize: t.type.micro, fontWeight: '700', color: t.color.muted },
  summaryNote: { fontSize: t.type.micro, lineHeight: 17, color: t.color.muted },
  glyph16: { width: 16, height: 16 },
  distLine: { position: 'absolute', left: 2, right: 2, top: 7, height: 1.8, borderRadius: 1, backgroundColor: t.color.muted },
  distStop: { position: 'absolute', width: 6, height: 6, borderRadius: 3, borderWidth: 1.8, borderColor: t.color.muted, backgroundColor: t.color.surface },
  climbChevron: { position: 'absolute', left: 3.5, top: 3.5, width: 9, height: 9, borderLeftWidth: 1.8, borderTopWidth: 1.8, borderColor: t.color.muted, transform: [{ rotate: '45deg' }] },
  climbBase: { position: 'absolute', left: 1, right: 1, bottom: 0.5, height: 1.8, borderRadius: 1, backgroundColor: t.color.muted },
});
