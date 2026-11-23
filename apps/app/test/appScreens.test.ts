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
import { AppStateProvider } from '../src/state/AppState.tsx';
import { INITIAL_STATE } from '../src/state/model.ts';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
import { EssayScreen } from '../src/features/essay/EssayScreen.tsx';
import { FestivalScreen } from '../src/features/festival/FestivalScreen.tsx';
import { EventsScreen } from '../src/features/events/EventsScreen.tsx';
import { MeScreen } from '../src/features/me/MeScreen.tsx';
import { AppInfoScreen, CONTACT_EMAIL, PRIVACY_URL, TERMS_URL } from '../src/features/me/AppInfoScreen.tsx';
import { Linking } from 'react-native';
import { MapScreen } from '../src/features/map/MapScreen.tsx';
import { ContentGate } from '../src/features/content/ContentGate.tsx';
function render(child: ReactNode) { return renderToStaticMarkup(createElement(AppStateProvider, { initialState: INITIAL_STATE, children: child })); }
describe('A screen rendering with mocked native views (not device tests)', () => {
  it('shows the empty real map honestly and supports manual endpoints', () => {
    vi.stubGlobal('__DEV__', true);
    const html = render(createElement(MapScreen));
    expect(html).toContain('실제 캠퍼스 길 데이터가 아직 없습니다');
    // Home is a full-screen map: floating place search, the route button and the locate button.
    expect(html).toContain('건물 이름, 동 번호, 강의실 검색'); expect(html).toContain('길찾기'); expect(html).toContain('내 위치로 이동');
    expect(html).toContain('어디로 가시나요?');
  });
  it('always shows the essay prototype notice and both date filters', () => {
    const html = render(createElement(EssayScreen, { data: DEMO_CONTENT }));
    expect(html).toContain('차기 시즌 프로토타입'); expect(html).toContain('2026-11-28'); expect(html).toContain('2026-11-29');
    expect(html).toContain('실제 일정'); expect(html).toContain('고사장 상세 보기');
  });
  it('renders the festival timetable without inventing booth pins', () => {
    const html = render(createElement(FestivalScreen, { data: DEMO_CONTENT }));
    expect(html).toContain('가상 밴드'); expect(html).toContain('지도 지점 ID가 없어');
    for (const category of ['주점', '부스', '공연', '편의']) expect(html).toContain(category);
  });
  it('renders event categories and an empty content state', () => {
    expect(render(createElement(EventsScreen, { data: DEMO_CONTENT }))).toContain('가상 입학설명회');
    expect(render(createElement(EventsScreen, { data: { ...DEMO_CONTENT, events: [] } }))).toContain('조건에 맞는 행사가 없습니다');
  });
  it('renders profiles, session-only favorites, privacy links and open-source notices', () => {
    const html = render(createElement(MeScreen));
    for (const label of ['일반 보행', '계단 회피', '휠체어 보행', '위치·센서 권한', 'OpenStreetMap', '개인정보 처리방침', '앱을 완전히 종료하면 초기화']) expect(html).toContain(label);
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
