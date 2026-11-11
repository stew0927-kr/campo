import { describe, expect, it } from 'vitest';
import {
  OBSERVATION_SPLIT_MESSAGE,
  addNode,
  checkInvariants,
  createIdGen,
  edgeCoords,
  lineLength,
  setProps,
  splitEdgeAt,
  type EditState,
  type Position,
} from '../../src/index.ts';
import { ctx, deepFreeze, expectInputUntouched, expectUndoRedo, fixtureState, newIds } from './helpers.ts';

const lerp = (a: Position, b: Position, t: number): Position => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function outdoorLine(vertices: Position[] = []): EditState {
  const node = (id: string, coord: Position) => ({ id, coord, props: { kind: 'node' as const, node_type: 'outdoor' as const, building_id: null, level: null, source: 'x', rev: 1 } });
  return deepFreeze({
    nodes: { a: node('a', [-0.001, 0]), b: node('b', [0.001, 0]) },
    edges: { e: { id: 'e', vertices, props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'a', to: 'b', bidirectional: true, step_free: null, source: 'x', rev: 1 } } },
    buildings: {},
    rooms: {},
  });
}

describe('splitEdgeAt', () => {
  it('splits a corridor at the foot of the point; the longer piece keeps the id and rev+1, the new one is rev 1', async () => {
    const s = await fixtureState();
    const next = splitEdgeAt('e_A_3_hall__A_3_bridge', [127.00065, 37.00052], {}, ctx(11)).apply(s);
    const [newEdge, newNode] = newIds(s, next);
    expect(newNode).toMatch(/^n_A_3_corridor_[0-9a-z]{6}$/);
    expect(newEdge).toMatch(/^e_A_3_[0-9a-z]{6}$/);
    const kept = next.edges['e_A_3_hall__A_3_bridge']!;
    expect(kept.props).toMatchObject({ from: newNode, to: 'n_A_3_bridge', rev: 2 });
    expect(next.edges[newEdge!]!.props).toMatchObject({ from: 'n_A_3_hall', to: newNode, rev: 1, highway: 'corridor', step_free: true });
    // same key order as the original
    expect(Object.keys(next.edges[newEdge!]!.props)).toEqual(Object.keys(s.edges['e_A_3_hall__A_3_bridge']!.props));
    const foot = next.nodes[newNode!]!;
    expect(foot.props).toEqual({ kind: 'node', node_type: 'corridor', building_id: 'bldg_A', level: 3, source: 'field-survey-2026-11', rev: 1 });
    expect(foot.coord[0]).toBeCloseTo(127.00065, 7);
    expect(foot.coord[1]).toBeCloseTo(37.0005, 7);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('equal lengths: the from side keeps the id', () => {
    const next = splitEdgeAt('e', [0, 0.0001], {}, ctx(1)).apply(outdoorLine());
    expect(next.edges['e']!.props).toMatchObject({ from: 'a', rev: 2 });
    const [newEdge, newNode] = newIds(outdoorLine(), next);
    expect(next.edges['e']!.props.to).toBe(newNode);
    expect(next.edges[newEdge!]!.props).toMatchObject({ from: newNode, to: 'b' });
    expect(next.nodes[newNode!]!.coord).toEqual([0, 0]);
  });

  it('uses an existing bend point within 1.0m', () => {
    const s = outdoorLine([[0.0002, 0]]);
    const next = splitEdgeAt('e', [0.000205, 0.000003], {}, ctx(1)).apply(s);
    const [newEdge, newNode] = newIds(s, next);
    expect(next.nodes[newNode!]!.coord).toEqual([0.0002, 0]);
    expect(next.edges['e']!.vertices).toEqual([]);
    expect(next.edges[newEdge!]!.vertices).toEqual([]);
  });

  it('keeps bend points on the right pieces', () => {
    const s = outdoorLine([[-0.0005, 0.0001], [0.0005, 0.0001]]);
    const next = splitEdgeAt('e', [0, 0.0002], {}, ctx(1)).apply(s);
    const [newEdge] = newIds(s, next);
    expect(next.edges['e']!.vertices).toEqual([[-0.0005, 0.0001]]);
    expect(next.edges[newEdge!]!.vertices).toEqual([[0.0005, 0.0001]]);
    const total = lineLength(edgeCoords(s, s.edges['e']!));
    expect(lineLength(edgeCoords(next, next.edges['e']!)) + lineLength(edgeCoords(next, next.edges[newEdge!]!))).toBeCloseTo(total, 6);
  });

  it('is disabled within 1.0m of either end', () => {
    // 1 m is about 0.000009 degrees at the equator
    expect(splitEdgeAt('e', [-0.000995, 0.0003], {}, ctx()).disabled(outdoorLine())).toMatch(/1m 안/);
    expect(splitEdgeAt('e', [0.000995, 0], {}, ctx()).disabled(outdoorLine())).toMatch(/1m 안/);
  });

  it('refuses elevator, bridge, portal and conveying edges with a reason', async () => {
    const s = await fixtureState();
    const at: Position = [127.0005, 37.0005];
    expect(splitEdgeAt('e_A_elevA_L1__A_elevA_L2', at, {}, ctx()).disabled(s)).toMatch(/엘리베이터/);
    expect(splitEdgeAt('e_A_3_bridge__B_2_bridge', at, {}, ctx()).disabled(s)).toMatch(/building_type: "bridge"/);
    expect(splitEdgeAt('e_portal_A_1_main', at, {}, ctx()).disabled(s)).toMatch(/포탈/);
    expect(splitEdgeAt('e_out_0002__out_0003_esc', [127.00025, 37.00055], {}, ctx()).disabled(s)).toMatch(/에스컬레이터·무빙워크/);
    expect(splitEdgeAt('e_nope', at, {}, ctx()).disabled(s)).toMatch(/없습니다/);
  });

  it('steps: only with step_count ≥ 2, split by length, both sides at least 1; the parallel escalator is left alone', async () => {
    const s = await fixtureState();
    const e = s.edges['e_out_0002__out_0003']!;
    const [a, b] = [s.nodes[e.props.from]!.coord, s.nodes[e.props.to]!.coord];
    const next = splitEdgeAt(e.id, lerp(a, b, 0.25), {}, ctx(3)).apply(s);
    const [newEdge, newNode] = newIds(s, next);
    expect(newNode).toMatch(/^n_out_/);
    expect(next.edges[e.id]!.props).toMatchObject({ from: newNode, to: 'n_out_0003', step_count: 18, rev: 2 });
    expect(next.edges[newEdge!]!.props).toMatchObject({ from: 'n_out_0002', to: newNode, step_count: 6, rev: 1 });
    expect(next.edges['e_out_0002__out_0003_esc']).toEqual(s.edges['e_out_0002__out_0003_esc']);

    const two = setProps([e.id], { step_count: 2 }).apply(s);
    const split2 = splitEdgeAt(e.id, lerp(a, b, 0.05 + 0.01), {}, ctx(3));
    expect(split2.disabled(two)).toBe(false);
    const after2 = split2.apply(two);
    const counts = Object.values(after2.edges).filter((x) => x.id === e.id || !(x.id in two.edges)).map((x) => x.props.step_count);
    expect(counts.sort()).toEqual([1, 1]);

    const one = setProps([e.id], { step_count: 1 }).apply(s);
    expect(splitEdgeAt(e.id, lerp(a, b, 0.5), {}, ctx()).disabled(one)).toMatch(/step_count가 2 이상/);
    expect(splitEdgeAt('e_A_1_stair__A_2_stair', [127.0007, 37.000405], {}, ctx()).disabled(s)).toMatch(/step_count가 2 이상/);
  });

  it('refuses an edge whose ends are in different scopes (a stair between levels)', async () => {
    const s = setProps(['e_A_1_stair__A_2_stair'], { step_count: 20 }).apply(await fixtureState());
    expect(splitEdgeAt('e_A_1_stair__A_2_stair', [127.0007, 37.000405], {}, ctx()).disabled(s)).toMatch(/범위/);
  });

  it('nodeId: moves that node onto the foot and inserts it; another scope is refused', async () => {
    const base = await fixtureState();
    const s = addNode({ id: 'n_drag', coord: [127.0008, 37.00058], props: { kind: 'node', node_type: 'door', building_id: 'bldg_A', level: 3, source: 'estimate' } }).apply(base);
    const next = splitEdgeAt('e_A_3_hall__A_3_bridge', [127.0008, 37.00058], { nodeId: 'n_drag' }, ctx(1)).apply(s);
    expect(Object.keys(next.nodes).length).toBe(Object.keys(s.nodes).length);
    expect(next.nodes['n_drag']!.coord[1]).toBeCloseTo(37.0005, 7);
    expect(next.nodes['n_drag']!.props.rev).toBe(2);
    expect(next.edges['e_A_3_hall__A_3_bridge']!.props.to).toBe('n_drag');
    expect(checkInvariants(next)).toEqual([]);
    expect(splitEdgeAt('e_A_3_hall__A_3_bridge', [127.0008, 37.0005], { nodeId: 'n_A_4_hall' }, ctx()).disabled(s)).toMatch(/범위/);
    expect(splitEdgeAt('e_A_3_hall__A_3_bridge', [127.0008, 37.0005], { nodeId: 'n_A_3_hall' }, ctx()).disabled(s)).toMatch(/끝 지점/);
    expect(splitEdgeAt('e_A_3_hall__A_3_bridge', [127.0008, 37.0005], { nodeId: 'n_A_elevA_L3' }, ctx()).disabled(s)).toMatch(/엘리베이터/);
  });

  it('warns that measurements on the edge must be redone', async () => {
    const s = await fixtureState();
    const id = 'e_out_0002__out_0003';
    const action = splitEdgeAt(id, [127.00025, 37.00055], {}, ctx(1, { observationTargets: new Set([`edge:${id}`]) }));
    expect(action.warnings!(s)).toEqual([`구간 "${id}": ${OBSERVATION_SPLIT_MESSAGE}.`]);
    expect(OBSERVATION_SPLIT_MESSAGE).toBe('이 구간의 측정은 나누기 전 길이 기준이라 다시 재야 합니다');
    expect(splitEdgeAt('e_A_3_hall__A_3_bridge', [127.00065, 37.0005], {}, ctx(1, { observationTargets: new Set([`edge:${id}`]) })).warnings!(s)).toEqual([]);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), splitEdgeAt('e_A_3_hall__A_3_bridge', [127.00065, 37.0005], {}, ctx()));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), splitEdgeAt('e_A_3_hall__A_3_bridge', [127.00065, 37.0005], {}, ctx()));
  });

  it('same seed, same ids', async () => {
    const s = await fixtureState();
    const run = () => newIds(s, splitEdgeAt('e_A_3_hall__A_3_bridge', [127.00065, 37.0005], {}, { ids: createIdGen(77) }).apply(s));
    expect(run()).toEqual(run());
  });
});
