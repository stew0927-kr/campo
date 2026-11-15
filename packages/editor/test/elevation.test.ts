// 고도 in the editor: the flat_exact / is_breakline toggles and their schema rules, the kind change that clears
// flat_exact, the read-only badges, the recompute write-back as one history line, break lines and slope lines.
import { describe, expect, it } from 'vitest';
import { findRoute, buildGraph, validateCampus, type EditState } from '@campo/core';
import { dirtyCount, emptyDirty, markStateChange, recomputeRequest } from '@campo/core/elevation';
import {
  elevationBadges, flagBlocked, kindChangeExtras, nodesNearLine, parseStore, planElevationFlag, planRecomputeResult,
  slopeLines, slopeSummary, storeText, withBreakline, withoutBreakline,
} from '../src/model/elevation.ts';
import { planMenuEdit } from '../src/model/menu.ts';
import { isError, runPlan, type PlanResult } from '../src/model/plan.ts';
import { stateToCampus } from '../src/model/session.ts';
import { fixtureSession } from './fixture.ts';

const FOOT = 'e_out_0001__out_0002'; // footway
const STEPS = 'e_out_0002__out_0003'; // outdoor steps
const RAMP = 'e_out_0004__out_0005';

function run(plan: PlanResult, session = fixtureSession()) {
  if (isError(plan)) throw new Error(plan.error);
  const r = runPlan(session.history, plan);
  if (!r.ok) throw new Error(r.reason);
  return session.history.current();
}

describe('flat_exact and is_breakline toggles', () => {
  it('follow the schema: flat_exact on footway / corridor, is_breakline on footway / steps / ramp, never both', () => {
    const s = fixtureSession().history.current();
    expect(flagBlocked(s.edges[FOOT]!.props, 'flat_exact')).toBe(false);
    expect(flagBlocked(s.edges[STEPS]!.props, 'flat_exact')).toContain('평지 길과 복도');
    expect(flagBlocked(s.edges[STEPS]!.props, 'is_breakline')).toBe(false);
    expect(flagBlocked({ ...s.edges[FOOT]!.props, flat_exact: true }, 'is_breakline')).toContain('평지로 확인한');
    expect(flagBlocked({ highway: 'corridor' }, 'is_breakline')).toContain('단절선은');
  });

  it('one setProps per toggle; off removes the key; the result validates and marks the edge for a recompute', () => {
    const session = fixtureSession();
    const s0 = session.history.current();
    const on = run(planElevationFlag(s0, FOOT, 'flat_exact', true), session);
    expect(on.edges[FOOT]!.props.flat_exact).toBe(true);
    expect([...markStateChange(emptyDirty(), s0, on).edges]).toEqual([FOOT]);
    expect(validateCampus(stateToCampus(on, session.meta, session.passthrough, session.extras)).errors).toEqual([]);
    const off = planElevationFlag(on, FOOT, 'flat_exact', false);
    expect(isError(off)).toBe(false);
    expect(isError(planElevationFlag(s0, STEPS, 'flat_exact', true))).toBe(true);
    expect(isError(planElevationFlag(s0, FOOT, 'flat_exact', false))).toBe(true); // nothing to change
  });

  it('turning a flat_exact footway into a ramp (or steps) clears flat_exact in the same entry (the menu kind change)', () => {
    const s0 = run(planElevationFlag(fixtureSession().history.current(), FOOT, 'flat_exact', true));
    expect(kindChangeExtras(s0.edges[FOOT]!.props, 'steps')).toEqual({ flat_exact: undefined });
    expect(kindChangeExtras(s0.edges[FOOT]!.props, 'corridor')).toEqual({});
    const session = fixtureSession();
    run(planElevationFlag(session.history.current(), FOOT, 'flat_exact', true), session);
    run(planMenuEdit(session.history.current(), [FOOT], { kind: 'ramp' }), session);
    const after = session.history.current();
    expect(after.edges[FOOT]!.props).toMatchObject({ highway: 'ramp' });
    expect('flat_exact' in after.edges[FOOT]!.props).toBe(false);
    session.history.undo();
    expect(session.history.current().edges[FOOT]!.props).toMatchObject({ highway: 'footway', flat_exact: true });
  });
});

describe('read-only values', () => {
  it('signed Δh, σ and grade with its class; nothing when the edge has no recomputed values', () => {
    expect(elevationBadges({ elev_diff_m: 1.2, elev_sigma_m: 0.2, grade_pct: 9.35 })).toEqual({
      diff: '+1.20 m', sigma: '±0.20 m', grade: { text: '+9.3 %', cls: 'steep' },
    });
    expect(elevationBadges({ elev_diff_m: -0.4, elev_sigma_m: 0.05, grade_pct: -6 })?.grade).toEqual({ text: '−6.0 %', cls: 'caution' });
    expect(elevationBadges({})).toBeNull();
  });
});

describe('고도 다시 계산', () => {
  it('the solver result is one history line; undo takes all of it back; a result that changes nothing is a reason', () => {
    const session = fixtureSession();
    const s0 = session.history.current();
    const moved = run(planElevationFlag(s0, FOOT, 'flat_exact', true), session);
    const dirty = markStateChange(emptyDirty(), s0, moved);
    expect(dirtyCount(dirty)).toBe(1);
    const req = recomputeRequest(dirty, moved);
    const derived = { format: 'campo-derived-elevation/1', runId: 'r', solvedAt: 0, nodes: {}, edges: { [FOOT]: { elev_diff_m: 0.004, elev_sigma_m: 0.01 }, [RAMP]: { elev_diff_m: 2, elev_sigma_m: 0.1 } } };
    const plan = planRecomputeResult(moved, req, derived);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.annotation).toBe('고도 다시 계산');
    const size = session.history.size();
    expect(runPlan(session.history, plan).ok).toBe(true);
    expect(session.history.size()).toBe(size + 1);
    const after = session.history.current();
    expect(after.edges[RAMP]!.props).toMatchObject({ elev_diff_m: 2, elev_sigma_m: 0.1 });
    // The write-back marks nothing again.
    expect(dirtyCount(markStateChange(emptyDirty(), moved, after))).toBe(0);
    session.history.undo();
    expect('elev_diff_m' in session.history.current().edges[RAMP]!.props).toBe(false);
    expect(isError(planRecomputeResult(after, req, derived))).toBe(true);
    expect(() => planRecomputeResult(s0, req, { format: 'nope' })).toThrow('고도 계산 결과 파일이 아닙니다');
  });
});

describe('불연속선', () => {
  it('drawn lines go into the store (serialised without pressures), removing one keeps the rest; too short is refused', () => {
    const s = parseStore(null);
    const one = withBreakline(s, [[127, 37], [127.0002, 37.0004]], 'b1', 5);
    if ('error' in one) throw new Error(one.error);
    expect(one.breaklines).toEqual([{ id: 'b1', coordinates: [{ lat: 37, lng: 127 }, { lat: 37.0004, lng: 127.0002 }], source: 'manual', createdAt: 5 }]);
    expect(JSON.parse(storeText(one)).breaklines[0].id).toBe('b1');
    expect(parseStore(storeText(one))).toEqual(JSON.parse(storeText(one)));
    expect(withoutBreakline(one, 'b1').breaklines).toEqual([]);
    expect('error' in withBreakline(s, [[127, 37], [127, 37]], 'b2', 5)).toBe(true);
    expect(() => parseStore('{"schemaVersion":2}')).toThrow('고도 저장소');
  });

  it('a line dirties the campus points near it, not the ones far away', () => {
    const s = fixtureSession().history.current();
    const near = nodesNearLine(s, { id: 'b', coordinates: [{ lat: 37, lng: 127 }, { lat: 37.0001, lng: 127.0001 }], source: 'manual', createdAt: 0 });
    expect(near).toContain('n_out_0001');
    expect(near).not.toContain('n_out_0005');
  });
});

describe('경로 테스트: slope parts', () => {
  it('a steep route edge becomes a line in travel direction, and the card summary counts it', () => {
    const session = fixtureSession();
    const s0: EditState = session.history.current();
    const plan = planRecomputeResult(s0, recomputeRequest(emptyDirty(), s0), {
      format: 'campo-derived-elevation/1', runId: 'r', solvedAt: 0, nodes: {}, edges: { [FOOT]: { elev_diff_m: 6, elev_sigma_m: 0.2 } },
    });
    if (isError(plan)) throw new Error(plan.error);
    runPlan(session.history, plan);
    const s = session.history.current();
    const g = buildGraph(stateToCampus(s, session.meta, session.passthrough, session.extras));
    const r = findRoute(g, 'n_out_0002', 'n_out_0001', 'shortest');
    if (!r.found) throw new Error(r.message);
    expect(r.slopeSegments.map((x) => [x.edgeId, x.gradeClass])).toEqual([[FOOT, 'steep']]);
    const [line] = slopeLines(s, r.slopeSegments);
    expect(line?.cls).toBe('steep');
    expect(line?.coordinates[0]).toEqual(s.nodes['n_out_0002']!.coord);
    expect(slopeSummary(r.slopeSegments)).toMatchObject({ steep: 1, caution: 0 });
    expect(r.steps[0]?.text).toContain('경사가 급한 길');
    expect(slopeSummary([])).toBeNull();
  });
});
