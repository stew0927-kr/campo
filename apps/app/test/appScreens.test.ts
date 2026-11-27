import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
// Use the existing root renderer and React together. This installs nothing and avoids native modules in Node.
const pressHandlers = vi.hoisted(() => new Map<string, () => void>());
vi.mock('react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(new URL('../../../package.json', import.meta.url))('react');
});
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const box = ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) => createElement('div', { 'data-label': accessibilityLabel }, children);
  return {
    View: box, Text: box, ScrollView: box, KeyboardAvoidingView: box,
    Pressable: ({ children, accessibilityLabel, onPress }: { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void }) => {
      const title = (children as { props?: { children?: unknown } } | undefined)?.props?.children;
      if (typeof title === 'string' && onPress) pressHandlers.set(title, onPress);
      return createElement('div', { 'data-label': accessibilityLabel }, children);
    },
    TextInput: ({ placeholder }: { placeholder?: string }) => createElement('input', { placeholder }),
    Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? children : null,
    FlatList: ({ data, renderItem, ListEmptyComponent }: { data: unknown[]; renderItem: (arg: { item: unknown }) => ReactNode; ListEmptyComponent: ReactNode }) => createElement('div', null, data.length ? data.map((item, i) => createElement('div', { key: i }, renderItem({ item }))) : ListEmptyComponent),
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 1 }),
    ActivityIndicator: box, StyleSheet: { create: (value: unknown) => value }, Platform: { OS: 'android' },
    AppState: { addEventListener: () => ({ remove() {} }) }, Linking: { openURL: vi.fn(), openSettings: vi.fn() },
    // The draggable sheet: no gestures in Node, only the rendered content.
    Animated: { View: box, Value: class { constructor(public v: number) {} setValue(v: number) { this.v = v; } }, spring: () => ({ start: () => undefined }) },
    PanResponder: { create: () => ({ panHandlers: {} }) },
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return { SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', null, children) };
});
vi.mock('expo-location', () => ({ getForegroundPermissionsAsync: vi.fn(), requestForegroundPermissionsAsync: vi.fn() }));
vi.mock('expo-sensors', () => ({ Barometer: {} }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0' } } }));
vi.mock('../src/features/map/MapCanvas.tsx', () => ({ MapCanvas: () => createElement('div', null, '지도 렌더링은 실기기 검증 대상입니다') }));
vi.mock('../src/photos/PhotoViewerModal.tsx', () => ({ PhotoViewerModal: () => null }));
vi.mock('../src/features/map/RoadviewScreen.tsx', () => ({ RoadviewScreen: () => null }));
import { AppStateProvider } from '../src/state/AppState.tsx';
import { INITIAL_STATE } from '../src/state/model.ts';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
import { EssayScreen } from '../src/features/essay/EssayScreen.tsx';
import { FestivalScreen, type FestivalView } from '../src/features/festival/FestivalScreen.tsx';
import { EventsScreen } from '../src/features/events/EventsScreen.tsx';
import { MeScreen } from '../src/features/me/MeScreen.tsx';
import { AppInfoScreen, CONTACT_EMAIL, PRIVACY_URL, TERMS_URL } from '../src/features/me/AppInfoScreen.tsx';
import { Linking } from 'react-native';
import { MapScreen } from '../src/features/map/MapScreen.tsx';
import { ContentGate } from '../src/features/content/ContentGate.tsx';
import { festivalGuide } from '../src/features/festival/guide.ts';
function render(child: ReactNode) { return renderToStaticMarkup(createElement(AppStateProvider, { initialState: INITIAL_STATE, children: child })); }
describe('A screen rendering with mocked native views (not device tests)', () => {
  it('shows the empty real map honestly and supports manual endpoints', () => {
    vi.stubGlobal('__DEV__', true);
    const html = render(createElement(MapScreen));
    // Real campus data is bundled now, so no "data missing" or internal-team notice is shown.
    expect(html).not.toContain('실제 캠퍼스 길 데이터가 아직 없습니다'); expect(html).not.toContain('조원');
    // Home is a full-screen map: floating place search, the route button and the locate button.
    expect(html).toContain('건물 이름, 동 번호, 강의실 검색'); expect(html).toContain('길찾기'); expect(html).toContain('내 위치로 이동');
    // The first sheet is left clean: no "어디로 가시나요?" heading or guide caption. The restroom quick button floats on the map.
    expect(html).not.toContain('어디로 가시나요?'); expect(html).not.toContain('위치 권한 없이도 길을 찾을 수 있습니다');
    expect(html).toContain('가장 가까운 화장실'); expect(html).toContain('시트 접기');
    // No floating building switch: buildings are tapped on the map itself. The sheet keeps a building list entry instead of the 실외|실내 segment,
    // and the only floating action left is the locate button.
    expect(html).not.toContain('건물에서 층 고르기'); expect(html).toContain('건물 목록'); expect(html).toContain('실외 지도');
    // No search sheet until the search is opened.
    expect(html).not.toContain('data-label="검색 닫기"');
  });
  it('renders the half-screen search sheet, the selection bar and the floor picker', async () => {
    const { PlaceSearch, SelectionBar, FloorPicker } = await import('../src/features/map/MapChrome.tsx');
    const base = { query: '', onQuery: () => undefined, results: [], places: [], buildings: [], detail: () => '', emptyMessage: '없음', demoNotice: false, maxWidth: 600, padding: 16, busy: false,
      onClose: () => undefined, onChoose: () => undefined, onCurrent: null, onMapPick: () => undefined };
    expect(render(createElement(PlaceSearch, { ...base, target: null }))).toBe('');
    const sheet = render(createElement(PlaceSearch, { ...base, target: 'to', areaHeight: 700 }));
    for (const label of ['data-label="검색 닫기"', 'placeholder="건물 이름, 동 번호, 강의실 검색"', '지도에서 선택']) expect(sheet).toContain(label);
    // Compact sheet: no title row and no ^/v buttons (the drag handle and ← cover them).
    for (const label of ['목적지 검색', 'data-label="검색 접기"', 'data-label="검색 크게 펼치기"']) expect(sheet).not.toContain(label);
    const bar = render(createElement(SelectionBar, { name: '303호 강의실', detail: '공업센터 · 3층', onBack: () => undefined, onSearch: () => undefined }));
    expect(bar).toContain('data-label="선택 취소"'); expect(bar).toContain('303호 강의실');
    const floors = render(createElement(FloorPicker, { name: '공업센터', detail: '8개 층', levels: [-1, 1, 3], current: 3, onLevel: () => undefined, onClose: () => undefined }));
    for (const label of ['B1', '1F', '3F', '3층, 지금 보는 층', 'data-label="층 선택 닫기"', '지도에서 계속 보기']) expect(floors).toContain(label);
  });
  it('browses the search list by building, then floor, then facility', async () => {
    const { PlaceSearch, PlaceTree } = await import('../src/features/map/MapChrome.tsx');
    const { loadBundledCampus } = await import('../src/campus/loadBundledCampus.ts');
    const { ROADVIEW_DEMO_CAMPUS } = await import('../src/features/map/roadviewDemo.ts');
    const rt = loadBundledCampus(ROADVIEW_DEMO_CAMPUS);
    const common = { places: rt.places, buildings: rt.buildings, detail: () => '', onChoose: () => undefined };
    const search = (query: string, target: 'place' | 'restroom' = 'place') => render(createElement(PlaceSearch, { ...common, target, query, onQuery: () => undefined, results: rt.places.filter((p) => p.name.includes(query)),
      emptyMessage: '없음', demoNotice: false, maxWidth: 600, padding: 16, busy: false, onClose: () => undefined, onCurrent: () => undefined, onMapPick: () => undefined }));
    const root = search('');
    expect(root).not.toContain('건물을 골라 주세요'); expect(root).toContain('data-label="건물 목록"'); expect(root).toContain('가상 공학관'); expect(root).toContain('야외 장소'); expect(root).not.toContain('가상 201호 강의실');
    const restroom = search('', 'restroom');
    expect(restroom).toContain('화장실 찾기 · 출발 위치'); expect(restroom).toContain('현재 위치'); expect(restroom).toContain('지도에서 선택');
    expect(search('201')).toContain('가상 201호 강의실');
    const floors = render(createElement(PlaceTree, { ...common, path: { building: 'bldg_rv_eng', level: null }, onPath: () => undefined }));
    expect(floors).toContain('1층'); expect(floors).toContain('2층');
    const facilities = render(createElement(PlaceTree, { ...common, path: { building: 'bldg_rv_eng', level: 2 }, onPath: () => undefined }));
    for (const label of ['화장실', '강의실', '가상 201호 강의실', '가상 공학관 2층 화장실']) expect(facilities).toContain(label);
  });
  it('always shows the essay prototype notice and both date filters', () => {
    const html = render(createElement(EssayScreen, { data: DEMO_CONTENT }));
    expect(html).toContain('예시 정보'); expect(html).not.toContain('시연'); expect(html).toContain('11/28(토)'); expect(html).toContain('11/29(일)');
    expect(html).toContain('실제 일정'); expect(html).toContain('고사장 상세 보기');
  });
  it('renders the festival hero, day switch, notices and the four guide views without inventing booth pins', () => {
    const html = render(createElement(FestivalScreen, { data: DEMO_CONTENT }));
    expect(html).toContain('예시 정보'); expect(html).toContain('2026 애국한양응원제 : 오름');
    for (const label of ['DAY 1 · 10/1(목)', 'DAY 2 · 10/2(금)', '17시 이후 성동 03-2번 버스 회차 지점 변경', '타임테이블', '입장·동선', '부스', '이용안내']) expect(html).toContain(label);
    // DAY 1 has no published line-up: an honest empty state, not made-up acts.
    expect(html).toContain('이 날짜의 공연 정보가 아직 공개되지 않았습니다'); expect(html).not.toContain('가상');
  });
  it('fills the festival guide sections only from the published guide', () => {
    const guide = festivalGuide(DEMO_CONTENT.festivals[0]);
    expect(guide.prohibitedItems).toHaveLength(8); expect(guide.gates.map((g) => g.label)).toEqual(['GATE A', 'GATE B', 'GATE C']);
    const bare = render(createElement(FestivalScreen, { data: { ...DEMO_CONTENT, festivals: DEMO_CONTENT.festivals.map((f) => ({ ...f, guide: null })) } }));
    expect(bare).not.toContain('버스 회차'); expect(bare).toContain('2026 애국한양응원제 : 오름');
  });
  it('renders every festival view from the official notice data', () => {
    const view = (initialView: FestivalView) => render(createElement(FestivalScreen, { data: DEMO_CONTENT, initialView, initialDayId: 'orum-day-2' }));
    const timetable = view('타임테이블');
    for (const act of ['15:10', '20:00', '한울림', '블라인드 소개팅', '루터스', 'fromis_9', 'HIGHLIGHT', '일부 일정이 변동될 수 있습니다']) expect(timetable).toContain(act);
    const flows = view('입장·동선');
    for (const label of ['한양존', '프렌즈존', 'GATE A 길찾기', 'GATE C 길찾기', '주황 선', '보라 선', '비상구', '대기 동선 지도에서 보기']) expect(flows).toContain(label);
    const booths = view('부스 찾기');
    for (const label of ['주점', '부스', '공연', '편의', '한마당', '국제관 옆', '지구 멸망까지 3분', '시끄러운 밤', '탕화쿵푸', '사천훠궈마라탕', '용기한걸음메아리', '부스 상세 보기']) expect(booths).toContain(label);
    const services = view('이용 안내');
    for (const label of ['팔찌 수령', '국제관 옆 팔찌 부스(2곳)', '10:00 ~ 20:00', '축구 유니폼', '38,000원', '3XL', '반입 금지 물품', '셀카봉', '가연성·폭발성 물질', '분실물·미수령 안내']) expect(services).toContain(label);
    // Sections with no published notice say so instead of inventing rules.
    expect(services).toContain('아직 공지되지 않았습니다');
  });
  it('renders event categories and an empty content state', () => {
    expect(render(createElement(EventsScreen, { data: DEMO_CONTENT }))).toContain('가상 입학설명회');
    expect(render(createElement(EventsScreen, { data: { ...DEMO_CONTENT, events: [] } }))).toContain('조건에 맞는 행사가 없습니다');
  });
  it('renders profiles, session-only favorites, privacy links and open-source notices', () => {
    const html = render(createElement(MeScreen));
    for (const label of ['일반 보행', '계단 회피', '휠체어 보행', '위치·센서 권한', 'OpenStreetMap', '개인정보 처리방침']) expect(html).toContain(label);
    for (const gone of ['조원', '시제품', '개발용', '앱을 완전히 종료하면 초기화']) expect(html).not.toContain(gone);
  });
  it('links the legal pages and the team contact without placeholder copy', () => {
    const html = render(createElement(AppInfoScreen));
    for (const label of ['개인정보 처리방침', '이용약관', '문의처', 'campo@gmail.com']) expect(html).toContain(label);
    for (const placeholder of ['D조원', '준비 중']) expect(html).not.toContain(placeholder);
    expect(PRIVACY_URL).toBe('https://stew0927-kr.github.io/campo-legal/privacy.html');
    expect(TERMS_URL).toBe('https://stew0927-kr.github.io/campo-legal/terms.html');
    expect(CONTACT_EMAIL).toBe('campo@gmail.com');
    const open = vi.mocked(Linking.openURL);
    for (const [title, url] of [['개인정보 처리방침', PRIVACY_URL], ['이용약관', TERMS_URL], ['문의처', 'mailto:campo@gmail.com']] as const) {
      open.mockClear();
      pressHandlers.get(title)?.();
      expect(open).toHaveBeenCalledWith(url);
    }
  });
  it('renders content loading and retryable failures rather than fake success', () => {
    const children = () => createElement('div', null, 'success');
    const loading = render(createElement(ContentGate, { content: { status: 'loading', data: null, error: null, reload: vi.fn() }, children }));
    expect(loading).toContain('불러오고 있습니다'); expect(loading).not.toContain('success');
    const error = render(createElement(ContentGate, { content: { status: 'error', data: null, error: '연결 오류입니다', reload: vi.fn() }, children }));
    expect(error).toContain('연결 오류입니다'); expect(error).toContain('다시 불러오기');
  });
});
