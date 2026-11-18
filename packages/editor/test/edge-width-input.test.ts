// 길 폭 field (model/edgeWidth.ts): what the typed text means, which edges take a width, and the one-entry plan.
import { describe, expect, it } from 'vitest';
import { EDGE_WIDTH_RANGE_MESSAGE, edgeWidthApplies, parseEdgeWidthInput, planEdgeWidth, widthTargets } from '../src/model/edgeWidth.ts';
import { isError, runPlan } from '../src/model/plan.ts';
import { fixtureSession } from './fixture.ts';

describe('parseEdgeWidthInput', () => {
  it('an empty field is the default (null), a number in range is the width', () => {
    expect(parseEdgeWidthInput('')).toEqual({ width: null });
    expect(parseEdgeWidthInput('  ')).toEqual({ width: null });
    expect(parseEdgeWidthInput('3.5')).toEqual({ width: 3.5 });
    expect(parseEdgeWidthInput('0.5')).toEqual({ width: 0.5 });
    expect(parseEdgeWidthInput('20')).toEqual({ width: 20 });
  });

  it('anything else is the Korean range message', () => {
    expect(EDGE_WIDTH_RANGE_MESSAGE).toBe('0.5 m 이상 20 m 이하로 입력해 주세요.');
    for (const bad of ['0.3', '20.5', '-1', 'abc', '2m']) expect(parseEdgeWidthInput(bad), bad).toEqual({ error: EDGE_WIDTH_RANGE_MESSAGE });
  });
});

describe('which edges take a width', () => {
  it('outdoor ways do; indoor edges and elevators do not (the height solver does not use them)', () => {
    expect(edgeWidthApplies({ highway: 'footway', edge_type: 'outdoor' })).toBe(true);
    expect(edgeWidthApplies({ highway: 'steps', edge_type: 'outdoor' })).toBe(true);
    expect(edgeWidthApplies({ highway: 'footway' })).toBe(true);
    expect(edgeWidthApplies({ highway: 'corridor', edge_type: 'indoor' })).toBe(false);
    expect(edgeWidthApplies({ highway: 'elevator', edge_type: 'indoor' })).toBe(false);
  });

  it('widthTargets keeps the selected edges that take a width, in selection order', () => {
    const state = fixtureSession().history.current();
    const indoor = Object.values(state.edges).find((e) => e.props.edge_type === 'indoor')!.id;
    expect(widthTargets(state, ['n_out_0001', 'e_out_0001__out_0006', indoor, 'e_out_0001__out_0002'])).toEqual(['e_out_0001__out_0006', 'e_out_0001__out_0002']);
  });
});

describe('planEdgeWidth', () => {
  it('sets every selected edge in one history entry, and null goes back to the default', () => {
    const session = fixtureSession();
    const s = session.history.current();
    const plan = planEdgeWidth(s, ['e_out_0001__out_0006', 'e_out_0001__out_0002'], 4);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.annotation).toBe('길 폭 2개 바꾸기');
    expect(runPlan(session.history, plan)).toMatchObject({ ok: true });
    const after = session.history.current();
    expect(after.edges['e_out_0001__out_0006']!.props.width_m).toBe(4);
    expect(after.edges['e_out_0001__out_0002']!.props.width_m).toBe(4);
    expect(session.history.undo()).toEqual(s);

    const reset = planEdgeWidth(s, ['e_out_0001__out_0006'], null);
    if (isError(reset)) throw new Error(reset.error);
    expect(reset.annotation).toBe('길 폭 기본값으로');
    runPlan(session.history, reset);
    expect('width_m' in session.history.current().edges['e_out_0001__out_0006']!.props).toBe(false);
  });

  it('no edge that takes a width is an error', () => {
    const s = fixtureSession().history.current();
    expect(planEdgeWidth(s, [], 3)).toEqual({ error: '폭을 바꿀 바깥 길을 골라 주세요.' });
  });
});
