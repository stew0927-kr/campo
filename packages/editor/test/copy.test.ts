// 다른 층에 복사 (copy.ts), the right-click menu's property edits (menu.ts) and the shortcut list (ui-state.ts).
import { describe, expect, it } from 'vitest';
import { checkInvariants, type EditState } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { NOT_IN_BUILDING, copyBlocked, copySource, copyTargets, planCopyToFloors } from '../src/model/copy.ts';
import { menuFields, planMenuEdit, selectionSummary } from '../src/model/menu.ts';
import { isError, runPlan } from '../src/model/plan.ts';
import { OPERATION_KEYS, TOOL_KEYS, TOOL_LIST, shortcutSections } from '../src/ui/ui-state.ts';

/** campus-basic A/3: corridor points hall, bridge, north (+ a stair landing, an elevator stop and the edges to them). */
const L3_NODES = ['n_A_3_hall', 'n_A_3_bridge', 'n_A_3_north', 'n_A_3_stair', 'n_A_elevA_L3'];
const L3_EDGES = [
  'e_A_3_hall__A_3_bridge', 'e_A_3_hall__A_3_north', 'e_A_3_hall__A_3_stair', 'e_A_3_hall__A_elevA_L3', 'e_A_3_stair__A_4_stair', 'e_A_elevA_L3__A_elevA_L4',
];
const whole = [...L3_NODES, ...L3_EDGES];

const added = (before: EditState, after: EditState) => ({
  nodes: Object.values(after.nodes).filter((n) => !(n.id in before.nodes)),
  edges: Object.values(after.edges).filter((e) => !(e.id in before.edges)),
});

describe('다른 층에 복사 (planCopyToFloors)', () => {
  it('copies the flat part to another floor: reuses the point at the same place, skips stairs / elevator / their edges, one history entry', () => {
    const s = fixtureSession(3);
    const before = s.history.current();
    const plan = planCopyToFloors(before, s.ctx, whole, [4]);
    if (isError(plan)) throw new Error(plan.error);
    // 4층 already has a corridor point where 3층's hall is (same coordinate): reused. bridge and north are new.
    expect(plan.summary).toMatchObject({ nodesCreated: 2, nodesReused: 1, edgesCreated: 2, edgesExisting: 0, floors: 1 });
    expect(plan.notices![0]).toBe('지점 2개 만듦, 1개 재사용, 구간 2개 만듦.');
    const skipped = Object.fromEntries(plan.summary.skipped.map((k) => [k.label, k.count]));
    expect(skipped).toEqual({
      '계단 구간': 1, '엘리베이터 구간': 1, '계단참': 1, '엘리베이터 정차 지점': 1, '양 끝 지점이 함께 복사되지 않는 구간': 2,
    });
    expect(plan.notices!.join(' ')).toContain('엘리베이터·계단·에스컬레이터·연결통로 도구로 만들어 주세요');

    expect(runPlan(s.history, plan)).toMatchObject({ ok: true });
    const after = s.history.current();
    const made = added(before, after);
    expect(made.nodes).toHaveLength(2);
    expect(made.edges).toHaveLength(2);
    for (const n of made.nodes) {
      expect(n.props.level).toBe(4);
      expect(n.props.building_id).toBe('bldg_A');
      expect(n.props.rev).toBe(1);
      expect(/^n_A_4_corridor_[0-9a-z]{6}$/.test(n.id)).toBe(true);
    }
    // same coordinate and same properties as the source, only the floor differs
    const bridge = made.nodes.find((n) => n.coord[0] === before.nodes['n_A_3_bridge']!.coord[0])!;
    const { level: _l, rev: _r, ...rest } = bridge.props;
    const { level: _l2, rev: _r2, ...src } = before.nodes['n_A_3_bridge']!.props;
    expect(rest).toEqual(src);
    expect(bridge.coord).toEqual(before.nodes['n_A_3_bridge']!.coord);
    // an edge reaches the reused 4층 hall; nothing touches a 3층 point
    const hall4 = 'n_A_4_hall';
    expect(made.edges.filter((e) => e.props.from === hall4 || e.props.to === hall4)).toHaveLength(2);
    for (const e of made.edges) {
      expect(after.nodes[e.props.from]!.props.level).toBe(4);
      expect(after.nodes[e.props.to]!.props.level).toBe(4);
      expect(e.props.rev).toBe(1);
    }
    expect(checkInvariants(after)).toEqual([]);
    // the source floor is untouched
    for (const id of [...L3_NODES, ...L3_EDGES]) expect(after.nodes[id] ?? after.edges[id]).toEqual(before.nodes[id] ?? before.edges[id]);
    // one Ctrl+Z
    expect(s.history.size()).toBe(1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('several floors in one entry; copies of different floors are never joined', () => {
    const s = fixtureSession(4);
    const before = s.history.current();
    const sel = ['n_A_3_hall', 'n_A_3_bridge', 'n_A_3_north', 'e_A_3_hall__A_3_bridge', 'e_A_3_hall__A_3_north'];
    const plan = planCopyToFloors(before, s.ctx, sel, [1, 2, 4]);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.annotation).toBe('3개 층에 복사');
    expect(runPlan(s.history, plan)).toMatchObject({ ok: true });
    const after = s.history.current();
    const made = added(before, after);
    // every floor already has a corridor point where 3층's hall is (reused); the bridge and north points are new on each floor
    expect(plan.summary).toMatchObject({ nodesCreated: 6, nodesReused: 3, edgesCreated: 6, floors: 3 });
    expect(made.nodes).toHaveLength(6);
    for (const e of made.edges) expect(after.nodes[e.props.from]!.props.level).toBe(after.nodes[e.props.to]!.props.level);
    expect(s.history.size()).toBe(1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('copying twice: the points are reused and the edges that exist are not made again', () => {
    const s = fixtureSession(5);
    const sel = ['n_A_3_hall', 'n_A_3_bridge', 'e_A_3_hall__A_3_bridge'];
    const first = planCopyToFloors(s.history.current(), s.ctx, sel, [2]);
    if (isError(first)) throw new Error(first.error);
    runPlan(s.history, first);
    const again = planCopyToFloors(s.history.current(), s.ctx, sel, [2]);
    expect(isError(again) && again.error).toMatch(/이미 모두 있습니다/);
  });

  it('refuses: the floor it came from, a floor not in the building, no floor chosen', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const sel = ['n_A_3_hall', 'n_A_3_bridge'];
    for (const levels of [[3], [9], []]) {
      const r = planCopyToFloors(st, s.ctx, sel, levels);
      expect(isError(r), String(levels)).toBe(true);
    }
    expect(copyTargets(st, 'bldg_A', 3)).toEqual([4, 2, 1]);
  });
});

describe('다른 층에 복사: what is blocked', () => {
  const st = () => fixtureSession().history.current();

  it('outdoor points and edges, nothing selected, buildings', () => {
    const s = st();
    expect(copyBlocked(s, ['n_out_0002'])).toBe(NOT_IN_BUILDING);
    expect(copyBlocked(s, ['n_A_3_hall', 'n_out_0002'])).toBe(NOT_IN_BUILDING);
    const outdoorEdge = Object.values(s.edges).find((e) => e.props.edge_type === 'outdoor')!;
    expect(copyBlocked(s, [outdoorEdge.id])).toBe(NOT_IN_BUILDING);
    expect(copyBlocked(s, [])).toMatch(/먼저 골라/);
    expect(copyBlocked(s, ['bldg_A'])).toMatch(/건물/);
  });

  it('only edges, only elevator / stairs, points of two floors', () => {
    const s = st();
    expect(copyBlocked(s, ['e_A_3_hall__A_3_bridge'])).toMatch(/구간만/);
    expect(copyBlocked(s, ['n_A_elevA_L3', 'n_A_3_stair'])).toMatch(/복사할 수 있는 지점이 없습니다/);
    expect(copyBlocked(s, ['n_A_3_hall', 'n_A_4_hall'])).toMatch(/한 층의 지점과 구간만/);
  });

  it('a building with one floor has nowhere to copy to; a good selection is not blocked', () => {
    const s = st();
    const c = Object.values(s.nodes).find((n) => n.props.building_id !== null && s.buildings['C'] && n.props.building_id === s.buildings['C'].id);
    if (c) expect(copyBlocked(s, [c.id])).toMatch(/다른 층이 없습니다/);
    expect(copyBlocked(s, ['n_A_3_hall', 'n_A_3_bridge', 'e_A_3_hall__A_3_bridge'])).toBe(false);
    const src = copySource(s, whole);
    if ('error' in src) throw new Error(src.error);
    expect(src).toMatchObject({ buildingId: 'bldg_A', level: 3 });
    expect(src.nodes.map((n) => n.id).sort()).toEqual(['n_A_3_bridge', 'n_A_3_hall', 'n_A_3_north']);
  });
});

describe('우클릭 메뉴 속성 편집 (menu.ts)', () => {
  it('a point: kind and name; an edge: step_free; one history entry each', () => {
    const s = fixtureSession(7);
    const st = s.history.current();
    const f = menuFields(st, ['n_A_3_bridge']);
    expect(f.kinds?.map((o) => o.value)).toEqual(['corridor', 'door', 'entrance']);
    expect(f).toMatchObject({ kind: 'corridor', name: true, stepFree: false });
    const kind = planMenuEdit(st, ['n_A_3_bridge'], { kind: 'door' });
    if (isError(kind)) throw new Error(kind.error);
    expect(runPlan(s.history, kind)).toMatchObject({ ok: true });
    expect(s.history.current().nodes['n_A_3_bridge']!.props).toMatchObject({ node_type: 'door', rev: 2 });
    const name = planMenuEdit(s.history.current(), ['n_A_3_bridge', 'n_A_3_north'], { name: '  북쪽 문  ' });
    if (isError(name)) throw new Error(name.error);
    runPlan(s.history, name);
    expect(s.history.current().nodes['n_A_3_north']!.props.name).toBe('북쪽 문');
    expect(s.history.size()).toBe(2);

    const edge = menuFields(st, ['e_A_3_hall__A_3_bridge']);
    expect(edge).toMatchObject({ stepFree: true, name: false, stepFreeValue: String(st.edges['e_A_3_hall__A_3_bridge']!.props.step_free) });
    const sf = planMenuEdit(s.history.current(), ['e_A_3_hall__A_3_bridge', 'e_A_3_hall__A_3_north'], { step_free: null });
    if (isError(sf)) throw new Error(sf.error);
    runPlan(s.history, sf);
    expect(s.history.current().edges['e_A_3_hall__A_3_north']!.props.step_free).toBeNull();
    expect(s.history.size()).toBe(3);
  });

  it('does not offer what does not fit: mixed selections, stops, stairs, outdoor kinds on indoor points', () => {
    const st = fixtureSession().history.current();
    expect(menuFields(st, ['n_A_3_hall', 'e_A_3_hall__A_3_bridge'])).toMatchObject({ kinds: null, name: false, stepFree: false });
    expect(menuFields(st, ['n_A_elevA_L3']).kinds).toBeNull();
    expect(menuFields(st, ['e_A_3_stair__A_4_stair']).kinds).toBeNull();
    expect(menuFields(st, ['n_out_0002']).kinds?.map((o) => o.value)).toEqual(['outdoor', 'poi']);
    const s = fixtureSession();
    expect(isError(planMenuEdit(s.history.current(), ['n_A_3_hall'], { kind: 'poi' }))).toBe(true);
    expect(isError(planMenuEdit(s.history.current(), ['n_A_3_hall'], { step_free: true }))).toBe(true);
    expect(selectionSummary(st, whole)).toBe('지점 5개, 구간 6개');
  });
});

describe('도구 단축키 목록 (ui-state.ts)', () => {
  it('the tool rows are exactly TOOL_LIST with the keys of TOOL_KEYS ("-" without a key)', () => {
    const tools = shortcutSections().find((s) => s.title === '도구')!.rows;
    expect(tools).toEqual(TOOL_LIST.map((t) => ({ keys: TOOL_KEYS[t.id] ?? '-', label: t.label })));
    expect(tools.find((r) => r.label === '문 연속 찍기')!.keys).toBe(TOOL_KEYS.door);
    const ops = shortcutSections().find((s) => s.title === '작업')!.rows.map((r) => r.keys).join(' | ');
    for (const k of Object.values(OPERATION_KEYS)) expect(ops).toContain(k);
    expect(ops).toContain('Esc');
    expect(ops).toContain('[ / ]');
  });
});
