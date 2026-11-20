import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TABS, type Tab } from '../state/model.ts';
import { theme as t } from './theme.ts';
export function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return <View accessibilityRole="tablist" style={s.tabs}>{TABS.map((name, index) => <Pressable key={name} accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected: tab === name }} onPress={() => onChange(name)} style={s.tab}><Text style={[s.icon, tab === name && s.active]}>{['⌖', '文', '☆', '▦', '○'][index]}</Text><Text style={[s.label, tab === name && s.active]}>{name}</Text></Pressable>)}</View>;
}
const s = StyleSheet.create({ tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: t.color.border, backgroundColor: 'white' }, tab: { flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', padding: 3, gap: 4 }, icon: { color: t.color.muted, fontSize: 22 }, label: { color: t.color.muted, fontSize: 11, textAlign: 'center' }, active: { color: t.color.primary, fontWeight: '700' } });
