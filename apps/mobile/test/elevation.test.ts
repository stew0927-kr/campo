// The phone's elevation store: measurements become Δh edges in a local JSON file (no absolute pressure anywhere on
// disk or in the zip), the touched height variables wait for a recompute, and a cut-off write falls back to the last copy.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  PressureSessionBuffer,
  floorNodeKey,
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
import { buildingCentre, pinText, pressurePins } from '../src/survey/pressurePins.ts';
import { AT, CAMPUS, fixture, memoryStore } from './helpers.ts';

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

  it('deleting a spot on the map removes it with its Δh edges, marks the far ends and is written to the file', async () => {
    let clock = 0;
    const buffer = new PressureSessionBuffer({}, () => `e${clock}`, () => clock);
    const fs = memoryStore();
    const repo = await openElevationRepo(fs);
    const A = point('A', 37), B = point('B', 37.001), C = point('C', 37.002);
    for (const [p, at, hpa] of [[A, 0, 1010], [B, 60_000, 1009.6], [C, 120_000, 1009.2]] as const) {
      clock = at;
      await repo.commit(p, buffer.add({ sessionId: SESSION.sessionId, nodeKey: p.key, window: window(hpa, at) }), SESSION);
    }
    expect(repo.current().edges).toHaveLength(2);
    await repo.remove(C.key);
    expect(repo.current().nodes.map((n) => n.key)).toEqual([A.key, B.key]);
    expect(repo.current().edges.map((e) => [e.from, e.to])).toEqual([[A.key, B.key]]);
    expect([...repo.pending()].sort()).toEqual([A.key, B.key].sort());
    expect((await openElevationRepo(fs)).current().nodes.map((n) => n.key)).toEqual([A.key, B.key]);
    expect(buffer.forgetNode(C.key)).toBe(1);
  });

  it('측정된 기압 pins: outdoor spots where measured, floors at their building, with the time left in memory', async () => {
    const { state } = await fixture();
    let clock = 0;
    const buffer = new PressureSessionBuffer({}, () => `p${clock}`, () => clock);
    const repo = await openElevationRepo(memoryStore());
    const A = point('A', 37.0001);
    const F3: HeightNode = { kind: 'floor_plane', key: floorNodeKey('bldg_A', '3F'), buildingId: 'bldg_A' as never, floorId: '3F' as never, createdAt: 0 };
    const F1: HeightNode = { ...F3, key: floorNodeKey('bldg_A', '1F'), floorId: '1F' as never };
    for (const [p, at] of [[A, 0], [F3, 60_000], [F1, 120_000]] as const) {
      clock = at;
      await repo.commit(p, buffer.add({ sessionId: SESSION.sessionId, nodeKey: p.key, window: window(1010 - at / 1e6, at) }), SESSION);
    }
    const ttl = 30 * 60_000;
    const pins = pressurePins(repo.current(), buffer.list(), state, 10 * 60_000);
    expect(pins.map((p) => [p.label, p.short, p.leftMs, p.edges, p.stack])).toEqual([
      ['바깥 지점 1', '', ttl - 10 * 60_000, 1, 0],
      ['A동 3F', '3F', ttl + 60_000 - 10 * 60_000, 2, 0],
      ['A동 1F', '1F', ttl + 120_000 - 10 * 60_000, 1, 1],
    ]);
    expect(pins[0]!.at).toEqual([127, 37.0001]);
    expect(pins[1]!.at).toEqual(buildingCentre(state.buildings[Object.keys(state.buildings).find((id) => state.buildings[id]!.id === 'bldg_A')!]!));
    expect(pinText(pins[1]!)).toBe('3F · 21분');
    // After the buffer forgets them only the saved Δh are left.
    const later = pressurePins(repo.current(), buffer.list(), state, 40 * 60_000);
    expect(later.map((p) => p.leftMs)).toEqual([null, null, null]);
    expect(pinText(later[0]!)).toBe('저장됨');
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

describe('ElevationRepo.removeEdge (저장된 높이 차 삭제)', () => {
  async function measured() {
    let clock = 0;
    let n = 0;
    const buffer = new PressureSessionBuffer({}, () => `id${++n}`, () => clock);
    const fs = memoryStore();
    const repo = await openElevationRepo(fs);
    const A = point('A', 37), B = point('B', 37.001);
    await repo.commit(A, buffer.add({ sessionId: SESSION.sessionId, nodeKey: A.key, window: window(1010, 0) }), SESSION);
    clock = 120_000;
    await repo.commit(B, buffer.add({ sessionId: SESSION.sessionId, nodeKey: B.key, window: window(1009.5, clock) }), SESSION);
    return { fs, repo, A, B };
  }

  it('removes the edge from memory and the file, keeps both spots, marks both ends, and bumps the revision', async () => {
    const { fs, repo, A, B } = await measured();
    const edgeId = repo.current().edges[0]!.edgeId;
    const before = repo.getRevision();
    let heard = 0;
    repo.subscribe(() => heard++);
    await repo.removeEdge(edgeId);
    expect(repo.current().edges).toHaveLength(0);
    expect(repo.current().nodes.map((x) => x.key)).toEqual([A.key, B.key]);
    expect([...repo.pending()].sort()).toEqual([A.key, B.key].sort());
    expect(repo.getRevision()).toBe(before + 1);
    expect(heard).toBe(1);
    const saved = JSON.parse(fs.files.get(ELEVATION_STORE_PATH)!) as { edges: unknown[]; nodes: unknown[] };
    expect(saved.edges).toHaveLength(0);
    expect(saved.nodes).toHaveLength(2);
    const dirty = JSON.parse(fs.files.get('elevation/dirty.json')!) as { heightNodes: string[] };
    expect(dirty.heightNodes).toEqual([A.key, B.key].sort());
  });

  it('an unknown edge id writes nothing and does not bump the revision', async () => {
    const { fs, repo } = await measured();
    const before = repo.getRevision();
    const writes = fs.log.length;
    await repo.removeEdge('e-nowhere');
    expect(repo.getRevision()).toBe(before);
    expect(fs.log.length).toBe(writes);
    expect(repo.current().edges).toHaveLength(1);
  });

  it('a reopened repo sees the deletion (the exported zip file no longer lists the edge)', async () => {
    const { fs, repo } = await measured();
    await repo.removeEdge(repo.current().edges[0]!.edgeId);
    const again = await openElevationRepo(fs);
    expect(again.current().edges).toHaveLength(0);
    expect(again.pending().size).toBe(2);
    expect(JSON.parse(again.archiveFiles()[ARCHIVE_ELEVATION_STORE]!).edges).toHaveLength(0);
  });
});
