// 지도 화면의 "경로를 따라가는 사진"(routeAlongPhotos): 경로가 지나는 모든 사진 지점, 진행 방위에 가장 가까운 사진,
// 방위가 안 맞아도 배지로 보이기, 양방향이면 다른 사진.
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CampusRuntime } from '../src/campus/types.ts';
import type { CampusRouteView, PhotoRow } from '../src/contracts.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { photoCatalogFromRows } from '../src/photos/catalog.ts';
import { APPROXIMATE_BADGE } from '../src/photos/photoText.ts';
import { lineBearings, NEAR_PHOTO_M, nodeLineIndex, pickAlong, routeAlongPhotos, segmentDistance } from '../src/photos/routeAlongPhotos.ts';
import { routeStepPhotos } from '../src/photos/routePhotos.ts';
import { stepMarkerGroups } from '../src/photos/roadviewModel.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { bundleOf, fixtureRuntime } from './helpers.ts';

const GATE = 'n_out_0001';
const ROOM_408 = 'n_A_4_408door';
const row = (id: string, node_id: string, heading_deg: number | null): PhotoRow => ({ id, node_id, heading_deg, thumb_url: `https://cdn.example/t/${id}.webp`, full_url: `https://cdn.example/v/${id}.webp` });
const routeOf = (rt: CampusRuntime, from: string, to: string): CampusRouteView => computeRoute(rt, { from: { kind: 'node', nodeId: from }, to: { kind: 'node', nodeId: to }, mode: 'shortest' }).route!;

/** 경로 안쪽(단계 시작·끝이 아닌) 지점 중 앞뒤로 걷는 방향이 있는 첫 지점. */
function midNode(route: CampusRouteView): { nodeId: string; outDeg: number } | null {
  const ends = new Set(route.steps.flatMap((s) => [s.fromNodeId, s.toNodeId]));
  const lineAt = nodeLineIndex(route);
  const line = route.polyline.map((p) => [p.lng, p.lat] as [number, number]);
  for (let k = 1; k < route.nodeIds.length - 1; k++) {
    const id = route.nodeIds[k]!;
    if (ends.has(id)) continue;
    const b = lineBearings(line, lineAt[k]!);
    // 곧은 복도 중간(꺾이지 않는 지점): 반대로 지나면 진행 방위가 거의 180° 달라진다.
    if (b.outDeg !== null && b.inDeg !== null && Math.abs(((b.outDeg - b.inDeg + 540) % 360) - 180) < 20) return { nodeId: id, outDeg: b.outDeg };
  }
  return null;
}

const REAL_DIR = fileURLToPath(new URL('../../../data/campuses/hanyang-seoul', import.meta.url));
/** 제1공학관 4층 문 두 곳 사이, 복도 중간 지점을 양방향으로 지나는 경로(실제 캠퍼스 데이터). */
async function fourthFloorWalk() {
  const rt = loadBundledCampus(await bundleOf(REAL_DIR, 'hanyang-seoul'));
  const building = [...rt.graph.buildings.values()].find((b) => b.properties.name === '제1공학관')!;
  const doors = [...rt.graph.nodes.values()].filter((n) => n.properties.building_id === building.id && n.properties.level === 4 && n.properties.node_type === 'door');
  for (let i = 0; i < doors.length; i++) {
    for (let j = doors.length - 1; j > i; j--) {
      const there = routeOf(rt, doors[i]!.id, doors[j]!.id);
      const back = routeOf(rt, doors[j]!.id, doors[i]!.id);
      const mid = there && back ? midNode(there) : null;
      if (mid && back.nodeIds.includes(mid.nodeId)) return { there, back, ...mid };
    }
  }
  return null;
}

describe('routeAlongPhotos (지도 화면)', () => {
  let walk: NonNullable<Awaited<ReturnType<typeof fourthFloorWalk>>>;
  let fixture: CampusRouteView;
  beforeAll(async () => {
    walk = (await fourthFloorWalk())!;
    fixture = routeOf(await fixtureRuntime(), GATE, ROOM_408);
  });

  it('경로가 없거나 카탈로그가 비면 []', () => {
    expect(walk).toBeTruthy();
    expect(routeAlongPhotos(null, photoCatalogFromRows([row('p', GATE, 0)]))).toEqual([]);
    expect(routeAlongPhotos(fixture, null)).toEqual([]);
  });

  it('단계 시작 지점 사이를 지나는 사진 지점도 후보로 넣는다(계약 훅은 단계 시작만 본다)', () => {
    const { there, nodeId, outDeg } = walk;
    const catalog = photoCatalogFromRows([row('mid', nodeId, outDeg)]);
    expect(routeStepPhotos(there, catalog).some((s) => s.photo !== null)).toBe(false);
    const along = routeAlongPhotos(there, catalog);
    const hit = along.find((s) => s.nodeId === nodeId)!;
    expect(hit).toMatchObject({ pick: 'ahead', photo: { photoId: 'mid' }, badge: null });
    expect(hit.lngLat).not.toBeNull();
    // 단계 시작은 사진이 없어도 자리를 지키고(경로 순서), 사진 없는 중간 지점은 넣지 않는다.
    expect(along.filter((s) => s.photo === null)).toHaveLength(there.steps.length + 1);
    expect(along.map((s) => s.stepIndex)).toEqual([...along.map((s) => s.stepIndex)].sort((a, b) => a - b));
    // 지도 사진 핀도 같은 목록에서 나온다.
    expect(stepMarkerGroups(along, there.steps.length).map((g) => g.nodeId)).toEqual([nodeId]);
  });

  it('같은 지점을 반대 방향으로 지나면 진행 방위가 180° 달라 다른 사진을 고른다', () => {
    const { there, back, nodeId, outDeg } = walk;
    const catalog = photoCatalogFromRows([row('fwd', nodeId, outDeg), row('rev', nodeId, (outDeg + 180) % 360)]);
    const a = routeAlongPhotos(there, catalog).find((s) => s.nodeId === nodeId)!;
    const b = routeAlongPhotos(back, catalog).find((s) => s.nodeId === nodeId)!;
    expect(a.photo?.photoId).toBe('fwd');
    expect(b.photo?.photoId).toBe('rev');
    expect(Math.abs(((a.targetDeg! - b.targetDeg! + 540) % 360) - 180)).toBeGreaterThan(140);
  });

  it('방위가 ±90° 밖이어도 사진을 숨기지 않고 배지와 함께 보인다(방향 없는 사진도)', () => {
    const back180 = pickAlong(photoCatalogFromRows([row('back', 'n', 180)]).byNodeId('n'), 0, null)!;
    expect(back180).toMatchObject({ pick: 'approximate', photo: { photoId: 'back' }, badge: APPROXIMATE_BADGE });
    expect(Math.abs(back180.deltaDeg!)).toBe(180);
    const noHeading = pickAlong(photoCatalogFromRows([row('x', 'n', null)]).byNodeId('n'), 0, null)!;
    expect(noHeading).toMatchObject({ pick: 'approximate', photo: { photoId: 'x' }, deltaDeg: null, arrow: null, badge: APPROXIMATE_BADGE });
    expect(pickAlong([], 0, null)).toBeNull();
    // 계약 훅은 그대로: ±90° 밖이면 none.
    const first = fixture.steps[0]!;
    const catalog = photoCatalogFromRows([row('behind', GATE, first.bearing_deg! + 180)]);
    expect(routeStepPhotos(fixture, catalog)[0]!.pick).toBe('none');
    expect(routeAlongPhotos(fixture, catalog)[0]).toMatchObject({ pick: 'approximate', photo: { photoId: 'behind' }, badge: APPROXIMATE_BADGE });
  });
});

describe('routeAlongPhotos on the real campus (제1공학관 4층 복도, 양방향 사진)', () => {
  it('복도 중간 지점의 128°/302° 사진이 진행 방향에 따라 바뀐다', async () => {
    const found = await fourthFloorWalk();
    expect(found).not.toBeNull();
    const { there, back, nodeId, outDeg } = found!;
    // 실제 사진처럼 128°와 302°(거의 반대) 두 장. 가는 방향에 가까운 쪽이 앞 사진이 된다.
    const near = (h: number) => Math.abs(((h - outDeg + 540) % 360) - 180);
    const [fwd, rev] = near(128) < near(302) ? ['p128', 'p302'] : ['p302', 'p128'];
    const catalog = photoCatalogFromRows([row('p128', nodeId, 128), row('p302', nodeId, 302)]);
    expect(routeAlongPhotos(there, catalog).find((s) => s.nodeId === nodeId)?.photo?.photoId).toBe(fwd);
    expect(routeAlongPhotos(back, catalog).find((s) => s.nodeId === nodeId)?.photo?.photoId).toBe(rev);
  });
});

describe('routeAlongPhotos: 경로 근처(오프셋) 사진', () => {
  it(`같은 층 경로선에서 ${NEAR_PHOTO_M}m 안 사진은 그 단계 사진, 25m 밖·다른 층은 제외, 핀은 실제 촬영 지점`, async () => {
    const walk = (await fourthFloorWalk())!;
    const rt = loadBundledCampus(await bundleOf(REAL_DIR, 'hanyang-seoul'));
    const base = rt.graph.nodes.get(walk.nodeId)!;
    // 복도 진행 방향에 직각으로 12 m / 25 m 떨어진 가짜 사진 지점(같은 4층), 12 m 떨어진 5층 지점.
    const side = ((walk.outDeg + 90) * Math.PI) / 180;
    const [lng, lat] = base.geometry.coordinates as [number, number];
    const off = (m: number): [number, number] => [lng + (Math.sin(side) * m) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(side) * m) / 110_540];
    const fake = (id: string, at: [number, number], level: number) => ({ ...base, id, properties: { ...base.properties, level }, geometry: { type: 'Point' as const, coordinates: at } });
    const nodes = new Map(rt.graph.nodes);
    for (const n of [fake('near12', off(12), 4), fake('far25', off(25), 4), fake('up12', off(12), 5)]) nodes.set(n.id, n as typeof base);
    const graph = { ...rt.graph, nodes };
    const catalog = photoCatalogFromRows([row('pNear', 'near12', walk.outDeg), row('pNearBack', 'near12', (walk.outDeg + 180) % 360), row('pFar', 'far25', walk.outDeg), row('pUp', 'up12', walk.outDeg)]);
    const there = routeAlongPhotos(walk.there, catalog, graph);
    const hit = there.filter((s) => s.photo !== null);
    expect(hit.map((s) => s.nodeId)).toEqual(['near12']);
    expect(hit[0]!.lngLat).toEqual(off(12));
    // 그 구간의 진행 방위에 가까운 쪽 사진.
    const facing = (h: number) => Math.abs(((h - hit[0]!.targetDeg! + 540) % 360) - 180);
    expect(facing(hit[0]!.photo!.heading_deg!)).toBeLessThanOrEqual(90);
    expect(hit[0]!.stepIndex).toBeGreaterThanOrEqual(0);
    expect(hit[0]!.stepIndex).toBeLessThan(walk.there.steps.length);
    // 지도 핀은 그 촬영 지점에, 그 단계 항목으로 연결된다.
    const groups = stepMarkerGroups(there, walk.there.steps.length);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lngLat).toEqual(off(12));
    expect(there[groups[0]!.entries[0]!.index]!.nodeId).toBe('near12');
    // 반대로 걸으면 반대쪽 사진.
    const backHit = routeAlongPhotos(walk.back, catalog, graph).find((s) => s.nodeId === 'near12')!;
    expect(backHit.photo?.photoId).not.toBe(hit[0]!.photo?.photoId);
    // 그래프를 넘기지 않으면 근처 사진은 보지 않는다.
    expect(routeAlongPhotos(walk.there, catalog).some((s) => s.photo !== null)).toBe(false);
    expect(segmentDistance([0, 0.0001], [-0.001, 0], [0.001, 0]).m).toBeCloseTo(11.05, 1);
  });
});

describe('routeAlongPhotos: 순서', () => {
  it('근처 사진까지 넣어도 경로 순서(단계 번호가 줄지 않는다)를 지킨다(로드뷰 가상 캠퍼스)', async () => {
    const { ROADVIEW_DEMO_CAMPUS, ROADVIEW_DEMO_CATALOG, RV } = await import('../src/features/map/roadviewDemo.ts');
    const rt = loadBundledCampus(ROADVIEW_DEMO_CAMPUS);
    for (const to of [RV.room201, RV.plaza]) {
      const along = routeAlongPhotos(routeOf(rt, RV.gate, to), ROADVIEW_DEMO_CATALOG, rt.graph);
      const steps = along.map((s) => s.stepIndex);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      expect(along.at(-1)!.nodeId).toBe(to);
    }
  });
});
