// 지도 화면의 "경로를 따라가는 사진"(routeAlongPhotos): 경로가 실제로 지나는 사진 지점만, 진행 방위에 가장 가까운 사진,
// ±90° 밖(반대·크게 어긋남)·방향 없는 사진은 제외(배지·U턴 없음), 양방향이면 다른 사진.
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CampusRuntime } from '../src/campus/types.ts';
import type { CampusRouteView, PhotoRow } from '../src/contracts.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { photoCatalogFromRows } from '../src/photos/catalog.ts';
import { ALONG_MAX_DEG, lineBearings, nodeLineIndex, pickAlong, routeAlongPhotos } from '../src/photos/routeAlongPhotos.ts';
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

  it('진행 방위와 ±90°를 넘게 어긋나거나 반대인 사진, 방향 없는 사진은 후보에서 뺀다(배지·U턴 없음)', () => {
    expect(ALONG_MAX_DEG).toBe(90);
    expect(pickAlong(photoCatalogFromRows([row('back', 'n', 180)]).byNodeId('n'), 0, null)).toBeNull();
    expect(pickAlong(photoCatalogFromRows([row('side', 'n', 100)]).byNodeId('n'), 0, null)).toBeNull();
    expect(pickAlong(photoCatalogFromRows([row('x', 'n', null)]).byNodeId('n'), 0, null)).toBeNull();
    expect(pickAlong([], 0, null)).toBeNull();
    // 진행 방위를 모르면 고르지 않는다.
    expect(pickAlong(photoCatalogFromRows([row('a', 'n', 0)]).byNodeId('n'), null, null)).toBeNull();
    // 반대 사진과 80° 사진이 같이 있으면 80° 쪽(±90° 안)을 고르고, 화살표는 U턴이 아니다. 배지도 없다.
    const ok = pickAlong(photoCatalogFromRows([row('back', 'n', 180), row('ok', 'n', 80)]).byNodeId('n'), 0, null)!;
    expect(ok).toMatchObject({ pick: 'approximate', photo: { photoId: 'ok' }, badge: null });
    expect(ok.arrow!.mode).not.toBe('behind');
    // 들어오는 방향 사진(approach)도 나가는 방향과 90°를 넘으면 쓰지 않는다: 반대로 돌아서 보는 사진이 끼지 않는다.
    expect(pickAlong(photoCatalogFromRows([row('in', 'n', 180)]).byNodeId('n'), 0, 180)).toBeNull();
    // 계약 훅도 그대로: ±90° 밖이면 none. 지도 목록은 그 지점을 사진 없음으로 두되 자리는 남긴다(단계 시작).
    const first = fixture.steps[0]!;
    const catalog = photoCatalogFromRows([row('behind', GATE, first.bearing_deg! + 180)]);
    expect(routeStepPhotos(fixture, catalog)[0]!.pick).toBe('none');
    expect(routeAlongPhotos(fixture, catalog)[0]).toMatchObject({ pick: 'none', photo: null, arrow: null, badge: null });
  });

  it('이 목록에서는 배지와 U턴(behind) 화살표가 나오지 않는다(로드뷰 가상 캠퍼스 전체 경로)', async () => {
    const { ROADVIEW_DEMO_CAMPUS, ROADVIEW_DEMO_CATALOG, RV } = await import('../src/features/map/roadviewDemo.ts');
    const rt = loadBundledCampus(ROADVIEW_DEMO_CAMPUS);
    for (const [a, b] of [[RV.gate, RV.room201], [RV.room201, RV.gate], [RV.gate, RV.plaza], [RV.plaza, RV.gate]] as const) {
      for (const s of routeAlongPhotos(routeOf(rt, a, b), ROADVIEW_DEMO_CATALOG)) {
        expect(s.badge).toBeNull();
        if (s.arrow) expect(s.arrow.mode).not.toBe('behind');
        if (s.deltaDeg !== null) expect(Math.abs(s.deltaDeg)).toBeLessThanOrEqual(ALONG_MAX_DEG);
      }
    }
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

describe('routeAlongPhotos: 경로 밖 근처 사진 제외', () => {
  it('경로가 지나지 않는 지점의 사진은 같은 층 12 m 안이어도 넣지 않는다 — 경로 위 node_id 사진만', async () => {
    const walk = (await fourthFloorWalk())!;
    const rt = loadBundledCampus(await bundleOf(REAL_DIR, 'hanyang-seoul'));
    const base = rt.graph.nodes.get(walk.nodeId)!;
    const side = ((walk.outDeg + 90) * Math.PI) / 180;
    const [lng, lat] = base.geometry.coordinates as [number, number];
    const off = (m: number): [number, number] => [lng + (Math.sin(side) * m) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(side) * m) / 110_540];
    const fake = (id: string, at: [number, number]) => ({ ...base, id, geometry: { type: 'Point' as const, coordinates: at } });
    const nodes = new Map(rt.graph.nodes);
    nodes.set('near12', fake('near12', off(12)) as typeof base);
    expect(nodes.size).toBe(rt.graph.nodes.size + 1);
    // 근처(12 m) 지점 사진 + 경로 위 지점 사진.
    const catalog = photoCatalogFromRows([row('pNear', 'near12', walk.outDeg), row('pOn', walk.nodeId, walk.outDeg)]);
    const there = routeAlongPhotos(walk.there, catalog);
    const hit = there.filter((s) => s.photo !== null);
    expect(hit.map((s) => s.nodeId)).toEqual([walk.nodeId]);
    expect(hit.every((s) => walk.there.nodeIds.includes(s.nodeId))).toBe(true);
    // 지도 핀도 경로 위 지점 사진만.
    const groups = stepMarkerGroups(there, walk.there.steps.length);
    expect(groups.map((g) => g.nodeId)).toEqual([walk.nodeId]);
  });

  it('왕복(같은 구간 두 번): 지날 때마다 하나씩, 방향에 맞는 사진', async () => {
    const walk = (await fourthFloorWalk())!;
    const catalog = photoCatalogFromRows([row('fwd', walk.nodeId, walk.outDeg), row('rev', walk.nodeId, (walk.outDeg + 180) % 360)]);
    const { combineRoundTrip } = await import('../src/photos/roadviewModel.ts');
    const trip = combineRoundTrip(walk.there, walk.back)!;
    expect(trip).not.toBeNull();
    const hits = routeAlongPhotos(trip.route, catalog).filter((s) => s.nodeId === walk.nodeId && s.photo !== null);
    expect(hits.map((s) => s.photo!.photoId)).toEqual(['fwd', 'rev']);
  });
});

describe('routeAlongPhotos: 순서', () => {
  it('경로 순서(단계 번호가 줄지 않는다)를 지킨다(로드뷰 가상 캠퍼스)', async () => {
    const { ROADVIEW_DEMO_CAMPUS, ROADVIEW_DEMO_CATALOG, RV } = await import('../src/features/map/roadviewDemo.ts');
    const rt = loadBundledCampus(ROADVIEW_DEMO_CAMPUS);
    for (const to of [RV.room201, RV.plaza]) {
      const along = routeAlongPhotos(routeOf(rt, RV.gate, to), ROADVIEW_DEMO_CATALOG);
      const steps = along.map((s) => s.stepIndex);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      expect(along.at(-1)!.nodeId).toBe(to);
    }
  });
});
