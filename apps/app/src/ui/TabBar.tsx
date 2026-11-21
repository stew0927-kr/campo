import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABS, type Tab } from '../state/model.ts';
import { theme as t } from './theme.ts';
import { screenLayout } from './layout.ts';
const SHORT_LABELS: Record<Tab, string> = { '지도·길찾기': '지도', '논술': '논술', '축제': '축제', '학교행사': '학교행사', '내정보': '내정보' };
export function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  return <View style={s.frame}><View accessibilityRole="tablist" style={[s.tabs, { maxWidth: layout.maxContentWidth }]}>{TABS.map((name, index) => <Pressable key={name} accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected: tab === name }} onPress={() => onChange(name)} style={[s.tab, { minHeight: layout.tabMinHeight }]}><Text accessible={false} style={[s.icon, tab === name && s.active]}>{['⌖', '文', '☆', '▦', '○'][index]}</Text><Text style={[s.label, tab === name && s.active]}>{layout.shortTabLabels ? SHORT_LABELS[name] : name}</Text></Pressable>)}</View></View>;
}
const s = StyleSheet.create({ frame: { backgroundColor: 'white', borderTopWidth: 1, borderColor: t.color.border, flexShrink: 0 }, tabs: { flexDirection: 'row', width: '100%', alignSelf: 'center' }, tab: { flex: 1, minWidth: 44, alignItems: 'center', justifyContent: 'center', padding: 4, gap: 4 }, icon: { color: t.color.muted, fontSize: 22 }, label: { color: t.color.muted, fontSize: 12, textAlign: 'center', maxWidth: '100%' }, active: { color: t.color.primary, fontWeight: '700' } });
