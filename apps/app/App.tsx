import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MapScreen } from './src/features/map/MapScreen.tsx';

const TABS = ['지도·길찾기', '논술', '축제', '학교행사', '내정보'] as const;
export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('지도·길찾기');
  return <SafeAreaProvider><StatusBar style="dark" /><SafeAreaView style={styles.screen}>
    <View style={[styles.content, tab !== '지도·길찾기' && styles.hidden]}><MapScreen /></View>
    {tab !== '지도·길찾기' && <View style={styles.placeholder}><Text style={styles.title}>{tab}</Text><Text style={styles.hint}>아직 준비 중인 화면입니다.</Text><Text style={styles.hint}>지도·길찾기 탭에서 캠퍼스 길을 찾아보세요.</Text></View>}
    <View style={styles.tabs} accessibilityRole="tablist">{TABS.map((name, index) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} style={styles.tab}><Text style={[styles.icon, tab === name && styles.selected]}>{['⌖', '文', '☆', '▦', '○'][index]}</Text><Text style={[styles.label, tab === name && styles.selected]}>{name}</Text></Pressable>)}</View>
  </SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' }, content: { flex: 1 }, hidden: { display: 'none' }, placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }, title: { fontSize: 24, fontWeight: '700', color: '#152C47' }, hint: { color: '#53647A', textAlign: 'center' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#E7EDF5', backgroundColor: '#FFFFFF' }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 62, gap: 5 }, icon: { color: '#79899C', fontSize: 22 }, label: { color: '#65758B', fontSize: 10 }, selected: { color: '#1465E8', fontWeight: '700' },
});
