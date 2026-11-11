import { describe, expect, it } from 'vitest';
import { addNode, createHistory, moveNode, noop, setProps } from '../../src/index.ts';
import { fixtureState } from './helpers.ts';

describe('History', () => {
  it('a drag (perform noop → replace × N → replace with annotation) is one undo and rev +1', async () => {
    const s = await fixtureState();
    const h = createHistory(s);
    h.perform(noop());
    for (let i = 1; i <= 5; i++) h.replace(moveNode('n_A_3_north', [127.0007 + i * 1e-6, 37.0007]), null);
    const end = h.replace(moveNode('n_A_3_north', [127.00071, 37.00071]));
    expect(h.size()).toBe(1);
    expect(end.nodes['n_A_3_north']!.props.rev).toBe(2);
    expect(end.edges['e_A_3_hall__A_3_north']!.props.rev).toBe(2);
    expect(end.edges['e_A_3_north__C_5_bridge']!.props.rev).toBe(2);
    expect(h.undo()).toEqual(s);
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toEqual(end);
  });

  it('two edits before saving: rev +1 once', async () => {
    const h = createHistory(await fixtureState());
    h.perform(setProps(['n_A_1_main'], { name: '정문 1' }));
    const s = h.perform(setProps(['n_A_1_main'], { name: '정문 2' }));
    expect(s.nodes['n_A_1_main']!.props.rev).toBe(2);
  });

  it('an edit undone by another edit goes back to the base rev', async () => {
    const start = await fixtureState();
    const h = createHistory(start);
    h.perform(setProps(['n_A_1_main'], { name: '다른 이름' }));
    h.perform(setProps(['n_A_1_main'], { name: 'A동 1층 출입구' }));
    expect(h.current().nodes['n_A_1_main']!.props.rev).toBe(1);
    h.perform(moveNode('n_A_3_north', [127.00072, 37.0007]));
    const back = h.perform(moveNode('n_A_3_north', [127.0007, 37.0007]));
    expect(back).toEqual(start);
  });

  it('after markSaved, the next edit is the saved rev + 1', async () => {
    const h = createHistory(await fixtureState());
    h.perform(setProps(['n_A_1_main'], { name: '가' }));
    h.markSaved();
    expect(h.base()).toBe(h.current());
    h.perform(setProps(['n_A_1_main'], { name: '나' }));
    const s = h.perform(setProps(['n_A_1_main'], { name: '다' }));
    expect(s.nodes['n_A_1_main']!.props.rev).toBe(3);
  });

  it('a new Feature stays at rev 1 however often it changes', async () => {
    const h = createHistory(await fixtureState());
    h.perform(addNode({ id: 'n_new', coord: [127.0001, 37.0001], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate' } }));
    h.perform(setProps(['n_new'], { name: '가' }));
    h.perform(moveNode('n_new', [127.0002, 37.0001]));
    h.perform(setProps(['n_new'], { needs_check: true }));
    expect(h.current().nodes['n_new']!.props.rev).toBe(1);
  });

  it('keeps at most 200 entries and drops the oldest', async () => {
    const start = await fixtureState();
    const h = createHistory(start);
    const states = [start];
    for (let i = 1; i <= 205; i++) states.push(h.perform(setProps(['n_A_1_main'], { name: `이름 ${i}` })));
    expect(h.size()).toBe(200);
    let undos = 0;
    while (h.canUndo()) {
      h.undo();
      undos++;
    }
    expect(undos).toBe(200);
    expect(h.current()).toEqual(states[5]);
    expect(createHistory(start, { limit: 3 }).size()).toBe(0);
  });

  it('undo / redo skip entries without an annotation; perform after undo drops the redo branch', async () => {
    const start = await fixtureState();
    const h = createHistory(start);
    const a = h.perform(setProps(['n_A_1_main'], { name: '가' }));
    h.perform(setProps(['n_A_1_main'], { name: '나' }), null);
    const c = h.perform(setProps(['n_A_1_main'], { name: '다' }), '이름 바꾸기');
    expect(h.undo()).toEqual(a);
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toEqual(c);
    h.undo();
    h.perform(setProps(['n_A_1_main'], { name: '라' }));
    expect(h.canRedo()).toBe(false);
    expect(h.redo().nodes['n_A_1_main']!.props.name).toBe('라');
  });

  it('overwrite replaces the last entry with a new one from the state before it', async () => {
    const start = await fixtureState();
    const h = createHistory(start);
    h.perform(setProps(['n_A_1_main'], { name: '가' }));
    const s = h.overwrite(setProps(['n_A_1_main'], { ref: 'M' }));
    expect(s.nodes['n_A_1_main']!.props.name).toBe('A동 1층 출입구');
    expect(s.nodes['n_A_1_main']!.props.ref).toBe('M');
    expect(h.size()).toBe(1);
    expect(h.undo()).toEqual(start);
  });

  it('refuses a disabled action', async () => {
    const h = createHistory(await fixtureState());
    expect(() => h.perform(moveNode('n_nope', [127, 37]))).toThrow(/없습니다/);
    expect(h.size()).toBe(0);
  });
});
