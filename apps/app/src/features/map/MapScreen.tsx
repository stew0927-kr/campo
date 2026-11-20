import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import type { BundledCampus } from '../../campus/types.ts';
import type { CampusPlace, CampusRouteRequest, TravelMode, PhotoCatalog } from '../../contracts.ts';
import { EMPTY_PHOTO_CATALOG } from '../../contracts.ts';
import { useRoutePhotos } from '../../hooks/useRoutePhotos.ts';
import { photoViewerPages } from '../../photos/viewerModel.ts';
import { PhotoViewerModal } from '../../photos/PhotoViewerModal.tsx';
import { useCampusData } from '../../hooks/useCampusData.ts';
import { useCampusRoute } from '../../hooks/useCampusRoute.ts';
import { useGpsMatcher } from '../../hooks/useGpsMatcher.ts';
import { useAppState } from '../../state/AppState.tsx';
import { placeDestination, planIntent } from '../../state/model.ts';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import { screenLayout } from '../../ui/layout.ts';
import { ActionRow, Body, Button, Card, Chips, Empty, Heading, Notice, Page, s } from '../../ui/kit.tsx';
import { MapCanvas } from './MapCanvas.tsx';
import { DEMO_CAMPUS } from './demoCampus.ts';
import indoorFixture from './indoorFixture.json';
import { endpointFor, placeDetail, placesInScope, pointPlace, requestFor, searchPlaces, TRAVEL_MODES } from './model.ts';
import { useSensorFixes } from './useSensorFixes.ts';

type Field = 'from' | 'to';
const GPS_MODE_LABEL = { OUTDOOR: '실외', APPROACHING: '입구 근처', PORTAL: '출입구 전환', INDOOR: '실내', OFF_NETWORK_SUSPECT: '경로 밖 의심' } as const;
export function MapScreen({ active = true, photoCatalog = EMPTY_PHOTO_CATALOG, photoNotice = '현장 사진은 공급 데이터 연결 대기 중입니다.' }: { active?: boolean; photoCatalog?: PhotoCatalog; photoNotice?: string }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  const { state, dispatch } = useAppState();
  const [demo, setDemo] = useState<'none' | 'outdoor' | 'indoor'>('none');
  const data = useCampusData(demo === 'indoor' ? indoorFixture as BundledCampus : demo === 'outdoor' ? DEMO_CAMPUS : undefined);
  const [from, setFrom] = useState<CampusPlace | null>(null);
  const [to, setTo] = useState<CampusPlace | null>(null);
  const [mode, setMode] = useState<TravelMode>(state.defaultMode);
  const [request, setRequest] = useState<CampusRouteRequest | null>(null);
  const [field, setField] = useState<Field | null>(null);
  const [query, setQuery] = useState('');
  const [mapFocus, setMapFocus] = useState(0);
  const [mapPick, setMapPick] = useState<Field | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [flow, setFlow] = useState<'enter' | 'queue' | 'exit' | null>(null);
  const gpsGeneration = useRef(0);
  const lastReroute = useRef(-1);
  const result = useCampusRoute(data.runtime, request);
  const route = result.route;
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const effectiveCatalog = demo === 'none' ? photoCatalog : EMPTY_PHOTO_CATALOG;
  const stepPhotos = useRoutePhotos(route, effectiveCatalog);
  const photoPages = useMemo(() => photoViewerPages(route, stepPhotos, effectiveCatalog), [route, stepPhotos, effectiveCatalog]);
  useEffect(() => setPhotoIndex(null), [route]);
  const gps = useGpsMatcher(data.network, { routeNodeIds: route?.nodeIds ?? null });
  const stopTracking = useCallback(() => setTracking(false), []);
  const sensors = useSensorFixes(tracking && active && demo === 'none', gps.pushFix, stopTracking);
  const matches = useMemo(() => searchPlaces(data.places, data.buildings, query), [data.places, data.buildings, query]);
  const scopePlaces = useMemo(() => placesInScope(data.places, buildingId, level), [data.places, buildingId, level]);
  const [placesExpanded, setPlacesExpanded] = useState(false);
  const visiblePlaces = placesExpanded ? scopePlaces : scopePlaces.slice(0, 20);
  useEffect(() => setPlacesExpanded(false), [buildingId, level, demo]);
  useScreenBack(active && (field !== null || mapPick !== null || photoIndex !== null), useCallback(() => { setField(null); setMapPick(null); setPhotoIndex(null); }, []));
  const building = data.buildings.find((item) => item.id === buildingId);
  useEffect(() => () => { gpsGeneration.current++; }, []);
  useEffect(() => { setMode(state.defaultMode); setRequest(null); }, [state.defaultMode]);
  useEffect(() => { if (!active) { setTracking(false); gpsGeneration.current++; setGpsBusy(false); } }, [active]);
  useEffect(() => { if (!route) dispatch({ type: 'clearEstimate' }); }, [route, dispatch]);
  useEffect(() => {
    if (demo === 'none' && route && to && data.graph?.nodes.has(to.id)) dispatch({ type: 'estimate', nodeId: to.id, timeSec: route.timeSec });
  }, [route, to, demo, data.graph, dispatch]);
  useEffect(() => {
    if (gps.mode === 'INDOOR' || !sensors.running || !gps.rerouteRequested || !gps.position || !to || gps.position.skipped || gps.position.free || lastReroute.current === gps.fixCount) return;
    lastReroute.current = gps.fixCount;
    const next = pointPlace(gps.position, '현재 위치');
    setFrom(next); setRequest({ from: endpointFor(next), to: endpointFor(to), mode });
    setMessage('경로를 벗어나 현재 위치에서 다시 찾았습니다.');
  }, [gps.mode, gps.fixCount, gps.rerouteRequested, gps.position, sensors.running, to, mode]);
  useEffect(() => {
    const intent = state.intent;
    if (!intent) return;
    // An event's real destination must never resolve against the developer fixture.
    if (demo !== 'none') { switchData('none'); return; }
    clearGps(); setTracking(false); setRequest(null); setMapPick(null); setBuildingId(null); setLevel(null); setFlow(null);
    const target = intent.destination;
    const { destination: resolved, start, missingFlow } = planIntent(data.runtime, target);
    if (resolved.kind === 'selected' && !missingFlow) {
      setTo(resolved.place);
      if (start) setFrom(start);
      setBuildingId(resolved.place.buildingId); setLevel(resolved.place.level);
      setField(null); setFlow(target.flow ?? null);
      setMessage(`${target.demo ? '시연용 정보에서 선택했습니다. ' : ''}목적지가 선택됐습니다. 출발지를 확인하고 길찾기를 눌러 주세요.${target.flow === 'queue' ? ' 대기 경로는 보행길 기준이며 실제 대기열의 모양은 아닙니다.' : ''}`);
    } else {
      setTo(null);
      if (target.flow) setFrom(null);
      setQuery(target.searchTerm); setField('to');
      setMessage(resolved.kind === 'search' ? resolved.message : '입장·퇴장 지점 연결이 아직 없습니다. 실제 출발지와 목적지를 직접 선택해 주세요.');
    }
    dispatch({ type: 'consumed', sequence: intent.sequence });
  }, [state.intent, data.runtime, demo, dispatch]);
  function clearGps() { gpsGeneration.current++; setGpsBusy(false); setMessage(null); }
  function choose(place: CampusPlace, target: Field) {
    clearGps();
    if (target === 'from') setFrom(place); else setTo(place);
    setRequest(null); setField(null); setMapPick(null); setFlow(null);
  }
  function switchData(next: typeof demo) {
    clearGps(); setTracking(false); setDemo(next); setFrom(null); setTo(null); setRequest(null); setQuery(''); setField(null); setMapPick(null); setBuildingId(null); setLevel(null); setFlow(null); gps.reset();
  }
  async function locate() {
    const generation = ++gpsGeneration.current;
    setGpsBusy(true); setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (generation !== gpsGeneration.current) return;
      if (permission.status !== 'granted') { setMessage('위치 권한이 없어도 출발지와 목적지를 직접 선택할 수 있습니다.'); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (generation !== gpsGeneration.current) return;
      setFrom(pointPlace({ lat: position.coords.latitude, lng: position.coords.longitude }, '현재 위치'));
      setRequest(null); setMessage('현재 위치를 출발지로 선택했습니다. 캠퍼스 길에서 멀면 경로를 찾지 못할 수 있습니다.');
    } catch { if (generation === gpsGeneration.current) setMessage('현재 위치를 확인하지 못했습니다. 출발지를 직접 선택해 주세요.'); }
    finally { if (generation === gpsGeneration.current) setGpsBusy(false); }
  }
  function selectBuilding(id: string | null) { setBuildingId(id); setLevel(data.buildings.find((item) => item.id === id)?.levels[0] ?? null); }
  function selectIndoorExample() {
    const start = data.places.find((p) => p.id === 'n_out_0001');
    const end = data.places.find((p) => p.id === 'n_A_4_408door');
    if (start && end) { setFrom(start); setTo(end); setRequest(null); setBuildingId(end.buildingId); setLevel(end.level); }
  }
  return <View style={{ flex: 1 }}>
    <Page resetKey={`${active}:${state.sequence}:${mapPick}:${mapFocus}`} title="어디로 가시나요?" subtitle="한양대학교 서울캠퍼스 · 위치 권한 없이도 길을 찾을 수 있습니다.">
      {demo !== 'none' && <Notice>개발용 가상 경로입니다. 실제 한양대 길이나 건물이 아닙니다.</Notice>}
      {data.status === 'error' && <Card><Notice>{data.error}</Notice><Button title="데이터 다시 읽기" onPress={data.reload} /></Card>}
      {data.status === 'ready' && data.counts.edges === 0 && <Notice>실제 캠퍼스 길 데이터가 아직 없습니다. C조원 데이터 연결 후 실제 길찾기를 이용할 수 있습니다.</Notice>}
      {data.issues.length > 0 && <Notice>{data.issues.join('\n')}</Notice>}
      {demo === 'none' && <Body>{photoNotice}</Body>}
      <MapCanvas center={data.campus?.center ?? { lat: 37.5572, lng: 127.045 }} label={demo !== 'none' ? '가상 시험 캠퍼스' : building?.name ?? '한양대학교 서울캠퍼스'} route={route} from={from} to={to} places={scopePlaces} graph={data.graph} buildingId={buildingId} level={level} position={sensors.running ? gps.position : null} flow={flow} stepPhotos={stepPhotos} onOpenPhoto={setPhotoIndex}
        onPoint={(point) => { if (!mapPick) return; if (buildingId) { setMessage('실내에서는 등록된 지점을 선택해 주세요.'); return; } choose(pointPlace(point, '지도에서 선택한 위치'), mapPick); }}
        onPlace={(place) => choose(place, mapPick ?? 'to')} />
      <Card>
        {(['from', 'to'] as const).map((key) => <Button key={key} secondary title={`${key === 'from' ? '출발' : '도착'}: ${(key === 'from' ? from : to)?.name ?? '검색해서 선택해 주세요'}`} onPress={() => { setQuery(''); setField(key); }} />)}
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {TRAVEL_MODES.map((item) => <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: mode === item.value }} onPress={() => { setMode(item.value); setRequest(null); }} style={[s.chip, mode === item.value && s.selected]}><Text style={s.link}>{item.label}</Text></Pressable>)}
        </ScrollView>
        <ActionRow><View style={{ flex: 1 }}><Button secondary title="출발·도착 바꾸기" disabled={!from && !to} onPress={() => { clearGps(); setTracking(false); setFrom(to); setTo(from); setRequest(null); setMapPick(null); setFlow(null); }} /></View><View style={{ flex: 1 }}><Button secondary title="선택 초기화" disabled={!from && !to && !request} onPress={() => { clearGps(); setTracking(false); setFrom(null); setTo(null); setRequest(null); setMapPick(null); setFlow(null); }} /></View></ActionRow>
        <Button title="길찾기" disabled={!from || !to || data.status !== 'ready'} onPress={() => { setRequest(requestFor(from, to, mode)); setMapFocus((value) => value + 1); }} />
        {demo === 'none' && <Button secondary disabled={gpsBusy} title={gpsBusy ? '위치를 확인하고 있습니다…' : '현재 위치를 출발지로'} onPress={() => void locate()} />}
        {gpsBusy && <ActivityIndicator />}
        {message && <Notice>{message}</Notice>}
      </Card>
      <Heading>지도에서 선택해 주세요</Heading>
      <Chips values={['실외', '실내'] as const} value={buildingId === null ? '실외' : '실내'} onChange={(value) => {
        if (value === '실외') selectBuilding(null);
        else if (data.buildings[0]) selectBuilding(data.buildings[0].id);
        else setMessage('등록된 실내 건물·층 데이터가 없습니다. 임의의 실내 경로는 만들지 않습니다.');
      }} />
      {buildingId !== null && <>
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{data.buildings.map((item) => <Button key={item.id} secondary title={item.name} onPress={() => selectBuilding(item.id)} />)}</ScrollView>
        <Chips values={(building?.levels ?? []).map(String)} value={String(level)} onChange={(value) => setLevel(Number(value))} />
        <Body>{building?.name} · {level !== null && level < 0 ? `지하 ${-level}층` : `${level}층`} · 등록된 지점·연결만 표시합니다. 층은 경로 판단에 사용하지 않습니다.</Body>
      </>}
      <ActionRow><View style={{ flex: 1 }}><Button secondary title="지도에서 출발 선택" onPress={() => setMapPick('from')} /></View><View style={{ flex: 1 }}><Button secondary title="지도에서 도착 선택" onPress={() => setMapPick('to')} /></View></ActionRow>
      {mapPick && <Notice>{mapPick === 'from' ? '출발' : '도착'} 지점을 눌러 주세요.{buildingId ? ' 실내에서는 등록된 초록 지점이나 아래 목록을 선택해 주세요.' : ' 길 근처의 점을 누르면 기존 엔진이 보행 경로에 연결합니다.'}</Notice>}
      {mapPick && <Button secondary title="지도 선택 취소" onPress={() => setMapPick(null)} />}
      <Body>입장=파랑 · 대기=주황 · 퇴장=회색. 실외 보기는 전체 경로 개요이며, 실내는 건물·층을 골라 확인해 주세요.</Body>
      {scopePlaces.length === 0 ? <Empty message="이 보기에 등록된 장소가 없습니다." /> : <Card><Heading>이 보기의 장소</Heading>{visiblePlaces.map((place) => <View key={place.id} style={{ gap: 4 }}><Button secondary title={`${place.name} · ${placeDetail(place, data.buildings)}`} onPress={() => choose(place, mapPick ?? 'to')} />{demo === 'none' && <Button secondary title={state.favorites.some((p) => p.key === `place:${place.id}`) ? '장소 즐겨찾기 해제' : '장소 즐겨찾기'} onPress={() => dispatch({ type: 'favorite', destination: placeDestination(place) })} />}</View>)}{scopePlaces.length > 20 && <Button secondary title={placesExpanded ? '장소 목록 접기' : `장소 ${scopePlaces.length}개 전체 보기`} onPress={() => setPlacesExpanded((value) => !value)} />}</Card>}
      <Card><Heading>이동 안내</Heading>
        {result.message && <Notice>{result.message}</Notice>}
        {route ? <>
          <Heading>{route.timeSec === 0 ? 0 : Math.max(1, Math.ceil(route.timeSec / 60))}분 · {Math.round(route.distanceM)}m</Heading>
          <Body>계단 {route.stairsCount}곳 · 에스컬레이터 {route.escalatorCount}곳</Body>
          {route.fallbackMessage && <Notice>{route.fallbackMessage}</Notice>}
          {route.slopeWarnings.map((item, i) => <Notice key={`${item.edgeId}-${i}`}>{item.message}</Notice>)}
          {route.floorChanges.map((item, i) => <Body key={i}>{item.label}</Body>)}
          {route.steps.map((step, i) => <Body key={i}>{i + 1}. {step.text}</Body>)}
          {route.distanceM === 0 && <Body>출발지와 목적지가 같습니다.</Body>}
          {stepPhotos.some((step) => step.photo !== null) ? <Button secondary title="사진으로 이동 안내 보기" onPress={() => setPhotoIndex(0)} /> : <Body>{demo === 'none' ? photoNotice : '가상 경로 시험에서는 서버 사진을 사용하지 않습니다.'} 현재는 문구와 지도로 안내합니다.</Body>}
        </> : result.status === 'idle' && <Body>출발지와 목적지를 선택하고 길찾기를 눌러 주세요.</Body>}
      </Card>
      {demo === 'none' && <Card><Heading>현재 위치 안내</Heading><Body>위치는 안내를 시작한 동안만 사용하며 앱에서 저장하지 않습니다. 실내 층 추정은 기기·데이터 상태에 따라 부정확할 수 있습니다. 실내 재탐색은 정확한 지점을 수동 선택해 주세요.</Body>
        <Button secondary disabled={!route || data.counts.edges === 0} title={tracking ? '위치 안내 중지' : '위치 안내 시작'} onPress={() => { gps.reset(); lastReroute.current = -1; setTracking((old) => !old); }} />
        <Body>{sensors.running ? `위치 수신 중 · ${GPS_MODE_LABEL[gps.mode]}${gps.level === null ? ' · 층 미확인' : ` · ${gps.level}층`}` : '위치 추적을 사용하지 않고 있습니다.'}</Body>
        {sensors.message && <Notice>{sensors.message}</Notice>}{gps.messages.map((text, i) => <Notice key={i}>{text}</Notice>)}
      </Card>}
      {__DEV__ && <Card><Heading>개발용 연결 시험</Heading><Button secondary title="야외 가상 경로 시험" onPress={() => switchData('outdoor')} /><Button secondary title="실내·계단·엘리베이터 시험" onPress={() => switchData('indoor')} />{demo === 'indoor' && <Button title="정문 → 가상 408호 선택" onPress={selectIndoorExample} />}<Button secondary title="실제 캠퍼스 데이터로 돌아가기" onPress={() => switchData('none')} /></Card>}
    </Page>
    <PhotoViewerModal visible={photoIndex !== null} pages={photoPages} initialIndex={photoIndex ?? 0} onClose={() => setPhotoIndex(null)} />
    <Modal visible={field !== null} animationType="slide" onRequestClose={() => setField(null)}><SafeAreaView style={{ flex: 1 }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, width: '100%', maxWidth: layout.modalMaxWidth, alignSelf: 'center', padding: layout.padding, gap: 12 }}>
      <Heading>{field === 'from' ? '출발지' : '목적지'} 검색</Heading><Button secondary title="닫기" onPress={() => setField(null)} />
      <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="장소·건물 이름 또는 강의실 호수" accessibilityLabel="장소 검색어" style={s.input} autoCorrect={false} />
      {demo !== 'none' && <Notice>가상 시험 데이터입니다. 실제 장소가 아닙니다.</Notice>}
      <FlatList data={matches} keyboardShouldPersistTaps="handled" keyExtractor={(item) => item.id} ListEmptyComponent={<Empty message={data.places.length ? '검색 결과가 없습니다. 다른 이름으로 찾아 주세요.' : '아직 등록된 장소가 없습니다. C조원의 데이터 연결을 기다리고 있습니다.'} />} renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => choose(item, field ?? 'to')} style={{ paddingVertical: 16, gap: 4 }}><Heading>{item.name}</Heading><Body>{placeDetail(item, data.buildings)}</Body></Pressable>} />
    </KeyboardAvoidingView></SafeAreaView></Modal>
  </View>;
}
