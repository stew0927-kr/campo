// The bottom of the survey screen, inside the thumb's reach: the floating record menu on the right (one press per
// record), 되돌리기 and the 턱 toggle on the left. The menu stays open while walking; the round button folds it away to see the map.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOUCH, TOUCH_LARGE, color, font, radius, space } from './theme.ts';

export interface DockAction {
  id: string;
  label: string;
  /** Small second line: what the press will do right now. */
  hint?: string;
  onPress: () => void;
  /** The record made most often gets the primary colour. */
  primary?: boolean;
}

/** What the surveyor saw on the stretch just walked: no step, a step, or did not look. */
export type StepFree = boolean | null;

const STEP_FREE_LABEL: Record<string, string> = { null: '턱: 안 봄', true: '턱: 없음', false: '턱: 있음' };
const NEXT_STEP_FREE: Record<string, StepFree> = { null: true, true: false, false: null };

interface Props {
  actions: readonly DockAction[];
  open: boolean;
  onToggle: () => void;
  canUndo: boolean;
  onUndo: () => void;
  stepFree: StepFree;
  onStepFree: (value: StepFree) => void;
}

export function ActionDock({ actions, open, onToggle, canUndo, onUndo, stepFree, onStepFree }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: insets.bottom + space.lg }]}>
      <View pointerEvents="box-none" style={styles.left}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${STEP_FREE_LABEL[String(stepFree)]}. 눌러서 바꾸기`}
          onPress={() => onStepFree(NEXT_STEP_FREE[String(stepFree)]!)}
          style={({ pressed }) => [styles.side, stepFree === true && styles.sideOk, stepFree === false && styles.sideWarn, pressed && styles.pressed]}
        >
          <Text style={[styles.sideLabel, stepFree !== null && styles.onColor]}>{STEP_FREE_LABEL[String(stepFree)]}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="되돌리기"
          accessibilityState={{ disabled: !canUndo }}
          disabled={!canUndo}
          onPress={onUndo}
          style={({ pressed }) => [styles.side, pressed && styles.pressed, !canUndo && styles.disabled]}
        >
          <Text style={styles.sideLabel}>되돌리기</Text>
        </Pressable>
      </View>

      <View pointerEvents="box-none" style={styles.right}>
        {open && actions.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityHint={a.hint}
            onPress={a.onPress}
            style={({ pressed }) => [styles.action, a.primary && styles.actionPrimary, pressed && styles.pressed]}
          >
            <Text style={[styles.actionLabel, a.primary && styles.onColor]}>{a.label}</Text>
            {a.hint !== undefined && <Text style={[styles.actionHint, a.primary && styles.onColor]} numberOfLines={1}>{a.hint}</Text>}
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? '기록 메뉴 접기' : '기록 메뉴 펼치기'}
          accessibilityState={{ expanded: open }}
          onPress={onToggle}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        >
          <Text style={styles.fabLabel}>{open ? '접기' : '기록'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const shadow = { elevation: 6, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } } as const;

const styles = StyleSheet.create({
  dock: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  left: { gap: space.sm, alignItems: 'flex-start' },
  right: { gap: space.sm, alignItems: 'flex-end' },
  side: {
    minHeight: TOUCH, minWidth: 104, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: color.line, ...shadow,
  },
  sideOk: { backgroundColor: color.ok, borderColor: color.ok },
  sideWarn: { backgroundColor: color.warn, borderColor: color.warn },
  sideLabel: { fontSize: font.body, fontWeight: '700', color: color.ink },
  action: {
    minHeight: TOUCH_LARGE, width: 208, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.md,
    backgroundColor: color.surface, justifyContent: 'center', borderWidth: 1.5, borderColor: color.line, ...shadow,
  },
  actionPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  actionLabel: { fontSize: font.label, fontWeight: '800', color: color.ink },
  actionHint: { fontSize: font.small, color: color.inkSoft, marginTop: 1 },
  fab: {
    width: TOUCH_LARGE + 8, height: TOUCH_LARGE + 8, borderRadius: radius.pill, backgroundColor: color.ink,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  fabLabel: { fontSize: font.body, fontWeight: '800', color: color.onPrimary },
  onColor: { color: color.onPrimary },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
});
