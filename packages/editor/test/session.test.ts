import { describe, expect, it } from 'vitest';
import { parseCampus, validateCampus } from '@campo/core';
import { FIXTURE, readFolder, fixtureSession } from './fixture.ts';
import { createSession, defaultMeta, stateToCampus, stateToFiles } from '../src/model/session.ts';
import { planOutdoorPath } from '../src/model/tools.ts';
import { runPlan } from '../src/model/plan.ts';

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
    expect(runPlan(s.history, plan).ok).toBe(true);
    const files = stateToFiles(s.history.current(), s.meta);
    expect(Object.keys(files).sort()).toEqual(['campus.json', 'outdoor.geojson']);
    expect(validateCampus(parseCampus(Object.entries(files).map(([path, text]) => ({ path, text }))))).toEqual({ errors: [], warnings: [] });
  });
});
