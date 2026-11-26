// 로드뷰 사진 위 안내(turnGuide): "앞으로 OOm 직진" / "OOm 직진 후 왼쪽" / "바로 왼쪽", ㄱ자·곧은 화살표, 흰 점 제거.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LngLat } from '@campo/core';
import type { CampusRouteView } from '../src/contracts.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { roadviewFrames, placeLookup, stepRun } from '../src/photos/roadviewModel.ts';
import { routeAlongPhotos } from '../src/photos/routeAlongPhotos.ts';
import { arrowShift, roundRunM, straightRun, turnGuide, ROUND_M, STRAIGHT_TOL_DEG, TURN_ARROW_DEG } from '../src/photos/turnGuide.ts';
import { computeRoute } from '../src/route/routeEngine.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const OVERLAY = source('../src/photos/PhotoArrowOverlay.tsx');
const ROADVIEW = source('../src/features/map/RoadviewScreen.tsx');

/** (0,0)에서 동서남북으로 m씩 걷는 선. 'E10' = 동쪽 10 m. */
function walk(...moves: string[]): LngLat[] {
  const lat0 = 37.5, kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  let x = 127, y = lat0;
  const out: LngLat[] = [[x, y]];
  for (const m of moves) {
    const d = Number(m.slice(1));
    if (m[0] === 'E') x += d / kx; else if (m[0] === 'W') x -= d / kx; else if (m[0] === 'N') y += d / ky; else if (m[0] === 'S') y -= d / ky;
    out.push([x, y]);
  }
  return out;
}

describe('straightRun: 다음 꺾임까지 실제 직진 거리(경로 폴리라인)', () => {
  it('곧은 길 10+15 m 뒤 왼쪽(북→서) 꺾임', () => {
    const run = straightRun(walk('N10', 'N15', 'W8'), 0)!;
    expect(run.distanceM).toBeCloseTo(25, 0);
    expect(run.turnDeg!).toBeLessThan(-STRAIGHT_TOL_DEG);
  });
  it('오른쪽 꺾임은 양수, 꺾임 없이 끝나면 null', () => {
    expect(straightRun(walk('N12', 'E5'), 0)!.turnDeg!).toBeGreaterThan(STRAIGHT_TOL_DEG);
    const end = straightRun(walk('N10', 'N10'), 0)!;
    expect(end.turnDeg).toBeNull();
    expect(end.distanceM).toBeCloseTo(20, 0);
  });
  it('중간 지점에서 시작하면 거기서부터 잰다', () => {
    const run = straightRun(walk('E30', 'N6', 'N6', 'E4'), 1)!;
    expect(run.distanceM).toBeCloseTo(12, 0);
    expect(run.turnDeg!).toBeGreaterThan(0);
  });
  it('짧은 흔들림(1 m 미만 옆걸음)은 곧은 길에 넣는다', () => {
    const run = straightRun(walk('N10', 'E0.6', 'N10', 'W6'), 0)!;
    expect(run.distanceM).toBeGreaterThan(20);
    expect(run.turnDeg!).toBeLessThan(0);
  });
  it('같은 자리 점(엘리베이터로 층만 바뀜)에서 멈춘다, 꺾임 없음', () => {
    const line = walk('N8');
    line.push(line[1]!); line.push(walk('N8', 'E10')[2]!);
    expect(straightRun(line, 0)).toEqual({ distanceM: expect.closeTo(8, 0), turnDeg: null });
  });
  it('자리가 없으면 null', () => {
    expect(straightRun(walk('N1'), 5)).toBeNull();
  });
});

describe('turnGuide: 문구와 화살표 모양', () => {
  it('5m 단위 반올림, 5m 미만은 "바로"', () => {
    expect(roundRunM(4.9)).toBe(0);
    expect(roundRunM(5)).toBe(ROUND_M);
    expect(roundRunM(23)).toBe(25);
    expect(roundRunM(61.4)).toBe(60);
  });
  it('꺾임 없이 가면 곧은 화살표 "앞으로 OOm 직진"', () => {
    expect(turnGuide({ distanceM: 61, turnDeg: null }, 3)).toMatchObject({ kind: 'straight', side: null, distanceM: 60, label: '앞으로 60m 직진', sentence: '앞으로 60m 직진하세요.' });
    expect(turnGuide({ distanceM: 2, turnDeg: null }, 0)).toMatchObject({ kind: 'straight', label: '앞으로 직진' });
  });
  it('앞에 꺾임이 있으면 ㄱ자 "OOm 직진 후 왼쪽/오른쪽", 5m 미만이면 "바로 왼쪽"', () => {
    expect(turnGuide({ distanceM: 24, turnDeg: -90 }, 5)).toMatchObject({ kind: 'turn', side: 'left', distanceM: 25, label: '25m 직진 후 왼쪽', sentence: '25m 직진 후 왼쪽으로 가세요.' });
    expect(turnGuide({ distanceM: 12, turnDeg: 70 }, -8)).toMatchObject({ kind: 'turn', side: 'right', label: '10m 직진 후 오른쪽' });
    expect(turnGuide({ distanceM: 3, turnDeg: -90 }, 0)).toMatchObject({ kind: 'turn', side: 'left', distanceM: 0, label: '바로 왼쪽', sentence: '바로 왼쪽으로 가세요.' });
  });
  it(`사진에서 ±${TURN_ARROW_DEG}° 넘게 어긋나면 바로 꺾기(ㄱ자), 그 안이면 직진 거리대로("약간 왼쪽"·"정면"은 없다)`, () => {
    expect(turnGuide({ distanceM: 30, turnDeg: null }, -60)).toMatchObject({ kind: 'turn', side: 'left', label: '바로 왼쪽' });
    expect(turnGuide({ distanceM: 30, turnDeg: null }, -35)).toMatchObject({ kind: 'straight', label: '앞으로 30m 직진' });
    expect(turnGuide(null, null)).toBeNull();
    expect(turnGuide(null, 10)).toMatchObject({ kind: 'straight', label: '앞으로 직진' });
    for (const d of [-90, -46, -20, 0, 20, 46, 90]) {
      const g = turnGuide({ distanceM: 20, turnDeg: null }, d)!;
      expect(g.label).not.toMatch(/정면|약간/);
    }
  });
  it('곧은 화살표의 가로 위치: ±15° 안은 가운데, 그 밖은 0.3~0.7로 묶어 그 방향 쪽으로', () => {
    expect(arrowShift(5, 0.55)).toBe(0.5);
    expect(arrowShift(-30, 0.1)).toBe(0.3);
    expect(arrowShift(30, 0.75)).toBe(0.7);
    expect(arrowShift(null, 0.9)).toBe(0.5);
  });
});

describe('로드뷰 장면에 직진 거리 연결(가상 로드뷰 캠퍼스)', () => {
  it('경로 장면마다 run을 경로선에서 재고, 도착 장면은 꺾임 없음', async () => {
    const { ROADVIEW_DEMO_CAMPUS, ROADVIEW_DEMO_CATALOG, RV } = await import('../src/features/map/roadviewDemo.ts');
    const rt = loadBundledCampus(ROADVIEW_DEMO_CAMPUS);
    const route: CampusRouteView = computeRoute(rt, { from: { kind: 'node', nodeId: RV.gate }, to: { kind: 'node', nodeId: RV.room201 }, mode: 'shortest' }).route!;
    const along = routeAlongPhotos(route, ROADVIEW_DEMO_CATALOG);
    const frames = roadviewFrames(route, along, ROADVIEW_DEMO_CATALOG, placeLookup(rt.graph, []));
    expect(frames.length).toBe(along.length);
    const withRun = frames.filter((f) => f.run);
    expect(withRun.length).toBeGreaterThan(0);
    for (const f of withRun) expect(f.run!.distanceM).toBeGreaterThanOrEqual(0);
    expect(frames.at(-1)!.run?.turnDeg ?? null).toBeNull();
    expect(stepRun(route, { stepIndex: 0, lngLat: null })).toBeNull();
  });
});

describe('화살표 그림(소스)', () => {
  it('흰 둥근 표식(xRatio target)을 그리지 않는다', () => {
    expect(OVERLAY).not.toContain('styles.target');
    expect(OVERLAY).not.toMatch(/target:\s*\{/);
  });
  it('꺾기는 ㄱ자(TurnGlyph, 오른쪽은 좌우 반전), 곧게는 곧은 화살표(돌리지 않는다)', () => {
    expect(OVERLAY).toContain("{g.kind === 'turn' ? <TurnGlyph side={g.side!} /> : <StraightGlyph />}");
    expect(OVERLAY).toContain("side === 'right' && styles.mirror");
    expect(OVERLAY).not.toContain('rotate: `${rotateDeg}deg`');
  });
  it('로드뷰는 경로 직진 거리(frame.run)로 안내 문구를 만든다', () => {
    expect(ROADVIEW).toContain('turnGuide(frame?.run ?? null, shown.deltaDeg ?? shown.arrow.rotateDeg)');
    expect(ROADVIEW).toContain('<ArrowOverlay arrow={shown.arrow} guide={guide} />');
    expect(ROADVIEW).toContain('{arrowSentence(shown.arrow, guide)}');
  });
});
