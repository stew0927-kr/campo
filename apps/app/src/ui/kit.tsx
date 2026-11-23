import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { screenLayout } from './layout.ts';
import { theme as t } from './theme.ts';
export function Page({ title, subtitle, children, resetKey }: { title: string; subtitle?: string; children: ReactNode; resetKey?: string | number | null }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [resetKey]);
  return <ScrollView ref={scroll} style={s.page} contentContainerStyle={[s.pageContent, { padding: layout.padding, maxWidth: layout.maxContentWidth, width: '100%', alignSelf: 'center' }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets nestedScrollEnabled>
    <View style={s.pageHeader}><Text accessibilityRole="header" style={s.title}>{title}</Text>{subtitle && <Text style={s.subtitle}>{subtitle}</Text>}</View>
    {children}
  </ScrollView>;
}
export function ActionRow({ children }: { children: ReactNode }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  return <View style={{ flexDirection: layout.stackActions ? 'column' : 'row', gap: 8, alignItems: 'stretch' }}>{children}</View>;
}
export function Card({ children }: { children: ReactNode }) { return <View style={s.card}>{children}</View>; }
export function Heading({ children }: { children: ReactNode }) { return <Text accessibilityRole="header" style={s.heading}>{children}</Text>; }
export function Body({ children }: { children: ReactNode }) { return <Text style={s.body}>{children}</Text>; }
export function Notice({ children }: { children: ReactNode }) { return <View style={s.notice}><Text style={s.warning}>{children}</Text></View>; }
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, pressed && !disabled && (secondary ? s.secondaryPressed : s.buttonPressed), disabled && s.disabled]}><Text style={secondary ? s.link : s.buttonText}>{title}</Text></Pressable>;
}
export function Chips<T extends string>({ values, value, onChange }: { values: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{values.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: value === item }} onPress={() => onChange(item)} style={[s.chip, value === item && s.selected]}><Text style={[s.chipText, value === item && s.chipTextSelected]}>{item}</Text></Pressable>)}</ScrollView>;
}
export function Empty({ message }: { message: string }) { return <View style={s.empty}><Text style={s.emptyText}>{message}</Text></View>; }
export function Loading() { return <View accessibilityRole="progressbar" style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}><ActivityIndicator color={t.color.primary} /><Body>안내를 불러오고 있습니다.</Body></View>; }
export function Checklist({ items }: { items: readonly string[] }) {
  const [checked, setChecked] = useState<string[]>([]);
  return <View style={{ gap: 2 }}>{items.map((item, index) => {
    const key = `${index}:${item}`;
    const on = checked.includes(key);
    return <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setChecked((old) => old.includes(key) ? old.filter((x) => x !== key) : [...old, key])} style={s.check}>
      <View style={[s.box, on && s.boxOn]}><Text style={s.boxMark}>{on ? '✓' : ''}</Text></View>
      <Text style={[s.body, { flex: 1 }, on && { color: t.color.faint, textDecorationLine: 'line-through' }]}>{item}</Text>
    </Pressable>;
  })}</View>;
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.color.bg }, pageContent: { padding: t.space.md, gap: 12, paddingBottom: 40 },
  pageHeader: { gap: 4, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: t.type.title, lineHeight: 32, fontWeight: '800', color: t.color.text, letterSpacing: -0.4 },
  subtitle: { fontSize: t.type.small, lineHeight: 19, color: t.color.muted, flexShrink: 1 },
  heading: { fontSize: t.type.heading, lineHeight: 24, fontWeight: '700', color: t.color.text, letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 21, color: t.color.muted, flexShrink: 1 },
  card: { borderRadius: t.radii.card, backgroundColor: t.color.surface, padding: 18, gap: 10, borderWidth: 1, borderColor: t.color.border },
  notice: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: t.color.warningBg },
  warning: { fontSize: t.type.small, lineHeight: 19, color: t.color.warning },
  button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 16, borderRadius: t.radii.button, backgroundColor: t.color.primary, alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  buttonPressed: { backgroundColor: t.color.primaryPressed }, disabled: { opacity: 0.4 },
  secondary: { backgroundColor: t.color.soft }, secondaryPressed: { backgroundColor: '#DCE6FF' },
  buttonText: { color: 'white', fontSize: t.type.body, fontWeight: '700', textAlign: 'center', flexShrink: 1, lineHeight: 21 },
  link: { color: t.color.primary, fontSize: 14, fontWeight: '700', textAlign: 'center', flexShrink: 1, lineHeight: 20 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: t.radii.pill, borderWidth: 1, borderColor: t.color.border, backgroundColor: t.color.surface },
  selected: { backgroundColor: t.color.text, borderColor: t.color.text },
  chipText: { color: t.color.text, fontSize: 14, fontWeight: '600' }, chipTextSelected: { color: 'white', fontWeight: '700' },
  empty: { paddingVertical: 28, paddingHorizontal: 20, borderRadius: t.radii.card, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD4E0', alignItems: 'center' },
  emptyText: { fontSize: 14, lineHeight: 21, color: t.color.muted, textAlign: 'center' },
  input: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, borderRadius: t.radii.field, borderWidth: 0, backgroundColor: '#EDF0F5', fontSize: t.type.body, color: t.color.text, minWidth: 0 },
  check: { paddingVertical: 10, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: '#C3CDDA', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: t.color.primary, borderColor: t.color.primary }, boxMark: { color: 'white', fontSize: 13, fontWeight: '800', lineHeight: 16 },
});
