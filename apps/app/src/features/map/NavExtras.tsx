// 위치 안내 화면의 작은 부품: 경과 시간 시계, 경로 '사진 보기' 토글(조이스틱형), 안내 종료 요약 카드.
// 값 계산은 navSummary.ts / routePhotos.ts(순수 모듈)에 있고, 여기서는 그리기만 한다.
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
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

/** 사진 보기 토글의 치수(dp): 알약형 트랙 64×32 안에서 지름 28 손잡이가 좌우로 움직인다. */
export const PHOTO_TOGGLE = { trackW: 64, trackH: 32, knob: 28, inset: 2, durationMs: 180 } as const;
/** 손잡이가 움직이는 거리(dp): 트랙 폭 − 손잡이 − 양쪽 여백. */
export const PHOTO_TOGGLE_TRAVEL = PHOTO_TOGGLE.trackW - PHOTO_TOGGLE.knob - PHOTO_TOGGLE.inset * 2;

/**
 * 경로 사진 보기 토글: 위에서 내려다본 조이스틱처럼 둥근 손잡이(가운데 오목한 캡)가 알약형 트랙 안에서 좌우로 미끄러진다.
 * 꺼짐: 왼쪽·회색 손잡이, 옅은 회색 트랙 / 켜짐: 오른쪽·primary 손잡이, soft 파랑 트랙. 사진 장수는 트랙 오른쪽 글자로 남긴다.
 * 손잡이 이동과 트랙 색 전환은 180ms ease-out(네이티브 드라이버), '동작 줄이기'가 켜져 있으면 바로 바뀐다.
 * 행 전체가 누름 영역(높이 44 이상). 스크린리더에는 switch + checked.
 */
export function PhotoChip({ on, count, onPress }: { on: boolean; count: number; onPress: () => void }) {
  const progress = useRef(new Animated.Value(on ? 1 : 0)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    Animated.timing(progress, { toValue: on ? 1 : 0, duration: reduceMotion ? 0 : PHOTO_TOGGLE.durationMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [on, reduceMotion, progress]);
  const knobX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, PHOTO_TOGGLE_TRAVEL] });
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={`경로 사진 보기, 사진 ${count}장`} onPress={onPress}
    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }} style={s.toggle}>
    {({ pressed }) => <>
      <View style={s.track}>
        {/* 켜짐 트랙은 꺼짐 트랙 위에 겹쳐 불투명도로만 바꾼다(색 보간은 네이티브 드라이버가 못 한다). */}
        <Animated.View style={[s.trackOn, { opacity: progress }]} />
        <Animated.View style={[s.knob, { transform: [{ translateX: knobX }, { scale: pressed ? 0.92 : 1 }] }]}>
          <Animated.View style={[s.knobOn, { opacity: progress }]} />
          <View style={[s.cap, on && s.capOn]} />
        </Animated.View>
      </View>
      <Text style={[s.toggleText, on && s.toggleTextOn]}>사진 {count}장</Text>
    </>}
  </Pressable>;
}

/** 시스템 '동작 줄이기' 설정(켜져 있으면 토글 애니메이션을 건너뛴다). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduce(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
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
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 6 },
  track: { width: PHOTO_TOGGLE.trackW, height: PHOTO_TOGGLE.trackH, borderRadius: PHOTO_TOGGLE.trackH / 2, padding: PHOTO_TOGGLE.inset, backgroundColor: t.color.border, justifyContent: 'center', overflow: 'hidden' },
  trackOn: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: PHOTO_TOGGLE.trackH / 2, backgroundColor: '#D3E0FF' },
  // Knob seen from above: a round stick top with a recessed cap in the middle and a soft drop shadow.
  knob: { width: PHOTO_TOGGLE.knob, height: PHOTO_TOGGLE.knob, borderRadius: PHOTO_TOGGLE.knob / 2, backgroundColor: t.color.muted, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0B1F3A', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1.5 }, elevation: 3 },
  knobOn: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: PHOTO_TOGGLE.knob / 2, backgroundColor: t.color.primary },
  cap: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(255,255,255,0.18)' },
  capOn: { borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(255,255,255,0.26)' },
  toggleText: { fontSize: t.type.small, fontWeight: '700', color: t.color.muted, fontVariant: ['tabular-nums'] },
  toggleTextOn: { color: t.color.primary },
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
