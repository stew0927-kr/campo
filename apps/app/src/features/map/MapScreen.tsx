import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import type { BundledCampus } from '../../campus/types.ts';
import type { CampusPlace, CampusRouteRequest, TravelMode, PhotoCatalog, RoutePoint } from '../../contracts.ts';
import { EMPTY_PHOTO_CATALOG } from '../../contracts.ts';
import { routeAlongPhotos } from '../../photos/routeAlongPhotos.ts';
import { combineRoundTrip, photoSpots as spotsOf, pinTapAction, placeLookup, roadviewFrames, spotFrame, stepMarkerGroups, type MarkerGroup, type PhotoSpot, type RoadviewFrame } from '../../photos/roadviewModel.ts';
import { headingLabel } from '../../photos/demoPhotoArt.ts';
import { useCampusRefreshing } from '../../hooks/useCampusBundle.ts';
import { useCampusData } from '../../hooks/useCampusData.ts';
import { useCampusAutoRefresh } from './useCampusAutoRefresh.ts';
import { useCampusRoute } from '../../hooks/useCampusRoute.ts';
import { useGpsMatcher } from '../../hooks/useGpsMatcher.ts';
import { useAppActions, useAppSelector } from '../../state/AppState.tsx';
import { placeDestination, planIntent } from '../../state/model.ts';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import { screenLayout } from '../../ui/layout.ts';
import { floating, theme as t } from '../../ui/theme.ts';
import { ActionCell, ActionRow, Button, Notice } from '../../ui/kit.tsx';
import { MapCanvas } from './MapCanvas.tsx';
import { DEMO_CAMPUS } from './demoCampus.ts';
import indoorFixture from './indoorFixture.json';
import { isValidLngLat } from './markerCoords.ts';
/** A position whose coordinates are not finite never reaches the map (a native Marker throws on NaN). */
const safePosition = <P extends { lng: number; lat: number }>(p: P | null): P | null => (p !== null && isValidLngLat(p.lng, p.lat) ? p : null);
import { endpointFor, insideOutline, placeDetail, placesInScope, pointPlace, requestFor, searchPlaces } from './model.ts';
import { slopeSections } from '../../route/slopeSections.ts';
import { getBuildingOutlineForLevel } from '@campo/core';
import { useSensorFixes } from './useSensorFixes.ts';
import { BackIcon, EndpointCard, Stack3DIcon, EndpointDot, FloorChips, FloorPicker, GenderChips, LocateIcon, ModeChips, PlaceSearch, RestroomChip, RoundButton, RoutePill, SearchBar, SelectionBar, Sheet, Stat, StatusLine, SwitchRow, TextButton, WheelchairToggle, type SearchTarget } from './MapChrome.tsx';
import { buildingCenter, floorChoice, mappedBuildings } from './buildings.ts';
import { RoadviewScreen } from './RoadviewScreen.tsx';
import { ROADVIEW_DEMO_CAMPUS, ROADVIEW_DEMO_CATALOG, RV } from './roadviewDemo.ts';
import { nearestRestroom } from './restroom.ts';
import { nearestRestroomTitle, type RestroomWanted } from './restroomGender.ts';
import type { RoadviewPreview } from './mapTypes.ts';
import { navCards, stepPhotoEntry } from './navModel.ts';
import { centerPickInfo, pressPinInfo } from './centerPick.ts';
import { PHOTOS_OFF, photoLayers, photosOn, showPhotos, togglePhotos, type PhotoToggle } from './routePhotos.ts';
import { addFix, startTrack, summarize, type NavSummary, type NavTrack } from './navSummary.ts';
import { NavClock, NavSummaryCard, PhotoChip } from './NavExtras.tsx';
import type { SensorFix } from '@campo/core';

type Field = 'from' | 'to';
type PickTarget = Field | 'restroom';
type DemoData = 'none' | 'outdoor' | 'indoor' | 'roadview';
const GPS_MODE_LABEL = { OUTDOOR: '실외', APPROACHING: '입구 근처', PORTAL: '출입구 전환', INDOOR: '실내', OFF_NETWORK_SUSPECT: '경로 밖 의심' } as const;
/** 지도 새로고침: 관리자 웹(/map/)에서 저장한 실내·실외 지도를 앱을 다시 켜지 않고 받는다. */
export const MAP_REFRESH_TITLE = '지도 새로고침';
export const MAP_REFRESH_HINT = '관리자 웹에서 고친 지도가 안 보이면 눌러 주세요.';
/** 개발 빌드 전용: 3D 버튼 길게 누름(접근성 동작 이름도 같다). 지도 위 오른쪽 위 배지는 없앴다. */
export const DEV_MENU_HINT = '개발 데이터';
const DEMO_LABEL: Record<DemoData, string> = { none: '실제 데이터', outdoor: '야외 가상', indoor: '실내 시험', roadview: '로드뷰 가상' };
const DEMO_BUNDLE = { outdoor: DEMO_CAMPUS, indoor: indoorFixture as BundledCampus, roadview: ROADVIEW_DEMO_CAMPUS } as const;
/** Travel mode to return to when the wheelchair switch is turned off. */
const walkingMode = (mode: TravelMode): TravelMode => (mode === 'wheelchair' ? 'shortest' : mode);
const floorLabel = (level: number | null) => level === null ? '층 미확인' : level < 0 ? `지하 ${-level}층` : `${level}층`;
const minutes = (sec: number) => sec === 0 ? 0 : Math.max(1, Math.ceil(sec / 60));
/** Camera zoom used when the map moves to a whole building (search list, building list). */
const BUILDING_ZOOM = 18;
/** Indoor tap on a spot that is not a registered place / outside the building. */
const INDOOR_OUTSIDE_HINT = "지금은 이 건물 실내만 선택할 수 있습니다. 건물 밖은 '실외 지도로 나가기'를 누른 뒤 골라 주세요.";

/**
 * Full-screen map tab. Three views share one map:
 * home (search + my location), plan (start/end input) and route (result with travel modes in the bottom sheet).
 * Picking a point on the map temporarily hides the overlays.
 */
export function MapScreen({ active = true, photoCatalog = EMPTY_PHOTO_CATALOG, photoNotice = '' }: { active?: boolean; photoCatalog?: PhotoCatalog; photoNotice?: string }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  const { dispatch } = useAppActions();
  // Only the fields this screen reads: a tab switch or an estimate update does not re-render the map screen.
  const defaultMode = useAppSelector((s) => s.defaultMode);
  const intentState = useAppSelector((s) => s.intent);
  const favorites = useAppSelector((s) => s.favorites);
  const [demo, setDemo] = useState<DemoData>('none');
  const data = useCampusData(demo === 'none' ? undefined : DEMO_BUNDLE[demo]);
  // 서버 지도: 앱이 포그라운드로 돌아오면 10분 지난 것만 다시 받고, 시트의 "지도 새로고침"은 바로 다시 받는다.
  const mapRefreshing = useCampusRefreshing();
  useCampusAutoRefresh(demo === 'none');
  const [view, setView] = useState<'home' | 'plan'>('home');
  const [from, setFrom] = useState<CampusPlace | null>(null);
  const [to, setTo] = useState<CampusPlace | null>(null);
  const [mode, setMode] = useState<TravelMode>(defaultMode);
  const [request, setRequest] = useState<CampusRouteRequest | null>(null);
  const [search, setSearch] = useState<SearchTarget | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CampusPlace | null>(null);
  /** Where the current selection came from: the search query to reopen on ←, or null (map tap, list, empty query). */
  const [selectQuery, setSelectQuery] = useState<string | null>(null);
  /** Building whose floor picker card is open over the map. */
  const [floorPicker, setFloorPicker] = useState<string | null>(null);
  /** Inline building list in the sheet (건물 목록 / 건물 바꾸기). */
  const [buildingList, setBuildingList] = useState(false);
  /** Building opened in the search list: the camera moved there and the map marks it after the search closes. */
  const [searchBuilding, setSearchBuilding] = useState<string | null>(null);
  /** Height of this screen above the tab bar; the search sheet is sized from it. */
  const [areaHeight, setAreaHeight] = useState(0);
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number; zoom?: number } | null>(null);
  const [myLocation, setMyLocation] = useState<RoutePoint | null>(null);
  const [mapPick, setMapPick] = useState<PickTarget | null>(null);
  /** Nearest-restroom flow: the chosen start, whether only wheelchair restrooms count, and 전체/남자/여자. */
  const [restroom, setRestroom] = useState<{ start: CampusPlace; wheelchair: boolean; gender: RestroomWanted } | null>(null);
  /** 전체/남자/여자 picked in the restroom search sheet before a start is chosen (전체 by default). */
  const [restroomGender, setRestroomGender] = useState<RestroomWanted>('any');
  const [roundTrip, setRoundTrip] = useState(false);
  const [preview, setPreview] = useState<RoadviewPreview | null>(null);
  const [roadview, setRoadview] = useState<{ frames: RoadviewFrame[]; index: number; route: boolean } | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** 위치 안내(네비게이션) 중이면 지금 보는 단계 카드. GPS 위치 추적과 경로 마그넷(매칭)은 이 동안만 켠다. */
  const [nav, setNav] = useState<{ index: number } | null>(null);
  /** 지도 가운데 핀으로 고르는 동안 핀 아래 좌표(카메라가 멈출 때마다 바뀐다). */
  const [pickCenter, setPickCenter] = useState<RoutePoint | null>(null);
  /** 마지막으로 멈춘 지도 가운데. 핀 고르기를 시작할 때 첫 좌표로 쓴다(평소에는 화면을 다시 그리지 않는다). */
  const mapCenter = useRef<RoutePoint | null>(null);
  const [flow, setFlow] = useState<'enter' | 'queue' | 'exit' | null>(null);
  /** 지도를 길게 눌러 띄운 핀: 그 자리를 출발지/도착지로 고른다. */
  const [pressPin, setPressPin] = useState<RoutePoint | null>(null);
  /** 3D 보기(층별 수직 분리). */
  const [threeD, setThreeD] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  /** 새 길찾기마다 1씩 는다(경로 사진 토글은 길찾기마다 꺼진 채 시작한다). 이동 방식·왕복·GPS 재탐색은 같은 길찾기. */
  const [routeEpoch, setRouteEpoch] = useState(0);
  const [photoToggle, setPhotoToggle] = useState<PhotoToggle>(PHOTOS_OFF);
  /** 위치 안내를 시작한 시각(경과 시간 표시). 안내 중에만 값이 있다. */
  const [navStartMs, setNavStartMs] = useState<number | null>(null);
  /** 안내 종료 요약. 떠 있는 동안 GPS는 꺼져 있다(nav가 null). */
  const [navSummary, setNavSummary] = useState<NavSummary | null>(null);
  /** 안내 중 GPS·기압 누적(거리·오르막). 렌더와 무관하므로 ref. */
  const navTrack = useRef<NavTrack | null>(null);
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
  // One card per run of connected slope edges with the same class and direction; tapping it highlights the run on the map.
  const sections = useMemo(() => slopeSections(route?.slopeWarnings ?? []), [route]);
  const [slopeKey, setSlopeKey] = useState<string | null>(null);
  useEffect(() => setSlopeKey(null), [route]);
  const slopeFocus = useMemo(() => {
    const section = sections.find((item) => item.key === slopeKey);
    return section && section.coordinates.length >= 2 ? { key: section.key, coordinates: section.coordinates } : null;
  }, [sections, slopeKey]);
  // Demo data uses the virtual roadview photos (no network); the real campus uses the provider's catalog.
  const effectiveCatalog = demo === 'none' ? photoCatalog : demo === 'roadview' ? ROADVIEW_DEMO_CATALOG : EMPTY_PHOTO_CATALOG;
  // The map shows every photo point the route itself passes (route.nodeIds, not nearby points), closest to the way walked there;
  // a photo more than 90° off that way is left out, so no U-turn arrow or "정면이 아닐 수 있습니다" badge (routeAlongPhotos).
  // The contract hook stays as is.
  const stepPhotos = useMemo(() => routeAlongPhotos(shownRoute, effectiveCatalog), [shownRoute, effectiveCatalog]);
  const lookup = useMemo(() => placeLookup(data.graph, data.places), [data.graph, data.places]);
  const frames = useMemo(() => roadviewFrames(shownRoute, stepPhotos, effectiveCatalog, lookup, trip?.backFrom ?? null), [shownRoute, stepPhotos, effectiveCatalog, lookup, trip]);
  const stepGroups = useMemo(() => stepMarkerGroups(stepPhotos, shownRoute?.steps.length ?? 0, trip?.backFrom ?? null), [stepPhotos, shownRoute, trip]);
  const spots = useMemo(() => spotsOf(data.graph, effectiveCatalog, buildingId, level), [data.graph, effectiveCatalog, buildingId, level]);
  useEffect(() => { setRoadview(null); setPreview(null); }, [shownRoute]);
  // GPS 매칭 세션은 위치 안내를 켰을 때만 만든다(상시 추적·마그넷 없음). 끄면 세션도 버린다.
  const navOn = nav !== null && route !== null;
  const gps = useGpsMatcher(navOn ? data.network : null, { routeNodeIds: route?.nodeIds ?? null });
  // Every fix also feeds the guidance summary (distance walked, height climbed). Stable while the matcher's pushFix is.
  const gpsPush = gps.pushFix;
  const pushFix = useCallback((fix: SensorFix) => {
    if (navTrack.current) navTrack.current = addFix(navTrack.current, fix);
    return gpsPush(fix);
  }, [gpsPush]);
  const sensors = useSensorFixes(navOn && active && demo === 'none', pushFix);
  const cards = useMemo(() => (shownRoute ? navCards(shownRoute, data.graph) : []), [shownRoute, data.graph]);
  const navIndex = nav ? Math.min(nav.index, Math.max(0, cards.length - 1)) : 0;
  const card = navOn ? cards[navIndex] ?? null : null;
  // 다시 찾은 경로(경로 이탈)는 첫 단계부터 다시 보인다.
  useEffect(() => setNav((old) => (old && old.index !== 0 ? { index: 0 } : old)), [shownRoute]);
  // 단계 시작 지점이 실내면 지도가 그 건물·층을 보인다(층 번호는 표시에만 쓴다).
  useEffect(() => {
    if (!card) return;
    setBuildingId(card.buildingId); setLevel(card.level);
  }, [card?.index, card?.buildingId, card?.level, navOn]);
  const stepFocus = useMemo(() => (card && card.coordinates.length >= 2 ? { key: `${navIndex}:${shownRoute?.nodeIds.join(',') ?? ''}:${shownRoute?.distanceM ?? 0}`, coordinates: card.coordinates, bearingDeg: card.bearingDeg } : null), [card, navIndex, shownRoute]);
  // Photo pins of the step shown during navigation (the first one also shows as the bubble).
  const navGroups = useMemo(() => (card ? stepMarkerGroups(stepPhotos.map((s) => (s.stepIndex === card.index ? s : { ...s, photo: null })), shownRoute?.steps.length ?? 0, trip?.backFrom ?? null) : []), [card, stepPhotos, shownRoute, trip]);
  const matches = useMemo(() => searchPlaces(data.places, data.buildings, query), [data.places, data.buildings, query]);
  const scopePlaces = useMemo(() => placesInScope(data.places, buildingId, level), [data.places, buildingId, level]);
  const visiblePlaces = placesExpanded ? scopePlaces : scopePlaces.slice(0, 20);
  useEffect(() => setPlacesExpanded(false), [buildingId, level, demo]);
  // 건물·층을 고르면 그 층의 시설·호실 목록을 바로 펼친다(지도에는 그 층의 복도·지점 아이콘이 보인다).
  useEffect(() => { if (buildingId !== null) setPlacesOpen(true); }, [buildingId, level]);
  const screen = mapPick ? 'pick' : request && nav && route ? 'nav' : request ? 'route' : view;
  // 경로 사진은 칩을 켤 때만(routePhotos.ts). 홈 화면의 사진 지점은 그대로.
  const routePhotosOn = photosOn(photoToggle, routeEpoch);
  const routePhotoCount = useMemo(() => stepPhotos.filter((item) => item.photo !== null).length, [stepPhotos]);
  const togglePhotoPins = () => { setPreview(null); setPhotoToggle((old) => togglePhotos(old, routeEpoch)); };
  const shownPhotos = photoLayers(screen, routePhotosOn, { spots, stepGroups, navGroups });
  // Guidance ended some other way (a new route, closing the plan, other data): no clock, no summary left over.
  useEffect(() => { if (nav === null) { navTrack.current = null; setNavStartMs(null); } }, [nav]);
  useEffect(() => { if (request === null) setNavSummary(null); }, [request]);
  const mapped = useMemo(() => mappedBuildings(data.places, data.buildings), [data.places, data.buildings]);
  const mappedIds = useMemo(() => mapped.map((b) => b.id), [mapped]);
  // Mapped buildings are always tappable on the map, except while picking a point on it and during navigation.
  const buildingsTappable = screen !== 'pick' && screen !== 'nav';
  // The on-screen ← buttons and the Android back key close things in the same order, one step at a time:
  // roadview → bubble → search → dev menu → floor picker → map pick → route → route input → selection (→ its search).
  const back = useCallback(() => {
    if (roadview !== null) setRoadview(null);
    else if (navSummary !== null) setNavSummary(null);
    else if (pressPin !== null) setPressPin(null);
    else if (preview !== null) setPreview(null);
    else if (search !== null) setSearch(null);
    else if (devOpen) setDevOpen(false);
    else if (floorPicker !== null) setFloorPicker(null);
    else if (mapPick !== null) setMapPick(null);
    else if (nav !== null) stopNav();
    else if (request !== null) { setRequest(null); }
    else if (view === 'plan') closePlan();
    else clearSelection();
  }, [roadview, navSummary, pressPin, preview, search, devOpen, floorPicker, mapPick, nav, request, view, selectQuery]);
  useScreenBack(active && (roadview !== null || navSummary !== null || pressPin !== null || preview !== null || search !== null || devOpen || floorPicker !== null || mapPick !== null || nav !== null || request !== null || view === 'plan' || selected !== null), back);
  const building = data.buildings.find((item) => item.id === buildingId);
  const indoorFeature = buildingId ? data.graph?.buildings.get(buildingId) : undefined;
  const indoorOutline = useMemo(() => (indoorFeature ? getBuildingOutlineForLevel(indoorFeature, level) : null), [indoorFeature, level]);
  /** A tap outside the open building's outline (unknown outline: not outside). */
  const outsideIndoor = (point: RoutePoint) => indoorOutline !== null && !insideOutline(point, indoorOutline);
  useEffect(() => () => { gpsGeneration.current++; }, []);
  useEffect(() => { setMode(defaultMode); setRequest(null); }, [defaultMode]);
  // 다른 탭으로 가면 GPS를 끈다(센서는 active일 때만 켜진다). 안내 카드는 그대로 두어 돌아오면 이어서 본다.
  useEffect(() => { if (!active) { gpsGeneration.current++; setGpsBusy(false); } }, [active]);
  useEffect(() => { if (!route) dispatch({ type: 'clearEstimate' }); }, [route, dispatch]);
  useEffect(() => {
    if (demo === 'none' && route && to && data.graph?.nodes.has(to.id)) dispatch({ type: 'estimate', nodeId: to.id, timeSec: route.timeSec });
  }, [route, to, demo, data.graph, dispatch]);
  useEffect(() => {
    if (gps.mode === 'INDOOR' || !sensors.running || !gps.rerouteRequested || !gps.position || !isValidLngLat(gps.position.lng, gps.position.lat) || !to || gps.position.skipped || gps.position.free || lastReroute.current === gps.fixCount) return;
    lastReroute.current = gps.fixCount;
    const next = pointPlace(gps.position, '현재 위치');
    setFrom(next); setRequest({ from: endpointFor(next), to: endpointFor(to), mode });
    setMessage('경로를 벗어나 현재 위치에서 다시 찾았습니다.');
  }, [gps.mode, gps.fixCount, gps.rerouteRequested, gps.position, sensors.running, to, mode]);
  useEffect(() => {
    const intent = intentState;
    if (!intent) return;
    // An event's real destination must never resolve against the developer fixture.
    if (demo !== 'none') { switchData('none'); return; }
    clearGps(); setNav(null); setRequest(null); setMapPick(null); setBuildingId(null); setLevel(null); setFlow(null); setSelected(null); setSelectQuery(null); setDevOpen(false);
    setFloorPicker(null); setBuildingList(false); setSearchBuilding(null);
    setView('plan');
    const target = intent.destination;
    const { destination: resolved, start, missingFlow } = planIntent(data.runtime, target);
    if (resolved.kind === 'selected' && !missingFlow) {
      setTo(resolved.place);
      if (start) setFrom(start);
      // Route planning starts on the outdoor map even for a room: the user opens the building themselves.
      setSearch(null); setFlow(target.flow ?? null);
      setMessage(`${target.demo ? '시연용 정보에서 선택했습니다. ' : ''}목적지가 선택됐습니다. 출발지를 확인하고 길찾기를 눌러 주세요.${target.flow === 'queue' ? ' 대기 경로는 보행길 기준이며 실제 대기열의 모양은 아닙니다.' : ''}`);
    } else {
      setTo(null);
      if (target.flow) setFrom(null);
      setQuery(target.searchTerm); setSearch('to');
      setMessage(resolved.kind === 'search' ? resolved.message : '입장·퇴장 지점 연결이 아직 없습니다. 실제 출발지와 목적지를 직접 선택해 주세요.');
    }
    dispatch({ type: 'consumed', sequence: intent.sequence });
  }, [intentState, data.runtime, demo, dispatch]);

  function clearGps() { gpsGeneration.current++; setGpsBusy(false); setMessage(null); }
  function focusOn(point: RoutePoint) { setFocus({ lat: point.lat, lng: point.lng, key: ++focusKey.current }); }
  /** Compute as soon as both ends exist; the route view replaces the input view. */
  function findRoute(start: CampusPlace | null, end: CampusPlace | null, travel: TravelMode = mode) {
    const next = requestFor(start, end, travel);
    if (next && data.status === 'ready') { setRequest(next); setRouteEpoch((n) => n + 1); }
  }
  function choose(place: CampusPlace, target: Field) {
    clearGps(); setRestroom(null); setPressPin(null);
    const start = target === 'from' ? place : from;
    const end = target === 'to' ? place : to;
    setFrom(start); setTo(end);
    setRequest(null); setSearch(null); setMapPick(null); setFlow(null); setSelected(null); setSelectQuery(null); setSearchBuilding(null); setView('plan');
    // Route planning is always on the outdoor map, so any spot can be tapped; a room stays the route's end.
    setBuildingId(null); setLevel(null); setFloorPicker(null);
    findRoute(start, end);
  }
  function openPlan() { setSelected(null); setSelectQuery(null); setDevOpen(false); setFloorPicker(null); setView('plan'); }
  /**
   * ← on a selected place: drop the selection at once. If it was picked from a search with a query, reopen that search
   * with the same words; otherwise go back to the plain map.
   */
  function clearSelection() {
    const previous = selectQuery;
    setSelected(null); setSelectQuery(null);
    if (previous) { setQuery(previous); setSearch('place'); setPreview(null); setFloorPicker(null); }
  }
  /** Tapping the selected place's name: search again, starting from the words that found it. */
  function searchAgain() {
    const previous = selectQuery ?? '';
    setSelected(null); setSelectQuery(null);
    setQuery(previous); setSearch('place'); setPreview(null); setFloorPicker(null);
  }
  function moveToBuilding(id: string) {
    const center = buildingCenter(data.graph, id, data.places);
    if (center) setFocus({ ...center, key: ++focusKey.current, zoom: BUILDING_ZOOM });
  }
  /** A building opened in the search list: move the map there and keep a light mark after the search closes. */
  function searchedBuilding(id: string) { moveToBuilding(id); setSearchBuilding(id); }
  function enterBuilding(id: string, floor: number) {
    setFloorPicker(null); setBuildingList(false); setSearchBuilding(null);
    setBuildingId(id); setLevel(floor);
  }
  /** A highlighted building tapped on the map (or chosen in the building list): one floor → enter, several → floor card. */
  function pressBuilding(id: string) {
    const target = data.buildings.find((item) => item.id === id);
    if (!target) return;
    setPreview(null); setDevOpen(false); setSearchBuilding(null);
    const choice = floorChoice(target);
    if (choice.kind === 'enter') enterBuilding(id, choice.level);
    else if (choice.kind === 'pick') setFloorPicker(id);
    else setMessage('이 건물의 층 정보가 아직 없습니다.');
  }
  /** 실외 지도로 나가기: close the floor card and the list, and leave the building. */
  function exitBuilding() {
    setFloorPicker(null); setBuildingList(false); setSearchBuilding(null);
    setBuildingId(null); setLevel(null);
    setMessage((old) => (old === INDOOR_OUTSIDE_HINT ? null : old));
  }
  function closePlan() { clearGps(); setNav(null); setFrom(null); setTo(null); setRequest(null); setMapPick(null); setFlow(null); setRestroom(null); setRestroomGender('any'); setRoundTrip(false); setView('home'); }
  function swap() {
    clearGps(); setNav(null); setFrom(to); setTo(from); setRequest(null); setMapPick(null); setFlow(null); setRestroom(null);
    findRoute(to, from);
  }
  function changeMode(next: TravelMode) {
    setMode(next);
    if (request) setRequest(requestFor(from, to, next));
  }
  function openSearch(target: SearchTarget) {
    setPressPin(null); setQuery(''); setSearch(target); setPreview(null); setFloorPicker(null);
    // The restroom sheet opens on the gender of the restroom shown now, else 전체.
    if (target === 'restroom') setRestroomGender(restroom?.gender ?? 'any');
  }
  /**
   * Nearest restroom from `start` (core findNearestRestroom), then the normal route request to it.
   * `wheelchair`: only restrooms checked as wheelchair-usable, by the wheelchair travel mode.
   * `gender`: 전체 / 남자 / 여자 (restrooms with no gender limit count for both).
   */
  function findRestroom(start: CampusPlace, wheelchair: boolean, gender: RestroomWanted) {
    clearGps(); setNav(null); setSearch(null); setMapPick(null); setFlow(null); setSelected(null); setSelectQuery(null); setSearchBuilding(null); setView('plan');
    setFrom(start); setRestroom({ start, wheelchair, gender }); setRestroomGender(gender);
    const found = nearestRestroom(data.runtime, endpointFor(start), wheelchair, mode, gender);
    if (!found.found) { setTo(null); setRequest(null); setMessage(found.message); return; }
    const target = data.places.find((p) => p.id === found.nodeId) ?? null;
    setTo(target ?? { id: found.nodeId, name: '화장실', nodeType: 'restroom', buildingId: null, level: null, lat: start.lat, lng: start.lng });
    setMode(found.request.mode ?? mode);
    setRequest(found.request); setRouteEpoch((n) => n + 1);
  }
  function setWheelchair(on: boolean) {
    if (restroom) findRestroom(restroom.start, on, restroom.gender);
    else changeMode(on ? 'wheelchair' : walkingMode(defaultMode));
  }
  /** 전체/남자/여자 in the result sheet: the nearest restroom is found again at once. */
  function changeRestroomGender(gender: RestroomWanted) {
    if (restroom) findRestroom(restroom.start, restroom.wheelchair, gender);
    else setRestroomGender(gender);
  }
  function pickFor(target: PickTarget, place: CampusPlace) {
    if (target === 'restroom') findRestroom(place, mode === 'wheelchair', restroomGender);
    else choose(place, target);
  }
  function openRoadview(index: number | null) {
    setPreview(null);
    if (index !== null && frames[index]) { setRoadview({ frames, index, route: true }); return; }
    if (!preview) return;
    const frame = spotFrame(preview.key.replace(/^spot:/, ''), preview.lngLat, effectiveCatalog, lookup);
    if (frame) setRoadview({ frames: [frame], index: 0, route: false });
  }
  /** 경로 없이 보이는 사진 지점 핀: 누르면 그 지점 로드뷰를 바로 연다(말풍선을 거치지 않는다). */
  function showSpot(spot: PhotoSpot) {
    setPreview(null);
    const frame = spotFrame(spot.nodeId, spot.lngLat, effectiveCatalog, lookup);
    if (frame) setRoadview({ frames: [frame], index: 0, route: false });
  }
  /** 경로 사진 핀: 항목이 하나면 그 사진이 첫 장면인 로드뷰를 바로 열고, 왕복으로 둘 이상이면 말풍선에서 가는 길/오는 길을 고른다. */
  function tapStepGroup(group: MarkerGroup) {
    const action = pinTapAction(group);
    if (action.kind === 'open') openRoadview(action.index);
    else showStepGroup(group);
  }
  function showStepGroup(group: MarkerGroup) {
    const first = frames[group.entries[0]!.index];
    const photo = first?.step.photo ?? null;
    setPreview({ key: group.key, lngLat: group.lngLat, thumbUrl: photo?.thumbUrl ?? null, title: first?.place.name ?? '경로 지점', subtitle: headingLabel(photo?.heading_deg ?? null), entries: group.entries });
    focusOn({ lng: group.lngLat[0], lat: group.lngLat[1] });
  }
  function showStep(stepIndex: number) {
    // Tapping a step's 사진 shows that photo: the route's photo pins come on with it.
    setPhotoToggle(showPhotos(routeEpoch));
    const index = stepPhotos.findIndex((s) => s.stepIndex === stepIndex && s.photo !== null);
    const group = stepGroups.find((g) => g.entries.some((e) => e.index === index));
    if (group) showStepGroup({ ...group, entries: group.entries.filter((e) => e.index === index) });
  }
  function switchData(next: DemoData) {
    clearGps(); setNav(null); setDemo(next); setFrom(null); setTo(null); setRequest(null); setQuery(''); setSearch(null); setMapPick(null); setBuildingId(null); setLevel(null); setFlow(null);
    setRestroom(null); setRestroomGender('any'); setRoundTrip(false); setPreview(null); setRoadview(null);
    setSelected(null); setSelectQuery(null); setView('home'); setDevOpen(false); setMyLocation(null); gps.reset();
    setFloorPicker(null); setBuildingList(false); setSearchBuilding(null);
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
  /** Select a place and move the map to it. `fromQuery`: the search words that found it, reopened by ←. */
  function showPlace(place: CampusPlace, fromQuery: string | null = null) {
    setSearch(null); setSelected(place); setSelectQuery(fromQuery); setView('home'); setFloorPicker(null); setSearchBuilding(null);
    // Browsing (home search) still opens the room's floor; once it becomes a start or end, choose() returns outdoors.
    if (place.buildingId !== buildingId || (place.buildingId !== null && place.level !== level)) { setBuildingId(place.buildingId); setLevel(place.level); }
    focusOn(place);
  }
  function selectExample(startId: string, endId: string, run = false) {
    const start = data.places.find((p) => p.id === startId);
    const end = data.places.find((p) => p.id === endId);
    if (!start || !end) return;
    setFrom(start); setTo(end); setRequest(null); setRestroom(null); setView('plan'); setDevOpen(false); setFloorPicker(null);
    setBuildingId(null); setLevel(null);
    if (run) findRoute(start, end);
  }
  /** 위치 안내 시작: 사진·GPS가 없어도 단계 카드와 지도로 안내한다. GPS는 이때부터 켠다. */
  function startNav() {
    gps.reset(); lastReroute.current = -1; setPreview(null); setPressPin(null); setSlopeKey(null); setNavSummary(null);
    const now = Date.now();
    navTrack.current = startTrack(now); setNavStartMs(now);
    setNav({ index: 0 });
  }
  /**
   * 위치 안내 종료(상단 ←, 패널 버튼, 뒤로 키): GPS를 끄고(nav가 null이 되면 센서 구독이 멈춘다) 걸린 시간 · 이동 거리 · 오르막
   * 요약을 띄운다. '확인'을 누르면 요약만 닫혀 경로 결과(실외 지도)가 보인다.
   */
  function stopNav() {
    const track = navTrack.current;
    setNavSummary(track ? summarize(track, Date.now()) : null);
    navTrack.current = null; setNavStartMs(null);
    setNav(null); setPreview(null); setBuildingId(null); setLevel(null);
  }
  function moveStep(delta: number) { setPreview(null); setNav((old) => (old ? { index: Math.min(Math.max(0, old.index + delta), Math.max(0, cards.length - 1)) } : old)); }
  /** '지도에서 선택': 지도 가운데 핀을 움직여 고른다. 실외 지도에서, 이미 고른 그 끝이 있으면 그 자리에서 시작한다. */
  function startMapPick(target: PickTarget) {
    setPressPin(null); setSearch(null); setView('plan'); setMapPick(target); setFloorPicker(null); setPreview(null);
    setBuildingId(null); setLevel(null);
    setPickCenter(mapCenter.current);
    const existing = target === 'from' ? from : target === 'to' ? to : null;
    if (existing && existing.buildingId === null) focusOn(existing);
  }
  /**
   * 지도를 길게 눌렀을 때: 그 자리에 핀을 띄우고 출발지/도착지를 고르게 한다. 가운데 핀 고르기·위치 안내·검색·로드뷰 중에는
   * 받지 않는다(서로 방해하지 않게). 실내 도면에서 건물 안을 누르면 받지 않는다(실외 지점만).
   */
  function longPress(point: RoutePoint) {
    if (mapPick || screen === 'nav' || search !== null || roadview !== null || data.status !== 'ready') return;
    if (buildingId && !outsideIndoor(point)) return;
    setPreview(null); setFloorPicker(null); setDevOpen(false); setSelected(null); setSelectQuery(null);
    setPressPin(point);
  }
  function choosePressed(target: Field) {
    if (!pressPin) return;
    const info = pressPinInfo(data.graph, data.places, pressPin);
    const place = info.place ?? pointPlace(pressPin, info.title);
    choose(place, target);
    if (info.far) setMessage(info.detail);
  }
  function confirmPick() {
    if (!mapPick || !pickCenter) return;
    const info = centerPickInfo(data.graph, data.places, pickCenter);
    pickFor(mapPick, info.place ?? pointPlace(pickCenter, info.title));
  }

  const sheetMax = (share: number) => Math.round(Math.max(220, (window.height - layout.tabMinHeight) * share));
  const notices = [
    demo !== 'none' ? '개발용 가상 경로입니다. 실제 한양대 길이나 건물이 아닙니다.' : null,
    data.status === 'ready' && data.counts.edges === 0 ? '길찾기 데이터를 준비하고 있습니다.' : null,
    ...data.issues,
  ].filter((item): item is string => Boolean(item));
  const messageBlock = <>
    {message && <Notice>{message}</Notice>}
    {gpsBusy && <View style={st.busy}><ActivityIndicator color={t.color.primary} /><Text style={st.busyText}>위치를 확인하고 있습니다…</Text></View>}
  </>;
  // Buildings are entered by tapping them on the map (or their name); the sheet keeps a building list as the
  // discoverable, screen-reader friendly way in (current building · floor, 건물 바꾸기, floors, 실외 지도로 나가기).
  const indoorControls = <View style={{ gap: 10 }}>
    <View style={st.rowBetween}>
      <Text style={st.sectionTitle}>{buildingId === null ? '실외 지도' : `${building?.name ?? '실내'} · ${floorLabel(level)}`}</Text>
      <TextButton title={buildingList ? '건물 목록 닫기' : buildingId === null ? '건물 목록' : '건물 바꾸기'} disabled={mapped.length === 0} onPress={() => setBuildingList((value) => !value)} />
    </View>
    {buildingId === null && !buildingList && <Text style={st.caption}>{mapped.length ? '파란 테두리 건물을 누르면 층을 골라 실내를 볼 수 있어요.' : '등록된 실내 건물·층 데이터가 없습니다. 임의의 실내 경로는 만들지 않습니다.'}</Text>}
    {buildingList && <View>{mapped.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.levels.length}개 층${item.id === buildingId ? ', 지금 보는 건물' : ''}`} accessibilityState={{ selected: item.id === buildingId }}
      onPress={() => { setBuildingList(false); moveToBuilding(item.id); pressBuilding(item.id); }} style={({ pressed }) => [st.listRow, pressed && { backgroundColor: t.color.sunken }]}>
      <Text style={[st.listName, item.id === buildingId && { color: t.color.primary }]}>{item.name}</Text>
      <Text style={st.listDetail}>{item.levels.length}개 층 · 장소 {data.places.filter((p) => p.buildingId === item.id).length}곳{item.id === buildingId ? ' · 지금 보는 건물' : ''}</Text>
    </Pressable>)}</View>}
    {buildingId !== null && !buildingList && <>
      <FloorChips name={building?.name ?? ''} levels={building?.levels ?? []} current={level} onLevel={setLevel} />
      <TextButton title="실외 지도로 나가기" onPress={exitBuilding} />
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
        <ActionCell><Button secondary title="출발지로" onPress={() => choose(selected, 'from')} /></ActionCell>
        <ActionCell><Button title="도착지로" onPress={() => choose(selected, 'to')} /></ActionCell>
      </ActionRow>
      {demo === 'none' && <TextButton title={favorites.some((p) => p.key === `place:${selected.id}`) ? '장소 즐겨찾기 해제' : '장소 즐겨찾기'} onPress={() => dispatch({ type: 'favorite', destination: placeDestination(selected) })} />}
    </View> : null}
    {data.status === 'error' && <View style={{ gap: 8 }}><Notice>{data.error}</Notice><Button secondary title="데이터 다시 읽기" onPress={data.reload} /></View>}
    {notices.length > 0 && <View style={{ gap: 6 }}>{notices.map((text, i) => <StatusLine key={i}>{text}</StatusLine>)}</View>}
    {indoorControls}
    <View style={{ gap: 4 }}>
      <TextButton title={placesOpen ? '장소 목록 닫기' : `이 보기의 장소 ${scopePlaces.length}곳`} disabled={scopePlaces.length === 0} onPress={() => setPlacesOpen((value) => !value)} />
      {placesOpen && visiblePlaces.map((place) => <Pressable key={place.id} accessibilityRole="button" onPress={() => showPlace(place, null)} style={({ pressed }) => [st.listRow, pressed && { backgroundColor: t.color.sunken }]}>
        <Text style={st.listName}>{place.name}</Text><Text style={st.listDetail}>{placeDetail(place, data.buildings)}</Text>
      </Pressable>)}
      {placesOpen && scopePlaces.length > 20 && <TextButton title={placesExpanded ? '장소 목록 접기' : `장소 ${scopePlaces.length}개 전체 보기`} onPress={() => setPlacesExpanded((value) => !value)} />}
    </View>
    {demo === 'none' && <View style={st.refreshRow}>
      <Text style={st.caption}>{mapRefreshing ? '서버 지도를 받고 있습니다…' : MAP_REFRESH_HINT}</Text>
      <TextButton title={MAP_REFRESH_TITLE} disabled={mapRefreshing} onPress={data.reload} />
    </View>}
  </Sheet>;

  const planSheet = <Sheet key={sheetKey} maxHeight={sheetMax(0.7)} defaultHeight={sheetMax(0.42)} footer={restroom ? undefined : <Button title="길찾기" disabled={!from || !to || data.status !== 'ready'} onPress={() => findRoute(from, to)} />}>
    {messageBlock}
    {restroom && <WheelchairToggle value={restroom.wheelchair} onChange={setWheelchair} />}
    {restroom && <GenderChips value={restroom.gender} onChange={changeRestroomGender} />}
    {!restroom && <ModeChips value={mode} onChange={changeMode} />}
    {demo !== 'none' && <StatusLine>개발용 가상 경로입니다. 실제 한양대 길이나 건물이 아닙니다.</StatusLine>}
    {data.status === 'ready' && data.counts.edges === 0 && <StatusLine>길찾기 데이터를 준비하고 있습니다.</StatusLine>}
    {buildingId !== null && <TextButton title="실외 지도로 나가기" onPress={exitBuilding} />}
    <Text style={st.caption}>{!from || !to ? '출발지와 도착지를 정하면 바로 경로를 찾아 드립니다. 입력란을 눌러 현재 위치, 지도, 검색 중에서 골라 주세요.' : '이동 방식을 고른 뒤 길찾기를 눌러 주세요.'}</Text>
  </Sheet>;

  const hasPhotos = frames.some((frame) => frame.step.photo !== null);
  const routePeek = route ? <Text style={st.peekText}>{restroom ? `${nearestRestroomTitle(restroom.gender)} · ` : ''}{minutes(shownRoute!.timeSec)}분 · {Math.round(shownRoute!.distanceM)}m{trip ? ' · 왕복' : ''}</Text> : null;
  const routeSheet = <Sheet key={sheetKey} maxHeight={sheetMax(0.8)} defaultHeight={sheetMax(0.46)} peek={routePeek}>
    {restroom && <Text accessibilityRole="header" style={st.sectionTitle}>{nearestRestroomTitle(restroom.gender)}{to ? ` · ${to.name}` : ''}</Text>}
    <WheelchairToggle value={restroom ? restroom.wheelchair : mode === 'wheelchair'} onChange={setWheelchair} />
    {restroom && <GenderChips value={restroom.gender} onChange={changeRestroomGender} />}
    {!restroom && <ModeChips value={mode} onChange={changeMode} />}
    {messageBlock}
    {result.message && <Notice>{result.message}</Notice>}
    {route && shownRoute ? <>
      <View style={st.summary}>
        <View style={st.timeRow} accessible accessibilityLabel={`${minutes(shownRoute.timeSec)}분`}><Text style={st.bigTime}>{minutes(shownRoute.timeSec)}</Text><Text style={st.bigUnit}>분</Text></View>
        <Text style={st.distance}>{Math.round(shownRoute.distanceM)}m{trip ? ' · 왕복' : ''}</Text>
        {routePhotoCount > 0 && <View style={st.summaryChip}><PhotoChip on={routePhotosOn} count={routePhotoCount} onPress={togglePhotoPins} /></View>}
      </View>
      <View style={st.stats}>
        <Stat value={`${shownRoute.stairsCount}곳`} label="계단" /><View style={st.statDivider} />
        <Stat value={`${shownRoute.escalatorCount}곳`} label="에스컬레이터" /><View style={st.statDivider} />
        <Stat value={`${shownRoute.floorChanges.length}번`} label="층 이동" />
      </View>
      {route.fallbackMessage && <Notice>{route.fallbackMessage}</Notice>}
      {sections.map((item) => item.coordinates.length >= 2 && buildingId === null
        ? <SlopeCard key={item.key} message={item.message} steep={item.gradeClass === 'steep'} on={item.key === slopeKey} onPress={() => setSlopeKey((old) => (old === item.key ? null : item.key))} />
        : <Notice key={item.key}>{item.message}</Notice>)}
      {canRoundTrip && <SwitchRow label="왕복 보기(돌아오는 길 포함)" value={roundTrip} onChange={setRoundTrip} />}
      {roundTrip && backResult.message && <Notice>{backResult.message}</Notice>}
      {shownRoute.floorChanges.length > 0 && <View style={{ gap: 6 }}>{shownRoute.floorChanges.map((item, i) => <View key={i} style={st.floorChange}><Text style={st.floorChangeText}>{item.label}</Text></View>)}</View>}
      {route.distanceM === 0 && <Text style={st.caption}>출발지와 목적지가 같습니다.</Text>}
      <ActionRow>
        <ActionCell><Button disabled={demo === 'none' && data.counts.edges === 0} title="위치 안내 시작" onPress={startNav} /></ActionCell>
        {hasPhotos && <ActionCell><Button secondary title="로드뷰로 보기" onPress={() => openRoadview(0)} /></ActionCell>}
      </ActionRow>
      {demo === 'none' && <Text style={st.caption}>위치(GPS)는 위치 안내를 켠 동안만 사용하며 앱에서 저장하지 않습니다.</Text>}
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

  const pickInfo = useMemo(() => (screen === 'pick' && pickCenter ? centerPickInfo(data.graph, data.places, pickCenter) : null), [screen, pickCenter, data.graph, data.places]);
  const pickWord = mapPick === 'to' ? '도착' : '출발';
  const pickSheet = <Sheet key={sheetKey} maxHeight={sheetMax(0.4)} defaultHeight={sheetMax(0.3)}
    footer={<Button title="이 위치로 설정" disabled={!pickCenter || data.status !== 'ready'} onPress={confirmPick} />}>
    <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
      <Text accessibilityRole="header" numberOfLines={2} style={st.pickTitle}>{pickInfo?.title ?? '지도를 움직여 위치를 맞춰 주세요.'}</Text>
      <Text style={st.caption}>{pickInfo ? pickInfo.detail : `가운데 핀 아래가 ${pickWord}지가 됩니다.`}</Text>
    </View>
    {messageBlock}
  </Sheet>;
  // Naver-style pick: a pin fixed at the middle of the map with a small + exactly on the spot; the map moves under it.
  const pickColor = mapPick === 'to' ? '#F2473F' : '#10A85E';
  const centerPin = <View pointerEvents="none" style={st.pinLayer}>
    <View style={st.pinAnchor}>
      <View style={st.pinBody}>
        <View style={[st.pinHead, { backgroundColor: pickColor }]}><View style={st.pinHole} /></View>
        <View style={[st.pinTip, { borderTopColor: pickColor }]} />
      </View>
      <View style={st.pinCrossH} /><View style={st.pinCrossV} />
    </View>
  </View>;

  // Step-by-step guidance: one card at a time with ← →; the map fits the step's stretch, and a photo at that point shows as a pin.
  const navPreview: RoadviewPreview | null = useMemo(() => {
    if (!card) return null;
    const entry = stepPhotoEntry(stepPhotos, card.index, card.index === cards.length - 1);
    const frame = entry === null ? undefined : frames[entry];
    const photo = frame?.step.photo ?? null;
    if (entry === null || !frame || !frame.lngLat || !photo) return null;
    return { key: `nav:${entry}`, lngLat: frame.lngLat, thumbUrl: photo.thumbUrl ?? null, title: frame.place.name, subtitle: headingLabel(photo.heading_deg ?? null), entries: [{ index: entry, label: `${card.index + 1}단계` }] };
  }, [card, cards.length, stepPhotos, frames]);
  const gpsLine = demo !== 'none'
    ? '가상 데이터에서는 위치(GPS)를 쓰지 않고 단계별 안내만 보여 드립니다.'
    : sensors.running ? `위치 수신 중 · ${GPS_MODE_LABEL[gps.mode]}${gps.level === null ? '' : ` · ${gps.level}층`}` : sensors.message ? null : '현재 위치를 확인하고 있습니다…';
  const navPanel = card ? <View style={[st.navPanel, { paddingHorizontal: layout.padding }]} accessibilityLabel="단계별 위치 안내">
    <View style={[st.navInner, { maxWidth: layout.modalMaxWidth }]}>
      {(navStartMs !== null || routePhotoCount > 0) && <View style={st.navHead}>
        {navStartMs !== null ? <NavClock startMs={navStartMs} /> : <View />}
        {routePhotoCount > 0 && <PhotoChip on={routePhotosOn} count={routePhotoCount} onPress={togglePhotoPins} />}
      </View>}
      <View style={st.navCard}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 안내" accessibilityState={{ disabled: navIndex === 0 }} disabled={navIndex === 0} onPress={() => moveStep(-1)} hitSlop={6} style={({ pressed }) => [st.navArrow, navIndex === 0 && st.navArrowOff, pressed && st.navArrowPressed]}>
          <Arrow left />
        </Pressable>
        <View style={st.navBody} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${navIndex + 1}단계, 전체 ${cards.length}단계 중. ${card.text}`}>
          <Text style={st.navCounter}>{navIndex + 1} / {cards.length}{card.distanceM > 0 ? ` · ${Math.round(card.distanceM)}m` : ''}{card.level !== null ? ` · ${floorLabel(card.level)}` : ''}</Text>
          <Text style={st.navText}>{card.text}</Text>
          {navPreview && routePhotosOn && <Text style={st.navPhotoHint}>지도의 사진이나 말풍선을 누르면 로드뷰로 볼 수 있어요.</Text>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="다음 안내" accessibilityState={{ disabled: navIndex >= cards.length - 1 }} disabled={navIndex >= cards.length - 1} onPress={() => moveStep(1)} hitSlop={6} style={({ pressed }) => [st.navArrow, navIndex >= cards.length - 1 && st.navArrowOff, pressed && st.navArrowPressed]}>
          <Arrow />
        </Pressable>
      </View>
      {gpsLine && <Text style={st.caption}>{gpsLine}</Text>}
      {sensors.message && <StatusLine>{sensors.message}</StatusLine>}
      {gps.messages.map((text, i) => <StatusLine key={i}>{text}</StatusLine>)}
      {message && <Notice>{message}</Notice>}
      <Button secondary title="위치 안내 종료" onPress={stopNav} />
    </View>
  </View> : null;

  const fitTop = screen === 'plan' ? 150 : screen === 'pick' ? 120 : 90;
  const picker = floorPicker ? data.buildings.find((item) => item.id === floorPicker) : undefined;
  const pickerChoice = picker ? floorChoice(picker) : null;
  const searchSheet = <PlaceSearch target={search} query={query} onQuery={setQuery} results={matches} places={data.places} buildings={data.buildings} detail={(place) => placeDetail(place, data.buildings)}
    emptyMessage={data.places.length ? '검색 결과가 없습니다. 다른 이름으로 찾아 주세요.' : '등록된 장소가 아직 없습니다.'}
    demoNotice={demo !== 'none'} maxWidth={layout.modalMaxWidth} padding={layout.padding} busy={gpsBusy}
    restroomGender={restroomGender} onRestroomGender={setRestroomGender} areaHeight={areaHeight || window.height - layout.tabMinHeight} onBuilding={searchedBuilding}
    onClose={() => setSearch(null)} onChoose={(place) => search === 'place' ? showPlace(place, query.trim() || null) : pickFor(search ?? 'to', place)}
    onCurrent={demo === 'none' ? () => { if (search && search !== 'place') void pickCurrentAs(search); } : null}
    onMapPick={() => { if (search && search !== 'place') startMapPick(search); }}
    onFloor={(id, floor) => {
      if (id === null) { setBuildingId(null); setLevel(null); return; }
      setSearchBuilding(null); setBuildingId(id); setLevel(floor);
    }} />;
  // A building tapped on the map: the bottom sheet shrinks to the building's name and one sideways line of floor chips.
  const floorSheet = picker && pickerChoice?.kind === 'pick' && (screen === 'home' || screen === 'plan' || screen === 'route') ? <View style={[st.bottomCard, { paddingHorizontal: layout.padding }]}>
    <View style={{ width: '100%', maxWidth: layout.modalMaxWidth, alignSelf: 'center' }}>
      <FloorPicker name={picker.name} detail={`${pickerChoice.levels.length}개 층 · 장소 ${data.places.filter((p) => p.buildingId === picker.id).length}곳`} levels={pickerChoice.levels} current={picker.id === buildingId ? level : null}
        onLevel={(floor) => enterBuilding(picker.id, floor)} onClose={() => setFloorPicker(null)} />
    </View>
  </View> : null;
  const pressInfo = useMemo(() => (pressPin ? pressPinInfo(data.graph, data.places, pressPin) : null), [pressPin, data.graph, data.places]);
  // Long-press card. It is laid out in the screen's flow right above the tab bar (never under it), its text is capped at two
  // lines each, and the 출발/도착 pair is always one row of equal halves (8 apart): the buttons are the point of the card.
  const pressSheet = pressPin && pressInfo && (screen === 'home' || screen === 'plan' || screen === 'route') ? <View style={[st.bottomCard, { paddingHorizontal: layout.padding }]}>
    <View style={[st.pressCard, { maxWidth: layout.modalMaxWidth }]} accessibilityLabel="길게 눌러 고른 위치">
      <View style={st.pressHeader}>
        <View style={st.pressText} accessibilityLiveRegion="polite">
          <Text accessibilityRole="header" numberOfLines={2} ellipsizeMode="tail" style={st.pressTitle}>{pressInfo.title}</Text>
          <Text numberOfLines={2} ellipsizeMode="tail" style={pressInfo.far ? st.pressFar : st.caption}>{pressInfo.detail}</Text>
        </View>
        <TextButton title="닫기" onPress={() => setPressPin(null)} />
      </View>
      <View style={st.pressActions}>
        <View style={st.pressAction}><Button secondary title="출발지로" onPress={() => choosePressed('from')} /></View>
        <View style={st.pressAction}><Button title="도착지로" onPress={() => choosePressed('to')} /></View>
      </View>
    </View>
  </View> : null;
  const summarySheet = navSummary && screen === 'route' ? <View style={[st.bottomCard, { paddingHorizontal: layout.padding }]}>
    <View style={[st.pressCard, { maxWidth: layout.modalMaxWidth }]}>
      <NavSummaryCard summary={navSummary} destination={to?.name ?? null} onDone={() => setNavSummary(null)} />
    </View>
  </View> : null;
  return <View style={st.root} onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}>
    <View style={st.mapArea}>
      <MapCanvas center={data.campus?.center ?? { lat: 37.5572, lng: 127.045 }} label={demo !== 'none' ? '가상 시험 캠퍼스' : building?.name ?? '한양대학교 서울캠퍼스'} route={shownRoute} from={from} to={to} places={scopePlaces} graph={data.graph} buildingId={buildingId} level={level}
        position={safePosition(navOn && sensors.running ? gps.position : myLocation)} flow={flow}
        focus={focus} selected={screen === 'home' ? selected : null} fitPadding={{ top: fitTop, bottom: 48, left: 36, right: 36 }}
        photoSpots={shownPhotos.photoSpots} onPhotoSpot={showSpot} stepGroups={shownPhotos.stepGroups} onStepGroup={tapStepGroup}
        preview={screen === 'pick' ? null : screen === 'nav' ? preview ?? (shownPhotos.autoPreview ? navPreview : null) : preview} onOpenPreview={openRoadview}
        stepFocus={screen === 'nav' ? stepFocus : null} threeD={threeD}
        onLongPress={longPress} pressPin={screen === 'pick' || screen === 'nav' ? null : pressPin}
        onCenter={(point) => { mapCenter.current = point; if (mapPick) setPickCenter(point); }}
        highlightBuildings={buildingsTappable} mappedBuildingIds={mappedIds} onBuildingPress={pressBuilding} pickedBuildingId={buildingsTappable ? floorPicker : null}
        markedBuildingId={search === null && buildingsTappable ? null : searchBuilding}
        onPoint={(point) => {
          // Picking moves the map under the fixed centre pin; a tap does not pick.
          if (mapPick || screen === 'nav') return;
          setPreview(null); setPressPin(null); if (buildingId && outsideIndoor(point)) setMessage(INDOOR_OUTSIDE_HINT);
        }}
        highlight={screen === 'route' ? slopeFocus : null}
        onPlace={(place) => { if (mapPick) focusOn(place); else if (screen === 'home') { setSelected(place); setSelectQuery(null); setDevOpen(false); setFloorPicker(null); } }} />
      {screen === 'pick' && centerPin}
      {screen === 'pick' && <View style={[st.top, { paddingHorizontal: layout.padding }]} pointerEvents="box-none">
        <View style={[st.topInner, { maxWidth: layout.modalMaxWidth }]} pointerEvents="box-none">
          <View style={st.pickHeader}>
            <RoundButton label="지도 선택 취소" onPress={() => setMapPick(null)}><BackIcon /></RoundButton>
            <View style={st.pickBanner}><Text style={st.pickBannerText}>{pickWord}지 선택 · 지도를 움직여 위치를 지정하세요.</Text></View>
          </View>
        </View>
      </View>}
      {screen !== 'pick' && search === null && <View style={[st.top, { paddingHorizontal: layout.padding }]} pointerEvents="box-none">
        <View style={[st.topInner, { maxWidth: layout.modalMaxWidth }]} pointerEvents="box-none">
          {screen === 'home' && <>
            {selected
              ? <SelectionBar name={selected.name} detail={placeDetail(selected, data.buildings)} onBack={clearSelection} onSearch={searchAgain} />
              : <><SearchBar onSearch={() => openSearch('place')} onRoute={openPlan} /><RestroomChip onPress={() => openSearch('restroom')} /></>}
            {/* 개발 메뉴: 지도 위 배지 없이, 개발 빌드에서만 3D 버튼을 길게 눌러 연다(DEV_MENU_HINT). */}
            {__DEV__ && devOpen && <View style={st.devMenu}>
              <Text style={st.caption}>개발용 연결 시험입니다({DEMO_LABEL[demo]}). 가상 데이터는 실제 한양대 길이 아닙니다.</Text>
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
          {screen === 'route' && <RoutePill from={from} to={to} onBack={() => { setNav(null); setRequest(null); }} />}
          {screen === 'nav' && <View style={st.pickHeader}>
            <RoundButton label="위치 안내 종료" onPress={stopNav}><BackIcon /></RoundButton>
            <View style={st.pickBanner}><Text numberOfLines={1} style={st.pickBannerText}>위치 안내 중 · {to?.name ?? '도착지'}</Text></View>
          </View>}
        </View>
      </View>}
      {screen !== 'pick' && search === null && <View style={st.bottomStack} pointerEvents="box-none">
        <View style={st.fabs} pointerEvents="box-none">
          <RoundButton label={threeD ? '3D 보기 끄기' : '3D 보기, 건물 층을 세워서 보기'} selected={threeD} onPress={() => setThreeD((value) => !value)}
            onLongPress={__DEV__ ? () => setDevOpen((value) => !value) : undefined} longPressLabel={DEV_MENU_HINT}><Stack3DIcon on={threeD} /></RoundButton>
          {demo === 'none' && <RoundButton label="내 위치로 이동" busy={gpsBusy} onPress={() => void locateMe()}><LocateIcon color={myLocation ? t.color.primary : t.color.text} /></RoundButton>}
        </View>
      </View>}
    </View>
    {search !== null ? searchSheet : summarySheet ?? pressSheet ?? floorSheet ?? (screen === 'home' ? homeSheet : screen === 'plan' ? planSheet : screen === 'route' ? routeSheet : screen === 'nav' ? navPanel : pickSheet)}
    <RoadviewScreen visible={roadview !== null} frames={roadview?.frames ?? []} initialIndex={roadview?.index ?? 0} route={roadview?.route ? shownRoute?.polyline ?? null : null} onClose={() => setRoadview(null)} />
  </View>;
}

const PIN = 40;
/** ← / → chevron for the step cards. */
function Arrow({ left = false }: { left?: boolean }) {
  return <View style={{ width: 12, height: 12, marginLeft: left ? 4 : -4, borderLeftWidth: 2.6, borderTopWidth: 2.6, borderColor: t.color.text, transform: [{ rotate: left ? '-45deg' : '135deg' }] }} />;
}

/** A slope card in the route sheet: tap to fit the map to the section and highlight it; tap again to clear. */
function SlopeCard({ message, steep, on, onPress }: { message: string; steep: boolean; on: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${message}. ${on ? '지도 강조를 끄려면 누르세요' : '눌러서 지도에서 구간 보기'}`} accessibilityState={{ selected: on }}
    onPress={onPress} style={({ pressed }) => [st.slopeCard, on && st.slopeCardOn, pressed && { opacity: 0.85 }]}>
    <View style={[st.slopeBar, { backgroundColor: steep ? '#E68A00' : '#C9A227' }]} />
    <Text style={st.slopeText}>{message}</Text>
    <Text style={[st.slopeAction, on && { color: '#B36A00' }]}>{on ? '강조 끄기' : '지도에서 보기'}</Text>
  </Pressable>;
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.bg, overflow: 'hidden' },
  pressCard: { width: '100%', alignSelf: 'center', gap: t.space.md },
  pressHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.sm },
  pressText: { flex: 1, minWidth: 0, gap: t.space.xs },
  pressTitle: { fontSize: 19, lineHeight: 25, fontWeight: '800', color: t.color.text, letterSpacing: -0.3 },
  pressFar: { fontSize: 13, lineHeight: 19, color: t.color.warning },
  pressActions: { flexDirection: 'row', gap: t.space.sm },
  pressAction: { flex: 1, minWidth: 0 },
  mapArea: { flex: 1, minHeight: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 12 },
  topInner: { width: '100%', alignSelf: 'center', gap: 10 },
  // Floating stack at the bottom right: building switch above 내 위치로 이동 (right 16, bottom 96 / 34), and the floor card under them.
  bottomStack: { position: 'absolute', left: 16, right: 16, bottom: 34, gap: 12 },
  fabs: { alignSelf: 'flex-end', gap: 14 },
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
  // Bottom card (long-press, floor picker): in the flow above the tab bar, overlapping only the map's lower edge.
  bottomCard: { flexShrink: 0, marginTop: -18, paddingTop: t.space.md + 4, paddingBottom: t.space.md, borderTopLeftRadius: t.radii.sheet, borderTopRightRadius: t.radii.sheet, backgroundColor: t.color.surface, ...floating },
  pickTitle: { fontSize: 20, lineHeight: 27, fontWeight: '800', color: t.color.primary, letterSpacing: -0.3 },
  pickHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickBanner: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 22, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: '#142A44E6' },
  pickBannerText: { color: 'white', fontSize: 14, fontWeight: '700' },
  pinLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pinAnchor: { width: 0, height: 0, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  pinBody: { position: 'absolute', bottom: 6, left: -PIN / 2, width: PIN, alignItems: 'center' },
  pinHead: { width: PIN, height: PIN, borderRadius: PIN / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'white', elevation: 6, shadowColor: '#0B1F3A', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  pinHole: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'white' },
  pinTip: { width: 0, height: 0, marginTop: -3, borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  pinCrossH: { position: 'absolute', left: -6, top: -1, width: 12, height: 2, backgroundColor: '#142A44' },
  pinCrossV: { position: 'absolute', left: -1, top: -6, width: 2, height: 12, backgroundColor: '#142A44' },
  navPanel: { flexShrink: 0, marginTop: -18, paddingTop: 14, paddingBottom: 12, borderTopLeftRadius: t.radii.sheet, borderTopRightRadius: t.radii.sheet, backgroundColor: t.color.surface, ...floating },
  navInner: { width: '100%', alignSelf: 'center', gap: 10 },
  refreshRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space.sm, flexWrap: 'wrap' },
  navHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space.sm },
  summaryChip: { marginLeft: 'auto', alignSelf: 'center' },
  navCard: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 96, padding: 10, borderRadius: 16, backgroundColor: t.color.soft },
  navArrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.color.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.color.border },
  navArrowOff: { opacity: 0.35 },
  navArrowPressed: { backgroundColor: t.color.sunken },
  navBody: { flex: 1, minWidth: 0, gap: 4 },
  navCounter: { fontSize: 12, fontWeight: '800', color: t.color.primary },
  navText: { fontSize: 17, lineHeight: 24, fontWeight: '800', color: t.color.text },
  navPhotoHint: { fontSize: 12, color: t.color.muted },
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
  slopeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#FFF5DF', borderWidth: 1, borderColor: '#FFF5DF' },
  slopeCardOn: { borderColor: '#E68A00', backgroundColor: '#FFEBC7' },
  slopeBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  slopeText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#8A5200', fontWeight: '600' },
  slopeAction: { fontSize: 12, fontWeight: '800', color: '#8A5200' },
});
