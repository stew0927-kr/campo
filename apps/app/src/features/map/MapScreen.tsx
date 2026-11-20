import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { CampusPlace, CampusRouteRequest, TravelMode } from '../../contracts.ts';
import { useCampusData } from '../../hooks/useCampusData.ts';
import { useCampusRoute } from '../../hooks/useCampusRoute.ts';
import { CampusMap } from './CampusMap.tsx';
import { DEMO_CAMPUS } from './demoCampus.ts';
import { placeDetail, requestFor, searchPlaces, TRAVEL_MODES } from './model.ts';

type Field = 'from' | 'to';
export function MapScreen() {
  const [demo, setDemo] = useState(false);
  const data = useCampusData(demo ? DEMO_CAMPUS : undefined);
  const [from, setFrom] = useState<CampusPlace | null>(null);
  const [to, setTo] = useState<CampusPlace | null>(null);
  const [mode, setMode] = useState<TravelMode>('shortest');
  const [request, setRequest] = useState<CampusRouteRequest | null>(null);
  const [field, setField] = useState<Field | null>(null);
  const [query, setQuery] = useState('');
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  // Invalidates pending GPS responses when the user makes another selection.
  const gpsGeneration = useRef(0);
  useEffect(() => () => { gpsGeneration.current++; }, []);
  const result = useCampusRoute(data.runtime, request);
  const matches = useMemo(() => searchPlaces(data.places, data.buildings, query), [data.places, data.buildings, query]);
  const route = result.route;
  const center = data.campus?.center ?? { lat: 37.5572, lng: 127.045 };
  function clearGps() { gpsGeneration.current++; setGpsBusy(false); setGpsMessage(null); }
  function choose(place: CampusPlace) {
    clearGps();
    if (field === 'from') setFrom(place); else setTo(place);
    setRequest(null); setField(null);
  }
  function switchData() {
    clearGps(); setDemo((value) => !value); setFrom(null); setTo(null); setRequest(null); setQuery(''); setField(null);
  }
  async function locate() {
    const generation = ++gpsGeneration.current;
    setGpsBusy(true); setGpsMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (generation !== gpsGeneration.current) return;
      if (permission.status !== 'granted') { setGpsMessage('위치 권한이 없어도 출발지와 목적지를 직접 선택할 수 있습니다.'); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (generation !== gpsGeneration.current) return;
      const { latitude: lat, longitude: lng } = position.coords;
      // A current-location choice is a point request, not an invented campus node.
      setFrom({ id: 'current-location', name: '현재 위치', lat, lng, nodeType: 'gps', buildingId: null, level: null });
      setRequest(null);
      setGpsMessage('현재 위치를 출발지로 선택했습니다. 캠퍼스 길에서 멀면 경로를 찾지 못할 수 있습니다.');
    } catch {
      if (generation === gpsGeneration.current) setGpsMessage('현재 위치를 확인하지 못했습니다. 출발지를 직접 선택해 주세요.');
    } finally {
      if (generation === gpsGeneration.current) setGpsBusy(false);
    }
  }
  function findRoute() {
    if (from?.nodeType === 'gps' && to) setRequest({ from: { kind: 'point', lat: from.lat, lng: from.lng }, to: { kind: 'node', nodeId: to.id }, mode });
    else setRequest(requestFor(from, to, mode));
  }
  return <View style={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headingRow}><View><Text style={styles.eyebrow}>CAMPO · 한양대학교</Text><Text style={styles.title}>어디로 가시나요?</Text></View>
        {!demo && <Pressable accessibilityRole="button" disabled={gpsBusy} onPress={() => void locate()} style={styles.smallButton}>{gpsBusy ? <ActivityIndicator /> : <Text style={styles.link}>현재 위치</Text>}</Pressable>}
      </View>
      <Text style={styles.hint}>위치 권한 없이도 직접 선택해 길을 찾을 수 있습니다.</Text>
      {(['from', 'to'] as const).map((key) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${key === 'from' ? '출발지' : '목적지'} 검색, ${(key === 'from' ? from : to)?.name ?? '선택하지 않음'}`} onPress={() => { setQuery(''); setField(key); }} style={styles.input}>
        <Text style={styles.inputLabel}>{key === 'from' ? '출발' : '도착'}</Text><Text numberOfLines={1} style={styles.inputText}>{(key === 'from' ? from : to)?.name ?? `${key === 'from' ? '출발지' : '목적지'}를 검색해 주세요`}</Text><Text style={styles.link}>검색</Text>
      </Pressable>)}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {TRAVEL_MODES.map((item) => <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: mode === item.value }} onPress={() => { setMode(item.value); setRequest(null); }} style={[styles.chip, mode === item.value && styles.chipActive]}><Text style={mode === item.value ? styles.activeText : styles.chipText}>{item.label}</Text></Pressable>)}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !from || !to }} disabled={!from || !to} style={[styles.primary, (!from || !to) && styles.disabled]} onPress={findRoute}><Text style={styles.primaryText}>길찾기</Text></Pressable>
      {gpsMessage && <Text accessibilityLiveRegion="polite" style={styles.hint}>{gpsMessage}</Text>}
    </View>
    {demo && <View style={styles.warning}><Text style={styles.warningText}>가상 경로 시험 중입니다 · 실제 캠퍼스 길이 아닙니다</Text></View>}
    {data.status === 'error' && <View style={styles.notice}><Text accessibilityRole="alert">{data.error}</Text><Pressable accessibilityRole="button" onPress={data.reload}><Text style={styles.link}>다시 읽기</Text></Pressable></View>}
    {data.counts.edges === 0 && data.status === 'ready' && <View style={styles.notice}><Text style={styles.hint}>실제 캠퍼스 길 데이터가 아직 없습니다. 장소 검색과 실제 길찾기는 데이터 등록 후 이용할 수 있습니다.</Text></View>}
    {data.issues.length > 0 && <View style={styles.notice}><Text style={styles.hint}>{data.issues.join('\n')}</Text></View>}
    <CampusMap center={center} route={route} from={from} to={to} />
    <ScrollView style={styles.results} contentContainerStyle={styles.resultContent} accessibilityLiveRegion="polite">
      {result.message && <Text style={styles.warningText}>{result.message}</Text>}
      {route ? <>
        <Text style={styles.summary}>{route.timeSec === 0 ? 0 : Math.max(1, Math.ceil(route.timeSec / 60))}분 <Text style={styles.distance}>· {Math.round(route.distanceM)}m</Text></Text>
        <Text style={styles.hint}>예상 이동 시간 · 계단 {route.stairsCount}곳 · 에스컬레이터 {route.escalatorCount}곳</Text>
        {route.fallbackMessage && <Text style={styles.warningText}>{route.fallbackMessage}</Text>}
        {route.slopeWarnings.map((item, i) => <Text key={`${item.edgeId}-${i}`} style={styles.warningText}>{item.message}</Text>)}
        {route.floorChanges.map((item, i) => <Text key={i} style={styles.hint}>{item.label}</Text>)}
        {route.steps.map((step, i) => <View key={i} style={styles.step}><Text style={styles.stepNumber}>{i + 1}</Text><Text style={styles.stepText}>{step.text}</Text></View>)}
        {route.distanceM === 0 && <Text style={styles.hint}>출발지와 목적지가 같습니다.</Text>}
      </> : result.status === 'idle' && <Text style={styles.hint}>출발지와 목적지를 선택하고 길찾기를 눌러 주세요.</Text>}
      {__DEV__ && <Pressable accessibilityRole="button" onPress={switchData} style={styles.demoButton}><Text style={styles.link}>{demo ? '실제 캠퍼스 데이터로 돌아가기' : '개발용 가상 경로 시험하기'}</Text></Pressable>}
    </ScrollView>
    <Modal visible={field !== null} animationType="slide" onRequestClose={() => setField(null)}>
      <KeyboardAvoidingView style={styles.searchScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.searchHeader}><Text style={styles.title}>{field === 'from' ? '출발지' : '목적지'} 검색</Text><Pressable accessibilityRole="button" onPress={() => setField(null)} style={styles.smallButton}><Text style={styles.link}>닫기</Text></Pressable></View>
        <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="장소·건물 이름 또는 강의실 호수" accessibilityLabel="장소 검색어" style={styles.searchInput} autoCorrect={false} />
        {demo && <Text style={styles.warningText}>가상 시험 지점입니다. 실제 장소가 아닙니다.</Text>}
        <FlatList data={matches} keyboardShouldPersistTaps="handled" keyExtractor={(item) => item.id} ListEmptyComponent={<Text style={styles.empty}>{data.places.length ? '검색 결과가 없습니다. 다른 이름으로 찾아 주세요.' : '아직 등록된 장소가 없습니다.'}</Text>} renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => choose(item)} style={styles.place}><Text style={styles.placeName}>{item.name}</Text><Text style={styles.hint}>{placeDetail(item, data.buildings)}</Text></Pressable>} />
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' }, header: { padding: 16, gap: 9 }, headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#1465E8', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, title: { fontSize: 22, fontWeight: '800', color: '#152C47' },
  hint: { color: '#53647A', fontSize: 12, lineHeight: 18 }, smallButton: { padding: 12, minHeight: 44 }, link: { color: '#145CC5', fontWeight: '700', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#DCE4EF', backgroundColor: '#F7F9FC', borderRadius: 12, minHeight: 48, padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center' }, inputLabel: { fontWeight: '700', fontSize: 12, color: '#53647A' }, inputText: { flex: 1, fontSize: 14, color: '#152C47' },
  chips: { gap: 6 }, chip: { paddingHorizontal: 13, paddingVertical: 12, borderRadius: 20, backgroundColor: '#F0F3F8' }, chipActive: { backgroundColor: '#DDEAFF' }, chipText: { color: '#53647A', fontSize: 12 }, activeText: { color: '#145CC5', fontSize: 12, fontWeight: '700' },
  primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#1465E8' }, primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 }, disabled: { backgroundColor: '#9AAAC0' },
  warning: { padding: 9, backgroundColor: '#FFF1D6' }, warningText: { color: '#855000', fontSize: 12, lineHeight: 18 }, notice: { paddingHorizontal: 16, paddingBottom: 8 },
  results: { flexGrow: 0, maxHeight: '30%' }, resultContent: { padding: 16, gap: 8 }, summary: { fontSize: 25, fontWeight: '800', color: '#145CC5' }, distance: { fontSize: 17, fontWeight: '500', color: '#53647A' },
  step: { flexDirection: 'row', gap: 10, paddingVertical: 5 }, stepNumber: { color: '#1465E8', fontWeight: '700', width: 22 }, stepText: { color: '#263D56', flex: 1, fontSize: 14, lineHeight: 21 }, demoButton: { paddingVertical: 13 },
  searchScreen: { flex: 1, padding: 20, paddingTop: 48, backgroundColor: '#FFFFFF', gap: 12 }, searchHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, searchInput: { minHeight: 48, borderRadius: 12, backgroundColor: '#F0F3F8', padding: 14, fontSize: 15 }, place: { paddingVertical: 16, borderBottomWidth: 1, borderColor: '#E7EDF5', gap: 4 }, placeName: { fontSize: 16, fontWeight: '600', color: '#152C47' }, empty: { paddingVertical: 30, color: '#53647A' },
});
