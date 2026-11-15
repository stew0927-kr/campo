// The phone's elevation store: measurements become Δh edges in a local JSON file (no absolute pressure anywhere on
// disk or in the zip), the touched height variables wait for a recompute, and a cut-off write falls back to the last copy.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  PressureSessionBuffer,
  outdoorNodeKey,
  type BarometerWindowResult,
  type HeightNode,
  type SessionId,
} from '@campo/core/elevation';
import type { Survey } from '@campo/core';
import { buildArchive } from '../src/export/archive.ts';
import {
  ARCHIVE_ELEVATION_DIRTY, ARCHIVE_ELEVATION_STORE, ELEVATION_STORE_PATH, openElevationRepo,
} from '../src/storage/elevationRepo.ts';
import { AT, CAMPUS, memoryStore } from './helpers.ts';

function window(p: number, tMs: number): BarometerWindowResult {
  return {
    meanPressureHpa: p, stdHpa: 0.04, sampleCount: 100, timestamp: tMs, startedAt: tMs - 5000, endedAt: tMs + 5000,
    rejectedCount: 0, stdErrHpa: 0.004, slopeHpaPerS: 0, stationaryRatio: 1, warnings: [], platform: 'android',
  };
}
const point = (key: string, lat: number): HeightNode => ({ kind: 'outdoor_point', key: outdoorNodeKey(key), position: { lat, lng: 127 }, influenceRadiusM: 1, createdAt: 0 });
const SESSION = { sessionId: 's1' as SessionId, mode: 'static' as const, platform: 'android' as const, installId: 'i1', startedAt: 0 };

describe('ElevationRepo (expo-file-system JSON through FileStore)', () => {
  it('A → B → A: pair edge, then a roundtrip that supersedes it; the file has Δh, σ, Δt and no pressure; the buffer forgets old pressures', async () => {
    let clock = 0;
    let n = 0;
    const buffer = new PressureSessionBuffer({}, () => `id${++n}`, () => clock);
    const fs = memoryStore();
    const repo = await openElevationRepo(fs);
    const sid = SESSION.sessionId;
    const A = point('A', 37), B = point('B', 37.001);

    const r1 = buffer.add({ sessionId: sid, nodeKey: A.key, window: window(1010.0, 0) });
    await repo.commit(A, r1, SESSION);
    clock = 120_000;
    const r2 = buffer.add({ sessionId: sid, nodeKey: B.key, window: window(1009.5, clock) });
    await repo.commit(B, r2, SESSION);
    expect(r2.newEdges).toHaveLength(1);
    clock = 240_000;
    const r3 = buffer.add({ sessionId: sid, nodeKey: A.key, window: window(1010.0, clock) });
    await repo.commit(A, r3, SESSION);

    const store = repo.current();
    expect(store.edges.map((e) => [e.method, e.qc])).toEqual([['static_pair', 'superseded'], ['roundtrip', 'pending']]);
    expect(store.sessions).toEqual([SESSION]);
    expect([...repo.pending()].sort()).toEqual([A.key, B.key].sort());
    const text = fs.files.get(ELEVATION_STORE_PATH)!;
    const edge = (JSON.parse(text) as { edges: Record<string, unknown>[] }).edges[1]!;
    expect(edge).toMatchObject({ dhM: expect.any(Number), sigmaM: expect.any(Number), dtS: 240 });
    expect(text).not.toMatch(/meanPressureHpa|1010|1009\.5/);

    // A measurement more than maxPairDtMin later is a new anchor; pressures past the TTL are dropped from memory.
    clock = 240_000 + 31 * 60_000;
    expect(buffer.purgeExpired()).toBe(3);
    const r4 = buffer.add({ sessionId: sid, nodeKey: B.key, window: window(1009.4, clock) });
    expect(r4.newEdges).toEqual([]);
  });

  it('reopening reads the last complete copy (a cut-off temporary file is ignored), and nearestOutdoor finds the spot again', async () => {
    const fs = memoryStore();
    const repo = await openElevationRepo(fs);
    await repo.commit(point('A', 37), { newEdges: [], supersede: [] });
    fs.files.set(`${ELEVATION_STORE_PATH}.tmp`, '{"schemaVersion":1,"nod');
    const again = await openElevationRepo(fs);
    expect(again.current().nodes.map((x) => x.key)).toEqual([outdoorNodeKey('A')]);
    expect(again.nearestOutdoor({ lat: 37.00001, lng: 127 }, 3)?.key).toBe(outdoorNodeKey('A'));
    expect(again.nearestOutdoor({ lat: 37.001, lng: 127 }, 3)).toBeNull();
    await again.clear();
    expect((await openElevationRepo(fs)).current().nodes).toEqual([]);
  });

  it('the exported zip carries the store and the pending heights next to survey.json; nothing when nothing was measured', async () => {
    const survey: Survey = { format: 'campo-survey', version: 1, id: 'sv-1', campus: CAMPUS, surveyed_at: AT, attachments: {}, vertical: [] };
    const fs = memoryStore();
    const repo = await openElevationRepo(fs);
    expect(repo.archiveFiles()).toEqual({});
    const buffer = new PressureSessionBuffer({}, () => 'e1', () => 60_000);
    await repo.commit(point('A', 37), { newEdges: [], supersede: [] });
    buffer.add({ sessionId: SESSION.sessionId, nodeKey: outdoorNodeKey('A'), window: window(1010, 0) });
    const r = buffer.add({ sessionId: SESSION.sessionId, nodeKey: outdoorNodeKey('B'), window: window(1009.6, 60_000) });
    await repo.commit(point('B', 37.0005), r);
    const archive = await buildArchive(survey, async () => null, repo.archiveFiles());
    const files = unzipSync(archive.bytes);
    expect(Object.keys(files).sort()).toEqual([ARCHIVE_ELEVATION_DIRTY, ARCHIVE_ELEVATION_STORE, 'survey.json']);
    const inZip = JSON.parse(strFromU8(files[ARCHIVE_ELEVATION_STORE]!)) as { edges: { dhM: number; sigmaM: number; dtS: number }[] };
    expect(inZip.edges[0]!.dhM).toBeGreaterThan(3); // 0.4 hPa lower ≈ 3.4 m higher
    expect(strFromU8(files[ARCHIVE_ELEVATION_STORE]!)).not.toContain('Pressure');
    expect(JSON.parse(strFromU8(files[ARCHIVE_ELEVATION_DIRTY]!)).heightNodes).toEqual([outdoorNodeKey('A'), outdoorNodeKey('B')]);
  });
});
