// 측정 입력 (SPEC-v0.2 3.9): which target the selection stands for, what is known about it, and the line a new measurement becomes.
// No calibration maths here: predicted times, outliers and the keys all come from core (predictedTimeSec, dropOutliers, observationKey).
// A measurement is not a map edit, so it is not in the edit history; it waits in the session until the next save.
import {
  buildingById,
  dropOutliers,
  observationKey,
  observationProblem,
  parseObservations,
  predictedTimeSec,
  type CampusGraph,
  type EditState,
  type LoadedFile,
  type Observation,
} from '@campo/core';

export type Direction = 'forward' | 'backward';

export interface MeasureTarget {
  /** "edge:<id>" or "elevator:<elevator_id>". */
  target: string;
  /** Korean name for the screen, e.g. "에스컬레이터 구간" or "A동 엘리베이터 A_elevA". */
  label: string;
  /** Edge targets have a direction; elevators do not. */
  isEdge: boolean;
}

/**
 * What the selection measures. An elevator edge is not a calibration target (SPEC-v0.2 3.9): it stands for the elevator of its stop.
 * A lone elevator stop is that elevator. Anything else cannot be measured.
 */
export function measureTargetOf(state: EditState, selection: readonly string[]): MeasureTarget | { reason: string } {
  if (selection.length !== 1) return { reason: '구간이나 엘리베이터 정차 지점을 하나만 골라 주세요.' };
  const id = selection[0]!;
  const elevator = (elevatorId: string | undefined, where: string): MeasureTarget | { reason: string } =>
    elevatorId ? { target: `elevator:${elevatorId}`, label: `${where} 엘리베이터 ${elevatorId}의 기다리는 시간`, isEdge: false } : { reason: '엘리베이터 번호가 없는 정차 지점입니다.' };
  const stopWhere = (buildingId: string | null) => (buildingId ? buildingById(state, buildingId)?.props.name ?? '' : '');

  const node = state.nodes[id];
  if (node) {
    return node.props.node_type === 'elevator_stop'
      ? elevator(node.props.elevator_id, stopWhere(node.props.building_id))
      : { reason: '지점은 잴 수 없습니다. 구간이나 엘리베이터 정차 지점을 골라 주세요.' };
  }
  const edge = state.edges[id];
  if (!edge) return { reason: '구간이나 엘리베이터 정차 지점을 골라 주세요.' };
  if (edge.props.highway === 'elevator') {
    const stop = state.nodes[edge.props.from];
    return elevator(stop?.props.elevator_id, stopWhere(stop?.props.building_id ?? null));
  }
  const what = edge.props.conveying !== undefined ? (edge.props.highway === 'steps' ? '에스컬레이터' : '무빙워크') : '구간';
  return { target: `edge:${id}`, label: `${what} ${id}`, isEdge: true };
}

export interface DirectionSummary {
  direction: Direction;
  /** calibration.json key: "edge:<id>#backward" for the backward direction. */
  key: string;
  predictedSec: number;
  /** Measurements saved plus not yet saved, for this key. */
  count: number;
  /** Of those, not saved yet. */
  pending: number;
  /** calibration.json's estimate for the key, when it has one. */
  estimateSec?: number;
  /** After the outliers are dropped, the number the calibration should have used. */
  expectedN: number;
  /** calibration.json is behind the measurements: save, then run npm run calibrate. */
  stale: boolean;
}

export interface MeasureSummary {
  target: MeasureTarget;
  directions: DirectionSummary[];
}

/** Records of every observations/*.jsonl among `extras` (bad lines are left to the 검사 tab). */
export function loadedObservations(extras: readonly LoadedFile[]): Observation[] {
  return extras.filter((f) => /^observations\/.+\.jsonl$/.test(f.path)).flatMap((f) => parseObservations(f.text).observations.map((o) => o.record));
}

function calibrationEntry(extras: readonly LoadedFile[], key: string): { estimateSec: number; n: number } | undefined {
  const file = extras.find((f) => f.path === 'calibration.json');
  if (!file) return undefined;
  try {
    const entry = (JSON.parse(file.text) as Record<string, { estimate_sec?: unknown; n?: unknown } | undefined>)[key];
    return typeof entry?.estimate_sec === 'number' && entry.estimate_sec > 0 && typeof entry.n === 'number'
      ? { estimateSec: entry.estimate_sec, n: entry.n }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Predicted times, counts and the calibration state of `target`. `graph` is built without calibration (buildGraph(campus, { calibration: {} })).
 * A target with no link in the graph (a one-way edge measured against it, a stop nobody can reach) is not measurable.
 */
export function measureSummary(target: MeasureTarget, graph: CampusGraph, extras: readonly LoadedFile[], pending: readonly Observation[]): MeasureSummary | { reason: string } {
  const saved = loadedObservations(extras);
  const directions: DirectionSummary[] = [];
  for (const direction of target.isEdge ? (['forward', 'backward'] as const) : (['forward'] as const)) {
    const predicted = predictedTimeSec(graph, target.target, direction);
    if (predicted === undefined) continue;
    const key = observationKey({ target: target.target, ...(target.isEdge ? { direction } : {}) });
    const mine = (list: readonly Observation[]) => list.filter((o) => observationKey(o) === key);
    const [all, waiting] = [[...mine(saved), ...mine(pending)], mine(pending)];
    const entry = calibrationEntry(extras, key);
    const expectedN = dropOutliers(all, predicted).length;
    directions.push({
      direction, key, predictedSec: predicted, count: all.length, pending: waiting.length,
      ...(entry ? { estimateSec: entry.estimateSec } : {}),
      expectedN,
      stale: waiting.length > 0 || expectedN !== (entry?.n ?? 0),
    });
  }
  if (directions.length === 0) return { reason: '길찾기가 지나지 않는 구간이라 잴 수 없습니다. 엘리베이터 구간은 엘리베이터 정차 지점으로 재세요.' };
  return { target, directions };
}

export const directionLabel = (d: Direction): string => (d === 'forward' ? '그린 방향' : '반대 방향');

/** "2026-11-12T09:10:00+09:00": the time in Korea, with its zone. */
export function kstIso(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
}

export interface MeasureForm {
  /** Typed text, seconds. */
  seconds: string;
  direction: Direction;
  note: string;
}

/** The line a typed measurement becomes, checked with core's observationProblem; or why it cannot be saved. */
export function makeObservation(target: MeasureTarget, form: MeasureForm, now: Date): { record: Observation } | { error: string } {
  const seconds = Number(form.seconds.trim());
  if (form.seconds.trim() === '' || !Number.isFinite(seconds) || seconds <= 0) return { error: '시간(초)에 0보다 큰 숫자를 넣어 주세요.' };
  const note = form.note.trim();
  const record: Observation = {
    target: target.target,
    duration_sec: seconds,
    ...(target.isEdge ? { direction: form.direction } : {}),
    source: 'field',
    measured_at: kstIso(now),
    ...(note ? { note } : {}),
  };
  const problem = observationProblem(record);
  return problem === undefined ? { record } : { error: problem };
}
