import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildGraph, predictedTimeSec, type Calibration, type Observation } from '@campo/core';
import { loadCampus } from '@campo/core/node';
import { runCalibrate } from '../src/calibrate-cli.ts';

const FIXTURE = fileURLToPath(new URL('../../core/test/fixtures/campus-basic', import.meta.url));
const OUT_ESC = 'edge:e_out_0002__out_0003_esc';
const IN_ESC = 'edge:e_A_1_esc__A_2_esc_up';
const LIFT = 'elevator:A_elevA';
const TODAY = '2026-11-12';

let root: string;
let lines: string[];
const out = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };

/** Priors of the fixture targets without calibration, so the test does not hard-code the time rules. */
const prior: Record<string, number> = {};
beforeAll(async () => {
  const g = buildGraph(await loadCampus(FIXTURE), { calibration: {} });
  for (const target of [OUT_ESC, IN_ESC, LIFT]) {
    const p = predictedTimeSec(g, target);
    if (p === undefined) throw new Error(`no prior for ${target}`);
    prior[target] = p;
  }
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'campo-calibrate-'));
  lines = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

const r1 = (x: number) => Math.round(x * 10) / 10;
const line = (target: string, duration_sec: number, extra: Partial<Observation> = {}) =>
  JSON.stringify({ target, duration_sec: r1(duration_sec), source: 'field', measured_at: '2026-11-12T09:10:00+09:00', ...extra });

async function campusWith(name: string, files: Record<string, string[]>): Promise<string> {
  const dir = join(root, name);
  await cp(FIXTURE, dir, { recursive: true });
  // The fixture ships its own sample measurements; these tests bring their own.
  await rm(join(dir, 'observations'), { recursive: true, force: true });
  await rm(join(dir, 'calibration.json'), { force: true });
  if (Object.keys(files).length > 0) await mkdir(join(dir, 'observations'), { recursive: true });
  for (const [file, rows] of Object.entries(files)) await writeFile(join(dir, 'observations', file), `${rows.join('\n')}\n`);
  return dir;
}

const measured = () => ({
  '2026-11-12.jsonl': [
    line(OUT_ESC, prior[OUT_ESC]! * 1.2),
    line(OUT_ESC, prior[OUT_ESC]! * 1.2, { direction: 'forward' }),
    line(IN_ESC, prior[IN_ESC]! * 0.8, { source: 'app' }),
  ],
  '2026-11-13.jsonl': [line(LIFT, prior[LIFT]! * 1.5, { direction: 'backward', note: '쉬는 시간' })],
});
const readCalibration = async (dir: string) => readFile(join(dir, 'calibration.json'), 'utf8');

describe('campo-calibrate', () => {
  it('writes calibration.json with sorted keys, blended estimates and a trailing newline', async () => {
    const dir = await campusWith('c', measured());
    expect(await runCalibrate([dir], { today: TODAY }, out, root)).toBe(0);

    const text = await readCalibration(dir);
    const cal = JSON.parse(text) as Calibration;
    expect(text).toBe(`${JSON.stringify(cal, null, 2)}\n`);
    expect(Object.keys(cal)).toEqual([IN_ESC, OUT_ESC, LIFT].sort());

    const median = r1(prior[OUT_ESC]! * 1.2);
    expect(cal[OUT_ESC]).toEqual({
      prior_sec: r1(prior[OUT_ESC]!),
      median_sec: median,
      n: 2,
      estimate_sec: r1((3 * prior[OUT_ESC]! + 2 * median) / 5),
      updated_at: TODAY,
    });
    expect(cal[IN_ESC]).toMatchObject({ n: 1, median_sec: r1(prior[IN_ESC]! * 0.8) });
    // Elevator measurements ignore direction.
    expect(cal[LIFT]).toMatchObject({ n: 1, median_sec: r1(prior[LIFT]! * 1.5) });
    expect(lines.join('\n')).toContain(`추가 ${OUT_ESC}: 없음 → ${cal[OUT_ESC]!.estimate_sec.toFixed(1)}초`);
  });

  it('--dry-run prints the changes and writes nothing', async () => {
    const dir = await campusWith('c', measured());
    expect(await runCalibrate([dir], { dryRun: true, today: TODAY }, out, root)).toBe(0);
    expect(existsSync(join(dir, 'calibration.json'))).toBe(false);
    expect(lines.filter((l) => l.includes('추가 '))).toHaveLength(3);
    expect(lines).toContain('--dry-run: 파일을 쓰지 않았습니다.');

    // With a file in place, a new measurement shows as before → after and the file stays as it was.
    lines = [];
    expect(await runCalibrate([dir], { today: TODAY }, out, root)).toBe(0);
    const before = await readCalibration(dir);
    const old = (JSON.parse(before) as Calibration)[IN_ESC]!.estimate_sec;
    await writeFile(join(dir, 'observations', '2026-11-14.jsonl'), `${line(IN_ESC, prior[IN_ESC]! * 0.8)}\n`);
    lines = [];
    expect(await runCalibrate([dir], { dryRun: true, today: TODAY }, out, root)).toBe(0);
    expect(lines.find((l) => l.startsWith(`  바뀜 ${IN_ESC}: ${old.toFixed(1)}초 → `))).toBeDefined();
    expect(lines).toContain('  그대로 2개');
    expect(await readCalibration(dir)).toBe(before);
  });

  it('gives the same file on a second run, also on a later day', async () => {
    const dir = await campusWith('c', measured());
    expect(await runCalibrate([dir], { today: TODAY }, out, root)).toBe(0);
    const once = await readCalibration(dir);

    lines = [];
    expect(await runCalibrate([dir], { today: TODAY }, out, root)).toBe(0);
    expect(await readCalibration(dir)).toBe(once);
    expect(lines).toContain('  calibration.json: 바뀐 것이 없습니다.');

    // Unchanged numbers keep their updated_at, so a rerun without new data never makes a diff.
    expect(await runCalibrate([dir], { today: '2026-12-01' }, out, root)).toBe(0);
    expect(await readCalibration(dir)).toBe(once);
  });

  it('skips a campus without measurements: creates nothing and keeps an existing calibration.json', async () => {
    const empty = await campusWith('a-empty', {});
    const kept = await campusWith('b-kept', {});
    const existing = '{\n  "edge:x": {}\n}\n';
    await writeFile(join(kept, 'calibration.json'), existing);

    expect(await runCalibrate([root], { today: TODAY }, out, root)).toBe(0);
    expect(lines).toContain('■ a-empty — 측정 없음, 건너뜁니다.');
    expect(lines).toContain('■ b-kept — 측정 없음, 건너뜁니다.');
    expect(existsSync(join(empty, 'calibration.json'))).toBe(false);
    expect(await readCalibration(kept)).toBe(existing);
  });

  it('warns about measurements of targets that do not exist and still writes the rest', async () => {
    const dir = await campusWith('c', {
      'a.jsonl': [line('edge:e_nope', 20), line('edge:e_nope', 21), line('elevator:Z_elevQ', 30), line(OUT_ESC, prior[OUT_ESC]!)],
    });
    expect(await runCalibrate([dir], { today: TODAY }, out, root)).toBe(0);
    expect(lines).toContain('  경고: 대상을 찾을 수 없어 측정 2개를 건너뛰었습니다: edge:e_nope');
    expect(lines).toContain('  경고: 대상을 찾을 수 없어 측정 1개를 건너뛰었습니다: elevator:Z_elevQ');
    expect(Object.keys(JSON.parse(await readCalibration(dir)))).toEqual([OUT_ESC]);
  });

  it('reports malformed lines (unknown keys included) by file and line and skips them', async () => {
    const dir = await campusWith('c', {
      'a.jsonl': [line(OUT_ESC, prior[OUT_ESC]!), JSON.stringify({ ...JSON.parse(line(OUT_ESC, 1)), device_id: 'd1' }), '{oops'],
    });
    expect(await runCalibrate([dir], { today: TODAY }, out, root)).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('observations/a.jsonl:2: 모르는 항목이 있습니다');
    expect(text).toContain('observations/a.jsonl:3');
    expect(JSON.parse(await readCalibration(dir))[OUT_ESC]).toMatchObject({ n: 1 });
  });

  it('exits 1 for a folder that does not exist', async () => {
    expect(await runCalibrate([join(root, 'nope')], { today: TODAY }, out, root)).toBe(1);
    expect(lines.join('\n')).toContain('폴더를 찾을 수 없습니다');
  });
});
