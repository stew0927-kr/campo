import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CALIBRATION_FILE,
  OBSERVATIONS_DIR,
  buildGraph,
  calibrate,
  formatMeta,
  observationKey,
  observationProblem,
  predictedTimeSec,
  splitObservationKey,
  type Calibration,
  type CalibrationEntry,
  type Observation,
} from '@campo/core';
import { loadCampus } from '@campo/core/node';
import type { Output } from './cli.ts';
import { campusFolders, display, isDirectory, isFile } from './folders.ts';

export interface CalibrateOptions {
  /** Print what would change and write nothing. */
  dryRun?: boolean;
  /** yyyy-mm-dd written to updated_at. Default: today in the local time zone. */
  today?: string;
}

/**
 * Recompute calibration.json for each campus from its observations/*.jsonl (SPEC-v0.2 3.9.3).
 * `targets` are campus folders (they hold campus.json) or folders of campus folders.
 *
 * - A campus without measurements is left alone: no file is created and an existing
 *   calibration.json is kept.
 * - Priors come from the graph built without calibration (predictedTimeSec).
 * - Measurements whose target does not exist are skipped with a warning; malformed lines are
 *   reported and skipped (validate reports them as errors).
 * - The file is the full recomputation, keys sorted, two-space indent, trailing newline.
 *   An entry whose numbers did not change keeps its previous updated_at, so a rerun without new
 *   measurements leaves the file byte-for-byte equal on any day.
 *
 * Returns the process exit code: 1 when a folder does not exist, otherwise 0.
 */
export async function runCalibrate(
  targets: string[],
  options: CalibrateOptions = {},
  out: Output = console,
  cwd = process.cwd(),
): Promise<number> {
  const today = options.today ?? localDate(new Date());
  const campuses: string[] = [];
  for (const target of targets) {
    if (!(await isDirectory(target))) {
      out.error(`폴더를 찾을 수 없습니다: ${display(cwd, target)}`);
      return 1;
    }
    campuses.push(...(await campusFolders(target)));
  }
  if (campuses.length === 0) {
    out.log('보정할 캠퍼스가 없습니다.');
    return 0;
  }

  for (const dir of campuses) {
    const shown = display(cwd, dir);
    const campus = await loadCampus(dir);

    const unreadable = campus.fileErrors.filter((e) => e.file.startsWith(`${OBSERVATIONS_DIR}/`));
    const records = campus.observations ?? [];
    if (records.length === 0 && unreadable.length === 0) {
      out.log(`■ ${shown} — 측정 없음, 건너뜁니다.`);
      continue;
    }

    const observations: Observation[] = [];
    const badLines: string[] = [];
    for (const e of unreadable) badLines.push(`${e.file}: ${e.message}`);
    for (const { file, line, record } of records) {
      const problem = observationProblem(record);
      if (problem === undefined) observations.push(record as Observation);
      else badLines.push(`${file}:${line}: ${problem}`);
    }
    out.log(`■ ${shown} — 측정 ${observations.length}개`);
    for (const bad of badLines) out.error(`  읽지 못한 줄(건너뜀) ${bad}`);
    if (observations.length === 0) {
      out.log('  쓸 수 있는 측정이 없어 건너뜁니다.');
      continue;
    }

    const graph = buildGraph(campus, { calibration: {} });
    const priorOf = (key: string): number | undefined => {
      const { target, direction } = splitObservationKey(key);
      return predictedTimeSec(graph, target, direction);
    };
    const result = calibrate(observations, priorOf, today);

    const counts = countByKey(observations);
    for (const key of result.skipped) {
      out.error(`  경고: 대상을 찾을 수 없어 측정 ${counts.get(key) ?? 0}개를 건너뛰었습니다: ${key}`);
    }
    for (const key of result.allOutliers) {
      out.log(`  주의: 측정 ${counts.get(key) ?? 0}개가 모두 예측값과 너무 달라 버렸습니다: ${key}`);
    }

    const previous = previousEntries(campus.calibration);
    const next = keepDates(result.calibration, previous);
    reportChanges(previous, next, out);

    const path = join(dir, CALIBRATION_FILE);
    const exists = await isFile(path);
    const text = formatMeta(next);
    if (Object.keys(next).length === 0 && !exists) {
      out.log(`  보정할 대상이 없어 ${CALIBRATION_FILE}을(를) 만들지 않았습니다.`);
      continue;
    }
    if (exists && (await readFile(path, 'utf8')) === text) {
      out.log(`  ${CALIBRATION_FILE}: 바뀐 것이 없습니다.`);
      continue;
    }
    if (options.dryRun) continue;
    await writeFile(path, text);
    out.log(`  ${CALIBRATION_FILE}을(를) 썼습니다.`);
  }

  if (options.dryRun) {
    out.log('');
    out.log('--dry-run: 파일을 쓰지 않았습니다.');
  }
  return 0;
}

function countByKey(observations: readonly Observation[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of observations) {
    const key = observationKey(o);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Entries of the current calibration.json that look like CalibrationEntry (the file is unvalidated). */
function previousEntries(raw: unknown): Map<string, CalibrationEntry> {
  const entries = new Map<string, CalibrationEntry>();
  if (!isRecord(raw)) return entries;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { prior_sec, median_sec, n, estimate_sec, updated_at } = value;
    if (typeof prior_sec === 'number' && typeof median_sec === 'number' && typeof n === 'number' && typeof estimate_sec === 'number' && typeof updated_at === 'string') {
      entries.set(key, { prior_sec, median_sec, n, estimate_sec, updated_at });
    }
  }
  return entries;
}

/** Keep the previous updated_at for entries whose numbers are unchanged. */
function keepDates(next: Calibration, previous: Map<string, CalibrationEntry>): Calibration {
  const result: Calibration = {};
  for (const [key, entry] of Object.entries(next)) {
    const old = previous.get(key);
    result[key] = old && sameNumbers(old, entry) ? { ...entry, updated_at: old.updated_at } : entry;
  }
  return result;
}

function sameNumbers(a: CalibrationEntry, b: CalibrationEntry): boolean {
  return a.prior_sec === b.prior_sec && a.median_sec === b.median_sec && a.n === b.n && a.estimate_sec === b.estimate_sec;
}

/** One line per added, changed or removed key (estimate_sec before → after), then the unchanged count. */
function reportChanges(previous: Map<string, CalibrationEntry>, next: Calibration, out: Output): void {
  const keys = [...new Set([...previous.keys(), ...Object.keys(next)])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let unchanged = 0;
  for (const key of keys) {
    const before = previous.get(key);
    const after = next[key];
    if (before && after && sameNumbers(before, after)) {
      unchanged++;
      continue;
    }
    const was = before ? `${sec(before.estimate_sec)}` : '없음';
    const now = after ? `${sec(after.estimate_sec)} (예측 ${sec(after.prior_sec)}, 측정 ${after.n}개의 중앙값 ${sec(after.median_sec)})` : '없음';
    const label = !before ? '추가' : !after ? '지움' : '바뀜';
    out.log(`  ${label} ${key}: ${was} → ${now}`);
  }
  if (unchanged > 0) out.log(`  그대로 ${unchanged}개`);
}

function sec(x: number): string {
  return `${x.toFixed(1)}초`;
}

/** yyyy-mm-dd in the local time zone. */
function localDate(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
