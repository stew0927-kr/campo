// 실기기 피드백 2차(갤럭시 S21): 3D 아이콘, 3D 유리 슬래브, 길게 누름 시트, 사진 점 제거, 길찾기 사진 토글, 로드뷰 무사진 문구,
// 위치 안내 타이머·종료 요약. RN·MapLibre 컴포넌트는 import하지 않는다(소스 문자열과 순수 모듈로 확인).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SensorFix } from '@campo/core';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { STACK_GAP, STACK_OPACITY, STACK_PLATE_H, STACK_PLATE_W, STACK_STEP, STACK_ICON_SIZE, diamond, stackPlates } from '../src/features/map/stackIcon.ts';
import { RIM_H_M, edgeBands, stack3d } from '../src/features/map/stack3d.ts';
import { PHOTOS_OFF, photoLayers, photosOn, showPhotos, togglePhotos } from '../src/features/map/routePhotos.ts';
import {
  CLIMB_STEP_M, MAX_ACCURACY_M, NOT_MEASURED, addFix, elapsedSec, formatClimb, formatClock, formatDistance, formatDuration, haversineM, startTrack, summarize,
} from '../src/features/map/navSummary.ts';
import { screenLayout } from '../src/ui/layout.ts';
import type { MarkerGroup, PhotoSpot } from '../src/photos/roadviewModel.ts';
import { bundleOf } from './helpers.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MAP = source('../src/features/map/CampusMap.tsx');
const SCREEN = source('../src/features/map/MapScreen.tsx');
const CHROME = source('../src/features/map/MapChrome.tsx');
const ROADVIEW = source('../src/features/map/RoadviewScreen.tsx');
const KIT = source('../src/ui/kit.tsx');
const REAL_DIR = fileURLToPath(new URL('../../../data/campuses/hanyang-seoul', import.meta.url));
const real = async () => loadBundledCampus(await bundleOf(REAL_DIR, 'hanyang-seoul'));

describe('[1] 3D 버튼 아이콘: 두꺼운 층판 셋이 둥근 모서리로 촘촘히 겹친 덩어리(rh-1.svg)', () => {
  it('SVG와 같은 기하: 판 중심 8·12·16, 판은 2:1 마름모로 두껍고(세로 9.8), 간격(4)보다 훨씬 두꺼워 겹친다', () => {
    const plates = stackPlates();
    expect(plates.map((p) => p.cy)).toEqual([16, 12, 8]);
    expect(STACK_STEP).toBe(4);
    expect(STACK_PLATE_H).toBeGreaterThan(2 * STACK_STEP); // "선 3개"가 아니라 판
    expect(STACK_PLATE_W / STACK_PLATE_H).toBeCloseTo(2, 6);
    const top = plates.at(-1)!.cy - STACK_PLATE_H / 2, bottom = plates[0]!.cy + STACK_PLATE_H / 2;
    expect(top).toBeGreaterThanOrEqual(2);
    expect(bottom).toBeLessThanOrEqual(STACK_ICON_SIZE - 2);
    expect((STACK_ICON_SIZE - STACK_PLATE_W) / 2).toBeGreaterThanOrEqual(2);
  });
  it('판 사이 틈은 약 0.4~0.5dp: 위 두 판 밑에 같은 비율의 틈 판(halo)을 깐다, 맨 아래 판은 없음', () => {
    expect(STACK_GAP).toBeGreaterThanOrEqual(0.4);
    expect(STACK_GAP).toBeLessThanOrEqual(0.6);
    const [bottom, middle, top] = stackPlates();
    expect(bottom!.haloW).toBe(0);
    for (const p of [middle!, top!]) {
      expect(p.haloW / p.haloH).toBeCloseTo(2, 6);
      // 변에 수직인 틈 = (halo 세로 - 판 세로)/2 × cos(atan(1/2)) = 2/√5
      expect(((p.haloH - STACK_PLATE_H) / 2) * (2 / Math.sqrt(5))).toBeCloseTo(STACK_GAP, 6);
    }
  });
  it('마름모 변환: 정사각형 한 변 w/√2, 세로 비율 h/w', () => {
    const d = diamond(STACK_PLATE_W, STACK_PLATE_H);
    expect(d.side * Math.SQRT2).toBeCloseTo(STACK_PLATE_W, 6);
    expect(d.scaleY).toBeCloseTo(0.5, 6);
  });
  it('위 판이 가장 진하고 아래로 옅다(같은 회색, 켜지면 primary), 틈 판은 버튼 바탕색, 접근성 라벨은 그대로', () => {
    const o = stackPlates().map((p) => p.opacity);
    expect(o).toEqual([...STACK_OPACITY]);
    expect(o[0]).toBeLessThan(o[1]!);
    expect(o[1]).toBeLessThan(o[2]!);
    expect(o[2]).toBe(1);
    expect(CHROME).toContain('const color = on ? t.color.primary : t.color.muted;');
    expect(CHROME).toContain('const gap = on ? ROUND_ON_BG : t.color.surface;');
    expect(CHROME).toContain('backgroundColor: ROUND_ON_BG }');
    expect(SCREEN).toContain("label={threeD ? '3D 보기 끄기' : '3D 보기, 건물 층을 세워서 보기'}");
  });
});

describe('[2] 3D 건물 모형: 유리판처럼 비치게', () => {
  it('고른 층 바로 위 층은 tier 0, 그 위는 tier 1(더 옅게), 슬래브마다 위·아래 경계 띠', async () => {
    const rt = await real();
    const b = [...rt.graph.buildings.values()].find((x) => x.properties.name === '공업센터')!;
    const s = stack3d(rt.graph, b.id, 3);
    expect(s.slabs.features.map((f) => f.properties.tier)).toEqual([0, 1, 1, 1]);
    expect(s.rims.features.length).toBeGreaterThan(0);
    for (const slab of s.slabs.features) {
      const rims = s.rims.features.filter((r) => r.properties.baseM === slab.properties.baseM || r.properties.topM === slab.properties.topM);
      expect(rims.length).toBeGreaterThan(0);
      for (const r of rims) expect(r.properties.topM - r.properties.baseM).toBeLessThanOrEqual(RIM_H_M + 1e-9);
    }
  });
  it('건물을 고르지 않은 실외 3D는 모든 판이 tier 0', async () => {
    const rt = await real();
    expect(stack3d(rt.graph, null, null).slabs.features.every((f) => f.properties.tier === 0)).toBe(true);
  });
  it('변 띠: 변마다 닫힌 사각형 하나, 폭은 주어진 값(m)', () => {
    const ring = [[127, 37.5], [127.0001, 37.5], [127.0001, 37.5001], [127, 37.5]];
    const bands = edgeBands([ring], 0.4);
    expect(bands).toHaveLength(3);
    for (const q of bands) { expect(q).toHaveLength(5); expect(q[0]).toEqual(q[4]); }
    const [a, , , d] = bands[0]!;
    expect(haversineM({ lng: a![0]!, lat: a![1]! }, { lng: d![0]!, lat: d![1]! })).toBeCloseTo(0.4, 2);
    expect(edgeBands([[[127, 37.5], [127, 37.5]]], 0.4)).toEqual([]);
  });
  it('레이어 순서: 가림막·외곽선·유리 슬래브가 먼저 늘 올라가고, 경로·실내선·단계선이 그 뒤(위)에 그려진다', () => {
    const at = (id: string) => { const i = MAP.indexOf(`id="${id}"`); expect(i, id).toBeGreaterThan(-1); return i; };
    expect(at('app-indoor-mask')).toBeLessThan(at('app-3d-floors'));
    expect(at('app-building-outline')).toBeLessThan(at('app-3d-floors'));
    expect(at('app-3d-floors')).toBeLessThan(at('app-3d-rims'));
    expect(at('app-3d-rims')).toBeLessThan(at('app-3d-links'));
    for (const above of ['app-route', 'app-indoor', 'app-nav-step', 'app-places']) expect(at('app-3d-links')).toBeLessThan(at(above));
    // 늘 올라가 있는 원천(빈 데이터로): 나중에 켠 3D가 경로선 위로 올라가지 않는다.
    expect(MAP).toContain('<GeoJSONSource id="app-3d-floors" data={stack?.slabs ?? EMPTY}>');
    expect(MAP).toContain('<GeoJSONSource id="app-indoor-mask" data={mask ?? EMPTY}>');
  });
  it('슬래브는 옅게(0.2/0.1, 실외 0.3), 경계 띠와 세로 선분은 진하게', () => {
    expect(MAP).toContain("slabsNear: { 'fill-extrusion-color': STACK_FLOOR_COLOR, 'fill-extrusion-opacity': 0.2");
    expect(MAP).toContain("slabsFar: { 'fill-extrusion-color': STACK_FLOOR_COLOR, 'fill-extrusion-opacity': 0.1");
    expect(MAP).toContain("'fill-extrusion-opacity': 0.3, ...SLAB_HEIGHT");
    expect(MAP).toContain("rimsNear: { 'fill-extrusion-color': STACK_EDGE_COLOR, 'fill-extrusion-opacity': 0.55");
    expect(MAP).toContain("links: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-opacity': 0.95");
  });
});

describe('[3] 길게 누름 시트: 탭바 위, 출발·도착 나란히', () => {
  it('S21(360dp)에서는 ActionRow가 세로로 쌓인다: 그래서 flex:1 감싸개는 높이 0으로 접혀 버튼이 겹쳤다', () => {
    expect(screenLayout(360, 800).stackActions).toBe(true);
    expect(KIT).toContain('return <View style={layout.stackActions ? s.cellStacked : s.cellRow}>{children}</View>;');
    expect(SCREEN).not.toMatch(/<View style=\{\{ flex: 1 \}\}><Button/);
  });
  it('출발/도착은 화면 폭과 상관없이 한 줄(같은 너비, 간격 8), 도착=primary·출발=secondary', () => {
    expect(SCREEN).toContain("pressActions: { flexDirection: 'row', gap: t.space.sm }");
    expect(SCREEN).toContain("pressAction: { flex: 1, minWidth: 0 }");
    expect(SCREEN).toMatch(/<View style=\{st\.pressAction\}><Button secondary title="출발지로" onPress=\{\(\) => choosePressed\('from'\)\} \/><\/View>\s*<View style=\{st\.pressAction\}><Button title="도착지로"/);
  });
  it('제목·설명은 두 줄까지 말줄임, 시트는 탭바 위 흐름 안(겹치지 않음)에 놓인다', () => {
    expect(SCREEN).toContain('<Text accessibilityRole="header" numberOfLines={2} ellipsizeMode="tail" style={st.pressTitle}>{pressInfo.title}</Text>');
    expect(SCREEN).toContain('<Text numberOfLines={2} ellipsizeMode="tail" style={pressInfo.far ? st.pressFar : st.caption}>{pressInfo.detail}</Text>');
    expect(SCREEN).toMatch(/bottomCard: \{ flexShrink: 0, marginTop: -18, paddingTop: t\.space\.md \+ 4, paddingBottom: t\.space\.md/);
    expect(SCREEN).not.toContain('position: \'absolute\', bottom: 0, left: 0, right: 0');
  });
  it('층 선택 카드도 같은 하단 카드 안(카드 안의 카드 없음)', () => {
    expect(SCREEN).toContain("const floorSheet = picker && pickerChoice?.kind === 'pick' && (screen === 'home' || screen === 'plan' || screen === 'route') ? <View style={[st.bottomCard,");
    expect(CHROME).toContain("floorCard: { alignSelf: 'stretch', gap: t.space.sm + 2 },");
  });
});

const spot = (nodeId: string): PhotoSpot => ({ nodeId, lngLat: [127, 37.5], count: 1, thumbUrl: 'https://example.test/t.webp' });
const group = (key: string): MarkerGroup => ({ key, lngLat: [127, 37.5], nodeId: `n_${key}`, entries: [{ index: 0, label: '1단계' }] });

describe('[5] 길찾기 사진 보기 토글', () => {
  const all = { spots: [spot('a')], stepGroups: [group('r')], navGroups: [group('n')] };
  it('기본은 경로만: 경로 결과·위치 안내에서 사진 핀과 자동 말풍선이 없다', () => {
    const on = photosOn(PHOTOS_OFF, 0);
    expect(on).toBe(false);
    expect(photoLayers('route', on, all)).toEqual({ photoSpots: [], stepGroups: [], autoPreview: false });
    expect(photoLayers('nav', on, all)).toEqual({ photoSpots: [], stepGroups: [], autoPreview: false });
  });
  it('켜면 경로 사진 핀(위치 안내는 지금 단계 사진 + 말풍선), 끄면 바로 사라진다', () => {
    const on = togglePhotos(PHOTOS_OFF, 3);
    expect(photosOn(on, 3)).toBe(true);
    expect(photoLayers('route', true, all).stepGroups).toEqual(all.stepGroups);
    expect(photoLayers('nav', true, all)).toEqual({ photoSpots: [], stepGroups: all.navGroups, autoPreview: true });
    const off = togglePhotos(on, 3);
    expect(photosOn(off, 3)).toBe(false);
  });
  it('같은 길찾기 안에서는 화면을 옮겨도 유지, 새 길찾기(epoch)는 꺼진 채 시작', () => {
    const on = togglePhotos(PHOTOS_OFF, 7);
    expect(photosOn(on, 7)).toBe(true); // route → nav → route: 같은 epoch
    expect(photosOn(on, 8)).toBe(false);
    expect(photosOn(togglePhotos(on, 8), 8)).toBe(true); // 새 길찾기에서 처음 누르면 켜진다
    expect(photosOn(showPhotos(9), 9)).toBe(true);
  });
  it('지도 탭 홈 화면의 사진 지점은 토글과 상관없이 그대로', () => {
    expect(photoLayers('home', false, all)).toEqual({ photoSpots: all.spots, stepGroups: [], autoPreview: false });
    expect(photoLayers('pick', true, all)).toEqual({ photoSpots: [], stepGroups: [], autoPreview: false });
  });
  it('화면 연결: 새 길찾기만 epoch를 올리고, 칩은 경로 요약과 안내 패널에', () => {
    expect(SCREEN).toContain("if (next && data.status === 'ready') { setRequest(next); setRouteEpoch((n) => n + 1); }");
    expect(SCREEN).toContain('photoSpots={shownPhotos.photoSpots} onPhotoSpot={showSpot} stepGroups={shownPhotos.stepGroups}');
    expect(SCREEN.match(/<PhotoChip on=\{routePhotosOn\}/g)).toHaveLength(2);
  });
});

describe('[6] 로드뷰: 사진이 없는 지점은 지도만 조용히', () => {
  it('무사진 안내 문구가 없고, 로드 실패 안내는 남는다', () => {
    expect(ROADVIEW).not.toContain('아직 로드뷰 사진이 없습니다');
    expect(ROADVIEW).not.toContain('아직 사진이 없습니다');
    expect(ROADVIEW).toContain('<Text style={s.emptyText}>{PHOTO_LOAD_FAILED_TEXT}</Text>');
  });
  it('사진이 있을 때만 위쪽 사진 칸, 없으면 아래 지도 칸이 화면을 채우고 닫기·이전·다음은 지도 위에', () => {
    expect(ROADVIEW).toContain('{hasPhoto && <View style={[s.photoArea,');
    expect(ROADVIEW).toContain('{(split || !hasPhoto) && <View style={s.lower}>');
    expect(ROADVIEW).toContain('{!hasPhoto && chrome}');
  });
});

const fix = (tSec: number, northM: number, extra: Partial<SensorFix> = {}): SensorFix => ({ tMs: tSec * 1000, lat: 37.5 + northM / 111_195, lng: 127, accuracyM: 5, ...extra });

describe('[7] 위치 안내 타이머 + 종료 요약', () => {
  it('경과 시간은 시작·지금 시각의 차이(인터벌 횟수와 무관), MM:SS', () => {
    expect(elapsedSec(1_000, 1_000)).toBe(0);
    expect(elapsedSec(1_000, 62_999)).toBe(61);
    expect(elapsedSec(5_000, 1_000)).toBe(0); // 시계가 뒤로 가도 음수 없음
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(61)).toBe('01:01');
    expect(formatClock(75 * 60 + 3)).toBe('75:03');
    // 화면이 꺼져 있다 와도 차이로 계산: 10분 뒤 한 번만 그려도 10:00
    expect(formatClock(elapsedSec(0, 600_000))).toBe('10:00');
  });
  it('fix 0건: 시간만 있고 거리·오르막은 측정 안 됨', () => {
    const s = summarize(startTrack(0), 90_000);
    expect(s).toEqual({ elapsedSec: 90, distanceM: null, climbM: null });
    expect(NOT_MEASURED).toBe('측정 안 됨');
  });
  it('거리: 걸은 만큼 더하고, 정확도 나쁜 fix·제자리 떨림·튐은 거른다', () => {
    let t = startTrack(0);
    t = addFix(t, fix(1, 0));
    t = addFix(t, fix(2, 1)); // 1 m 떨림: 무시
    t = addFix(t, fix(3, 0.5));
    expect(t.distanceM).toBe(0);
    t = addFix(t, fix(10, 10)); // 10 m 걸음
    expect(t.distanceM).toBeCloseTo(10, 0);
    t = addFix(t, fix(11, 60, { accuracyM: MAX_ACCURACY_M + 5 })); // 정확도 나쁨: 무시
    expect(t.distanceM).toBeCloseTo(10, 0);
    t = addFix(t, fix(12, 200)); // 1초에 190 m: 튐 → 더하지 않고 기준만 옮김
    expect(t.distanceM).toBeCloseTo(10, 0);
    t = addFix(t, fix(20, 220)); // 튐 뒤 다시 걸음
    expect(t.distanceM).toBeCloseTo(30, 0);
    const s = summarize(t, 20_000);
    expect(s.distanceM).toBeCloseTo(30, 0);
    expect(s.climbM).toBeNull(); // 기압 없음
  });
  it('천천히 걸어 떨림 기준보다 작게 여러 번 움직여도 쌓이면 센다', () => {
    let t = addFix(startTrack(0), fix(0, 0));
    for (let i = 1; i <= 10; i++) t = addFix(t, fix(i * 2, i * 1));
    expect(t.distanceM).toBeGreaterThanOrEqual(9 - 3);
    expect(t.distanceM).toBeLessThanOrEqual(10.5);
  });
  it('오르막: 기압 고도 상승분만 합산, 1 m 미만 떨림·내려감은 세지 않음', () => {
    let t = startTrack(0);
    const baro = [0, 0.4, -0.3, 1.2, 3.5, 2.0, 1.0, 0.8, 2.5, 2.2];
    baro.forEach((h, i) => { t = addFix(t, fix(i, 0, { baroDeltaM: h })); });
    // 0 → 1.2(+1.2) → 3.5(+2.3) → 내려가 1.0(기준 이동) → 0.8(떨림) → 2.5(+1.5) = 5.0
    expect(t.climbM).toBeCloseTo(5.0, 6);
    expect(CLIMB_STEP_M).toBe(1);
    expect(summarize(t, 10_000).climbM).toBeCloseTo(5.0, 6);
  });
  it('표시: 큰 숫자 + 작은 단위', () => {
    expect(formatDuration(42)).toEqual([{ value: '42', unit: '초' }]);
    expect(formatDuration(12 * 60 + 5)).toEqual([{ value: '12', unit: '분' }, { value: '5', unit: '초' }]);
    expect(formatDuration(3600 + 120)).toEqual([{ value: '1', unit: '시간' }, { value: '2', unit: '분' }]);
    expect(formatDistance(349.6)).toEqual({ value: '350', unit: 'm' });
    expect(formatDistance(1234)).toEqual({ value: '1.2', unit: 'km' });
    expect(formatClimb(4.6)).toEqual({ value: '5', unit: 'm' });
  });
  it('화면 연결: 종료(상단 ←·패널 버튼·뒤로)는 요약을 띄우고 GPS를 끄며, 확인은 요약만 닫는다', () => {
    expect(SCREEN).toContain('<RoundButton label="위치 안내 종료" onPress={stopNav}>');
    expect(SCREEN).toContain('<Button secondary title="위치 안내 종료" onPress={stopNav} />');
    expect(SCREEN).toContain('setNavSummary(track ? summarize(track, Date.now()) : null);');
    expect(SCREEN).toContain('onDone={() => setNavSummary(null)}');
    // 센서는 nav(안내 중)일 때만 켜진다: 요약 중에는 nav가 null이라 구독이 멈춘다.
    expect(SCREEN).toContain("const sensors = useSensorFixes(navOn && active && demo === 'none', pushFix);");
    expect(SCREEN).toContain('{navStartMs !== null ? <NavClock startMs={navStartMs} /> : <View />}');
  });
});
