import { produceWithPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { moveNode, setEdgeElevation, setProps, type Action, type EditState } from '../../src/index.ts';
import {
  PressureSessionBuffer,
  addMeasurement,
  applyDerivedElevation,
  clearDirty,
  emptyDirty,
  emptyElevationStore,
  floorNodeKey,
  isBreakline,
  isClean,
  dirtyCount,
  markEditPatches,
  markStateChange,
  markMeasurements,
  outdoorNodeKey,
  readDerivedElevation,
  recomputeRequest,
  removeHeightNode,
  serializeElevationStore,
  statePatches,
  type BarometerWindowResult,
  type DerivedElevation,
  type HeightNode,
  type SessionId,
} from '../../src/elevation/index.ts';
import { fixtureState } from '../edit/helpers.ts';

function window(p: number, tMs: number): BarometerWindowResult {
  return {
    meanPressureHpa: p, stdHpa: 0.04, sampleCount: 100, timestamp: tMs, startedAt: tMs - 5000, endedAt: tMs + 5000,
    rejectedCount: 0, stdErrHpa: 0.004, slopeHpaPerS: 0, stationaryRatio: 1, warnings: [], platform: 'android',
  };
}

const A = outdoorNodeKey('A');
const B = floorNodeKey('bldg_A', '3F');
const nodeA: HeightNode = { kind: 'outdoor_point', key: A, position: { lat: 37, lng: 127 }, influenceRadiusM: 1, createdAt: 0 };
const nodeB: HeightNode = { kind: 'floor_plane', key: B, buildingId: 'bldg_A' as never, floorId: '3F' as never, createdAt: 0 };

/** A → B → A: one pair edge, then a roundtrip that supersedes it. */
function measuredStore() {
  let clock = 0;
  let id = 0;
  const buf = new PressureSessionBuffer({}, () => `id${++id}`, () => clock);
  const sid = 's1' as SessionId;
  let store = emptyElevationStore();
  const r1 = buf.add({ sessionId: sid, nodeKey: A, window: window(1010, 0) });
  store = addMeasurement(store, nodeA, r1);
  clock = 6 * 60_000;
  const r2 = buf.add({ sessionId: sid, nodeKey: B, window: window(1009, clock) });
  store = addMeasurement(store, nodeB, r2);
  clock = 12 * 60_000;
  const r3 = buf.add({ sessionId: sid, nodeKey: A, window: window(1010, clock) });
  const before = store;
  store = addMeasurement(store, nodeA, r3);
  return { buf, before, store, r2, r3 };
}

describe('ElevationStore: persisted data has no absolute pressure', () => {
  it('addMeasurement upserts nodes, appends edges, marks superseded ones and leaves the input alone', () => {
    const { before, store, r2, r3 } = measuredStore();
    expect(store.nodes.map((n) => n.key)).toEqual([A, B]);
    expect(store.edges.map((e) => [e.method, e.qc])).toEqual([['static_pair', 'superseded'], ['roundtrip', 'pending']]);
    expect(r3.supersede).toEqual([r2.newEdges[0]!.edgeId]);
    expect(before.edges[0]!.qc).toBe('pending');
    // Same result twice: no duplicate edge.
    expect(addMeasurement(store, nodeA, r3).edges).toHaveLength(2);
  });

  it('serializeElevationStore writes only Δh / σ / Δt observations, even if an ephemeral observation leaks in', () => {
    const { buf, store } = measuredStore();
    const leaked = { ...store, nodes: [...store.nodes, { ...nodeA, key: outdoorNodeKey('X'), window: window(1010, 0) } as unknown as HeightNode] };
    (leaked as unknown as Record<string, unknown>)['buffer'] = buf.list();
    const text = serializeElevationStore(leaked);
    expect(text).not.toMatch(/pressure/i);
    expect(text).not.toMatch(/"(pHpa|stdHpa|stdErrHpa|window|expiresAt|__ephemeral)"/);
    const back = JSON.parse(text) as typeof store;
    expect(Object.keys(back.edges[1]!)).toEqual(expect.arrayContaining(['dhM', 'sigmaM', 'dtS']));
    expect(back.edges[1]!.model).toEqual({ tempC: 15, sigmaInstFloorHpa: 0.03, driftHpaPerHour: 0.3 });
    expect(text.endsWith('}\n')).toBe(true);
    // Round trip of a clean store is exact.
    expect(serializeElevationStore(JSON.parse(serializeElevationStore(store)))).toBe(serializeElevationStore(store));
  });
});

describe('deleting a measured spot (survey app 측정된 기압 → 삭제)', () => {
  it('removes the node, every Δh edge at it and its estimate; the other variables stay', () => {
    const { store } = measuredStore();
    const withEstimate = { ...store, estimates: [{ key: A, hM: 30, sigmaM: 0.1, floating: false }, { key: B, hM: 34, sigmaM: 0.1, floating: false }] };
    const { store: next, removed } = removeHeightNode(withEstimate as never, B);
    expect(removed.map((e) => e.method).sort()).toEqual(['roundtrip', 'static_pair']);
    expect(next.nodes.map((n) => n.key)).toEqual([A]);
    expect(next.edges).toHaveLength(0);
    expect(next.estimates?.map((x) => x.key)).toEqual([A]);
    expect(removeHeightNode(next, 'op:nowhere').store).toBe(next);
  });

  it('forgets the spot’s pressures in memory, so the next window pairs with what is left', () => {
    const { buf } = measuredStore();
    expect(buf.forgetNode(A)).toBe(2);
    expect(buf.list().map((o) => o.nodeKey)).toEqual([B]);
    expect(buf.forgetNode(A)).toBe(0);
    expect(buf.forgetNode(B)).toBe(1);
    expect(buf.list()).toHaveLength(0);
  });
});

describe('isBreakline', () => {
  it('outdoor steps by default, is_breakline overrides both ways', () => {
    expect(isBreakline({ highway: 'steps', edge_type: 'outdoor' })).toBe(true);
    expect(isBreakline({ highway: 'steps', edge_type: 'outdoor', is_breakline: false })).toBe(false);
    expect(isBreakline({ highway: 'steps', edge_type: 'indoor' })).toBe(false);
    expect(isBreakline({ highway: 'footway', edge_type: 'outdoor', is_breakline: true })).toBe(true);
  });
});

const GATE_PATH = 'e_out_0001__out_0002';

function patchesOf(state: EditState, action: Action) {
  expect(action.disabled(state)).toBe(false);
  const [next, patches] = produceWithPatches(state, (d) => action.recipe(d));
  return { next, patches };
}

describe('lazy recompute: edits only mark, the explicit trigger asks for the dirty part', () => {
  it('moving a node marks it; the request adds its edges and their ends', async () => {
    const s = await fixtureState();
    const { next, patches } = patchesOf(s, moveNode('n_out_0002', [127.00021, 37.0004]));
    const d = markEditPatches(emptyDirty(), patches, next);
    expect([...d.nodes]).toEqual(['n_out_0002']);
    const req = recomputeRequest(d, next);
    expect(req.format).toBe('campo-elevation-dirty/1');
    expect(req.campusEdges).toEqual(expect.arrayContaining([GATE_PATH, 'e_out_0002__out_0003', 'e_out_0002__out_0004']));
    expect(req.campusNodes).toEqual(expect.arrayContaining(['n_out_0001', 'n_out_0002', 'n_out_0003', 'n_out_0004']));
    expect(req.campusNodes).toEqual([...req.campusNodes].sort());
  });

  it('a property the solver does not read marks nothing; flat_exact and a floor height do', async () => {
    const s = await fixtureState();
    const hours = patchesOf(s, setProps([GATE_PATH], { hours: '07:00-22:00' }));
    expect(isClean(markEditPatches(emptyDirty(), hours.patches, hours.next))).toBe(true);
    const flat = patchesOf(s, setProps([GATE_PATH], { flat_exact: true }));
    expect([...markEditPatches(emptyDirty(), flat.patches, flat.next).edges]).toEqual([GATE_PATH]);
    const floor = patchesOf(s, setProps(['bldg_A'], { ext: { floor_height_m: 4.2 } }));
    expect([...markEditPatches(emptyDirty(), floor.patches, floor.next).buildings]).toEqual(['bldg_A']);
  });

  it('markStateChange (state before and after) marks the same as the edit patches, for the edit and for its undo', async () => {
    const s = await fixtureState();
    for (const action of [moveNode('n_out_0002', [127.00021, 37.0004]), setProps([GATE_PATH], { flat_exact: true }), setProps(['bldg_A'], { ext: { floor_height_m: 4.2 } })]) {
      const { next, patches } = patchesOf(s, action);
      const byPatches = markEditPatches(emptyDirty(), patches, next);
      expect(markStateChange(emptyDirty(), s, next)).toEqual(byPatches);
      expect(markStateChange(emptyDirty(), next, s)).toEqual(markEditPatches(emptyDirty(), patches, s));
      expect(dirtyCount(byPatches)).toBe(1);
    }
    expect(statePatches(s, s)).toEqual([]);
    const hours = setProps([GATE_PATH], { hours: '07:00-22:00' }).apply(s);
    expect(statePatches(s, hours).map((p) => p.path)).toEqual(expect.arrayContaining([['edges', GATE_PATH, 'props', 'hours']]));
    expect(isClean(markStateChange(emptyDirty(), s, hours))).toBe(true);
    const w = setEdgeElevation({ [GATE_PATH]: { elev_diff_m: 1.2, elev_sigma_m: 0.2, grade_pct: 2.6 } }).apply(s);
    expect(isClean(markStateChange(emptyDirty(), s, w))).toBe(true);
  });

  it("the recompute's own write-back does not dirty anything again", async () => {
    const s = await fixtureState();
    const w = patchesOf(s, setEdgeElevation({ [GATE_PATH]: { elev_diff_m: 1.2, elev_sigma_m: 0.2, grade_pct: 2.6 } }));
    expect(isClean(markEditPatches(emptyDirty(), w.patches, w.next))).toBe(true);
  });

  it('a measurement marks both height variables of the new and the superseded edges', () => {
    const { before, r3 } = measuredStore();
    const d = markMeasurements(emptyDirty(), r3, before);
    expect([...d.heightNodes].sort()).toEqual([B, A].sort());
  });

  it('applyDerivedElevation writes rounded values with grade over the plan length, removes values it could not compute, and clearDirty drops what was sent', async () => {
    const s0 = await fixtureState();
    const s = setEdgeElevation({ e_out_0002__out_0004: { elev_diff_m: 3, elev_sigma_m: 0.3, grade_pct: 5 } }).apply(s0);
    const { next, patches } = patchesOf(s, moveNode('n_out_0002', [127.0002, 37.00041]));
    const dirty = markEditPatches(emptyDirty(), patches, next);
    const req = recomputeRequest(dirty, next);
    const derived: DerivedElevation = readDerivedElevation({
      format: 'campo-derived-elevation/1', runId: 'r', solvedAt: 0, nodes: {},
      edges: { [GATE_PATH]: { elev_diff_m: 1.2345, elev_sigma_m: 0.004 }, e_unknown: { elev_diff_m: 1, elev_sigma_m: 1 } },
    });
    const applied = applyDerivedElevation(next, derived, req).apply(next);
    const p = applied.edges[GATE_PATH]!.props;
    expect(p.elev_diff_m).toBe(1.23);
    expect(p.elev_sigma_m).toBe(0.01); // floor of 1 cm
    expect(p.grade_pct).toBeGreaterThan(2);
    expect(p.grade_pct).toBeLessThan(3); // ≈ 1.23 m over ≈ 47.6 m
    expect(p.rev).toBe(next.edges[GATE_PATH]!.props.rev + 1);
    // In the request but not in the result: the stale values are removed.
    expect('elev_diff_m' in applied.edges['e_out_0002__out_0004']!.props).toBe(false);
    // Unchanged result → nothing to do.
    expect(applyDerivedElevation(applied, derived, req).disabled(applied)).toBe('바뀔 고도 값이 없습니다.');
    expect(isClean(clearDirty(dirty, req))).toBe(true);
  });

  it('readDerivedElevation refuses other files', () => {
    expect(() => readDerivedElevation({ format: 'x' })).toThrow('고도 계산 결과 파일이 아닙니다');
    expect(() => readDerivedElevation({ format: 'campo-derived-elevation/1', nodes: {}, edges: { e: { elev_diff_m: 'a' } } })).toThrow('숫자가 아닙니다');
  });
});
