// Elevation in the editor (docs/ELEVATION_INTEGRATION.md 12장): the two facts a person sets on an edge (flat_exact,
// is_breakline), the read-only recomputed values, the recompute's write-back, the hand-drawn break lines and the slope
// parts of a route. Map data changes only through core actions (setProps, applyDerivedElevation → setEdgeElevation).
import {
  GRADE_CAUTION_MAX_PCT,
  GRADE_GENTLE_MAX_PCT,
  gradeClass,
  metres,
  setProps,
  type EdgeProperties,
  type EditState,
  type Position,
  type SlopeSegment,
} from '@campo/core';
import {
  applyDerivedElevation,
  emptyElevationStore,
  readDerivedElevation,
  serializeElevationStore,
  type BreakLine,
  type ElevationStore,
  type RecomputeRequest,
} from '@campo/core/elevation';
import type { PlanResult } from './plan.ts';

// ---- flat_exact · is_breakline: the schema rules (ELEVATION_INTEGRATION.md 3장) ----

type EdgeKind = Pick<EdgeProperties, 'highway' | 'flat_exact' | 'is_breakline'>;

/** flat_exact is for footway and corridor only. */
export const flatExactAllowed = (p: Pick<EdgeProperties, 'highway'>): boolean => p.highway === 'footway' || p.highway === 'corridor';
/** is_breakline is for footway, steps and ramp only. */
export const breaklineAllowed = (p: Pick<EdgeProperties, 'highway'>): boolean => p.highway === 'footway' || p.highway === 'steps' || p.highway === 'ramp';

/** Why the toggle cannot be used on this edge (Korean), or false. */
export function flagBlocked(p: EdgeKind, flag: 'flat_exact' | 'is_breakline'): string | false {
  if (flag === 'flat_exact') {
    if (!flatExactAllowed(p)) return '평지 확인은 평지 길과 복도에만 씁니다.';
    if (p.is_breakline === true) return '단절선으로 표시한 구간은 평지로 확인할 수 없습니다.';
    return false;
  }
  if (!breaklineAllowed(p)) return '단절선은 평지 길, 계단, 경사로에만 씁니다.';
  if (p.flat_exact === true) return '평지로 확인한 구간은 단절선이 될 수 없습니다.';
  return false;
}

/** Turn flat_exact or is_breakline on (true) or off (removed: "not checked"). One setProps, one history entry. */
export function planElevationFlag(state: EditState, id: string, flag: 'flat_exact' | 'is_breakline', on: boolean): PlanResult {
  const edge = state.edges[id];
  if (!edge) return { error: '구간을 찾을 수 없습니다.' };
  if (on) {
    const blocked = flagBlocked(edge.props, flag);
    if (blocked) return { error: blocked };
  }
  if ((edge.props[flag] === true) === on) return { error: '바뀐 내용이 없습니다.' };
  const label = flag === 'flat_exact' ? '평지 확인' : '단절선';
  return { annotation: `${label} ${on ? '표시' : '해제'}`, steps: [() => setProps([id], { [flag]: on ? true : undefined })] };
}

/**
 * What else a change of `highway` must clear on an edge so it still meets the schema: flat_exact when it stops being a
 * footway / corridor (계단 등으로 바꿀 때), is_breakline when it becomes a corridor or an elevator.
 */
export function kindChangeExtras(p: EdgeKind, highway: string): Record<string, undefined> {
  const next = { highway } as Pick<EdgeProperties, 'highway'>;
  const out: Record<string, undefined> = {};
  if (p.flat_exact !== undefined && !flatExactAllowed(next)) out['flat_exact'] = undefined;
  if (p.is_breakline !== undefined && !breaklineAllowed(next)) out['is_breakline'] = undefined;
  return out;
}

// ---- Read-only values ----

export interface ElevationBadges {
  /** "+1.20 m" (to minus from). */
  diff: string | null;
  /** "±0.20 m". */
  sigma: string | null;
  /** "2.6 %" and its class (gentle / caution / steep). */
  grade: { text: string; cls: 'gentle' | 'caution' | 'steep' } | null;
}

const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

/** The recomputed values of an edge as short texts, or null when it has none. */
export function elevationBadges(p: Pick<EdgeProperties, 'elev_diff_m' | 'elev_sigma_m' | 'grade_pct'>): ElevationBadges | null {
  if (p.elev_diff_m === undefined && p.grade_pct === undefined) return null;
  return {
    diff: p.elev_diff_m === undefined ? null : `${signed(p.elev_diff_m, 2)} m`,
    sigma: p.elev_sigma_m === undefined ? null : `±${p.elev_sigma_m.toFixed(2)} m`,
    grade: p.grade_pct === undefined ? null : { text: `${signed(p.grade_pct, 1)} %`, cls: gradeClass(p.grade_pct) },
  };
}

export const GRADE_LIMITS = { gentle: GRADE_GENTLE_MAX_PCT, caution: GRADE_CAUTION_MAX_PCT } as const;

// ---- 고도 다시 계산 ----

/** "고도 다시 계산 필요 3곳": campus places (nodes, edges, buildings) plus measured heights waiting for a recompute. */
export function dirtyLabel(count: number): string {
  return `고도 다시 계산 필요 ${count}곳`;
}

/**
 * The solver's answer → one setEdgeElevation plan (annotation "고도 다시 계산", one history line), or why nothing changes.
 * Throws (Korean) when the file is not a derived elevation result. The caller clears the dirt with clearDirty(d, req).
 */
export function planRecomputeResult(state: EditState, req: RecomputeRequest, json: unknown): PlanResult {
  const action = applyDerivedElevation(state, readDerivedElevation(json), req);
  const reason = action.disabled(state);
  return reason === false ? { annotation: '고도 다시 계산', steps: [() => action] } : { error: reason };
}

// ---- 불연속선 (ElevationStore.breaklines): not map data, kept in the elevation store file ----

/** The store as the dev server sent it (or an empty one). Unreadable text throws in Korean. */
export function parseStore(text: string | null): ElevationStore {
  if (text === null || text.trim() === '') return emptyElevationStore();
  const v = JSON.parse(text) as Partial<ElevationStore>;
  if (v.schemaVersion !== 1 || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) throw new Error('고도 저장소 파일(schemaVersion 1)이 아닙니다.');
  return v as ElevationStore;
}

export function withBreakline(store: ElevationStore, coords: readonly Position[], id: string, now: number): ElevationStore | { error: string } {
  const line = coords.map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
  const length = coords.slice(1).reduce((s, c, i) => s + metres(coords[i]!, c), 0);
  if (line.length < 2 || length < 1) return { error: '고도 단절선은 1m 이상, 점 두 개 이상으로 그려 주세요.' };
  const b: BreakLine = { id, coordinates: line, source: 'manual', createdAt: now };
  return { ...store, breaklines: [...(store.breaklines ?? []), b] };
}

export function withoutBreakline(store: ElevationStore, id: string): ElevationStore {
  return { ...store, breaklines: (store.breaklines ?? []).filter((b) => b.id !== id) };
}

export const storeText = (store: ElevationStore): string => serializeElevationStore(store);

/** How far a break line reaches into the recompute: campus nodes this close to it are dirtied (residual smoothing radius). */
export const BREAKLINE_REACH_M = 30;

/** Campus nodes within BREAKLINE_REACH_M of a break line's vertices or segment midpoints (a drawn or removed line dirties them). */
export function nodesNearLine(state: EditState, line: BreakLine): string[] {
  const pts: Position[] = [];
  const c = line.coordinates.map((p): Position => [p.lng, p.lat]);
  c.forEach((p, i) => {
    pts.push(p);
    const q = c[i + 1];
    if (q) pts.push([(p[0]! + q[0]!) / 2, (p[1]! + q[1]!) / 2]);
  });
  return Object.values(state.nodes).filter((n) => pts.some((p) => metres(p, n.coord) <= BREAKLINE_REACH_M)).map((n) => n.id);
}

// ---- 경로 테스트: caution and steep parts of a route ----

export interface SlopeLine {
  cls: 'caution' | 'steep';
  coordinates: Position[];
}

/** The slope segments of a route as lines in travel direction (the edge's own vertices). */
export function slopeLines(state: EditState, segments: readonly SlopeSegment[]): SlopeLine[] {
  return segments.flatMap((s) => {
    const e = state.edges[s.edgeId];
    const a = state.nodes[s.from]?.coord;
    const b = state.nodes[s.to]?.coord;
    if (!e || !a || !b) return [];
    const inner = e.props.from === s.from ? e.vertices : [...e.vertices].reverse();
    return [{ cls: s.gradeClass, coordinates: [a, ...inner, b] }];
  });
}

/** "주의 2곳 · 급경사 1곳" for a route card, or null when the route has no slope worth a word. */
export function slopeSummary(segments: readonly SlopeSegment[]): { caution: number; steep: number; maxPct: number } | null {
  if (segments.length === 0) return null;
  return {
    caution: segments.filter((s) => s.gradeClass === 'caution').length,
    steep: segments.filter((s) => s.gradeClass === 'steep').length,
    maxPct: Math.max(...segments.map((s) => Math.abs(s.gradePct))),
  };
}
