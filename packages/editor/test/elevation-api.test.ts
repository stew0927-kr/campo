import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElevationApi, type RunSolver } from '../server/elevation-api.ts';

let root: string;
let server: Server;
let base: string;
let calls: string[][];
let solver: RunSolver;

const DERIVED = { format: 'campo-derived-elevation/1', runId: 'r1', solvedAt: 1, nodes: {}, edges: { e1: { elev_diff_m: 1, elev_sigma_m: 0.2 } } };
const REQUEST = { format: 'campo-elevation-dirty/1', heightNodes: [], campusNodes: ['n1'], campusEdges: ['e1'], buildings: [] };
const STORE = JSON.stringify({ schemaVersion: 1, positionCrs: 'EPSG:4326', verticalDatum: 'KVD_INCHEON_MSL', nodes: [], sessions: [], edges: [] });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'campo-elev-'));
  calls = [];
  solver = async (args) => {
    calls.push(args);
    // The fake solver checks what it was given, then writes the derived file where --derived-out says.
    const campus = args[args.indexOf('--campus') + 1]!;
    const files = await readdir(campus);
    const dirty = JSON.parse(await readFile(args[args.indexOf('--dirty') + 1]!, 'utf8')) as unknown;
    await writeFile(args[args.indexOf('--derived-out') + 1]!, JSON.stringify({ ...DERIVED, runId: `files:${files.join(',')}`, dirty }));
    return { code: 0, output: 'ok' };
  };
  const api = createElevationApi({ elevationDir: root, solverScript: 'solver.py', run: (a) => solver(a) });
  server = createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
});

const recompute = (body: unknown) => fetch(`${base}/api/elevation/campus-a/recompute`, { method: 'POST', body: JSON.stringify(body) });

describe('elevation API (고도 다시 계산)', () => {
  it('without a store and a DEM: 409 naming what is missing; with an earlier elevation.json it is returned as it is', async () => {
    const none = await recompute({ request: REQUEST, files: {} });
    expect(none.status).toBe(409);
    expect(((await none.json()) as { error: string }).error).toContain('store.json');
    await mkdir(join(root, 'campus-a'), { recursive: true });
    await writeFile(join(root, 'campus-a', 'elevation.json'), JSON.stringify(DERIVED));
    const old = await recompute({ request: REQUEST, files: {} });
    expect(old.status).toBe(200);
    expect(await old.json()).toMatchObject({ mode: 'existing', derived: DERIVED });
    expect(calls).toEqual([]);
  });

  it('with a store and a DEM: runs the solver on the unsaved campus with --dirty, previous derived, and cleans its work folder', async () => {
    await mkdir(join(root, 'campus-a'), { recursive: true });
    await writeFile(join(root, 'campus-a', 'store.json'), STORE);
    await writeFile(join(root, 'campus-a', 'dem.json'), '{}');
    await writeFile(join(root, 'campus-a', 'elevation.json'), JSON.stringify(DERIVED));
    const r = await recompute({ request: REQUEST, files: { 'outdoor.geojson': '{"type":"FeatureCollection","features":[]}' } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { mode: string; derived: { runId: string; dirty: unknown } };
    expect(body.mode).toBe('solved');
    expect(body.derived.runId).toBe('files:outdoor.geojson');
    expect(body.derived.dirty).toEqual(REQUEST);
    expect(calls[0]).toEqual(expect.arrayContaining(['--store', '--dem', '--campus', '--dirty', '--previous-derived']));
    expect(calls[0]).not.toContain('--previous-residual');
    expect((await readdir(join(root, 'campus-a'))).filter((f) => f.startsWith('.work-'))).toEqual([]);
  });

  it('a campus with a plaza (평지) runs height solver v2; without one the engine is left to the solver', async () => {
    await mkdir(join(root, 'campus-a'), { recursive: true });
    await writeFile(join(root, 'campus-a', 'store.json'), STORE);
    await writeFile(join(root, 'campus-a', 'dem.json'), '{}');
    const plaza = '{"type":"FeatureCollection","features":[{"type":"Feature","id":"plaza_a","properties":{"kind":"plaza","source":"t","rev":1}}]}';
    expect((await recompute({ request: REQUEST, files: { 'outdoor.geojson': plaza } })).status).toBe(200);
    expect(calls[0]!.slice(0, 2)).toEqual(['--engine', 'v2']);
    expect((await recompute({ request: REQUEST, files: { 'outdoor.geojson': '{"type":"FeatureCollection","features":[]}' } })).status).toBe(200);
    expect(calls[1]).not.toContain('--engine');
  });

  it('a failing solver is a 500 with the end of its output; bad requests are 400', async () => {
    await mkdir(join(root, 'campus-a'), { recursive: true });
    await writeFile(join(root, 'campus-a', 'store.json'), STORE);
    await writeFile(join(root, 'campus-a', 'dem.json'), '{}');
    solver = async () => ({ code: 1, output: 'Traceback\nModuleNotFoundError: No module named scipy' });
    const fail = await recompute({ request: REQUEST, files: {} });
    expect(fail.status).toBe(500);
    expect(((await fail.json()) as { error: string }).error).toContain('scipy');
    expect((await recompute({ request: { format: 'x' }, files: {} })).status).toBe(400);
    expect((await recompute({ request: REQUEST, files: { '../escape.geojson': '' } })).status).toBe(400);
  });

  it('GET says what the solver lacks; PUT store keeps a store file and refuses absolute pressures', async () => {
    const before = (await (await fetch(`${base}/api/elevation/campus-a`)).json()) as { store: string | null; solver: { ready: boolean; missing: string[] } };
    expect(before.store).toBeNull();
    expect(before.solver.ready).toBe(false);
    expect(before.solver.missing).toHaveLength(2);
    const put = (text: string) => fetch(`${base}/api/elevation/campus-a/store`, { method: 'PUT', body: JSON.stringify({ text }) });
    expect((await put(STORE)).status).toBe(200);
    expect(await readFile(join(root, 'campus-a', 'store.json'), 'utf8')).toBe(STORE);
    expect((await put(STORE.replace('"edges":[]', '"edges":[],"x":{"meanPressureHpa":1003.2}'))).status).toBe(400);
    expect((await put('{"schemaVersion":2}')).status).toBe(400);
  });
});
