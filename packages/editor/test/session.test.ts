import { describe, expect, it } from 'vitest';
import { attachDoor, parseCampus, splitEdgeAt, validateCampus } from '@campo/core';
import { FIXTURE, readFolder, fixtureSession } from './fixture.ts';
import { commitOverrides, createSession, defaultMeta, pendingOverrides, stateToCampus, stateToFiles } from '../src/model/session.ts';
import { planOutdoorPath } from '../src/model/tools.ts';
import { runPlan, type Plan } from '../src/model/plan.ts';

describe('session (편집 엔진 상태)', () => {
  it('writes the fixture back byte for byte in the same files', () => {
    const s = fixtureSession();
    expect(s.passthrough).toEqual([]);
    const files = stateToFiles(s.history.current(), s.meta, s.passthrough);
    const geo = readFolder(FIXTURE).filter((f) => f.path.endsWith('.geojson') || f.path === 'campus.json');
    expect(Object.keys(files).sort()).toEqual(geo.map((f) => f.path).sort());
    for (const f of geo) expect(files[f.path], f.path).toBe(f.text);
  });

  it('reads overrides and observations the engine never rewrites', () => {
    const s = fixtureSession();
    expect(s.extras.map((f) => f.path)).toContain('observations/sample.jsonl');
    expect(s.ctx.observationTargets?.size).toBeGreaterThan(0);
    const campus = stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras);
    expect(campus.observations?.length).toBeGreaterThan(0);
  });

  it('keeps features the engine left out in their original file', () => {
    const broken = { type: 'Feature', id: 'n_bad', properties: { kind: 'node' } };
    const s = createSession('x', [
      { path: 'campus.json', text: JSON.stringify(defaultMeta('x')) },
      { path: 'buildings/Z/L1.geojson', text: JSON.stringify({ type: 'FeatureCollection', features: [broken] }) },
    ]);
    expect(s.passthrough).toHaveLength(1);
    expect(JSON.parse(stateToFiles(s.history.current(), s.meta, s.passthrough)['buildings/Z/L1.geojson']!).features).toEqual([broken]);
  });

  it('drawn outdoor paths land in outdoor.geojson and the result passes validation', () => {
    const s = createSession('x', [{ path: 'campus.json', text: JSON.stringify(defaultMeta('x')) }], 7);
    const plan = planOutdoorPath(s.history.current(), s.ctx, [{ position: [127, 37] }, { position: [127.001, 37] }], 'flat')!;
    expect(runPlan(s.history, plan as Plan).ok).toBe(true);
    const files = stateToFiles(s.history.current(), s.meta);
    expect(Object.keys(files).sort()).toEqual(['campus.json', 'outdoor.geojson']);
    expect(validateCampus(parseCampus(Object.entries(files).map(([path, text]) => ({ path, text }))))).toEqual({ errors: [], warnings: [] });
  });

  describe('overrides.json follows a split', () => {
    const EDGE = 'e_A_4_hall__A_elevA_L4';
    const entry = { feature_id: EDGE, status: 'closed', until: '2026-12-31T00:00:00+09:00', report_id: 'rp-1' };
    const closedSession = () =>
      createSession('fixture', [...readFolder(FIXTURE), { path: 'overrides.json', text: JSON.stringify([entry]) }], 1);

    it('writes the copy for the new piece, once, and not for undone edits', () => {
      const s = closedSession();
      expect(pendingOverrides(s)).toBeNull();
      const door = attachDoor(s.history.current(), [127.0007, 37.00054], { building_id: 'bldg_A', level: 4 }, s.ctx);
      if (!door.ok) throw new Error(door.reason);
      s.history.perform(door.action);

      const pending = pendingOverrides(s)!;
      expect(pending.overrides.map((o) => o.feature_id).sort()).toEqual([EDGE, door.splitEdgeIds[0]!].sort());
      expect(pending.text.endsWith('\n')).toBe(true);
      s.history.undo();
      expect(pendingOverrides(s)).toBeNull();
      s.history.redo();

      // After saving, the new file is the loaded one and a later split of the new piece copies it again.
      s.history.markSaved();
      commitOverrides(s, pending);
      expect(pendingOverrides(s)).toBeNull();
      expect(s.ctx.overrideIds?.has(door.splitEdgeIds[0]!)).toBe(true);
      const again = splitEdgeAt(door.splitEdgeIds[0]!, [127.00075, 37.0005], {}, s.ctx);
      expect(again.overrideCopies!(s.history.current())).toHaveLength(1);
    });
  });
});
