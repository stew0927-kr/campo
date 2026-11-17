// Elevation API for the editor's dev server (docs/ELEVATION_INTEGRATION.md 6장, 12장). Dev server only.
//   GET  /api/elevation/:id            → { store: text | null, solver: { ready, missing } }
//   PUT  /api/elevation/:id/store      ← { text }    the ElevationStore (break lines drawn in the editor). No absolute pressure.
//   POST /api/elevation/:id/recompute  ← { request, files }  recomputeRequest JSON and the campus as it would be saved
//        → { derived, mode: 'solved' | 'existing', log }
//   GET  /api/elevation/:id/terrain    → { grid: TerrainGrid | null, walls: TerrainWall[] }  solve/corrected_dem first, else dem.json;
//        walls: 1 m sections across the store's break lines with lowSide and dropM > 0 (server/terrain.ts terrainWalls)
// Per campus folder <elevationDir>/<id>/ (default derived/<id>/, git-ignored):
//   store.json      ElevationStore (copy the survey app's elevation_store.json here)
//   dem.json        campo-grid DEM meta (dem_prep.py output, read only). CAMPO_ELEVATION_DEM overrides it.
//   elevation.json  derived/elevation.json written by the solver (--derived-out)
//   solve/          the solver's --out (corrected_dem, residual_field, store.solved.json)
// The recompute writes the unsaved campus into a work folder, runs tools/elevation/campo_height_solver.py with --dirty
// (and the previous residual / derived when there are some), and returns the new derived file. When the solver cannot
// run (no store, no DEM), an elevation.json made earlier is returned as it is, so the editor can still apply it.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { HttpError, writeCampusFiles } from './campus-api.ts';
import { findPython, outputTail, parseCommand, pythonCandidates, showCommand, type Probe, type PythonCommand } from './python.ts';
import { readTerrain } from './terrain.ts';

const CAMPUS_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

export interface SolverRun {
  code: number;
  /** stdout and stderr together, in order. */
  output: string;
  /** The command line that ran (for the error message). */
  command?: string;
  /** stderr alone. */
  stderr?: string;
}
/** Runs the solver with these arguments (tests pass a fake). */
export type RunSolver = (args: string[]) => Promise<SolverRun>;

export interface ElevationApiOptions {
  /** Folder of the per-campus elevation folders (default derived/ at the repository root). */
  elevationDir: string;
  /** tools/elevation/campo_height_solver.py */
  solverScript: string;
  /** A DEM to use for every campus instead of <id>/dem.json. */
  demPath?: string | undefined;
  /** DEM prior σ in metres (--sigma-dem). */
  sigmaDem?: string | undefined;
  /** The Python command (CAMPO_PYTHON, may carry arguments such as "py -3"). Left out: found by pythonCandidates. */
  python?: string | undefined;
  /** Folders whose .venv / venv are tried first when `python` is left out (the repository root, tools/elevation). */
  pythonRoots?: string[];
  run?: RunSolver;
}

/** Runs the solver script with one Python command; the result names the command line and keeps stderr apart. */
export function pythonRunner(python: PythonCommand | string, script: string): RunSolver {
  const cmd = typeof python === 'string' ? parseCommand(python) : python;
  return (args) => new Promise((resolve) => {
    const command = showCommand({ file: cmd.file, args: [...cmd.args, script, ...args] });
    let output = '';
    let stderr = '';
    const child = spawn(cmd.file, [...cmd.args, script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (b: Buffer) => { output += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => {
      const t = b.toString('utf8');
      output += t;
      stderr += t;
    });
    child.on('error', (err) => resolve({ code: -1, output: `${output}${err.message}`, command, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, output, command, stderr }));
  });
}

/**
 * The solver runner of the dev server: with `python` that command only; without it the first working Python 3 of
 * pythonCandidates (looked up on the first recompute and remembered; a failed lookup is tried again next time).
 */
export function autoPythonRunner(script: string, opts: { python?: string | undefined; roots?: readonly string[]; probe?: Probe } = {}): RunSolver {
  let found: Promise<PythonCommand | { error: string }> | null = null;
  return async (args) => {
    found ??= findPython(pythonCandidates({ platform: process.platform, env: { ...process.env, CAMPO_PYTHON: opts.python }, roots: opts.roots ?? [] }), opts.probe);
    const cmd = await found;
    if ('error' in cmd) {
      found = null;
      return { code: -1, output: cmd.error, stderr: cmd.error, command: opts.python ?? '(자동 탐색)' };
    }
    return pythonRunner(cmd, script)(args);
  };
}

/** The Korean error for a failed solver run: the exit code, the command line and the end of stderr (or of the output). */
export function solverFailure(r: SolverRun): string {
  const why = (r.stderr ?? '').trim() || r.output.trim();
  return [
    `고도 계산(campo_height_solver.py)이 실패했습니다(종료 코드 ${r.code}).`,
    r.command ? `실행한 명령: ${r.command}` : '',
    why ? `stderr: ${outputTail(why)}` : '출력이 없습니다.',
  ].filter(Boolean).join('\n');
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

const exists = async (path: string) => (await readIfExists(path)) !== null;

/** The store file must be an ElevationStore v1 and must not carry absolute pressures (they stay in the phone's memory). */
export function checkStoreText(text: string): void {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, '고도 저장소가 JSON이 아닙니다.');
  }
  const s = v as { schemaVersion?: unknown; nodes?: unknown; edges?: unknown };
  if (typeof s !== 'object' || s === null || s.schemaVersion !== 1 || !Array.isArray(s.nodes) || !Array.isArray(s.edges)) {
    throw new HttpError(400, '고도 저장소(schemaVersion 1, nodes, edges) 형식이 아닙니다.');
  }
  if (/"(meanPressureHpa|pHpa|pressureHpa)"\s*:/.test(text)) throw new HttpError(400, '고도 저장소에 절대 기압 값이 들어 있습니다. 저장하지 않습니다.');
}

export function createElevationApi(opts: ElevationApiOptions) {
  const run = opts.run ?? autoPythonRunner(opts.solverScript, { python: opts.python, roots: opts.pythonRoots ?? [] });
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const m = /^\/api\/elevation\/([^/?#]+)(\/store|\/recompute|\/terrain)?\/?(?:\?.*)?$/.exec(req.url ?? '');
    if (!m) return next();
    try {
      const id = decodeURIComponent(m[1]!);
      if (!CAMPUS_ID.test(id)) throw new HttpError(400, `캠퍼스 id가 올바르지 않습니다: ${id}`);
      const dir = join(opts.elevationDir, id);
      const paths = {
        store: join(dir, 'store.json'),
        dem: opts.demPath ?? join(dir, 'dem.json'),
        derived: join(dir, 'elevation.json'),
        solve: join(dir, 'solve'),
      };
      const missing = async () => [
        ...(await exists(paths.store) ? [] : ['store.json(고도 측정 저장소)']),
        ...(await exists(paths.dem) ? [] : ['dem.json(DEM)']),
      ];

      if (!m[2] && req.method === 'GET') {
        const gone = await missing();
        return send(res, 200, { store: await readIfExists(paths.store), solver: { ready: gone.length === 0, missing: gone } });
      }
      if (m[2] === '/terrain' && req.method === 'GET') {
        const corrected = join(paths.solve, 'corrected_dem.json');
        // The walls come from the store's drawn lines; a store that cannot be read gives none, the relief still comes.
        const store = await readIfExists(paths.store).catch(() => null);
        if (await exists(corrected)) return send(res, 200, await readTerrain(corrected, 'corrected', store));
        if (await exists(paths.dem)) return send(res, 200, await readTerrain(paths.dem, 'dem', store));
        return send(res, 200, { grid: null, walls: [] });
      }
      if (m[2] === '/store' && req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as { text?: unknown };
        if (typeof body.text !== 'string') throw new HttpError(400, '요청 본문은 { text } 형식이어야 합니다.');
        checkStoreText(body.text);
        await mkdir(dir, { recursive: true });
        await writeFile(paths.store, body.text, 'utf8');
        return send(res, 200, { written: true });
      }
      if (m[2] === '/recompute' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { request?: unknown; files?: unknown };
        const request = body.request as { format?: unknown } | undefined;
        if (typeof request !== 'object' || request === null || request.format !== 'campo-elevation-dirty/1') {
          throw new HttpError(400, 'request는 recomputeRequest 결과(campo-elevation-dirty/1)여야 합니다.');
        }
        if (typeof body.files !== 'object' || body.files === null || !Object.values(body.files).every((t) => typeof t === 'string')) {
          throw new HttpError(400, 'files는 { 경로: 내용 } 형식이어야 합니다.');
        }
        const gone = await missing();
        if (gone.length > 0) {
          const old = await readIfExists(paths.derived);
          if (old === null) {
            throw new HttpError(409, `고도를 계산할 수 없습니다. ${dir} 에 ${gone.join(', ')}이(가) 없고, 이전 계산 결과(elevation.json)도 없습니다.`);
          }
          return send(res, 200, { derived: JSON.parse(old), mode: 'existing', log: `${gone.join(', ')}이(가) 없어 이전 계산 결과를 그대로 읽었습니다.` });
        }
        await mkdir(dir, { recursive: true });
        const work = await mkdtemp(join(dir, '.work-'));
        let answer: unknown;
        try {
          const campus = join(work, 'campus');
          await writeCampusFiles(campus, body.files as Record<string, string>);
          const dirty = join(work, 'dirty.json');
          await writeFile(dirty, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
          const previousResidual = join(paths.solve, 'residual_field.json');
          const args = [
            // 평지 is held flat by height solver v2 only: a campus with one always runs v2.
            ...(campusHasPlaza(body.files as Record<string, string>) ? ['--engine', 'v2'] : []),
            '--store', paths.store, '--dem', paths.dem, ...(opts.sigmaDem ? ['--sigma-dem', opts.sigmaDem] : []),
            '--campus', campus, '--out', paths.solve, '--derived-out', paths.derived, '--dirty', dirty,
            ...(await exists(previousResidual) ? ['--previous-residual', previousResidual] : []),
            ...(await exists(paths.derived) ? ['--previous-derived', paths.derived] : []),
          ];
          const r = await run(args);
          if (r.code !== 0) throw new HttpError(500, solverFailure(r));
          const text = await readIfExists(paths.derived);
          if (text === null) throw new HttpError(500, '고도 계산이 끝났지만 elevation.json이 없습니다.');
          answer = { derived: JSON.parse(text), mode: 'solved', log: r.output.trim() };
        } finally {
          await rm(work, { recursive: true, force: true });
        }
        return send(res, 200, answer);
      }
      throw new HttpError(405, `${req.method ?? ''} 요청은 지원하지 않습니다.`);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
      return send(res, status, { error: (err as Error).message });
    }
  };
}

/** Whether the campus files hold a plaza (평지) Feature. Files that are not FeatureCollection JSON are skipped. */
export function campusHasPlaza(files: Readonly<Record<string, string>>): boolean {
  return Object.entries(files).some(([path, text]) => {
    if (!path.endsWith('.geojson') || !text.includes('plaza')) return false;
    try {
      const fc = JSON.parse(text) as { features?: { properties?: { kind?: unknown } }[] };
      return (fc.features ?? []).some((f) => f?.properties?.kind === 'plaza');
    } catch {
      return false;
    }
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '보낼 데이터가 너무 큽니다.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
