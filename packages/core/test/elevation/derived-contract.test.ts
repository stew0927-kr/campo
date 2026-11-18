// TS ↔ Python contract: fixtures/elevation/campus-basic.derived.json is what tools/elevation/campo_height_solver.py
// writes for campus-basic (tools/elevation/test_core_contract.py checks that it still does). Here the same file goes
// through readDerivedElevation → applyDerivedElevation → schema check → routing.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PROFILES, buildGraph, findRoute, parseCampus, serialize, validateCampus, type WalkLinkData } from '../../src/index.ts';
import { applyDerivedElevation, readDerivedElevation } from '../../src/elevation/index.ts';
import { fixture } from '../edit/helpers.ts';

const DERIVED = new URL('../fixtures/elevation/campus-basic.derived.json', import.meta.url);

describe('derived/elevation.json from the solver', () => {
  it('applies to campus-basic in one action, stays schema-valid, and DEM-only grades do not change any route', async () => {
    const { loaded, state } = await fixture();
    const derived = readDerivedElevation(JSON.parse(await readFile(DERIVED, 'utf8')));
    const next = applyDerivedElevation(state, derived).apply(state);

    for (const id of Object.keys(derived.edges)) {
      expect(next.edges[id]!.props.elev_diff_m, id).toBeTypeOf('number');
      expect(next.edges[id]!.props.rev, id).toBe(state.edges[id]!.props.rev + 1);
    }
    expect(Object.values(next.edges).filter((e) => e.props.highway === 'elevator').every((e) => !('elev_diff_m' in e.props))).toBe(true);

    const campus = parseCampus(serialize(next, loaded.meta));
    const issues = validateCampus(campus);
    expect(issues.errors).toEqual([]);
    expect(issues.warnings).toEqual(validateCampus(loaded).warnings);

    const before = buildGraph(loaded, { calibration: {} });
    const after = buildGraph(campus, { calibration: {} });
    // No barometer data: DEM-only σ is metres, so a grade survives only where σ stays under 3 % of the plan length —
    // the surveyed-flat footway (flat_exact → 0), the footway the v2 grid flattens (0.80 m over the run, σ 0.97 m) and
    // the building B door (σ 0.70 m). The A door (σ 2.13 m) and the 5th floor of C (σ 13.4 m) have none.
    const graded = new Set<string>();
    after.graph.forEachLink((l) => {
      if (l.data.kind === 'walk' && (l.data as WalkLinkData).gradePct !== null) graded.add(l.data.edge.id);
    });
    expect([...graded].sort()).toEqual(['e_out_0001__out_0006', 'e_out_0004__out_0005', 'e_portal_B_1_main']);
    for (const profile of PROFILES) {
      const a = findRoute(before, 'n_out_0001', 'n_A_4_408door', profile);
      const b = findRoute(after, 'n_out_0001', 'n_A_4_408door', profile);
      expect(b.found && a.found && b.edgeIds, profile).toEqual(a.found && a.edgeIds);
    }
  });
});
