// The few controls every sheet uses, all with touch targets of TOUCH or more.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { TOUCH, TOUCH_LARGE, color, font, radius, space } from './theme.ts';

interface BigButtonProps {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  /** Smaller second line. */
  hint?: string;
  style?: StyleProp<ViewStyle>;
}

/** A full-width action. */
export function BigButton({ label, onPress, tone = 'primary', disabled = false, hint, style }: BigButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.big, styles[tone], pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      <Text style={[styles.bigLabel, tone !== 'plain' && styles.onColor]}>{label}</Text>
      {hint !== undefined && <Text style={[styles.hint, tone !== 'plain' && styles.onColor]}>{hint}</Text>}
    </Pressable>
  );
}

interface ChoiceProps<T> {
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** Read by screen readers before the options. */
  label: string;
}

/** One of a few options, as a row of large chips that wraps. */
export function Choice<T extends string | number | boolean>({ options, value, onChange, label }: ChoiceProps<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed]}
          >
            <Text style={[styles.chipLabel, selected && styles.onColor]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  big: { minHeight: TOUCH_LARGE, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm },
  primary: { backgroundColor: color.primary },
  danger: { backgroundColor: color.danger },
  plain: { backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  bigLabel: { fontSize: font.label, fontWeight: '700', color: color.ink },
  hint: { fontSize: font.small, color: color.inkSoft, marginTop: 2 },
  onColor: { color: color.onPrimary },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: TOUCH, minWidth: TOUCH + space.lg, paddingHorizontal: space.lg, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line,
  },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipLabel: { fontSize: font.body, fontWeight: '600', color: color.ink },
  fieldLabel: { fontSize: font.small, fontWeight: '700', color: color.inkSoft, marginTop: space.lg, marginBottom: space.sm },
});
