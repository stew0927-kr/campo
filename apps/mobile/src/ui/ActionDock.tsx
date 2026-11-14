// The bottom of the survey screen: one compact panel inside the thumb's reach. The upper row holds the records made
// while walking (출발점, 갈림길, 문, 층 이동, 포탈), the lower row the tools (건물 추가, 층 복사·연동, 사진, 정보, 옮기기, 되돌리기, 내보내기,
// 설정). Both rows scroll sideways, so the panel stays two buttons high and the map keeps the screen. While a drawing or a
// move is in progress the panel shows only what that needs. Buttons are TOUCH (38 dp) high.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nextStepFree, stepFreeLabel, type StepFree } from './stepFree.ts';
import { TOUCH, color, font, radius, space } from './theme.ts';

export interface DockAction {
  id: string;
  label: string;
  /** What the press will do right now (read by screen readers; shown small under the label when `hint` is short). */
  hint?: string;
  onPress: () => void;
  /** The record made most often gets the primary colour. */
  primary?: boolean;
  disabled?: boolean;
  /** A mode that is on (the button turns dark). */
  active?: boolean;
  tone?: 'danger';
}

/** What replaces the rows while a drawing or a move is going on. */
export interface DockMode {
  text: string;
  actions: readonly DockAction[];
}

interface Props {
  records: readonly DockAction[];
  tools: readonly DockAction[];
  open: boolean;
  onToggle: () => void;
  /** What the surveyor saw on the stretch just walked; the next 갈림길 기록 writes it. */
  stepFree: StepFree;
  onStepFree: (value: StepFree) => void;
  mode: DockMode | null;
}

function Btn({ a }: { a: DockAction }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a.label}
      accessibilityHint={a.hint}
      accessibilityState={{ disabled: a.disabled === true, selected: a.active === true }}
      disabled={a.disabled}
      onPress={a.onPress}
      style={({ pressed }) => [styles.btn, a.primary && styles.btnPrimary, a.active && styles.btnActive, a.tone === 'danger' && styles.btnDanger, pressed && styles.pressed, a.disabled && styles.disabled]}
    >
      <Text style={[styles.btnLabel, (a.primary || a.active || a.tone === 'danger') && styles.onColor]} numberOfLines={1}>{a.label}</Text>
    </Pressable>
  );
}

function Row({ actions }: { actions: readonly DockAction[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.rowContent}>
      {actions.map((a) => <Btn key={a.id} a={a} />)}
    </ScrollView>
  );
}

export function ActionDock({ records, tools, open, onToggle, stepFree, onStepFree, mode }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: insets.bottom + space.sm }]}>
      <View style={styles.panel}>
        {mode ? (
          <>
            <Text style={styles.modeText}>{mode.text}</Text>
            <Row actions={mode.actions} />
          </>
        ) : (
          <>
            <View style={styles.head}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`방금 걸은 구간의 턱: ${stepFreeLabel(stepFree)}. 눌러서 바꾸기`}
                onPress={() => onStepFree(nextStepFree(stepFree))}
                style={({ pressed }) => [styles.chip, stepFree === true && styles.chipOk, stepFree === false && styles.chipWarn, pressed && styles.pressed]}
              >
                <Text style={[styles.chipLabel, stepFree !== null && styles.onColor]}>턱: {stepFreeLabel(stepFree)}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={open ? '기록 메뉴 접기' : '기록 메뉴 펼치기'}
                accessibilityState={{ expanded: open }}
                onPress={onToggle}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              >
                <Text style={styles.chipLabel}>{open ? '접기 ▾' : '펼치기 ▴'}</Text>
              </Pressable>
            </View>
            {open && (
              <>
                <Row actions={records} />
                <Row actions={tools} />
              </>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
  panel: {
    gap: space.sm, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: color.line, elevation: 6, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.md },
  rowContent: { paddingHorizontal: space.md, gap: space.sm },
  btn: {
    minHeight: TOUCH, minWidth: TOUCH + 12, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.line,
  },
  btnPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  btnActive: { backgroundColor: color.ink, borderColor: color.ink },
  btnDanger: { backgroundColor: color.danger, borderColor: color.danger },
  btnLabel: { fontSize: font.body, fontWeight: '700', color: color.ink },
  chip: {
    minHeight: TOUCH - 4, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.line,
  },
  chipOk: { backgroundColor: color.ok, borderColor: color.ok },
  chipWarn: { backgroundColor: color.warn, borderColor: color.warn },
  chipLabel: { fontSize: font.small, fontWeight: '700', color: color.ink },
  modeText: { fontSize: font.small, lineHeight: 17, color: color.ink, fontWeight: '600', paddingHorizontal: space.md },
  onColor: { color: color.onPrimary },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
});
