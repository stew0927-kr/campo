import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { screenLayout } from './layout.ts';
import { theme as t } from './theme.ts';
export function Page({ title, subtitle, children, resetKey }: { title: string; subtitle?: string; children: ReactNode; resetKey?: string | number | null }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [resetKey]);
  return <ScrollView ref={scroll} style={s.page} contentContainerStyle={[s.pageContent, { padding: layout.padding, maxWidth: layout.maxContentWidth, width: '100%', alignSelf: 'center' }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets nestedScrollEnabled><Text accessibilityRole="header" style={s.title}>{title}</Text>{subtitle && <Text style={s.body}>{subtitle}</Text>}{children}</ScrollView>;
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
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, (disabled || pressed) && { opacity: 0.55 }]}><Text style={secondary ? s.link : s.buttonText}>{title}</Text></Pressable>;
}
export function Chips<T extends string>({ values, value, onChange }: { values: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{values.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: value === item }} onPress={() => onChange(item)} style={[s.chip, value === item && s.selected]}><Text style={s.link}>{item}</Text></Pressable>)}</ScrollView>;
}
export function Empty({ message }: { message: string }) { return <Card><Body>{message}</Body></Card>; }
export function Loading() { return <View accessibilityRole="progressbar" style={s.card}><ActivityIndicator /><Body>안내를 불러오고 있습니다.</Body></View>; }
export function Checklist({ items }: { items: readonly string[] }) {
  const [checked, setChecked] = useState<string[]>([]);
  return <View style={{ gap: 4 }}>{items.map((item, index) => {
    const key = `${index}:${item}`;
    return <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: checked.includes(key) }} onPress={() => setChecked((old) => old.includes(key) ? old.filter((x) => x !== key) : [...old, key])} style={s.check}><Text style={s.body}>{checked.includes(key) ? '☑' : '☐'} {item}</Text></Pressable>;
  })}</View>;
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.color.bg }, pageContent: { padding: t.space.md, gap: 14, paddingBottom: 32 }, title: { fontSize: 26, fontWeight: '800', color: t.color.text }, heading: { fontSize: 18, fontWeight: '700', color: t.color.text },
  body: { fontSize: 14, lineHeight: 22, color: t.color.muted, flexShrink: 1 }, card: { borderRadius: t.radius, backgroundColor: t.color.surface, padding: 16, gap: 12, borderWidth: 1, borderColor: t.color.border },
  notice: { padding: 12, borderRadius: 10, backgroundColor: t.color.warningBg }, warning: { fontSize: 13, lineHeight: 21, color: t.color.warning },
  button: { minHeight: 46, padding: 12, borderRadius: 10, backgroundColor: t.color.primary, alignItems: 'center', justifyContent: 'center', minWidth: 0 }, secondary: { backgroundColor: t.color.soft }, buttonText: { color: 'white', fontSize: 14, fontWeight: '700', textAlign: 'center', flexShrink: 1, lineHeight: 22 }, link: { color: t.color.primary, fontSize: 13, fontWeight: '700' },
  chips: { gap: 8, paddingVertical: 4 }, chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: t.color.border, backgroundColor: 'white' }, selected: { backgroundColor: t.color.soft, borderColor: t.color.primary },
  input: { minHeight: 48, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.color.border, backgroundColor: 'white', fontSize: 15, color: t.color.text, minWidth: 0 }, check: { paddingVertical: 10, minHeight: 44 },
});
