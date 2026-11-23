import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import type { BundledCampus } from '../../campus/types.ts';
import type { CampusPlace, CampusRouteRequest, TravelMode, PhotoCatalog, RoutePoint } from '../../contracts.ts';
import { EMPTY_PHOTO_CATALOG } from '../../contracts.ts';
import { useRoutePhotos } from '../../hooks/useRoutePhotos.ts';
import { combineRoundTrip, photoSpots as spotsOf, placeLine, placeLookup, roadviewFrames, spotFrame, stepMarkerGroups, type MarkerGroup, type PhotoSpot, type RoadviewFrame } from '../../photos/roadviewModel.ts';
import { headingLabel } from '../../photos/demoPhotoArt.ts';
import { useCampusData } from '../../hooks/useCampusData.ts';
import { useCampusRoute } from '../../hooks/useCampusRoute.ts';
import { useGpsMatcher } from '../../hooks/useGpsMatcher.ts';
import { useAppState } from '../../state/AppState.tsx';
import { placeDestination, planIntent } from '../../state/model.ts';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import { screenLayout } from '../../ui/layout.ts';
import { floating, theme as t } from '../../ui/theme.ts';
import { ActionRow, Button, Notice } from '../../ui/kit.tsx';
import { MapCanvas } from './MapCanvas.tsx';
import { DEMO_CAMPUS } from './demoCampus.ts';
import indoorFixture from './indoorFixture.json';
import { endpointFor, placeDetail, placesInScope, pointPlace, requestFor, searchPlaces } from './model.ts';
import { useSensorFixes } from './useSensorFixes.ts';
import { EndpointCard, EndpointDot, FloatChip, LocateIcon, ModeChips, PlaceSearch, RestroomChip, RoundButton, RoutePill, SearchBar, Segmented, Sheet, Stat, StatusLine, SwitchRow, TextButton, WheelchairToggle, type SearchTarget } from './MapChrome.tsx';
import { RoadviewScreen } from './RoadviewScreen.tsx';
import { ROADVIEW_DEMO_CAMPUS, ROADVIEW_DEMO_CATALOG, RV } from './roadviewDemo.ts';
import { nearestRestroom } from './restroom.ts';
import type { RoadviewPreview } from './mapTypes.ts';

type Field = 'from' | 'to';
type PickTarget = Field | 'restroom';
type DemoData = 'none' | 'outdoor' | 'indoor' | 'roadview';
const GPS_MODE_LABEL = { OUTDOOR: '실외', APPROACHING: '입구 근처', PORTAL: '출입구 전환', INDOOR: '실내', OFF_NETWORK_SUSPECT: '경로 밖 의심' } as const;
const DEMO_LABEL: Record<DemoData, string> = { none: '실제 데이터', outdoor: '야외 가상', indoor: '실내 시험', roadview: '로드뷰 가상' };
const DEMO_BUNDLE = { outdoor: DEMO_CAMPUS, indoor: indoorFixture as BundledCampus, roadview: ROADVIEW_DEMO_CAMPUS } as const;
/** Travel mode to return to when the wheelchair switch is turned off. */
const walkingMode = (mode: TravelMode): TravelMode => (mode === 'wheelchair' ? 'shortest' : mode);
const floorLabel = (level: number | null) => level === null ? '층 미확인' : level < 0 ? `지하 ${-level}층` : `${level}층`;
const minutes = (sec: number) => sec === 0 ? 0 : Math.max(1, Math.ceil(sec / 60));

/**
 * Full-screen map tab. Three views share one map:
 * home (search + my location), plan (start/end input) and route (result with travel modes in the bottom sheet).
 * Picking a point on the map temporarily hides the overlays.
 */
export function MapScreen({ active = true, photoCatalog = EMPTY_PHOTO_CATALOG, photoNotice = '현장 사진은 공급 데이터 연결 대기 중입니다.' }: { active?: boolean; photoCatalog?: PhotoCatalog; photoNotice?: string }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  const { state, dispatch } = useAppState();
  const [demo, setDemo] = useState<DemoData>('none');
  const data = useCampusData(demo === 'none' ? undefined : DEMO_BUNDLE[demo]);
  const [view, setView] = useState<'home' | 'plan'>('home');
  const [from, setFrom] = useState<CampusPlace | null>(null);
  const [to, setTo] = useState<CampusPlace | null>(null);
  const [mode, setMode] = useState<TravelMode>(state.defaultMode);
  const [request, setRequest] = useState<CampusRouteRequest | null>(null);
  const [search, setSearch] = useState<SearchTarget | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CampusPlace | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [myLocation, setMyLocation] = useState<RoutePoint | null>(null);
  const [mapPick, setMapPick] = useState<PickTarget | null>(null);
  /** Nearest-restroom flow: the chosen start and whether only wheelchair restrooms count. */
  const [restroom, setRestroom] = useState<{ start: CampusPlace; wheelchair: boolean } | null>(null);
  const [roundTrip, setRoundTrip] = useState(false);
  const [preview, setPreview] = useState<RoadviewPreview | null>(null);
  const [roadview, setRoadview] = useState<{ frames: RoadviewFrame[]; index: number; route: boolean } | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [flow, setFlow] = useState<'enter' | 'queue' | 'exit' | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [placesExpanded, setPlacesExpanded] = useState(false);
  const gpsGeneration = useRef(0);
  const focusKey = useRef(0);
  const lastReroute = useRef(-1);
  const result = useCampusRoute(data.runtime, request);
  const route = result.route;
  // Round trip: the way back is a second request through the same engine; both legs are joined only for display.
  const canRoundTrip = request?.from?.kind === 'node' && request.to?.kind === 'node';
  const backRequest = useMemo(() => (roundTrip && canRoundTrip && request ? { from: request.to, to: request.from, mode: request.mode ?? mode } : null), [roundTrip, canRoundTrip, request, mode]);
  const backResult = useCampusRoute(data.runtime, backRequest);
  const trip = useMemo(() => (backRequest ? combineRoundTrip(route, backResult.route) : null), [backRequest, route, backResult.route]);
  const shownRoute = trip?.route ?? route;
  // Demo data uses the virtual roadview photos (no network); the real campus uses the provider's catalog.
  const effectiveCatalog = demo === 'none' ? photoCatalog : demo === 'roadview' ? ROADVIEW_DEMO_CATALOG : EMPTY_PHOTO_CATALOG;
  const stepPhotos = useRoutePhotos(shownRoute, effectiveCatalog);
  const lookup = useMemo(() => placeLookup(data.graph, data.places), [data.graph, data.places]);
  const frames = useMemo(() => roadviewFrames(shownRoute, stepPhotos, effectiveCatalog, lookup, trip?.backFrom ?? null), [shownRoute, stepPhotos, effectiveCatalog, lookup, trip]);
  const stepGroups = useMemo(() => stepMarkerGroups(stepPhotos, shownRoute?.steps.length ?? 0, trip?.backFrom ?? null), [stepPhotos, shownRoute, trip]);
  const spots = useMemo(() => spotsOf(data.graph, effectiveCatalog, buildingId, level), [data.graph, effectiveCatalog, buildingId, level]);
  useEffect(() => { setRoadview(null); setPreview(null); }, [shownRoute]);
  const gps = useGpsMatcher(data.network, { routeNodeIds: route?.nodeIds ?? null });
  const stopTracking = useCallback(() => setTracking(false), []);
  const sensors = useSensorFixes(tracking && active && demo === 'none', gps.pushFix, stopTracking);
  const matches = useMemo(() => searchPlaces(data.places, data.buildings, query), [data.places, data.buildings, query]);
  const scopePlaces = useMemo(() => placesInScope(data.places, buildingId, level), [data.places, buildingId, level]);
  const visiblePlaces = placesExpanded ? scopePlaces : scopePlaces.slice(0, 20);
  useEffect(() => setPlacesExpanded(false), [buildingId, level, demo]);
  const screen = mapPick ? 'pick' : request ? 'route' : view;
  const back = useCallback(() => {
    if (roadview !== null) setRoadview(null);
    else if (preview !== null) setPreview(null);
    else if (search !== null) setSearch(null);
    else if (devOpen) setDevOpen(false);
    else if (mapPick !== null) setMapPick(null);
    else if (request !== null) { setTracking(false); setRequest(null); }
    else if (view === 'plan') closePlan();
    else setSelected(null);
  }, [roadview, preview, search, devOpen, mapPick, request, view]);
  useScreenBack(active && (roadview !== null || preview !== null || search !== null || devOpen || mapPick !== null || request !== null || view === 'plan' || selected !== null), back);
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
    clearGps(); setTracking(false); setRequest(null); setMapPick(null); setBuildingId(null); setLevel(null); setFlow(null); setSelected(null); setDevOpen(false);
    setView('plan');
    const target = intent.destination;
    const { destination: resolved, start, missingFlow } = planIntent(data.runtime, target);
    if (resolved.kind === 'selected' && !missingFlow) {
      setTo(resolved.place);
      if (start) setFrom(start);
      setBuildingId(resolved.place.buildingId); setLevel(resolved.place.level);
      setSearch(null); setFlow(target.flow ?? null);
      setMessage(`${target.demo ? '시연용 정보에서 선택했습니다. ' : ''}목적지가 선택됐습니다. 출발지를 확인하고 길찾기를 눌러 주세요.${target.flow === 'queue' ? ' 대기 경로는 보행길 기준이며 실제 대기열의 모양은 아닙니다.' : ''}`);
    } else {
      setTo(null);
      if (target.flow) setFrom(null);
      setQuery(target.searchTerm); setSearch('to');
      setMessage(resolved.kind === 'search' ? resolved.message : '입장·퇴장 지점 연결이 아직 없습니다. 실제 출발지와 목적지를 직접 선택해 주세요.');
    }
    dispatch({ type: 'consumed', sequence: intent.sequence });
  }, [state.intent, data.runtime, demo, dispatch]);

  function clearGps() { gpsGeneration.current++; setGpsBusy(false); setMessage(null); }
  function focusOn(point: RoutePoint) { setFocus({ lat: point.lat, lng: point.lng, key: ++focusKey.current }); }
  /** Compute as soon as both ends exist; the route view replaces the input view. */
  function findRoute(start: CampusPlace | null, end: CampusPlace | null, travel: TravelMode = mode) {
    const next = requestFor(start, end, travel);
    if (next && data.status === 'ready') setRequest(next);
  }
  function choose(place: CampusPlace, target: Field) {
    clearGps(); setRestroom(null);
    const start = target === 'from' ? place : from;
    const end = target === 'to' ? place : to;
    setFrom(start); setTo(end);
    setRequest(null); setSearch(null); setMapPick(null); setFlow(null); setSelected(null); setView('plan');
    findRoute(start, end);
  }
  function openPlan() { setSelected(null); setDevOpen(false); setView('plan'); }
  function closePlan() { clearGps(); setTracking(false); setFrom(null); setTo(null); setRequest(null); setMapPick(null); setFlow(null); setRestroom(null); setRoundTrip(false); setView('home'); }
  function swap() {
    clearGps(); setTracking(false); setFrom(to); setTo(from); setRequest(null); setMapPick(null); setFlow(null); setRestroom(null);
    findRoute(to, from);
  }
  function changeMode(next: TravelMode) {
    setMode(next);
    if (request) setRequest(requestFor(from, to, next));
  }
  function openSearch(target: SearchTarget) { setQuery(''); setSearch(target); setPreview(null); }
  /**
   * Nearest restroom from `start` (core findNearestRestroom), then the normal route request to it.
   * `wheelchair`: only restrooms checked as wheelchair-usable, by the wheelchair travel mode.
   */
  function findRestroom(start: CampusPlace, wheelchair: boolean) {
    clearGps(); setTracking(false); setSearch(null); setMapPick(null); setFlow(null); setSelected(null); setView('plan');
    setFrom(start); setRestroom({ start, wheelchair });
    const found = nearestRestroom(data.runtime, endpointFor(start), wheelchair, mode);
    if (!found.found) { setTo(null); setRequest(null); setMessage(found.message); return; }
    const target = data.places.find((p) => p.id === found.nodeId) ?? null;
    setTo(target ?? { id: found.nodeId, name: '화장실', nodeType: 'restroom', buildingId: null, level: null, lat: start.lat, lng: start.lng });
    setMode(found.request.mode ?? mode);
    setRequest(found.request);
  }
  function setWheelchair(on: boolean) {
    if (restroom) findRestroom(restroom.start, on);
    else changeMode(on ? 'wheelchair' : walkingMode(state.defaultMode));
  }
  function pickFor(target: PickTarget, place: CampusPlace) {
    if (target === 'restroom') findRestroom(place, mode === 'wheelchair');
    else choose(place, target);
  }
  function openRoadview(index: number | null) {
    setPreview(null);
    if (index !== null && frames[index]) { setRoadview({ frames, index, route: true }); return; }
    if (!preview) return;
    const frame = spotFrame(preview.key.replace(/^spot:/, ''), preview.lngLat, effectiveCatalog, lookup);
    if (frame) setRoadview({ frames: [frame], index: 0, route: false });
  }
  function showSpot(spot: PhotoSpot) {
    const info = lookup(spot.nodeId);
    setPreview({ key: `spot:${spot.nodeId}`, lngLat: spot.lngLat, thumbUrl: spot.thumbUrl, title: info?.name ?? '사진 지점', subtitle: `${info ? placeLine(info) : '실외'} · 사진 ${spot.count}장`, entries: [] });
  }
  function showStepGroup(group: MarkerGroup) {
    const first = frames[group.entries[0]!.index];
    const photo = first?.step.photo ?? null;
    setPreview({ key: group.key, lngLat: group.lngLat, thumbUrl: photo?.thumbUrl ?? null, title: first?.place.name ?? '경로 지점', subtitle: headingLabel(photo?.heading_deg ?? null), entries: group.entries });
    focusOn({ lng: group.lngLat[0], lat: group.lngLat[1] });
  }
  function showStep(stepIndex: number) {
    const index = stepPhotos.findIndex((s) => s.stepIndex === stepIndex);
    const group = stepGroups.find((g) => g.entries.some((e) => e.index === index));
    if (group) showStepGroup({ ...group, entries: group.entries.filter((e) => e.index === index) });
  }
  function switchData(next: DemoData) {
    clearGps(); setTracking(false); setDemo(next); setFrom(null); setTo(null); setRequest(null); setQuery(''); setSearch(null); setMapPick(null); setBuildingId(null); setLevel(null); setFlow(null);
    setRestroom(null); setRoundTrip(false); setPreview(null); setRoadview(null);
    setSelected(null); setView('home'); setDevOpen(false); setMyLocation(null); gps.reset();
  }
  /** One permission + position read shared by the locate button and the "current location" endpoint. */
  async function currentPoint(): Promise<RoutePoint | null> {
    const generation = ++gpsGeneration.current;
    setGpsBusy(true); setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (generation !== gpsGeneration.current) return null;
      if (permission.status !== 'granted') { setMessage('위치 권한이 없어도 출발지와 목적지를 직접 선택할 수 있습니다.'); return null; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (generation !== gpsGeneration.current) return null;
      return { lat: position.coords.latitude, lng: position.coords.longitude };
    } catch {
      if (generation === gpsGeneration.current) setMessage('현재 위치를 확인하지 못했습니다. 출발지를 직접 선택해 주세요.');
      return null;
    } finally { if (generation === gpsGeneration.current) setGpsBusy(false); }
  }
  async function pickCurrentAs(target: PickTarget) {
    const point = await currentPoint();
    if (!point) { setSearch(null); return; }
    setMyLocation(point);
    pickFor(target, pointPlace(point, '현재 위치'));
    if (target !== 'restroom') setMessage(`현재 위치를 ${target === 'from' ? '출발지' : '도착지'}로 선택했습니다. 캠퍼스 길에서 멀면 경로를 찾지 못할 수 있습니다.`);
  }
  async function locateMe() {
    const point = await currentPoint();
    if (!point) return;
    setMyLocation(point); focusOn(point);
  }
  function showPlace(place: CampusPlace) {
    setSearch(null); setSelected(place); setView('home');
    if (place.buildingId !== buildingId || (place.buildingId !== null && place.level !== level)) { setBuildingId(place.buildingId); setLevel(place.level); }
    focusOn(place);
  }
  function selectBuilding(id: string | null) { setBuildingId(id); setLevel(data.buildings.find((item) => item.id === id)?.levels[0] ?? null); }
  function selectExample(startId: string, endId: string, run = false) {
    const start = data.places.find((p) => p.id === startId);
    const end = data.places.find((p) => p.id === endId);
    if (!start || !end) return;
    setFrom(start); setTo(end); setRequest(null); setRestroom(null); setView('plan'); setDevOpen(false);
    if (end.buildingId) { setBuildingId(end.buildingId); setLevel(end.level); }
    if (run) findRoute(start, end);
  }
  function toggleTracking() { gps.reset(); lastReroute.current = -1; setTracking((old) => !old); }

  const sheetMax = (share: number) => Math.round(Math.max(220, (window.height - layout.tabMinHeight) * share));
  const notices = [
    demo !== 'none' ? '개발용 가상 경로입니다. 실제 한양대 길이나 건물이 아닙니다.' : null,
    data.status === 'ready' && data.counts.edges === 0 ? '실제 캠퍼스 길 데이터가 아직 없습니다. C조원 데이터 연결 후 실제 길찾기를 이용할 수 있습니다.' : null,
    ...data.issues,
    demo === 'none' ? photoNotice : null,
  ].filter((item): item is string => Boolean(item));
  const messageBlock = <>
    {message && <Notice>{message}</Notice>}
    {gpsBusy && <View style={st.busy}><ActivityIndicator color={t.color.primary} /><Text style={st.busyText}>위치를 확인하고 있습니다…</Text></View>}
  </>;
  const indoorControls = <View style={{ gap: 10 }}>
    <View style={st.rowBetween}>
      <Text style={st.sectionTitle}>{buildingId === null ? '실외 지도' : `${building?.name ?? '실내'} · ${floorLabel(level)}`}</Text>
      <Segmented values={['실외', '실내'] as const} value={buildingId === null ? '실외' : '실내'} onChange={(value) => {
        if (value === '실외') selectBuilding(null);
        else if (data.buildings[0]) selectBuilding(buildingId ?? data.buildings[0].id);
        else setMessage('등록된 실내 건물·층 데이터가 없습니다. 임의의 실내 경로는 만들지 않습니다.');
      }} />
    </View>
    {buildingId !== null && <>
      {data.buildings.length > 1 && <Segmented values={data.buildings.map((item) => item.name)} value={building?.name ?? ''} onChange={(name) => selectBuilding(data.buildings.find((item) => item.name === name)?.id ?? null)} />}
      <View style={st.floorRow}>{(building?.levels ?? []).map((item) => <Pressable key={item} accessibilityRole="button" accessibilityLabel={floorLabel(item)} accessibilityState={{ selected: item === level }} onPress={() => setLevel(item)} style={[st.floor, item === level && st.floorOn]}>
        <Text style={[st.floorText, item === level && st.floorTextOn]}>{item < 0 ? `B${-item}` : `${item}F`}</Text>
      </Pressable>)}</View>
    </>}
  </View>;

  const sheetKey = `${screen}:${demo}`;
  const homeSheet = <Sheet key={sheetKey} maxHeight={sheetMax(0.78)} defaultHeight={sheetMax(0.4)}>
    {messageBlock}
    {selected ? <View style={st.placeCard}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={st.placeName}>{selected.name}</Text>
        <Text style={st.placeDetail}>{placeDetail(selected, data.buildings)}</Text>
      </View>
      <ActionRow>
        <View style={{ flex: 1 }}><Button secondary title="출발지로" onPress={() => choose(selected, 'from')} /></View>
        <View style={{ flex: 1 }}><Button title="도착지로" onPress={() => choose(selected, 'to')} /></View>
      </ActionRow>
      {demo === 'none' && <TextButton title={state.favorites.some((p) => p.key === `place:${selected.id}`) ? '장소 즐겨찾기 해제' : '장소 즐겨찾기'} onPress={() => dispatch({ type: 'favorite', destination: placeDestination(selected) })} />}
    </View> : null}
    {data.status === 'error' && <View style={{ gap: 8 }}><Notice>{data.error}</Notice><Button secondary title="데이터 다시 읽기" onPress={data.reload} /></View>}
    {notices.length > 0 && <View style={{ gap: 6 }}>{notices.map((text, i) => <StatusLine key={i}>{text}</StatusLine>)}</View>}
    {indoorControls}
    <View style={{ gap: 4 }}>
      <TextButton title={placesOpen ? '장소 목록 닫기' : `이 보기의 장소 ${scopePlaces.length}곳`} disabled={scopePlaces.length === 0} onPress={() => setPlacesOpen((value) => !value)} />
      {placesOpen && visiblePlaces.map((place) => <Pressable key={place.id} accessibilityRole="button" onPress={() => showPlace(place)} style={({ pressed }) => [st.listRow, pressed && { backgroundColor: t.color.sunken }]}>
        <Text style={st.listName}>{place.name}</Text><Text style={st.listDetail}>{placeDetail(place, data.buildings)}</Text>
      </Pressable>)}
      {placesOpen && scopePlaces.length > 20 && <TextButton title={placesExpanded ? '장소 목록 접기' : `장소 ${scopePlaces.length}개 전체 보기`} onPress={() => setPlacesExpanded((value) => !value)} />}
    </View>
  </Sheet>;

  const planSheet = <Sheet key={sheetKey} maxHeight={sheetMax(0.7)} defaultHeight={sheetMax(0.42)} footer={restroom ? undefined : <Button title="길찾기" disabled={!from || !to || data.status !== 'ready'} onPress={() => findRoute(from, to)} />}>
    {messageBlock}
    {restroom && <WheelchairToggle value={restroom.wheelchair} onChange={setWheelchair} />}
    {!restroom && <ModeChips value={mode} onChange={changeMode} />}
    {demo !== 'none' && <StatusLine>개발용 가상 경로입니다. 실제 한양대 길이나 건물이 아닙니다.</StatusLine>}
    {data.status === 'ready' && data.counts.edges === 0 && <StatusLine>실제 캠퍼스 길 데이터가 아직 없습니다. C조원 데이터 연결 후 실제 길찾기를 이용할 수 있습니다.</StatusLine>}
    <Text style={st.caption}>{!from || !to ? '출발지와 도착지를 정하면 바로 경로를 찾아 드립니다. 입력란을 눌러 현재 위치, 지도, 검색 중에서 골라 주세요.' : '이동 방식을 고른 뒤 길찾기를 눌러 주세요.'}</Text>
  </Sheet>;

  const hasPhotos = frames.some((frame) => frame.step.photo !== null);
  const routePeek = route ? <Text style={st.peekText}>{restroom ? '가장 가까운 화장실 · ' : ''}{minutes(shownRoute!.timeSec)}분 · {Math.round(shownRoute!.distanceM)}m{trip ? ' · 왕복' : ''}</Text> : null;
  const routeSheet = <Sheet key={sheetKey} maxHeight={sheetMax(0.8)} defaultHeight={sheetMax(0.46)} peek={routePeek}>
    {restroom && <Text accessibilityRole="header" style={st.sectionTitle}>가장 가까운 화장실{to ? ` · ${to.name}` : ''}</Text>}
    <WheelchairToggle value={restroom ? restroom.wheelchair : mode === 'wheelchair'} onChange={setWheelchair} />
    {!restroom && <ModeChips value={mode} onChange={changeMode} />}
    {messageBlock}
    {result.message && <Notice>{result.message}</Notice>}
    {route && shownRoute ? <>
      <View style={st.summary}>
        <View style={st.timeRow} accessible accessibilityLabel={`${minutes(shownRoute.timeSec)}분`}><Text style={st.bigTime}>{minutes(shownRoute.timeSec)}</Text><Text style={st.bigUnit}>분</Text></View>
        <Text style={st.distance}>{Math.round(shownRoute.distanceM)}m{trip ? ' · 왕복' : ''}</Text>
      </View>
      <View style={st.stats}>
        <Stat value={`${shownRoute.stairsCount}곳`} label="계단" /><View style={st.statDivider} />
        <Stat value={`${shownRoute.escalatorCount}곳`} label="에스컬레이터" /><View style={st.statDivider} />
        <Stat value={`${shownRoute.floorChanges.length}번`} label="층 이동" />
      </View>
      {route.fallbackMessage && <Notice>{route.fallbackMessage}</Notice>}
      {route.slopeWarnings.map((item, i) => <Notice key={`${item.edgeId}-${i}`}>{item.message}</Notice>)}
      {canRoundTrip && <SwitchRow label="왕복 보기(돌아오는 길 포함)" value={roundTrip} onChange={setRoundTrip} />}
      {roundTrip && backResult.message && <Notice>{backResult.message}</Notice>}
      {shownRoute.floorChanges.length > 0 && <View style={{ gap: 6 }}>{shownRoute.floorChanges.map((item, i) => <View key={i} style={st.floorChange}><Text style={st.floorChangeText}>{item.label}</Text></View>)}</View>}
      {route.distanceM === 0 && <Text style={st.caption}>출발지와 목적지가 같습니다.</Text>}
      <ActionRow>
        {demo === 'none' && <View style={{ flex: 1 }}><Button disabled={data.counts.edges === 0} title={tracking ? '위치 안내 중지' : '위치 안내 시작'} onPress={toggleTracking} /></View>}
        {hasPhotos && <View style={{ flex: 1 }}><Button secondary title="로드뷰로 보기" onPress={() => openRoadview(0)} /></View>}
      </ActionRow>
      {!hasPhotos && <Text style={st.caption}>{demo === 'none' ? photoNotice : '이 가상 데이터에는 로드뷰 사진이 없습니다.'} 현재는 문구와 지도로 안내합니다.</Text>}
      {demo === 'none' && <View style={{ gap: 6 }}>
        <Text style={st.caption}>{sensors.running ? `위치 수신 중 · ${GPS_MODE_LABEL[gps.mode]}${gps.level === null ? ' · 층 미확인' : ` · ${gps.level}층`}` : '위치는 안내를 시작한 동안만 사용하며 앱에서 저장하지 않습니다. 실내 층 추정은 부정확할 수 있으니 실내 재탐색은 정확한 지점을 직접 선택해 주세요.'}</Text>
        {sensors.message && <Notice>{sensors.message}</Notice>}{gps.messages.map((text, i) => <Notice key={i}>{text}</Notice>)}
      </View>}
      {indoorControls}
      <View style={{ gap: 0 }}>
        <Text accessibilityRole="header" style={st.sectionTitle}>단계별 안내</Text>
        {shownRoute.steps.map((step, i) => {
          const hasPhoto = stepPhotos.some((s) => s.stepIndex === i && s.photo !== null);
          return <View key={i}>
            {trip && (i === 0 || i === trip.backFrom) && <Text style={st.legTitle}>{i === 0 ? '가는 길' : '오는 길'}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel={`${i + 1}단계. ${step.text}${hasPhoto ? '. 눌러서 지도에서 사진 보기' : ''}`} disabled={!hasPhoto} onPress={() => showStep(i)} style={({ pressed }) => [st.step, pressed && { backgroundColor: t.color.sunken }]}>
              <View style={st.stepIndex}><Text style={st.stepIndexText}>{i + 1}</Text></View>
              <Text style={st.stepText}>{step.text}</Text>
              {hasPhoto && <Text style={st.stepPhoto}>사진</Text>}
            </Pressable>
          </View>;
        })}
      </View>
    </> : result.status === 'idle' && <Text style={st.caption}>출발지와 목적지를 선택하고 길찾기를 눌러 주세요.</Text>}
  </Sheet>;

  const pickSheet = <Sheet key={sheetKey} maxHeight={sheetMax(0.4)} footer={<Button secondary title="지도 선택 취소" onPress={() => setMapPick(null)} />}>
    <View style={st.rowStart}><EndpointDot kind={mapPick === 'to' ? 'to' : 'from'} /><Text style={st.sheetTitle}>{mapPick === 'to' ? '도착' : '출발'} 지점을 눌러 주세요.</Text></View>
    <Text style={st.caption}>{buildingId ? '실내에서는 등록된 초록 지점을 선택해 주세요.' : '길 근처의 점을 누르면 기존 엔진이 보행 경로에 연결합니다. 초록 점을 누르면 등록된 지점으로 선택합니다.'}</Text>
    {messageBlock}
  </Sheet>;

  const fitTop = screen === 'plan' ? 150 : 90;
  return <View style={st.root}>
    <View style={st.mapArea}>
      <MapCanvas center={data.campus?.center ?? { lat: 37.5572, lng: 127.045 }} label={demo !== 'none' ? '가상 시험 캠퍼스' : building?.name ?? '한양대학교 서울캠퍼스'} route={shownRoute} from={from} to={to} places={scopePlaces} graph={data.graph} buildingId={buildingId} level={level}
        position={sensors.running ? gps.position : myLocation} flow={flow}
        focus={focus} selected={screen === 'home' ? selected : null} fitPadding={{ top: fitTop, bottom: 48, left: 36, right: 36 }}
        photoSpots={screen === 'home' ? spots : []} onPhotoSpot={showSpot} stepGroups={screen === 'route' ? stepGroups : []} onStepGroup={showStepGroup}
        preview={screen === 'pick' ? null : preview} onOpenPreview={openRoadview}
        onPoint={(point) => { if (!mapPick) { setPreview(null); return; } if (buildingId) { setMessage('실내에서는 등록된 지점을 선택해 주세요.'); return; } pickFor(mapPick, pointPlace(point, '지도에서 선택한 위치')); }}
        onPlace={(place) => { if (mapPick) pickFor(mapPick, place); else if (screen === 'home') { setSelected(place); setDevOpen(false); } }} />
      {screen !== 'pick' && <View style={[st.top, { paddingHorizontal: layout.padding }]} pointerEvents="box-none">
        <View style={[st.topInner, { maxWidth: layout.modalMaxWidth }]} pointerEvents="box-none">
          {screen === 'home' && <>
            <SearchBar onSearch={() => openSearch('place')} onRoute={openPlan} />
            <RestroomChip onPress={() => openSearch('restroom')} />
            {__DEV__ && <FloatChip label="개발 데이터" text={`개발 · ${DEMO_LABEL[demo]}`} onPress={() => setDevOpen((value) => !value)} />}
            {__DEV__ && devOpen && <View style={st.devMenu}>
              <Text style={st.caption}>개발용 연결 시험입니다. 가상 데이터는 실제 한양대 길이 아닙니다.</Text>
              <Button secondary title="실제 캠퍼스 데이터로 돌아가기" onPress={() => switchData('none')} />
              <Button secondary title="야외 가상 경로 시험" onPress={() => switchData('outdoor')} />
              <Button secondary title="실내·계단·엘리베이터 시험" onPress={() => switchData('indoor')} />
              <Button secondary title="실내·실외 로드뷰 시험" onPress={() => switchData('roadview')} />
              {demo === 'indoor' && <Button title="정문 → 가상 408호 선택" onPress={() => selectExample('n_out_0001', 'n_A_4_408door')} />}
              {demo === 'roadview' && <>
                <Button title="정문 → 가상 201호 강의실" onPress={() => selectExample(RV.gate, RV.room201, true)} />
                <Button secondary title="왕복 예시: 정문 ↔ 가상 본관 앞" onPress={() => { selectExample(RV.gate, RV.hall, true); setRoundTrip(true); }} />
                <Button secondary title="갈림길 예시: 정문 → 가상 중앙 광장" onPress={() => selectExample(RV.gate, RV.plaza, true)} />
              </>}
            </View>}
          </>}
          {screen === 'plan' && <EndpointCard from={from} to={to} onField={openSearch} onSwap={swap} onClose={closePlan} />}
          {screen === 'route' && <RoutePill from={from} to={to} onBack={() => { setTracking(false); setRequest(null); }} />}
        </View>
      </View>}
      {screen !== 'pick' && demo === 'none' && <View style={st.fab} pointerEvents="box-none">
        <RoundButton label="내 위치로 이동" busy={gpsBusy} onPress={() => void locateMe()}><LocateIcon color={myLocation ? t.color.primary : t.color.text} /></RoundButton>
      </View>}
    </View>
    {screen === 'home' ? homeSheet : screen === 'plan' ? planSheet : screen === 'route' ? routeSheet : pickSheet}
    <RoadviewScreen visible={roadview !== null} frames={roadview?.frames ?? []} initialIndex={roadview?.index ?? 0} route={roadview?.route ? shownRoute?.polyline ?? null : null} onClose={() => setRoadview(null)} />
    <PlaceSearch target={search} query={query} onQuery={setQuery} results={matches} places={data.places} buildings={data.buildings} detail={(place) => placeDetail(place, data.buildings)}
      emptyMessage={data.places.length ? '검색 결과가 없습니다. 다른 이름으로 찾아 주세요.' : '아직 등록된 장소가 없습니다. C조원의 데이터 연결을 기다리고 있습니다.'}
      demoNotice={demo !== 'none'} maxWidth={layout.modalMaxWidth} padding={layout.padding} busy={gpsBusy}
      onClose={() => setSearch(null)} onChoose={(place) => search === 'place' ? showPlace(place) : pickFor(search ?? 'to', place)}
      onCurrent={demo === 'none' ? () => { if (search && search !== 'place') void pickCurrentAs(search); } : null}
      onMapPick={() => { if (search && search !== 'place') { const target = search; setSearch(null); setView('plan'); setMapPick(target); } }} />
  </View>;
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.bg, overflow: 'hidden' },
  mapArea: { flex: 1, minHeight: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 12 },
  topInner: { width: '100%', alignSelf: 'center', gap: 10 },
  fab: { position: 'absolute', right: 16, bottom: 34 },
  devMenu: { alignSelf: 'flex-end', width: 280, maxWidth: '100%', backgroundColor: t.color.surface, borderRadius: 18, padding: 14, gap: 8, ...floating },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 8 }, busyText: { fontSize: 13, color: t.color.muted },
  sheetTitle: { fontSize: 20, lineHeight: 27, fontWeight: '800', color: t.color.text, letterSpacing: -0.3, flexShrink: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: t.color.text, flexShrink: 1 },
  caption: { fontSize: 13, lineHeight: 19, color: t.color.muted, flexShrink: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  rowStart: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  placeCard: { gap: 12 },
  placeName: { fontSize: 21, lineHeight: 28, fontWeight: '800', color: t.color.text, letterSpacing: -0.3 },
  placeDetail: { fontSize: 14, color: t.color.muted },
  floorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  floor: { minWidth: 48, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: t.color.border, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.surface },
  floorOn: { backgroundColor: t.color.text, borderColor: t.color.text },
  floorText: { fontSize: 14, fontWeight: '700', color: t.color.text }, floorTextOn: { color: 'white' },
  listRow: { paddingVertical: 12, paddingHorizontal: 4, gap: 2, borderBottomWidth: 1, borderColor: t.color.divider },
  listName: { fontSize: 15, fontWeight: '700', color: t.color.text }, listDetail: { fontSize: 13, color: t.color.muted },
  summary: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bigTime: { fontSize: 40, lineHeight: 46, fontWeight: '900', color: t.color.text, letterSpacing: -1.2 },
  bigUnit: { fontSize: 20, lineHeight: 34, fontWeight: '800', color: t.color.text },
  distance: { fontSize: 18, lineHeight: 34, fontWeight: '700', color: t.color.muted },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  statDivider: { width: 1, height: 26, backgroundColor: t.color.divider },
  floorChange: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: t.color.soft },
  floorChangeText: { fontSize: 13, fontWeight: '700', color: t.color.primary },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: t.color.divider, alignItems: 'flex-start' },
  stepIndex: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.color.sunken, borderWidth: 1, borderColor: t.color.border, alignItems: 'center', justifyContent: 'center' },
  stepIndexText: { fontSize: 12, fontWeight: '800', color: t.color.muted },
  stepText: { flex: 1, fontSize: 14, lineHeight: 21, color: t.color.text },
  stepPhoto: { fontSize: 11, fontWeight: '800', color: '#119A5E', borderWidth: 1, borderColor: '#119A5E', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
  legTitle: { marginTop: 10, fontSize: 13, fontWeight: '800', color: '#7A4FD6' },
  peekText: { fontSize: 15, fontWeight: '800', color: t.color.text },
});
