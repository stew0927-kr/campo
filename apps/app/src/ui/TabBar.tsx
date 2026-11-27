import { memo, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { TABS, type Tab } from '../state/model.ts';
import { theme as t } from './theme.ts';
import { screenLayout } from './layout.ts';
const SHORT_LABELS: Record<Tab, string> = { '지도·길찾기': '지도', '논술': '논술', '축제': '축제', '학교행사': '학교행사', '내정보': '내정보' };
// TABS(state/model.ts) 순서(논술·축제·지도·길찾기·학교행사·내정보)와 같은 순서로 맞춘다.
const ICONS = [
  { on: require('../../assets/tabs/essay_active.png'), off: require('../../assets/tabs/essay_inactive.png') },
  { on: require('../../assets/tabs/festival_active.png'), off: require('../../assets/tabs/festival_inactive.png') },
  { on: require('../../assets/tabs/map_active.png'), off: require('../../assets/tabs/map_inactive.png') },
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
// 각 탭을 옛 물리 라디오 버튼처럼: 안 눌린 버튼은 살짝 떠 있고(밝은 윗변·은은한 아래 그림자), 눌린 버튼은 translateY로
// 눌려 들어가며 윗변에 진한 홈 테두리가 생기고 배경·아이콘·글자색이 한눈에 바뀐다. 버튼 사이의 세로줄이 5구역을 분명히 나눈다.
const TabButton = memo(function TabButton({ name, index, on, short, minHeight, onPress }: { name: Tab; index: number; on: boolean; short: boolean; minHeight: number; onPress: (name: Tab) => void }) {
  return <Pressable accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected: on }} onPress={() => onPress(name)}
    style={[s.tab, index > 0 && s.tabDivider, { minHeight }, on ? s.tabOn : s.tabOff]}>
    <View style={[on && s.iconOn]}><Image accessible={false} source={on ? ICONS[index]!.on : ICONS[index]!.off} style={s.icon} contentFit="contain" /></View>
    <Text numberOfLines={1} style={[s.label, on && s.active]}>{short ? SHORT_LABELS[name] : name}</Text>
  </Pressable>;
});
const s = StyleSheet.create({
  frame: { backgroundColor: t.color.surface, borderTopWidth: 1, borderColor: t.color.divider, flexShrink: 0 },
  tabs: { flexDirection: 'row', width: '100%', alignSelf: 'center' },
  tab: { flex: 1, minWidth: 44, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4, paddingTop: 7, paddingBottom: 5 },
  // 구역 경계: 버튼 사이에만 세로 줄을 그어 5구역으로 또렷이 나눈다(가장자리는 frame의 테두리가 맡는다).
  tabDivider: { borderLeftWidth: 1, borderLeftColor: t.color.divider },
  // 안 눌린 버튼: 밝은 표면 + 미세한 상(밝음)·하(그림자) 테두리로 살짝 솟은 느낌.
  tabOff: {
    backgroundColor: t.color.surface,
    borderTopWidth: 2, borderTopColor: '#FFFFFF',
    borderBottomWidth: 2, borderBottomColor: t.color.border,
    shadowColor: '#0B1F3A', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  // 눌린 버튼: soft 배경 + 아래로 눌림(translateY) + 윗변에 진한 홈 테두리(primaryPressed), 그림자는 없애 눌려 들어간 느낌을 준다.
  tabOn: {
    backgroundColor: t.color.soft,
    borderTopWidth: 2, borderTopColor: t.color.primaryPressed,
    borderBottomWidth: 2, borderBottomColor: t.color.soft,
    transform: [{ translateY: 2 }],
    shadowOpacity: 0, elevation: 0,
  },
  icon: { width: 22, height: 22 },
  iconOn: { transform: [{ scale: 1.04 }] },
  label: { color: t.color.faint, fontSize: 11, fontWeight: '600', textAlign: 'center', maxWidth: '100%' },
  active: { color: t.color.primary, fontWeight: '800' },
});
