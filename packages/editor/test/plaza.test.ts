// 평지 tool (model/plaza.ts): a drawn ring becomes a plaza or a hole, edits, the map display, the 상세 정보 panel,
// the shortcut, the selection priority and the solver engine the dev server picks.
import { describe, expect, it } from 'vitest';
import { createHistory, createIdGen, emptyState, localFrame, signedAreaM2, type EditState, type Position } from '@campo/core';
import { campusHasPlaza } from '../server/elevation-api.ts';
import { toDisplayGeoJSON } from '../src/map/layers.ts';
import { classify, planDelete } from '../src/model/ops.ts';
import { runPlan, isError, type Plan } from '../src/model/plan.ts';
import {
  PLAZA_OVERLAPS_BUILDING_NOTICE,
  PLAZA_SURFACE_LABELS,
  formatArea,
  parsePlazaHeight,
  planDeletePlaza,
  planPlaza,
  planPlazaEdit,
  planRemovePlazaHole,
  plazaAt,
  plazaDraftMessage,
  plazaFacts,
} from '../src/model/plaza.ts';
import { selectionSummary } from '../src/model/menu.ts';
import { propsOf } from '../src/model/session.ts';
import { OPERATIONS, TOOLS, parseKey, shortcutSections, toolDef } from '../src/ui/registry.ts';

const F = localFrame([127, 37]);
const P = (x: number, y: number): Position => F.toPos(x, y);
/** An open ring the way Terra Draw hands it over (closed by the plan). */
const rect = (x0: number, y0: number, x1: number, y1: number): Position[] => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)];
const OFFSET = { outdoor: { kind: 'outdoor' as const } };
const ctx = () => ({ ids: createIdGen(5) });

function run(history: ReturnType<typeof createHistory>, plan: Plan | { error: string }) {
  if (isError(plan)) throw new Error(plan.error);
  const r = runPlan(history, plan);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

function withPlaza(): { history: ReturnType<typeof createHistory>; id: string } {
  const history = createHistory(emptyState());
  const made = planPlaza(history.current(), ctx(), rect(0, 0, 40, 30));
  run(history, made.plan);
  return { history, id: made.plazaId! };
}

describe('planPlaza', () => {
  it('a ring apart from every plaza is a new plaza, selected by id; one Ctrl+Z takes it away', () => {
    const history = createHistory(emptyState());
    const made = planPlaza(history.current(), ctx(), rect(0, 0, 40, 30));
    expect(made.created).toBe(true);
    expect(made.plazaId).toMatch(/^plaza_[0-9a-z]{6}$/);
    run(history, made.plan);
    const p = history.current().plazas[made.plazaId!]!;
    expect(p.props).toEqual({ kind: 'plaza', source: 'editor', rev: 1 });
    expect(signedAreaM2(p.polygon[0]!)).toBeGreaterThan(0);
    expect(history.undo()).toEqual(emptyState());
  });

  it('a ring inside a plaza is a hole of it, clockwise; one Ctrl+Z closes it again', () => {
    const { history, id } = withPlaza();
    const before = history.current();
    const hole = planPlaza(before, ctx(), rect(10, 10, 20, 20));
    expect(hole).toMatchObject({ plazaId: id, created: false });
    run(history, hole.plan);
    const p = history.current().plazas[id]!;
    expect(p.polygon).toHaveLength(2);
    expect(signedAreaM2(p.polygon[1]!)).toBeLessThan(0);
    expect(p.props.rev).toBe(1); // History counts rev from its start, where the plaza did not exist yet
    expect(history.undo()).toEqual(before);
  });

  it('a ring inside a hole is a new plaza (an island)', () => {
    const { history, id } = withPlaza();
    run(history, planPlaza(history.current(), ctx(), rect(10, 10, 20, 20)).plan);
    const island = planPlaza(history.current(), ctx(), rect(12, 12, 18, 18));
    expect(island.created).toBe(true);
    run(history, island.plan);
    expect(Object.keys(history.current().plazas)).toHaveLength(2);
    expect(island.plazaId).not.toBe(id);
  });

  it('crossing a ring, around a hole or a whole plaza, or too close: refused with the reason', () => {
    const { history } = withPlaza();
    run(history, planPlaza(history.current(), ctx(), rect(10, 10, 20, 20)).plan);
    const s = history.current();
    expect(planPlaza(s, ctx(), rect(30, 5, 50, 10)).plan).toEqual({ error: '다른 평지의 테두리를 가로지릅니다.' });
    expect((planPlaza(s, ctx(), rect(5, 5, 25, 25)).plan as { error: string }).error).toMatch(/먼저 그 구멍을 지워/);
    expect((planPlaza(s, ctx(), rect(-5, -5, 50, 40)).plan as { error: string }).error).toMatch(/바깥 평지를 먼저 그리고/);
    expect((planPlaza(s, ctx(), rect(0.05, 2, 5, 5)).plan as { error: string }).error).toMatch(/0\.1 m/);
    expect(planPlaza(s, ctx(), [P(60, 0), P(61, 0)]).plan).toMatchObject({ error: expect.any(String) });
  });

  it('a new plaza over a building goes in with a notice', () => {
    const history = createHistory(emptyState());
    const s: EditState = {
      ...history.current(),
      buildings: { A: { id: 'bldg_A', polygon: [rect(5, 5, 15, 15)], props: { kind: 'building', name: 'A동', code: 'A', levels: [1], ground_levels: [1], source: 't', rev: 1 } } },
    };
    const made = planPlaza(s, ctx(), rect(0, 0, 40, 30));
    expect(isError(made.plan)).toBe(false);
    expect((made.plan as Plan).notices).toEqual([PLAZA_OVERLAPS_BUILDING_NOTICE]);
  });

  it('the status line on the first corner', () => {
    const { history } = withPlaza();
    expect(plazaDraftMessage(history.current(), P(5, 5))).toMatch(/^평지 'plaza_[0-9a-z]+' 안쪽에서 시작했습니다\. 구멍으로 뚫립니다\.$/);
    expect(plazaDraftMessage(history.current(), P(100, 5))).toBe('새 평지를 그립니다.');
  });
});

describe('plaza edits', () => {
  it('name, surface and fixed height, each one history entry; empty height is 자동', () => {
    const { history, id } = withPlaza();
    run(history, planPlazaEdit(history.current(), id, { name: ' 분수 광장 ' }));
    run(history, planPlazaEdit(history.current(), id, { surface: 'grass' }));
    run(history, planPlazaEdit(history.current(), id, { height: '42.5 m' }));
    expect(history.current().plazas[id]!.props).toMatchObject({ name: '분수 광장', surface: 'grass', fixed_height_m: 42.5 });
    run(history, planPlazaEdit(history.current(), id, { height: '' }));
    expect(history.current().plazas[id]!.props.fixed_height_m).toBeUndefined();
    expect(planPlazaEdit(history.current(), id, { name: '분수 광장' })).toEqual({ error: '바뀐 내용이 없습니다.' });
    expect(planPlazaEdit(history.current(), id, { height: 'abc' })).toMatchObject({ error: expect.stringMatching(/숫자/) });
    expect(planPlazaEdit(history.current(), id, { height: '4000' })).toMatchObject({ error: expect.stringMatching(/-100~3000/) });
    expect(parsePlazaHeight(' ')).toBeNull();
  });

  it('remove a hole, delete the plaza (also through the selection delete)', () => {
    const { history, id } = withPlaza();
    run(history, planPlaza(history.current(), ctx(), rect(10, 10, 20, 20)).plan);
    run(history, planRemovePlazaHole(history.current(), id, 0));
    expect(history.current().plazas[id]!.polygon).toHaveLength(1);
    expect(classify(history.current(), [id]).plazas).toEqual([id]);
    expect(selectionSummary(history.current(), [id])).toBe('평지 1개');
    const del = planDelete(history.current(), ctx(), [id], false);
    expect(del).toMatchObject({ annotation: '평지 1개 삭제' });
    const s = history.current();
    run(history, planDeletePlaza(s, ctx(), id));
    expect(history.current().plazas).toEqual({});
    expect(history.undo()).toEqual(s);
  });

  it('propsOf reads a plaza', () => {
    const { history, id } = withPlaza();
    expect(propsOf(history.current(), id)?.props.kind).toBe('plaza');
  });
});

describe('map, selection and panel', () => {
  it('toDisplayGeoJSON keeps the hole rings; faded inside a building floor', () => {
    const { history, id } = withPlaza();
    run(history, planPlaza(history.current(), ctx(), rect(10, 10, 20, 20)).plan);
    const fc = toDisplayGeoJSON(history.current(), OFFSET.outdoor, new Set([id]));
    const f = fc.features.find((x) => x.properties!['kind'] === 'plaza')!;
    expect(f.geometry.type).toBe('Polygon');
    expect((f.geometry as unknown as { coordinates: Position[][] }).coordinates.length).toBe(2);
    expect(f.properties).toMatchObject({ id, emphasis: 1, highlight: true });
    const indoor = toDisplayGeoJSON(history.current(), { kind: 'building', buildingId: 'bldg_x', level: 1 });
    expect(indoor.features.find((x) => x.properties!['kind'] === 'plaza')!.properties!['emphasis']).toBe(0);
  });

  it('only the solid area picks the plaza (the hole does not)', () => {
    const { history, id } = withPlaza();
    run(history, planPlaza(history.current(), ctx(), rect(10, 10, 20, 20)).plan);
    expect(plazaAt(history.current(), P(5, 5))?.id).toBe(id);
    expect(plazaAt(history.current(), P(15, 15))).toBeUndefined();
    expect(plazaAt(history.current(), P(50, 5))).toBeUndefined();
  });

  it('the 평지 tool: G, outdoors, after 건물 외곽선 그리기, and no key used twice', () => {
    const def = toolDef('plaza');
    expect(def).toMatchObject({ label: '평지', key: 'G', scope: 'outdoor', group: 'draw' });
    const ids = TOOLS.map((t) => t.id);
    expect(ids.indexOf('plaza')).toBe(ids.indexOf('building') + 1);
    const keys = [...TOOLS, ...OPERATIONS].flatMap((t) => (t.key ? [t.key] : [])).map((k) => JSON.stringify(parseKey(k)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(shortcutSections().flatMap((s) => s.rows).some((r) => r.keys === 'G' && r.label.includes('평지'))).toBe(true);
  });

  it('상세 정보 shows name, surface, height (자동), area, perimeter and the holes', () => {
    const { history, id } = withPlaza();
    run(history, planPlaza(history.current(), ctx(), rect(10, 10, 20, 20)).plan);
    run(history, planPlazaEdit(history.current(), id, { surface: 'paved' }));
    const plaza = history.current().plazas[id]!;
    const facts = plazaFacts(plaza);
    expect(facts.areaM2).toBeCloseTo(1200 - 100, 0);
    expect(facts.perimeterM).toBeCloseTo(140 + 40, 0);
    expect(facts.holes).toEqual([{ index: 0, areaM2: expect.closeTo(100, 0) }]);
    // The panel (ui/PlazaPanel.tsx) prints these: 면적, 둘레, 구멍 n개 and each hole's area, and the surface names.
    expect(formatArea(1100)).toBe('1,100 ㎡');
    expect(formatArea(facts.areaM2)).toMatch(/^1,100(\.\d)? ㎡$/);
    expect(Object.values(PLAZA_SURFACE_LABELS)).toEqual(['포장', '자갈', '잔디', '데크', '기타']);
    expect(PLAZA_SURFACE_LABELS[plaza.props.surface!]).toBe('포장');
  });
});

describe('dev server', () => {
  it('runs height solver v2 when the campus has a plaza', () => {
    expect(campusHasPlaza({ 'outdoor.geojson': '{"type":"FeatureCollection","features":[{"properties":{"kind":"plaza"}}]}' })).toBe(true);
    expect(campusHasPlaza({ 'outdoor.geojson': '{"type":"FeatureCollection","features":[{"properties":{"kind":"node","name":"plaza"}}]}' })).toBe(false);
    expect(campusHasPlaza({ 'outdoor.geojson': 'not json plaza', 'campus.json': '{"kind":"plaza"}' })).toBe(false);
  });
});
