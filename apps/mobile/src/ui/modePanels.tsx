// Small panels that sit inside the tool panel while a mode is on, so the map stays in view: the photo direction readout,
// the escalator stopwatch, and the room number of 호실 연속 입력.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PathKind } from '../survey/plans.ts';
import type { TimingStats } from '../survey/selection.ts';
import { FOV_HALF_DEG, compassWord } from './dial.ts';
import { TOUCH, color, font, radius, space } from './theme.ts';

function Chip({ label, onPress, on = false, disabled = false }: { label: string; onPress: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.chipLabel, on && styles.onColor]}>{label}</Text>
    </Pressable>
  );
}

// ---- 사진 방향 ----

export function HeadingPanel({ deg, fromSensor, onSet, onSensor }: { deg: number; fromSensor: boolean; onSet: (deg: number) => void; onSensor: (() => void) | null }) {
  return (
    <View style={styles.panel}>
      <View style={styles.readRow}>
        <Text style={styles.big}>{deg}°</Text>
        <Text style={styles.soft}>{compassWord(deg)}쪽 · 시야 ±{FOV_HALF_DEG}°{fromSensor ? ' · 센서 값' : ''}</Text>
      </View>
      <View style={styles.row}>
        <Chip label="−5°" onPress={() => onSet(deg - 5)} />
        <Chip label="−1°" onPress={() => onSet(deg - 1)} />
        <Chip label="+1°" onPress={() => onSet(deg + 1)} />
        <Chip label="+5°" onPress={() => onSet(deg + 5)} />
        <Chip label="반대쪽" onPress={() => onSet(deg + 180)} />
        <Chip label="센서 값" disabled={onSensor === null} onPress={() => onSensor?.()} />
      </View>
    </View>
  );
}

// ---- 에스컬레이터 스톱워치 ----

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

interface StopwatchProps {
  /** The directions this belt can be ridden ("올라감"/"내려감" for a reversible belt), and the one picked. */
  directions: readonly { value: 'forward' | 'backward'; label: string }[];
  direction: 'forward' | 'backward';
  onDirection: (d: 'forward' | 'backward') => void;
  stats: TimingStats | null;
  /** A ride was timed: its length in seconds. */
  onLap: (sec: number) => void;
}

/** Start when stepping on, stop when stepping off. Every ride is added to the times of the belt. */
export function StopwatchPanel({ directions, direction, onDirection, stats, onLap }: StopwatchProps) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [last, setLast] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (startedAt === null) return undefined;
    timer.current = setInterval(() => setNow(Date.now()), 100);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [startedAt]);

  const running = startedAt !== null;
  const shown = running ? now - startedAt : last ?? 0;
  return (
    <View style={styles.panel}>
      {directions.length > 1 && (
        <View style={styles.row}>
          {directions.map((d) => <Chip key={d.value} label={d.label} on={d.value === direction} disabled={running} onPress={() => onDirection(d.value)} />)}
        </View>
      )}
      <View style={styles.readRow}>
        <Text style={[styles.big, running && { color: color.accent }]} accessibilityLiveRegion="polite">{seconds(shown)}초</Text>
        <Pressable
          onPress={() => {
            if (!running) {
              const t = Date.now();
              setStartedAt(t);
              setNow(t);
              return;
            }
            const ms = Date.now() - startedAt;
            setStartedAt(null);
            setLast(ms);
            onLap(ms / 1000);
          }}
          accessibilityRole="button"
          accessibilityLabel={running ? '내린 순간 누르기: 측정 끝' : '탄 순간 누르기: 측정 시작'}
          style={({ pressed }) => [styles.watch, running && styles.watchStop, pressed && styles.pressed]}
        >
          <Text style={styles.watchLabel}>{running ? '내렸어요 · 정지' : '탔어요 · 시작'}</Text>
        </Pressable>
        {running && <Chip label="취소" onPress={() => setStartedAt(null)} />}
      </View>
      <Text style={styles.soft}>
        {stats === null ? '예상 시간을 계산할 수 없는 구간입니다.'
          : `예상 ${stats.priorSec}초 · 측정 ${stats.taken}회${stats.medianSec !== null ? ` (가운데값 ${stats.medianSec}초)` : ''} → 보정 ${stats.estimateSec}초${stats.taken > stats.n ? ` · 너무 다른 ${stats.taken - stats.n}회는 뺐습니다` : ''}`}
      </Text>
    </View>
  );
}

// ---- 잇기 · 외부 길 ----

interface LinkPanelProps {
  outdoor: boolean;
  kind: PathKind;
  onKind: (kind: PathKind) => void;
}

/** What the next stretch is (outdoors: 길·계단·경사로; indoors: 복도·경사로). Its sill is set in 선택 → 속성 편집. */
export function LinkPanel({ outdoor, kind, onKind }: LinkPanelProps) {
  const kinds: { value: PathKind; label: string }[] = outdoor
    ? [{ value: 'flat', label: '길' }, { value: 'steps', label: '계단' }, { value: 'ramp', label: '경사로' }]
    : [{ value: 'flat', label: '복도' }, { value: 'ramp', label: '경사로' }];
  return (
    <View style={[styles.panel, styles.row]}>
      {kinds.map((k) => <Chip key={k.value} label={k.label} on={kind === k.value} onPress={() => onKind(k.value)} />)}
    </View>
  );
}

// ---- 호실 연속 입력 ----

export function DoorRunPanel({ nextRef, step, onRef, onStep }: { nextRef: string; step: 1 | 2; onRef: (ref: string) => void; onStep: (step: 1 | 2) => void }) {
  return (
    <View style={[styles.panel, styles.row]}>
      <Text style={styles.soft}>다음 호실</Text>
      <TextInput
        value={nextRef}
        onChangeText={(t) => onRef(t.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8))}
        placeholder="301"
        placeholderTextColor={color.inkSoft}
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="default"
        accessibilityLabel="다음 호실 번호"
        style={styles.input}
      />
      <Chip label="1씩" on={step === 1} onPress={() => onStep(1)} />
      <Chip label="2씩 (한쪽 줄)" on={step === 2} onPress={() => onStep(2)} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: space.md, gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  big: { fontSize: font.display - 4, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
  soft: { fontSize: font.small, lineHeight: 17, color: color.inkSoft, fontWeight: '600' },
  chip: {
    minHeight: TOUCH - 4, minWidth: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.line,
  },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipLabel: { fontSize: font.small, fontWeight: '700', color: color.ink },
  onColor: { color: color.onPrimary },
  watch: { minHeight: TOUCH + 4, paddingHorizontal: space.xl, borderRadius: radius.md, backgroundColor: color.ok, alignItems: 'center', justifyContent: 'center' },
  watchStop: { backgroundColor: color.danger },
  watchLabel: { fontSize: font.label, fontWeight: '800', color: color.onPrimary },
  input: {
    minHeight: TOUCH, minWidth: 90, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: color.surface,
    borderWidth: 1.5, borderColor: color.primary, fontSize: font.label, fontWeight: '800', color: color.ink,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
});
