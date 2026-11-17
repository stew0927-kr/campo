// 되돌리기 and 복원 at the upper left: two round buttons with curved arrows (left: back, right: forward).
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TOUCH, color, space } from './theme.ts';

/** A curved arrow bending to the left; mirrored for the right one. */
function CurvedArrow({ flip, tone }: { flip: boolean; tone: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Path d="M9 14 L4 9 L9 4" fill="none" stroke={tone} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11" fill="none" stroke={tone} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function HistoryButtons({ canUndo, canRedo, onUndo, onRedo }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onUndo}
        disabled={!canUndo}
        accessibilityRole="button"
        accessibilityLabel="되돌리기"
        accessibilityState={{ disabled: !canUndo }}
        hitSlop={4}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed, !canUndo && styles.disabled]}
      >
        <CurvedArrow flip={false} tone={color.ink} />
      </Pressable>
      <Pressable
        onPress={onRedo}
        disabled={!canRedo}
        accessibilityRole="button"
        accessibilityLabel="복원"
        accessibilityState={{ disabled: !canRedo }}
        hitSlop={4}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed, !canRedo && styles.disabled]}
      >
        <CurvedArrow flip tone={color.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  btn: {
    width: TOUCH + 2, height: TOUCH + 2, borderRadius: (TOUCH + 2) / 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.line,
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
});
