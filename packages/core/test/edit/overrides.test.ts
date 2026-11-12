import { describe, expect, it } from 'vitest';
import {
  applyOverrideCopies,
  attachDoor,
  buildGraph,
  createHistory,
  deleteNodes,
  findRoute,
  overrideIdsOf,
  parseCampus,
  serialize,
  splitEdgeAt,
  type EditState,
  type Override,
} from '../../src/index.ts';
import { ctx, fixture } from './helpers.ts';

const EDGE = 'e_A_4_hall__A_elevA_L4'; // 4F corridor from the hall to the elevator stop
const NOW = new Date('2026-11-11T00:00:00+09:00');
const BROKEN: Override = { feature_id: EDGE, status: 'closed', until: '2026-12-31T00:00:00+09:00', report_id: 'rp-1' };

/** Save the way the editor does (serialize + overrides.json), read it back and build the routing graph. */
async function saved(state: EditState, overrides: Override[]) {
  const { loaded } = await fixture();
  const files = [...serialize(state, loaded.meta), { path: 'overrides.json', text: JSON.stringify(overrides) }];
  return buildGraph(parseCampus(files), { now: NOW });
}

describe('overrides follow a split and a heal', () => {
  it('attachDoor on a closed corridor: after saving, routing is blocked on both pieces', async () => {
    const { loaded, state } = await fixture();
    const c = ctx(1, { overrideIds: overrideIdsOf({ ...loaded, overrides: [BROKEN] }) });
    const h = createHistory(state);
    const door = attachDoor(h.current(), [127.0007, 37.00054], { building_id: 'bldg_A', level: 4 }, c);
    if (!door.ok) throw new Error(door.reason);
    h.perform(door.action);

    expect(door.splitEdgeIds).toHaveLength(1);
    expect(door.warnings.join('\n')).toContain('override');
    const copies = h.overrideCopies();
    expect(copies).toEqual([{ fromId: EDGE, toId: door.splitEdgeIds[0] }]);

    const after = applyOverrideCopies([BROKEN], copies);
    expect(after.map((o) => o.feature_id).sort()).toEqual([EDGE, door.splitEdgeIds[0]].sort());
    expect(after.every((o) => o.status === 'closed' && o.until === BROKEN.until && o.report_id === 'rp-1')).toBe(true);

    // Both sides of the new door are cut off, so neither side can reach it.
    const g = await saved(h.current(), after);
    expect(findRoute(g, 'n_A_4_hall', door.doorId, 'shortest')).toMatchObject({ found: false });
    expect(findRoute(g, 'n_A_elevA_L4', door.doorId, 'shortest')).toMatchObject({ found: false });
    // Without the copy only one piece is closed, so the door stays reachable (round the other way, over the elevator).
    const only = await saved(h.current(), [BROKEN]);
    const open = [findRoute(only, 'n_A_4_hall', door.doorId, 'shortest'), findRoute(only, 'n_A_elevA_L4', door.doorId, 'shortest')];
    expect(open.some((r) => r.found)).toBe(true);
  });

  it('splitEdgeAt reports the copy only when the edge has an override', async () => {
    const { state } = await fixture();
    const withOverride = splitEdgeAt(EDGE, [127.0007, 37.0005], {}, ctx(1, { overrideIds: new Set([EDGE]) }));
    const [copy] = withOverride.overrideCopies!(state);
    expect(copy).toMatchObject({ fromId: EDGE });
    expect(withOverride.warnings!(state)[0]).toContain(copy!.toId);
    expect(withOverride.apply(state).edges[copy!.toId]).toBeDefined(); // the id it names is the piece it makes
    expect(splitEdgeAt(EDGE, [127.0007, 37.0005], {}, ctx(1)).overrideCopies!(state)).toEqual([]);
  });

  it('heal moves the override of the dropped edge onto the kept one', async () => {
    const { state } = await fixture();
    const dropped = 'e_A_4_north__A_4_408door'; // the shorter piece, dropped when n_A_4_408door is healed
    const action = deleteNodes(['n_A_4_408door'], { heal: true }, ctx(1, { overrideIds: new Set([dropped]) }));
    expect(action.overrideCopies!(state)).toEqual([{ fromId: dropped, toId: 'e_A_4_hall__A_4_408door', move: true }]);
    expect(action.warnings!(state).join('\n')).toContain('남는 구간 "e_A_4_hall__A_4_408door"');
    expect(applyOverrideCopies([{ ...BROKEN, feature_id: dropped }], action.overrideCopies!(state))).toEqual([
      { ...BROKEN, feature_id: 'e_A_4_hall__A_4_408door' },
    ]);
    expect(deleteNodes(['n_A_4_408door'], {}, ctx(1, { overrideIds: new Set([dropped]) })).overrideCopies!(state)).toEqual([]);
  });

  it('history keeps copies only for edits that are still done and not yet saved', async () => {
    const { state } = await fixture();
    const c = ctx(1, { overrideIds: new Set([EDGE]) });
    const h = createHistory(state);
    h.perform(splitEdgeAt(EDGE, [127.0007, 37.0005], {}, c));
    expect(h.overrideCopies()).toHaveLength(1);
    h.undo();
    expect(h.overrideCopies()).toEqual([]);
    h.redo();
    expect(h.overrideCopies()).toHaveLength(1);
    h.markSaved();
    expect(h.overrideCopies()).toEqual([]);
  });

  it('applyOverrideCopies does not duplicate a report and follows a copy of a copy', () => {
    const copies = [
      { fromId: 'a', toId: 'b' },
      { fromId: 'b', toId: 'c' },
      { fromId: 'a', toId: 'b' },
    ];
    const out = applyOverrideCopies([{ ...BROKEN, feature_id: 'a' }], copies);
    expect(out.map((o) => o.feature_id)).toEqual(['a', 'b', 'c']);
  });
});
