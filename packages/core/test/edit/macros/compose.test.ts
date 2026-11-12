import { describe, expect, it } from 'vitest';
import {
  addNode,
  attachDoorSteps,
  createHistory,
  defineMacro,
  deleteNodes,
  observationMessage,
  overrideMessage,
} from '../../../src/index.ts';
import { ctx } from '../helpers.ts';
import { B, world, xy } from './world.ts';

describe('defineMacro', () => {
  it('collects the warnings of every sub-action: override (delete) and measurement (split)', () => {
    const s = world();
    const c = ctx(1, { overrideIds: new Set(['n_k1']), observationTargets: new Set(['edge:e_s']) });
    const macro = defineMacro('정리하고 문 잇기', c, (r) => {
      r.step('delete n_k1', () => deleteNodes(['n_k1'], {}, c));
      return attachDoorSteps(r, xy(10, 3), { building_id: B, level: 1 }, c);
    });
    const run = macro.run(s);
    expect(run.ok).toBe(true);
    expect(run.ok && run.warnings).toEqual([overrideMessage('n_k1'), observationMessage('e_s')]);
    expect(macro.warnings!(s)).toEqual([overrideMessage('n_k1'), observationMessage('e_s')]);
    // one entry in History, one undo
    const h = createHistory(s);
    const after = h.perform(macro);
    expect(after.nodes['n_k1']).toBeUndefined();
    expect(h.size()).toBe(1);
    expect(h.undo()).toEqual(s);
  });

  it('a disabled sub-action disables the whole macro and nothing changes', () => {
    const s = world();
    const macro = defineMacro('둘 추가', ctx(), (r) => {
      r.step('a', () => addNode({ id: 'n_new', coord: xy(1, 1), props: { kind: 'node', node_type: 'corridor', building_id: B, level: 1, source: 'x' } }));
      r.step('b', () => addNode({ id: 'n_new', coord: xy(2, 2), props: { kind: 'node', node_type: 'corridor', building_id: B, level: 1, source: 'x' } }));
      return {};
    });
    expect(macro.disabled(s)).toBe('이미 있는 id입니다: n_new');
    expect(macro.apply(s)).toBe(s);
    expect(macro.warnings!(s)).toEqual([]);
    expect(() => createHistory(s).perform(macro)).toThrow(/이미 있는 id/);
  });

  it('only the Features the sub-actions changed are new objects; the rest stay shared with the input', () => {
    const s = world();
    const macro = defineMacro('문', ctx(), (r) => attachDoorSteps(r, xy(10, 3), { building_id: B, level: 1 }, ctx()));
    const after = createHistory(s).perform(macro);
    const changed = (['nodes', 'edges'] as const).flatMap((c) =>
      Object.keys(after[c]).filter((k) => (after[c] as Record<string, unknown>)[k] !== (s[c] as Record<string, unknown>)[k]));
    expect(changed.sort()).toHaveLength(5); // door, foot, link, e_s, the new piece
  });
});
