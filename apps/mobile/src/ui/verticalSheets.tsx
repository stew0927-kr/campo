// The part of a point's sheet for a stair landing, an elevator stop or an escalator spot: where it already leads, and the
// tools that used to be menu modes — 다른 층과 연결 (the trip measured with the barometer), 시간 재기 (the escalator
// stopwatch) and 계단 칸 수 — so they are there when the point is tapped, and out of the way otherwise.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FloorChoice, VerticalInfo } from '../survey/vertical.ts';
import { PictoIcon } from './Pictogram.tsx';
import { TOUCH, color, font, radius, space } from './theme.ts';

const NAME = { stairs: '계단', elevator: '엘리베이터', escalator: '에스컬레이터' } as const;
const PICTO = { stairs: 'stairs', elevator: 'elevator', escalator: 'escalator' } as const;
const LINK_HINT = {
  stairs: '위나 아래층으로 걸어가며 기압으로 높이를 잽니다',
  elevator: '타고 내린 층의 정차 지점을 만들고 잇습니다',
  escalator: '타고 내린 곳을 찍어 에스컬레이터로 잇습니다',
} as const;

interface Props {
  info: VerticalInfo;
  /** The floors of the building (stairs and elevators); without them, or without onLinkMany, there is no multi-floor button. */
  floors?: FloorChoice[];
  /** Join the point to all of these floors at once. */
  onLinkMany?: (levels: number[]) => void;
  /** Start the trip from this point (the sheet closes; arriving is recorded from the menu). */
  onLink: () => void;
  /** Escalator with a belt: open the stopwatch on it. */
  onTime: (() => void) | null;
  /**
   * Stairs: write the step count on one flight at the landing (null clears it). Only that flight changes: the flight up
   * and the flight down from a landing between floors are counted apart.
   */
  onStepCount: (flightId: string, count: number | null) => void;
}

function Action({ title, hint, onPress, disabled = false, primary = false }: { title: string; hint: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.actionTitle, primary && styles.onPrimary]}>{title}</Text>
      <Text style={[styles.actionHint, primary && styles.onPrimarySoft]} numberOfLines={2}>{hint}</Text>
    </Pressable>
  );
}

/** − n + and a save button: the number of steps on the flight from this landing. */
function StepCount({ title, value, enabled, onSave }: { title: string; value: number | undefined; enabled: boolean; onSave: (count: number | null) => void }) {
  const [n, setN] = useState<number>(value ?? 20);
  const step = (d: number) => setN((x) => Math.min(200, Math.max(1, x + d)));
  return (
    <View style={[styles.steps, !enabled && styles.disabled]} pointerEvents={enabled ? 'auto' : 'none'}>
      <View style={styles.stepsHead}>
        <Text style={styles.stepsTitle}>{title}</Text>
        <Text style={styles.stepsNow}>{value === undefined ? '아직 안 셌음' : `저장된 값 ${value}칸`}</Text>
      </View>
      <View style={styles.stepper}>
        {[-5, -1].map((d) => (
          <Pressable key={d} onPress={() => step(d)} accessibilityRole="button" accessibilityLabel={`${-d}칸 빼기`} style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}>
            <Text style={styles.stepBtnLabel}>{d}</Text>
          </Pressable>
        ))}
        <Text style={styles.count} accessibilityLabel={`${n}칸`}>{n}</Text>
        {[1, 5].map((d) => (
          <Pressable key={d} onPress={() => step(d)} accessibilityRole="button" accessibilityLabel={`${d}칸 더하기`} style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}>
            <Text style={styles.stepBtnLabel}>+{d}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.stepsActions}>
        <Pressable onPress={() => onSave(n)} accessibilityRole="button" accessibilityLabel={`${n}칸으로 저장`} style={({ pressed }) => [styles.save, pressed && styles.pressed]}>
          <Text style={styles.saveLabel}>{n}칸으로 저장</Text>
        </Pressable>
        {value !== undefined && (
          <Pressable onPress={() => onSave(null)} accessibilityRole="button" accessibilityLabel="칸 수 지우기" style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
            <Text style={styles.clearLabel}>지우기</Text>
          </Pressable>
        )}
      </View>
      {!enabled && <Text style={styles.soft}>다른 층과 연결하면 그 계단에 칸 수를 적을 수 있습니다.</Text>}
    </View>
  );
}

/** [여러 층 한 번에 연결]: tick the floors of the building, then join them in one go. */
function MultiLink({ kind, floors, onLinkMany }: { kind: 'stairs' | 'elevator'; floors: FloorChoice[]; onLinkMany: (levels: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (level: number) => setPicked((p) => (p.includes(level) ? p.filter((l) => l !== level) : [...p, level]));
  const choices = floors.filter((f) => !f.here);
  if (choices.length === 0) return null;
  if (!open) {
    return <Action title="여러 층 한 번에 연결" hint={kind === 'stairs' ? '이어 갈 층을 모두 골라 계단을 한꺼번에 잇습니다' : '정차할 층을 모두 골라 한꺼번에 잇습니다'} onPress={() => setOpen(true)} />;
  }
  return (
    <View style={styles.steps} accessibilityLabel="여러 층 한 번에 연결">
      <Text style={styles.stepsTitle}>이을 층을 골라 주세요</Text>
      <View style={styles.floorRow}>
        {choices.map((f) => {
          const on = picked.includes(f.level);
          return (
            <Pressable
              key={f.level}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={f.label}
              onPress={() => toggle(f.level)}
              style={({ pressed }) => [styles.floor, on && styles.floorOn, pressed && styles.pressed]}
            >
              <Text style={[styles.floorLabel, on && styles.onPrimary]}>{f.label}{f.joined ? ' ✓' : ''}</Text>
            </Pressable>
          );
        })}
      </View>
      {kind === 'stairs' && <Text style={styles.soft}>계단은 한 층씩 이어서 골라 주세요. ✓는 이미 이어진 층입니다.</Text>}
      <View style={styles.stepsActions}>
        <Pressable
          disabled={picked.length === 0}
          onPress={() => onLinkMany([...picked])}
          accessibilityRole="button"
          accessibilityLabel={`${picked.length}개 층 연결하기`}
          accessibilityState={{ disabled: picked.length === 0 }}
          style={({ pressed }) => [styles.save, pressed && styles.pressed, picked.length === 0 && styles.disabled]}
        >
          <Text style={styles.saveLabel}>{picked.length}개 층 연결하기</Text>
        </Pressable>
        <Pressable onPress={() => { setOpen(false); setPicked([]); }} accessibilityRole="button" accessibilityLabel="닫기" style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
          <Text style={styles.clearLabel}>닫기</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function VerticalSection({ info, floors, onLink, onLinkMany, onTime, onStepCount }: Props) {
  const name = NAME[info.kind];
  return (
    <View style={styles.box} accessibilityLabel={`${name} 연결`}>
      <View style={styles.head}>
        <PictoIcon kind={PICTO[info.kind]} size={30} />
        <View style={styles.headText}>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.linked}>{info.linked.length === 0 ? '아직 다른 층과 이어지지 않았습니다' : `이어진 곳: ${info.linked.join(', ')}`}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Action title="다른 층과 연결" hint={LINK_HINT[info.kind]} onPress={onLink} primary />
        {info.kind === 'escalator' && (
          <Action
            title="시간 재기"
            hint={onTime ? '탄 순간과 내린 순간을 눌러 시간을 잽니다' : '연결한 뒤에 잴 수 있습니다'}
            onPress={() => onTime?.()}
            disabled={onTime === null}
          />
        )}
      </View>
      {(info.kind === 'stairs' || info.kind === 'elevator') && onLinkMany && floors && (
        <MultiLink key={info.linked.join(',')} kind={info.kind} floors={floors} onLinkMany={onLinkMany} />
      )}
      {info.kind === 'stairs' && info.flightList.length === 0 && <StepCount title="계단 칸 수" value={undefined} enabled={false} onSave={() => {}} />}
      {info.kind === 'stairs' && info.flightList.map((f) => (
        // Keyed by the saved value too: a save (or an undo) resets the stepper to what is stored.
        <StepCount
          key={`${f.id}:${f.stepCount ?? ''}`}
          title={info.flightList.length > 1 ? `계단 칸 수 (${f.to} 쪽)` : '계단 칸 수'}
          value={f.stepCount}
          enabled
          onSave={(count) => onStepCount(f.id, count)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.md, padding: space.md, marginBottom: space.md, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1 },
  title: { fontSize: font.label, fontWeight: '800', color: color.ink },
  linked: { fontSize: font.small, color: color.inkSoft, marginTop: 1 },
  actions: { flexDirection: 'row', gap: space.sm },
  action: {
    flex: 1, minHeight: TOUCH + 18, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.sm, backgroundColor: color.bg, borderWidth: 1.5, borderColor: color.line,
  },
  actionPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  actionTitle: { fontSize: font.body, fontWeight: '800', color: color.ink },
  actionHint: { fontSize: 11, lineHeight: 14, color: color.inkSoft, marginTop: 2 },
  onPrimary: { color: color.onPrimary },
  onPrimarySoft: { color: 'rgba(255,255,255,0.82)' },
  steps: { gap: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  stepsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  stepsTitle: { fontSize: font.body, fontWeight: '800', color: color.ink },
  stepsNow: { fontSize: font.small, color: color.inkSoft },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepBtn: { minWidth: TOUCH, height: TOUCH, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg, borderWidth: 1.5, borderColor: color.line },
  stepBtnLabel: { fontSize: font.body, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
  count: { flex: 1, textAlign: 'center', fontSize: font.display, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
  stepsActions: { flexDirection: 'row', gap: space.sm },
  save: { flex: 1, minHeight: TOUCH, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: color.ink },
  saveLabel: { fontSize: font.body, fontWeight: '800', color: color.onPrimary },
  clear: { minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: color.line },
  clearLabel: { fontSize: font.body, fontWeight: '700', color: color.inkSoft },
  soft: { fontSize: font.small, color: color.inkSoft },
  floorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  floor: { minWidth: TOUCH + 8, height: TOUCH, paddingHorizontal: space.md, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg, borderWidth: 1.5, borderColor: color.line },
  floorOn: { backgroundColor: color.primary, borderColor: color.primary },
  floorLabel: { fontSize: font.body, fontWeight: '800', color: color.ink },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
