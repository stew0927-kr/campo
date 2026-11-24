import { memo, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { TABS, type Tab } from '../state/model.ts';
import { theme as t } from './theme.ts';
import { screenLayout } from './layout.ts';
const SHORT_LABELS: Record<Tab, string> = { '지도·길찾기': '지도', '논술': '논술', '축제': '축제', '학교행사': '학교행사', '내정보': '내정보' };
const ICONS = [
  { on: require('../../assets/tabs/map_active.png'), off: require('../../assets/tabs/map_inactive.png') },
  { on: require('../../assets/tabs/essay_active.png'), off: require('../../assets/tabs/essay_inactive.png') },
  { on: require('../../assets/tabs/festival_active.png'), off: require('../../assets/tabs/festival_inactive.png') },
  { on: require('../../assets/tabs/events_active.png'), off: require('../../assets/tabs/events_inactive.png') },
  { on: require('../../assets/tabs/me_active.png'), off: require('../../assets/tabs/me_inactive.png') },
] as const;
/**
 * Bottom tabs. Memoised with stable buttons: a press re-renders only the two buttons whose highlight changes. The app
 * renders the tab bar with the new tab first and the screens after it (see App.tsx), so the highlight shows at once.
 */
export const TabBar = memo(function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  const current = useRef(tab);
  current.current = tab;
  const press = useCallback((name: Tab) => { if (name !== current.current) onChange(name); }, [onChange]);
  return <View style={s.frame}><View accessibilityRole="tablist" style={[s.tabs, { maxWidth: layout.maxContentWidth }]}>{TABS.map((name, index) => (
    <TabButton key={name} name={name} index={index} on={tab === name} short={layout.shortTabLabels} minHeight={layout.tabMinHeight} onPress={press} />
  ))}</View></View>;
});
const TabButton = memo(function TabButton({ name, index, on, short, minHeight, onPress }: { name: Tab; index: number; on: boolean; short: boolean; minHeight: number; onPress: (name: Tab) => void }) {
  return <Pressable accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected: on }} onPress={() => onPress(name)} style={[s.tab, { minHeight }]}>
    <View style={[s.iconWrap, on && s.iconWrapOn]}><Image accessible={false} source={on ? ICONS[index]!.on : ICONS[index]!.off} style={s.icon} contentFit="contain" /></View>
    <Text numberOfLines={1} style={[s.label, on && s.active]}>{short ? SHORT_LABELS[name] : name}</Text>
  </Pressable>;
});
const s = StyleSheet.create({
  frame: { backgroundColor: t.color.surface, borderTopWidth: 1, borderColor: t.color.divider, flexShrink: 0, paddingTop: 4, paddingBottom: 2 },
  tabs: { flexDirection: 'row', width: '100%', alignSelf: 'center' },
  tab: { flex: 1, minWidth: 44, alignItems: 'center', justifyContent: 'center', padding: 4, gap: 2 },
  iconWrap: { width: 48, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconWrapOn: { backgroundColor: t.color.soft },
  icon: { width: 22, height: 22 },
  label: { color: t.color.faint, fontSize: 11, fontWeight: '600', textAlign: 'center', maxWidth: '100%' },
  active: { color: t.color.primary, fontWeight: '800' },
});
