// Measured time calibration (SPEC-v0.2 3.9). Pure functions: no DOM, no file system.
// `npm run calibrate` (packages/tools) reads observations/*.jsonl, asks the routing graph for the
// prior of each target and writes calibration.json from `calibrate()`.
import { CALIBRATION_K, OUTLIER_RATIO } from '../costs.ts';
import type { Calibration, CalibrationEntry, Observation } from '../types.ts';

const EDGE_PREFIX = 'edge:';
const ELEVATOR_PREFIX = 'elevator:';
/** Suffix of the key for an edge travelled against its drawn direction. */
export const BACKWARD_SUFFIX = '#backward';

/**
 * calibration.json key of a measurement: `edge:<id>#backward` for an edge measured against its
 * drawn direction, otherwise the target itself. Elevator targets ignore `direction` (waiting time
 * does not depend on it).
 */
export function observationKey(o: Pick<Observation, 'target' | 'direction'>): string {
  if (o.target.startsWith(EDGE_PREFIX) && o.direction === 'backward') return `${o.target}${BACKWARD_SUFFIX}`;
  return o.target;
}

/** Inverse of observationKey: `edge:x#backward` → { target: 'edge:x', direction: 'backward' }. */
export function splitObservationKey(key: string): { target: string; direction?: 'backward' } {
  if (key.startsWith(EDGE_PREFIX) && key.endsWith(BACKWARD_SUFFIX)) {
    return { target: key.slice(0, -BACKWARD_SUFFIX.length), direction: 'backward' };
  }
  return { target: key };
}

// ---- Reading observations ----

const KNOWN_KEYS = new Set(['target', 'duration_sec', 'direction', 'source', 'measured_at', 'note']);
const MEASURED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Why `record` is not an Observation (Korean, for people), or undefined when it is one.
 * Same rules as $defs/observation in campo.schema.json. Unknown keys are refused so that a user
 * id, device id or position never slips into the data (SPEC-v0.2 3.9.2).
 */
export function observationProblem(record: unknown): string | undefined {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return '측정 한 줄은 JSON 객체여야 합니다.';
  const r = record as Record<string, unknown>;
  const unknown = Object.keys(r).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length > 0) return `모르는 항목이 있습니다(개인정보 방지를 위해 받지 않습니다): ${unknown.join(', ')}`;
  const target = r['target'];
  if (typeof target !== 'string' || !/^(edge|elevator):.+/.test(target)) return 'target은 "edge:<구간 id>" 또는 "elevator:<elevator_id>"여야 합니다.';
  const duration = r['duration_sec'];
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return 'duration_sec는 0보다 큰 숫자여야 합니다.';
  if (r['direction'] !== undefined && r['direction'] !== 'forward' && r['direction'] !== 'backward') return 'direction은 "forward" 또는 "backward"여야 합니다.';
  if (r['source'] !== 'field' && r['source'] !== 'app') return 'source는 "field" 또는 "app"이어야 합니다.';
  if (typeof r['measured_at'] !== 'string' || !MEASURED_AT.test(r['measured_at'])) return 'measured_at은 시간대가 있는 ISO 8601 시각이어야 합니다(예: 2026-11-12T09:10:00+09:00).';
  if (r['note'] !== undefined && typeof r['note'] !== 'string') return 'note는 문자열이어야 합니다.';
  return undefined;
}

export interface ParsedObservations {
  /** Good lines in file order. `line` is 1-based. */
  observations: { line: number; record: Observation }[];
  /** Lines that are not JSON or not an Observation. */
  errors: { line: number; message: string }[];
}

/** Read one observations/*.jsonl text. Blank lines are skipped; bad lines go to `errors`, never throws. */
export function parseObservations(text: string): ParsedObservations {
  const result: ParsedObservations = { observations: [], errors: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch (err) {
      result.errors.push({ line, message: `JSON으로 읽을 수 없습니다: ${(err as Error).message}` });
      return;
    }
    const problem = observationProblem(record);
    if (problem !== undefined) result.errors.push({ line, message: problem });
    else result.observations.push({ line, record: record as Observation });
  });
  return result;
}

// ---- Calculation ----

type Measured = Pick<Observation, 'duration_sec' | 'source'>;

/** Keep measurements within [prior / OUTLIER_RATIO, prior × OUTLIER_RATIO] (bounds included). */
export function dropOutliers<T extends Pick<Observation, 'duration_sec'>>(obs: readonly T[], prior: number): T[] {
  return obs.filter((o) => o.duration_sec >= prior / OUTLIER_RATIO && o.duration_sec <= prior * OUTLIER_RATIO);
}

/** Field weight in the median: a field measurement counts twice, an app report once. */
const SOURCE_WEIGHT: Record<Observation['source'], number> = { field: 2, app: 1 };

/**
 * Median after repeating each `field` measurement twice and each `app` one once; with an even
 * count, the mean of the middle two. undefined for an empty list.
 */
export function weightedMedian(obs: readonly Measured[]): number | undefined {
  const values: number[] = [];
  for (const o of obs) for (let i = 0; i < SOURCE_WEIGHT[o.source]; i++) values.push(o.duration_sec);
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

/** (k × prior + n × median) / (k + n): close to the prior with few measurements, to the median with many. */
export function blend(prior: number, median: number, n: number, k: number = CALIBRATION_K): number {
  return (k * prior + n * median) / (k + n);
}

export interface CalibrateResult {
  /** One entry per key with at least one measurement left, keys in code-unit order. */
  calibration: Calibration;
  /** Keys whose target priorOf does not know (no such edge or elevator), sorted. Their measurements are ignored. */
  skipped: string[];
  /** Keys whose measurements were all outliers, sorted. They get no entry. */
  allOutliers: string[];
}

/**
 * Turn measurements into calibration.json (SPEC-v0.2 3.9.3). Measurements are grouped by
 * observationKey. For each key: priorOf(key) gives the predicted time without calibration
 * (undefined, non-finite or ≤ 0 → key goes to `skipped`); outliers are dropped (none left → key
 * goes to `allOutliers`); the weighted median is blended with the prior with n = measurements
 * left (unweighted). prior_sec, median_sec and estimate_sec are rounded to 0.1 s; estimate_sec is
 * computed from the unrounded values. updated_at is `today`. The result does not depend on the
 * order of `observations`.
 */
export function calibrate(
  observations: readonly Observation[],
  priorOf: (key: string) => number | undefined,
  today: string,
): CalibrateResult {
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    const key = observationKey(o);
    const group = groups.get(key);
    if (group) group.push(o);
    else groups.set(key, [o]);
  }

  const calibration: Calibration = {};
  const skipped: string[] = [];
  const allOutliers: string[] = [];
  for (const key of [...groups.keys()].sort(compareKeys)) {
    const prior = priorOf(key);
    if (prior === undefined || !Number.isFinite(prior) || prior <= 0) {
      skipped.push(key);
      continue;
    }
    const kept = dropOutliers(groups.get(key)!, prior);
    const median = weightedMedian(kept);
    if (median === undefined) {
      allOutliers.push(key);
      continue;
    }
    const entry: CalibrationEntry = {
      prior_sec: round1(prior),
      median_sec: round1(median),
      n: kept.length,
      estimate_sec: round1(blend(prior, median, kept.length)),
      updated_at: today,
    };
    calibration[key] = entry;
  }
  return { calibration, skipped, allOutliers };
}

/** Round to one decimal place (20.875 → 20.9). */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Plain code-unit order so every machine sorts the same. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
