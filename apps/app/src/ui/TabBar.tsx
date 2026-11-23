import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABS, type Tab } from '../state/model.ts';
import { theme as t } from './theme.ts';
import { screenLayout } from './layout.ts';
const SHORT_LABELS: Record<Tab, string> = { '지도·길찾기': '지도', '논술': '논술', '축제': '축제', '학교행사': '학교행사', '내정보': '내정보' };
const ICONS = ['⌖', '文', '☆', '▦', '○'] as const;
export function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  return <View style={s.frame}><View accessibilityRole="tablist" style={[s.tabs, { maxWidth: layout.maxContentWidth }]}>{TABS.map((name, index) => {
    const on = tab === name;
    return <Pressable key={name} accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected: on }} onPress={() => onChange(name)} style={[s.tab, { minHeight: layout.tabMinHeight }]}>
      <View style={[s.iconWrap, on && s.iconWrapOn]}><Text accessible={false} style={[s.icon, on && s.active]}>{ICONS[index]}</Text></View>
      <Text numberOfLines={1} style={[s.label, on && s.active]}>{layout.shortTabLabels ? SHORT_LABELS[name] : name}</Text>
    </Pressable>;
  })}</View></View>;
}
const s = StyleSheet.create({
  frame: { backgroundColor: t.color.surface, borderTopWidth: 1, borderColor: t.color.divider, flexShrink: 0, paddingTop: 4, paddingBottom: 2 },
  tabs: { flexDirection: 'row', width: '100%', alignSelf: 'center' },
  tab: { flex: 1, minWidth: 44, alignItems: 'center', justifyContent: 'center', padding: 4, gap: 2 },
  iconWrap: { width: 48, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconWrapOn: { backgroundColor: t.color.soft },
  icon: { color: t.color.faint, fontSize: 19, lineHeight: 24 },
  label: { color: t.color.faint, fontSize: 11, fontWeight: '600', textAlign: 'center', maxWidth: '100%' },
  active: { color: t.color.primary, fontWeight: '800' },
});
