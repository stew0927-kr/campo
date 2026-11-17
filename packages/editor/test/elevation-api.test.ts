import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElevationApi, pythonRunner, type RunSolver } from '../server/elevation-api.ts';

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

  it('terrain: a DEM in another CRS than EPSG:5186 is a 422 that says how to remake it (not a 500)', async () => {
    await mkdir(join(root, 'campus-a'), { recursive: true });
    const meta = { format: 'campo-grid/1', crs: 'EPSG:5179', origin_x: 950000, origin_y: 1950000, res: 1, width: 2, height: 1, dtype: 'float32', nodata: -9999, bin: 'dem.bin' };
    await writeFile(join(root, 'campus-a', 'dem.json'), JSON.stringify(meta));
    await writeFile(join(root, 'campus-a', 'dem.bin'), new Uint8Array(new Float32Array([1, 2]).buffer));
    const r = await fetch(`${base}/api/elevation/campus-a/terrain`);
    expect(r.status).toBe(422);
    const error = ((await r.json()) as { error: string }).error;
    expect(error).toContain('EPSG:5179');
    expect(error).toContain('--dst-crs EPSG:5186');
    await writeFile(join(root, 'campus-a', 'dem.json'), JSON.stringify({ ...meta, crs: 'EPSG:5186' }));
    const ok = (await (await fetch(`${base}/api/elevation/campus-a/terrain`)).json()) as { grid: { z: number[] } };
    expect(ok.grid.z).toEqual([1, 2]);
  });

  it('two recomputes of one campus at once run one after the other, and each answer is its own request’s result', async () => {
    await mkdir(join(root, 'campus-a'), { recursive: true });
    await writeFile(join(root, 'campus-a', 'store.json'), STORE);
    await writeFile(join(root, 'campus-a', 'dem.json'), '{}');
    let active = 0;
    let most = 0;
    solver = async (args) => {
      active++;
      most = Math.max(most, active);
      const dirty = JSON.parse(await readFile(args[args.indexOf('--dirty') + 1]!, 'utf8')) as unknown;
      const out = args[args.indexOf('--out') + 1]!;
      await mkdir(out, { recursive: true });
      await writeFile(join(out, 'residual_field.json'), JSON.stringify(dirty));
      await writeFile(args[args.indexOf('--derived-out') + 1]!, JSON.stringify({ ...DERIVED, dirty }));
      await new Promise((r) => setTimeout(r, 60)); // the other tab's run would write here meanwhile
      active--;
      return { code: 0, output: 'ok' };
    };
    const reqA = { ...REQUEST, campusNodes: ['a'] };
    const reqB = { ...REQUEST, campusNodes: ['b'] };
    const [ra, rb] = await Promise.all([recompute({ request: reqA, files: {} }), recompute({ request: reqB, files: {} })]);
    const [a, b] = (await Promise.all([ra.json(), rb.json()])) as { derived: { dirty: unknown } }[];
    expect(most).toBe(1);
    expect(a!.derived.dirty).toEqual(reqA);
    expect(b!.derived.dirty).toEqual(reqB);
    // The kept files are those of the run that finished last, written as one set.
    const last = JSON.parse(await readFile(join(root, 'campus-a', 'elevation.json'), 'utf8')) as { dirty: unknown };
    expect(JSON.parse(await readFile(join(root, 'campus-a', 'solve', 'residual_field.json'), 'utf8'))).toEqual(last.dirty);
    expect((await readdir(join(root, 'campus-a'))).filter((f) => f.startsWith('.'))).toEqual([]);
  });

  it('a failing run leaves the earlier results as they were', async () => {
    await mkdir(join(root, 'campus-a', 'solve'), { recursive: true });
    await writeFile(join(root, 'campus-a', 'store.json'), STORE);
    await writeFile(join(root, 'campus-a', 'dem.json'), '{}');
    await writeFile(join(root, 'campus-a', 'elevation.json'), JSON.stringify(DERIVED));
    await writeFile(join(root, 'campus-a', 'solve', 'corrected_dem.json'), 'old');
    solver = async (args) => {
      // Half way through: the derived file is written, then the solver dies.
      await writeFile(args[args.indexOf('--derived-out') + 1]!, '{"half":');
      await mkdir(args[args.indexOf('--out') + 1]!, { recursive: true });
      await writeFile(join(args[args.indexOf('--out') + 1]!, 'corrected_dem.json'), 'half');
      return { code: 1, output: 'MemoryError' };
    };
    expect((await recompute({ request: REQUEST, files: {} })).status).toBe(500);
    expect(JSON.parse(await readFile(join(root, 'campus-a', 'elevation.json'), 'utf8'))).toEqual(DERIVED);
    expect(await readFile(join(root, 'campus-a', 'solve', 'corrected_dem.json'), 'utf8')).toBe('old');
  });

  it('a solver that does not finish is stopped after the time limit: 504 with a clear message, and the next run goes ahead', async () => {
    await new Promise((r) => server.close(r));
    let stopped = 0;
    const hang: RunSolver = (_args, opts) => new Promise((resolve) => {
      opts?.signal?.addEventListener('abort', () => { stopped++; resolve({ code: -1, output: '' }); });
    });
    let run: RunSolver = hang;
    const api = createElevationApi({ elevationDir: root, solverScript: 'solver.py', timeoutMs: 100, run: (a, o) => run(a, o) });
    server = createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await mkdir(join(root, 'campus-a'), { recursive: true });
    await writeFile(join(root, 'campus-a', 'store.json'), STORE);
    await writeFile(join(root, 'campus-a', 'dem.json'), '{}');
    const r = await recompute({ request: REQUEST, files: {} });
    expect(r.status).toBe(504);
    expect(((await r.json()) as { error: string }).error).toContain('시간');
    expect(stopped).toBe(1);
    run = async (args) => {
      await writeFile(args[args.indexOf('--derived-out') + 1]!, JSON.stringify(DERIVED));
      return { code: 0, output: 'ok' };
    };
    expect((await recompute({ request: REQUEST, files: {} })).status).toBe(200);
  });
});

describe('pythonRunner', () => {
  it('kills the child process when the signal aborts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'campo-run-'));
    try {
      const script = join(dir, 'hang.js');
      await writeFile(script, 'setInterval(() => {}, 1000); console.log("started");');
      const ac = new AbortController();
      const t0 = Date.now();
      setTimeout(() => ac.abort(), 200);
      const r = await pythonRunner({ file: process.execPath, args: [] }, script)([], { signal: ac.signal });
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(r.code).not.toBe(0);
      expect(r.output).toContain('started');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

