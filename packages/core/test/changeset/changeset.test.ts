// Changesets (SPEC-v0.2 7.1, 7.2): historyToChangeset, conflict detection, applyChangeset, already-applied, schema.
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addNode,
  applyChangeset,
  changesetFileName,
  changesetId,
  checkChangeset,
  checkInvariants,
  createHistory,
  createIdGen,
  deleteEdges,
  deleteNodes,
  featureOf,
  formatChangeset,
  historyToChangeset,
  isAlreadyApplied,
  moveNode,
  setProps,
  splitEdgeAt,
  summarizeChangeset,
  validateChangeset,
  type Action,
  type Changeset,
  type EditContext,
  type EditState,
  type NodeFeature,
  type Position,
} from '../../src/index.ts';
import { expectUndoRedo, fixtureState } from '../edit/helpers.ts';

let start: EditState;
beforeAll(async () => {
  start = await fixtureState();
});

const META = { id: 'cs-20261113-test', campus: 'fixture-basic', source: 'editor' as const, summary: '시험' };
const HALL_EDGES = ['e_A_1_hall__A_1_esc', 'e_A_1_hall__A_1_stair', 'e_A_1_hall__A_elevA_L1', 'e_A_1_main__A_1_hall'];

function edited(...actions: Action[]): { base: EditState; current: EditState } {
  const h = createHistory(start);
  for (const a of actions) h.perform(a);
  return { base: h.base(), current: h.current() };
}

describe('historyToChangeset', () => {
  it('moving a node modifies the node and every edge on it, with base_rev from the base and rev = base_rev + 1', () => {
    const { base, current } = edited(moveNode('n_A_1_hall', [127.00061, 37.00051]));
    const cs = historyToChangeset(base, current, META);
    expect(cs.changes.map((c) => [c.op, c.op === 'delete' ? c.id : c.feature.id])).toEqual(
      ['n_A_1_hall', ...HALL_EDGES].sort().map((id) => ['modify', id]),
    );
    for (const c of cs.changes) {
      if (c.op !== 'modify') throw new Error('modify only');
      expect(c.base_rev).toBe(1);
      expect(c.feature.properties.rev).toBe(2);
    }
    const edge = cs.changes.find((c) => c.op === 'modify' && c.feature.id === 'e_A_1_main__A_1_hall')!;
    if (edge.op !== 'modify' || edge.feature.geometry.type !== 'LineString') throw new Error('edge');
    expect(edge.feature.geometry.coordinates.at(-1)).toEqual([127.00061, 37.00051]);
    expect(validateChangeset(cs)).toEqual({ ok: true, errors: [] });
  });

  it('creates get rev 1, deletes carry their base rev; order is create, modify, delete', () => {
    const ctx: EditContext = { ids: createIdGen(7) };
    const { base, current } = edited(
      addNode({ id: 'n_out_new1', coord: [127.0001, 37.0001], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate' } }),
      setProps(['n_out_0004'], { needs_check: true }),
      deleteEdges(['e_out_0004__out_0005'], ctx),
    );
    const cs = historyToChangeset(base, current, META);
    expect(cs.changes.map((c) => c.op)).toEqual(['create', 'modify', 'delete']);
    expect(cs.changes[0]).toMatchObject({ op: 'create', feature: { id: 'n_out_new1', properties: { rev: 1 } } });
    expect(cs.changes[2]).toEqual({ op: 'delete', base_rev: 1, id: 'e_out_0004__out_0005' });
  });

  it('two edits of one Feature are one modify (+1 once); an edit undone is no change', () => {
    const twice = edited(setProps(['n_out_0004'], { name: 'a' }), setProps(['n_out_0004'], { name: 'b' }));
    const cs = historyToChangeset(twice.base, twice.current, META);
    expect(cs.changes).toHaveLength(1);
    expect(cs.changes[0]).toMatchObject({ op: 'modify', base_rev: 1, feature: { properties: { rev: 2, name: 'b' } } });

    const h = createHistory(start);
    h.perform(moveNode('n_A_1_hall', [127.00061, 37.00051]));
    h.undo();
    expect(historyToChangeset(h.base(), h.current(), META).changes).toEqual([]);
  });

  it('after markSaved the next changeset uses the saved revs as base_rev', () => {
    const h = createHistory(start);
    h.perform(setProps(['n_out_0004'], { name: 'a' }));
    h.markSaved();
    h.perform(setProps(['n_out_0004'], { name: 'b' }));
    expect(historyToChangeset(h.base(), h.current(), META).changes).toEqual([
      expect.objectContaining({ op: 'modify', base_rev: 2, feature: expect.objectContaining({ properties: expect.objectContaining({ rev: 3 }) }) }),
    ]);
  });

  it('checks source and report_ids', () => {
    expect(() => historyToChangeset(start, start, { ...META, source: 'report' })).toThrow();
    expect(() => historyToChangeset(start, start, { ...META, report_ids: ['rp-20261110-0001'] })).toThrow();
    const cs = historyToChangeset(start, edited(setProps(['n_out_0004'], { name: 'a' })).current, { ...META, source: 'report', report_ids: ['rp-20261110-0001'] });
    expect(cs.report_ids).toEqual(['rp-20261110-0001']);
    expect(validateChangeset(cs).ok).toBe(true);
  });

  it('file name, id and text format', () => {
    expect(changesetId('20261111', 'EV1 fix!')).toBe('cs-20261111-ev1-fix');
    expect(changesetFileName('cs-20261111-ev1-fix')).toBe('20261111-ev1-fix.json');
    expect(() => changesetFileName('20261111-ev1-fix')).toThrow();
    const { base, current } = edited(moveNode('n_A_1_hall', [127.00061, 37.00051]));
    const cs = historyToChangeset(base, current, META);
    const text = formatChangeset(cs);
    expect(JSON.parse(text)).toEqual(cs);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n').filter((l) => l.startsWith('    {"op":"modify"'))).toHaveLength(5);
  });
});

describe('changeset schema', () => {
  it('refuses unknown fields, a bad id, an empty change list and a schema-invalid Feature', () => {
    const cs = historyToChangeset(start, edited(setProps(['n_out_0004'], { name: 'a' })).current, META);
    expect(validateChangeset({ ...cs, author: 'x' }).ok).toBe(false);
    expect(validateChangeset({ ...cs, id: 'changeset-1' }).ok).toBe(false);
    expect(validateChangeset({ ...cs, changes: [] }).ok).toBe(false);
    const broken = JSON.parse(JSON.stringify(cs)) as Changeset;
    if (broken.changes[0]!.op === 'delete') throw new Error('modify expected');
    (broken.changes[0]!.feature.properties as unknown as Record<string, unknown>)['node_type'] = 'spaceship';
    expect(validateChangeset(broken).ok).toBe(false);
  });
});

describe('conflicts (SPEC-v0.2 7.2)', () => {
  const feature = (id: string) => featureOf(start, id)!;
  const bump = (id: string, rev: number) => ({ ...feature(id), properties: { ...feature(id).properties, rev } }) as ReturnType<typeof feature>;

  it('collects every conflict of all three kinds in one pass, "없음" for a missing target', () => {
    const cs: Changeset = {
      ...META,
      report_ids: [],
      changes: [
        { op: 'modify', base_rev: 3, feature: bump('n_out_0004', 4) },
        { op: 'modify', base_rev: 1, feature: { ...bump('n_out_0005', 2), id: 'n_out_9999' } },
        { op: 'create', feature: feature('n_A_1_main') },
        { op: 'delete', base_rev: 1, id: 'n_A_1_stair' },
        { op: 'delete', base_rev: 2, id: 'n_gone' },
      ],
    };
    const check = checkChangeset(start, cs);
    expect(check.ok).toBe(false);
    expect(check.alreadyApplied).toBe(false);
    expect(check.conflicts.map((c) => [c.code, c.id])).toEqual([
      ['rev_mismatch', 'n_out_0004'],
      ['rev_mismatch', 'n_out_9999'],
      ['id_exists', 'n_A_1_main'],
      ['rev_mismatch', 'n_gone'],
      ['still_referenced', 'n_A_1_stair'],
    ]);
    expect(check.conflicts[1]).toMatchObject({ currentRev: null });
    expect(check.conflicts[1]!.message).toContain('없음');
    expect(check.conflicts[4]!.referencedBy).toEqual(['e_A_1_hall__A_1_stair', 'e_A_1_stair__A_2_stair']);
    expect(applyChangeset(cs).disabled(start)).toContain('적용할 수 없습니다');
    expect(applyChangeset(cs).apply(start)).toBe(start);
  });

  it('a node deleted together with its edges is not still_referenced; an edge written by the changeset still counts', () => {
    const ok: Changeset = {
      ...META,
      report_ids: [],
      changes: ['n_out_0004', 'e_out_0002__out_0004', 'e_out_0004__out_0005'].map((id) => ({ op: 'delete' as const, base_rev: 1, id })),
    };
    expect(checkChangeset(start, ok).conflicts).toEqual([]);
    const keepsOne: Changeset = { ...ok, changes: [ok.changes[0]!, ok.changes[1]!, { op: 'modify', base_rev: 1, feature: bump('e_out_0004__out_0005', 2) }] };
    expect(checkChangeset(start, keepsOne).conflicts).toEqual([
      expect.objectContaining({ code: 'still_referenced', id: 'n_out_0004', referencedBy: ['e_out_0004__out_0005'] }),
    ]);
  });

  it('deleting a building that still has nodes is still_referenced', () => {
    const cs: Changeset = { ...META, report_ids: [], changes: [{ op: 'delete', base_rev: 1, id: 'bldg_C' }] };
    const [c] = checkChangeset(start, cs).conflicts;
    expect(c).toMatchObject({ code: 'still_referenced', id: 'bldg_C' });
    expect(c!.referencedBy).toContain('n_C_5_main');
    expect(c!.referencedBy).toContain('e_A_3_north__C_5_bridge');
  });

  it('two changesets made from the same base: the second one conflicts once the first is applied', () => {
    const one = edited(setProps(['n_out_0004'], { name: 'a' }));
    const two = edited(setProps(['n_out_0004'], { name: 'b' }));
    const cs1 = historyToChangeset(one.base, one.current, { ...META, id: 'cs-20261113-a' });
    const cs2 = historyToChangeset(two.base, two.current, { ...META, id: 'cs-20261113-b' });
    const after = applyChangeset(cs1).apply(start);
    expect(checkChangeset(after, cs2).conflicts).toEqual([expect.objectContaining({ code: 'rev_mismatch', id: 'n_out_0004', baseRev: 1, currentRev: 2 })]);
  });

  it('refuses a bad rev and a moved node whose edges are not in the changeset', () => {
    const badRev: Changeset = { ...META, report_ids: [], changes: [{ op: 'modify', base_rev: 1, feature: bump('n_out_0004', 5) }] };
    expect(checkChangeset(start, badRev).problems.map((p) => p.code)).toEqual(['bad_rev']);
    const moved = bump('n_out_0004', 2) as NodeFeature;
    const onlyNode: Changeset = { ...META, report_ids: [], changes: [{ op: 'modify', base_rev: 1, feature: { ...moved, geometry: { type: 'Point', coordinates: [126.99981, 37.00081] } } }] };
    const problems = checkChangeset(start, onlyNode).problems;
    expect(problems.map((p) => [p.code, p.id])).toEqual([['endpoint', 'e_out_0002__out_0004'], ['endpoint', 'e_out_0004__out_0005']]);
  });
});

describe('applyChangeset', () => {
  it('applied to the base it gives the edited state; a second time it is refused as already applied', () => {
    const ctx: EditContext = { ids: createIdGen(3) };
    const { base, current } = edited(
      moveNode('n_A_1_hall', [127.00061, 37.00051]),
      splitEdgeAt('e_out_0001__out_0006', [127.0005, 37.00005], {}, ctx),
      deleteNodes(['n_out_0007'], {}, ctx),
    );
    const cs = historyToChangeset(base, current, META);
    const action = applyChangeset(cs);
    expect(action.disabled(base)).toBe(false);
    const after = action.apply(base);
    expect(after).toEqual(current);
    expect(checkInvariants(after)).toEqual([]);

    expect(isAlreadyApplied(after, cs)).toBe(true);
    const again = checkChangeset(after, cs);
    expect(again.ok).toBe(false);
    expect(again.alreadyApplied).toBe(true);
    expect(again.conflicts.map((c) => c.code)).toContain('rev_mismatch');
    expect(action.disabled(after)).toBe('이미 적용된 changeset입니다: cs-20261113-test');

    const groups = summarizeChangeset(base, after, cs);
    expect(groups.find((g) => g.key === 'bldg_A')).toMatchObject({ label: 'A동(A)', added: 0, deleted: 0, changed: 5 });
    expect(groups.find((g) => g.key === 'outdoor')).toMatchObject({ label: '바깥', added: 2, changed: 1 });
  });

  it('is one history entry and undoes in one step', () => {
    const { base, current } = edited(moveNode('n_A_1_hall', [127.00061, 37.00051]));
    const after = expectUndoRedo(base, applyChangeset(historyToChangeset(base, current, META)));
    expect(after).toEqual(current);
  });

  it('property: for random edit sequences, applying the changeset to the base gives the current state (1,000 runs)', () => {
    const kinds = ['move', 'props', 'split', 'deleteEdges', 'deleteNodes', 'addNode', 'undo'] as const;
    const opArb = fc.record({ kind: fc.constantFrom(...kinds), a: fc.nat(1000), t: fc.integer({ min: 5, max: 95 }).map((x) => x / 100) });
    let checked = 0;
    const opCounts = new Map<string, number>();
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 12 }), (ops) => {
        const ctx: EditContext = { ids: createIdGen(99) };
        const h = createHistory(start);
        for (const op of ops) {
          if (op.kind === 'undo') {
            h.undo();
            continue;
          }
          const s = h.current();
          const nodes = Object.keys(s.nodes).sort();
          const edges = Object.keys(s.edges).sort();
          const node = nodes[op.a % nodes.length];
          const edge = edges[op.a % edges.length];
          let action: Action | undefined;
          if (op.kind === 'move' && node) {
            const c = s.nodes[node]!.coord;
            action = moveNode(node, [c[0] + (op.t - 0.5) * 1e-5, c[1] + (0.5 - op.t) * 1e-5]);
          } else if (op.kind === 'props' && node) action = setProps([node], { name: `n${op.a}` });
          else if (op.kind === 'split' && edge) {
            const e = s.edges[edge]!;
            const a: Position = s.nodes[e.props.from]!.coord;
            const b: Position = s.nodes[e.props.to]!.coord;
            action = splitEdgeAt(edge, [a[0] + (b[0] - a[0]) * op.t, a[1] + (b[1] - a[1]) * op.t], {}, ctx);
          } else if (op.kind === 'deleteEdges' && edge) action = deleteEdges([edge], ctx);
          else if (op.kind === 'deleteNodes' && node) action = deleteNodes([node], { heal: op.a % 2 === 0 }, ctx);
          else if (op.kind === 'addNode' && node) {
            const n = s.nodes[node]!;
            action = addNode({ coord: [n.coord[0] + 1e-6, n.coord[1]], props: { kind: 'node', node_type: n.props.building_id === null ? 'outdoor' : 'corridor', building_id: n.props.building_id, level: n.props.level, source: 'p' } }, ctx);
          }
          if (action && action.disabled(s) === false) h.perform(action);
        }
        const cs = historyToChangeset(h.base(), h.current(), META);
        if (cs.changes.length === 0) return;
        const check = checkChangeset(h.base(), cs);
        expect(check.problems).toEqual([]);
        expect(check.conflicts).toEqual([]);
        const after = applyChangeset(cs).apply(h.base());
        expect(after).toEqual(h.current());
        expect(checkInvariants(after)).toEqual([]);
        expect(isAlreadyApplied(after, cs)).toBe(true);
        expect(validateChangeset(cs).ok).toBe(true);
        checked++;
        for (const c of cs.changes) opCounts.set(c.op, (opCounts.get(c.op) ?? 0) + 1);
      }),
      { numRuns: 1000, seed: 20261113 },
    );
    // The generator must produce real changesets of every kind, not mostly empty ones.
    expect(checked).toBeGreaterThan(800);
    for (const op of ['create', 'modify', 'delete']) expect(opCounts.get(op) ?? 0, op).toBeGreaterThan(500);
  }, 120_000);
});
