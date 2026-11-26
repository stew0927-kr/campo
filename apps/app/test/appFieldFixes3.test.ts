// 실기기 피드백 3차(PR #61): 개발 배지 제거, 사진 핀 → 로드뷰, 조이스틱형 사진 토글, 서버 지도 새로고침.
// (3D 아이콘·세로 선분은 appFieldFixes2·appMapFeedback, 사진 목록은 routeAlongPhotos, 화살표·문구는 turnGuide 테스트.)
// RN·MapLibre 컴포넌트는 import하지 않는다(소스 문자열과 순수 모듈로 확인).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { campusDataWithFallback, type CampusMapReader } from '../src/campus/remote.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { CAMPUS_REFRESH_MS, campusFetchedAt, currentCampusBundle, isCampusStale, refreshCampusBundle, resetCampusBundle, startCampusBundle } from '../src/hooks/useCampusBundle.ts';
import { pinTapAction } from '../src/photos/roadviewModel.ts';
import { stack3d } from '../src/features/map/stack3d.ts';
import { bundleOf } from './helpers.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MAP = source('../src/features/map/CampusMap.tsx');
const SCREEN = source('../src/features/map/MapScreen.tsx');
const CHROME = source('../src/features/map/MapChrome.tsx');
const EXTRAS = source('../src/features/map/NavExtras.tsx');
const DATA_HOOK = source('../src/hooks/useCampusData.ts');
const AUTO = source('../src/features/map/useCampusAutoRefresh.ts');
const REAL_DIR = fileURLToPath(new URL('../../../data/campuses/hanyang-seoul', import.meta.url));

describe('[3] 지도 오른쪽 위 "개발 · 실제 데이터" 배지 제거', () => {
  it('지도 위 FloatChip 배지가 없다(컴포넌트도 지움)', () => {
    expect(SCREEN).not.toContain('<FloatChip');
    expect(SCREEN).not.toContain('`개발 · ${DEMO_LABEL[demo]}`');
    expect(CHROME).not.toContain('export function FloatChip');
  });
  it('개발 메뉴는 개발 빌드에서만, 3D 버튼 길게 누르기(접근성 동작 포함)로 연다', () => {
    expect(SCREEN).toContain('onLongPress={__DEV__ ? () => setDevOpen((value) => !value) : undefined} longPressLabel={DEV_MENU_HINT}');
    expect(SCREEN).toContain('{__DEV__ && devOpen && <View style={st.devMenu}>');
    expect(CHROME).toContain("accessibilityActions={onLongPress ? [{ name: 'longpress', label: longPressLabel ?? label }] : undefined}");
  });
});

describe('[4] 사진 핀·말풍선을 누르면 그 사진이 첫 장면인 로드뷰', () => {
  it('항목 하나인 핀은 바로 열고(장면 위치 = stepPhotos 위치), 왕복으로 둘 이상이면 말풍선에서 고른다', () => {
    expect(pinTapAction({ entries: [{ index: 7, label: '3단계' }] })).toEqual({ kind: 'open', index: 7 });
    expect(pinTapAction({ entries: [{ index: 2, label: '가는 길 · 2단계' }, { index: 9, label: '오는 길 · 4단계' }] })).toEqual({ kind: 'choose' });
    expect(SCREEN).toContain('onStepGroup={tapStepGroup}');
    expect(SCREEN).toContain("if (action.kind === 'open') openRoadview(action.index);");
    expect(SCREEN).toContain('if (index !== null && frames[index]) { setRoadview({ frames, index, route: true }); return; }');
  });
  it('경로 없는 사진 지점 핀도 말풍선 없이 그 지점 로드뷰를 연다', () => {
    const at = SCREEN.indexOf('function showSpot(spot: PhotoSpot)');
    const body = SCREEN.slice(at, SCREEN.indexOf('\n  }', at));
    expect(body).toContain('spotFrame(spot.nodeId, spot.lngLat, effectiveCatalog, lookup)');
    expect(body).toContain('setRoadview({ frames: [frame], index: 0, route: false })');
  });
  it('손가락이 핀·말풍선에 닿는 순간(onPressIn) 지도 탭을 막는다: 지도 탭이 말풍선을 먼저 닫아 버리지 않게', () => {
    expect(MAP).toContain('const markPinTouch = useCallback(() => { pinPressedAt.current = Date.now(); }, []);');
    expect(MAP).toContain('if (Date.now() - pinPressedAt.current < PIN_TAP_GUARD_MS) return;');
    expect(MAP).toMatch(/export const PIN_TAP_GUARD_MS = (\d+);/);
    expect(Number(MAP.match(/export const PIN_TAP_GUARD_MS = (\d+);/)![1])).toBeGreaterThanOrEqual(500);
    // 핀, 말풍선 본체, 가는 길/오는 길 버튼 모두.
    expect(MAP.match(/onPressIn=\{onTouch\}/g)!.length).toBeGreaterThanOrEqual(3);
    expect(MAP).toContain('onTouch={markPinTouch}');
  });
  it('팬·핀치 직후 조금 흔들린 탭도 잡도록 터치 여유(hitSlop·pressRetentionOffset), 핀 터치 영역 48pt', () => {
    expect(MAP).toContain('hitSlop={PIN_SLOP} pressRetentionOffset={PIN_SLOP}');
    expect(MAP).toContain('const PIN_TOUCH = 48;');
  });
  it('안내 문구도 로드뷰로', () => {
    expect(SCREEN).toContain('지도의 사진이나 말풍선을 누르면 로드뷰로 볼 수 있어요.');
    expect(SCREEN).not.toContain('크게 볼 수 있어요');
    expect(MAP).toContain('눌러서 로드뷰 보기');
  });
});

describe('[8] 사진 보기 토글: 위에서 본 조이스틱(알약 트랙 + 둥근 손잡이)', () => {
  it('트랙 64×32, 손잡이 28, 180ms ease-out으로 좌우 이동(네이티브 드라이버), 동작 줄이기면 바로', () => {
    expect(EXTRAS).toContain('export const PHOTO_TOGGLE = { trackW: 64, trackH: 32, knob: 28, inset: 2, durationMs: 180 } as const;');
    expect(EXTRAS).toContain("outputRange: [0, PHOTO_TOGGLE_TRAVEL]");
    expect(EXTRAS).toContain('duration: reduceMotion ? 0 : PHOTO_TOGGLE.durationMs, easing: Easing.out(Easing.cubic), useNativeDriver: true');
    expect(EXTRAS).toContain('AccessibilityInfo.isReduceMotionEnabled()');
  });
  it('꺼짐: 회색 손잡이·옅은 트랙 / 켜짐: primary 손잡이·파란 트랙(불투명도로 겹쳐 전환)', () => {
    expect(EXTRAS).toMatch(/knob: \{[^}]*backgroundColor: t\.color\.muted/);
    expect(EXTRAS).toMatch(/knobOn: \{[^}]*backgroundColor: t\.color\.primary/);
    expect(EXTRAS).toContain('<Animated.View style={[s.trackOn, { opacity: progress }]} />');
  });
  it('switch 역할·checked 상태·레이블 유지, 사진 장수는 트랙 옆 글자, 누름 영역 높이 44 이상', () => {
    expect(EXTRAS).toContain('accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={`경로 사진 보기, 사진 ${count}장`}');
    expect(EXTRAS).toContain('사진 {count}장</Text>');
    expect(EXTRAS).toMatch(/toggle: \{[^}]*minHeight: 44/);
    expect(SCREEN.match(/<PhotoChip on=\{routePhotosOn\}/g)).toHaveLength(2);
  });
});

describe('[9] 서버 지도 새로고침(앱 재시작 없이)', () => {
  afterEach(() => resetCampusBundle({ clear: true }));
  const files = (tag: string) => [{ path: 'campus.json', text: `{"tag":"${tag}"}` }];

  it('resetCampusBundle 뒤에는 다시 묻고, refreshCampusBundle은 바로 다시 받는다', async () => {
    const read = vi.fn<CampusMapReader>(async () => files('a'));
    await startCampusBundle(read);
    await startCampusBundle(read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(campusFetchedAt()).toBeGreaterThan(0);
    resetCampusBundle();
    expect(campusFetchedAt()).toBe(0);
    await startCampusBundle(read);
    expect(read).toHaveBeenCalledTimes(2);
    const next = await refreshCampusBundle(async () => files('b'));
    expect(next.bundle?.files[0]!.text).toBe('{"tag":"b"}');
  });
  it('다시 받기에 실패해도(오프라인) 이미 받은 서버 지도를 지킨다', async () => {
    await refreshCampusBundle(async () => files('server'));
    expect(currentCampusBundle()?.source).toBe('server');
    const failed = await refreshCampusBundle(async () => { throw new Error('offline'); });
    expect(failed.source).toBe('bundled');
    expect(currentCampusBundle()?.bundle?.files[0]!.text).toBe('{"tag":"server"}');
    // 처음부터 실패면 앱 번들 + 안내.
    resetCampusBundle({ clear: true });
    await startCampusBundle(async () => { throw new Error('offline'); });
    expect(currentCampusBundle()?.source).toBe('bundled');
  });
  it('겹친 새로고침은 마지막 요청의 답만 반영한다', async () => {
    let release!: () => void;
    const slow = refreshCampusBundle(() => new Promise((ok) => { release = () => ok(files('old')); }));
    await refreshCampusBundle(async () => files('new'));
    release();
    await slow;
    expect(currentCampusBundle()?.bundle?.files[0]!.text).toBe('{"tag":"new"}');
  });
  it('포그라운드 복귀: 10분 지난 것만 다시 받는다', () => {
    expect(CAMPUS_REFRESH_MS).toBe(600_000);
    expect(isCampusStale(0, 1000)).toBe(true);
    expect(isCampusStale(1_000_000, 1_000_000 + 9 * 60_000)).toBe(false);
    expect(isCampusStale(1_000_000, 1_000_000 + CAMPUS_REFRESH_MS)).toBe(true);
    expect(AUTO).toContain("if (state === 'active' && isCampusStale(campusFetchedAt(), Date.now())) void refreshCampusBundle();");
    expect(SCREEN).toContain("useCampusAutoRefresh(demo === 'none');");
  });
  it('useCampusData().reload()가 서버 지도를 실제로 다시 요청하고, 지도 화면에 "지도 새로고침"이 있다', () => {
    expect(DATA_HOOK).toContain('if (fromServer) void refreshCampusBundle();');
    expect(SCREEN).toContain("export const MAP_REFRESH_TITLE = '지도 새로고침';");
    expect(SCREEN).toContain('<TextButton title={MAP_REFRESH_TITLE} disabled={mapRefreshing} onPress={data.reload} />');
  });
  it('서버 지도는 통째로 쓴다: 층 목록·3D 층은 서버 L*.geojson 기준, 앱 번들과 섞이지 않는다', async () => {
    const bundled = await bundleOf(REAL_DIR, 'hanyang-seoul');
    // 서버에서 한 건물의 맨 위층 파일이 빠졌다고 하자(그 층을 지운 저장).
    const rt = loadBundledCampus(bundled);
    const b = [...rt.graph.buildings.values()].find((x) => x.properties.name === '공업센터')!;
    const top = Math.max(...b.properties.levels);
    const building = bundled.files.find((f) => f.path.endsWith('/building.geojson') && f.text.includes(`"id":"${b.id}"`))!;
    const dir = building.path.replace(/building\.geojson$/, '');
    const dropped = bundled.files.filter((f) => f.path !== `${dir}L${top}.geojson`);
    expect(dropped.length).toBe(bundled.files.length - 1);
    const edited = { ...building, text: building.text.replace(/"levels":\[([^\]]*)\]/, (_, list: string) => `"levels":[${list.split(',').filter((x) => Number(x) !== top).join(',')}]`) };
    expect(edited.text).not.toBe(building.text);
    const server = { campus: bundled.campus, files: dropped.map((f) => (f === building ? edited : f)) };
    const data = campusDataWithFallback({ bundle: server, source: 'server', message: null }, bundled);
    expect(data.status).toBe('ready');
    const fromServer = data.buildings.find((x) => x.id === b.id)!;
    expect(fromServer.levels).not.toContain(top);
    expect(stack3d(data.graph, b.id, 1).slabs.features.map((f) => f.properties.level)).not.toContain(top);
    // 앱 번들은 여전히 그 층을 갖고 있다(섞였다면 다시 나타났을 것).
    expect(rt.graph.buildings.get(b.id)!.properties.levels).toContain(top);
  });
});
