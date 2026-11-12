import { describe, expect, it } from 'vitest';
import {
  OBSERVATION_CHANGED_MESSAGE,
  checkInvariants,
  compose,
  createHistory,
  deleteNodes,
  moveNode,
  setProps,
  splitEdgeAt,
} from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

const HALL = 'n_A_4_hall';

describe('compose', () => {
  it('runs the steps in order as one history entry; one undo takes all back', async () => {
    const s = await fixtureState();
    const action = compose([moveNode(HALL, [127.00061, 37.00051]), setProps([HALL], { name: '홀' })], '지점 옮기고 이름 달기');
    const h = createHistory(s);
    const next = h.perform(action);
    expect(h.size()).toBe(1);
    expect(next.nodes[HALL]!.coord).toEqual([127.00061, 37.00051]);
    expect(next.nodes[HALL]!.props).toMatchObject({ name: '홀', rev: 2 });
    expect(action.annotation).toBe('지점 옮기고 이름 달기');
    expect(h.undo()).toEqual(s);
    expect(h.redo()).toEqual(next);
  });

  it('a step can be a function of the state the earlier steps left; null skips it', async () => {
    const s = await fixtureState();
    const action = compose([
      moveNode(HALL, [127.00061, 37.00051]),
      (state) => setProps([HALL], { name: `x=${state.nodes[HALL]!.coord[0]}` }),
      () => null,
    ], '묶음');
    expect(action.apply(s).nodes[HALL]!.props.name).toBe('x=127.00061');
  });

  it('is disabled with the reason of the first step that cannot run, and changes nothing', async () => {
    const s = await fixtureState();
    const action = compose([moveNode(HALL, [127.00061, 37.00051]), setProps(['nope'], { name: 'x' })], '묶음');
    expect(action.disabled(s)).toMatch(/없는 Feature/);
    expect(action.apply(s)).toBe(s);
    expect(compose([], '빈 묶음').disabled(s)).toMatch(/묶을 동작이 없습니다/);
  });

  it('collects the warnings and override copies of every step', async () => {
    const s = await fixtureState();
    const id = 'e_out_0002__out_0003';
    const c = ctx(1, { observationTargets: new Set([`edge:${id}`]), overrideIds: new Set([id]) });
    const action = compose([splitEdgeAt(id, [127.00025, 37.00055], {}, c), deleteNodes([HALL])], '묶음');
    const warnings = action.warnings!(s);
    expect(warnings.some((w) => w.includes(OBSERVATION_CHANGED_MESSAGE))).toBe(true);
    const copies = action.overrideCopies!(s);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ fromId: id });
    expect(action.apply(s).edges[copies[0]!.toId]).toBeDefined();
  });

  it('keeps the new ids the same when it runs again on the same state (disabled, warnings, perform)', async () => {
    const s = await fixtureState();
    const id = 'e_out_0002__out_0003';
    const c = ctx(7, { overrideIds: new Set([id]) });
    const action = compose([splitEdgeAt(id, [127.00025, 37.00055], {}, c)], '나누기');
    const [copy] = action.overrideCopies!(s);
    const h = createHistory(s);
    h.perform(action);
    expect(h.current().edges[copy!.toId]).toBeDefined();
    expect(action.apply(s)).toEqual(h.current()); // the same action instance gives the same ids every time
  });

  it('does not touch a frozen input, undo / redo work, invariants hold', async () => {
    const s = await fixtureState();
    const make = () => compose([moveNode(HALL, [127.00061, 37.00051]), setProps([HALL], { name: '홀' })], '묶음');
    expectInputUntouched(s, make());
    const after = expectUndoRedo(s, make());
    expect(checkInvariants(after)).toEqual([]);
  });
});
