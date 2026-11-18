/**
 * 지연 재계산(lazy recompute) — 편집할 때는 무엇이 바뀌었는지(dirty)만 기록하고, 사람이 "고도 다시 계산"을 누를 때만
 * 바뀐 성분과 타일을 다시 푼다.
 *
 *   편집 동작(History의 Immer 패치) ─markEditPatches─┐
 *   기압 측정(버퍼가 만든 엣지)      ─markMeasurements─┤→ ElevationDirty ─recomputeRequest→ JSON
 *                                                    │        → python tools/elevation/campo_height_solver.py --dirty
 *                                                    │          (v1: 그 성분만 다시 풀고 잔차장은 dirty 타일만 갱신)
 *                                                    │          (v2, 기본 엔진: 요청은 그대로 보내지만 --dirty·--previous-residual을 읽지 않고 전체를 다시 푼다)
 *   derived/elevation.json ─readDerivedElevation→ applyDerivedElevation(setEdgeElevation 동작 한 번) → clearDirty
 *
 * 고도 값을 데이터에 쓰는 것은 편집 동작 setEdgeElevation뿐이다(AGENTS.md). 이 파일은 층 번호를 읽지 않는다.
 */
import type { Patch } from 'immer';
import { DERIVED_ELEVATION_PROPS } from '../types.ts';
import { setEdgeElevation, type EdgeElevationValues } from '../edit/actions/setEdgeElevation.ts';
import type { Action } from '../edit/action.ts';
import { metres } from '../edit/geo.ts';
import { COLLECTIONS, edgesAt, type EditState } from '../edit/state.ts';
import type { DhEdge, EdgeId, ElevationStore, HeightNodeKey } from './types.ts';

/** A map area in [minLng, minLat, maxLng, maxLat]. */
export type LngLatBox = readonly [number, number, number, number];

/** What changed since the last recompute. Immutable: every mark returns a new value. */
export interface ElevationDirty {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
  /** Building Feature ids (floor height, levels). */
  readonly buildings: ReadonlySet<string>;
  /** Measured height variables (op:…, fp:…) that got or lost an edge. */
  readonly heightNodes: ReadonlySet<HeightNodeKey>;
  /**
   * 고도 단절선 drawn, changed (low side, drop, points) or removed: line id → the areas it covered before and after
   * (the places whose heights and residual field depend on it). A change dirties the recompute whether or not any
   * campus point is near the line.
   */
  readonly breaklines: ReadonlyMap<string, readonly LngLatBox[]>;
  /** 평지 drawn, reshaped, given or cleared a fixed height, or removed: plaza id → its areas before and after. */
  readonly plazas: ReadonlyMap<string, readonly LngLatBox[]>;
}

export function emptyDirty(): ElevationDirty {
  return { nodes: new Set(), edges: new Set(), buildings: new Set(), heightNodes: new Set(), breaklines: new Map(), plazas: new Map() };
}

export function isClean(d: ElevationDirty): boolean {
  return d.nodes.size === 0 && d.edges.size === 0 && d.buildings.size === 0 && d.heightNodes.size === 0 && d.breaklines.size === 0 &&
    d.plazas.size === 0;
}

function withBoxes(map: ReadonlyMap<string, readonly LngLatBox[]>, id: string, boxes: readonly (LngLatBox | null)[]): Map<string, readonly LngLatBox[]> {
  const merged = [...(map.get(id) ?? [])];
  for (const b of boxes) if (b && !merged.some((m) => m.every((v, i) => v === b[i]))) merged.push(b);
  return new Map(map).set(id, merged);
}

/** The box of a plaza's outer ring (null: no points). */
export function plazaBox(polygon: readonly (readonly (readonly [number, number])[])[] | undefined): LngLatBox | null {
  return boxOf((polygon?.[0] ?? []).map(([lng, lat]) => ({ lng, lat })));
}

/** The area of a line's points as a box (null: no points). */
export function boxOf(points: readonly { lng: number; lat: number }[]): LngLatBox | null {
  if (points.length === 0) return null;
  return [
    Math.min(...points.map((p) => p.lng)), Math.min(...points.map((p) => p.lat)),
    Math.max(...points.map((p) => p.lng)), Math.max(...points.map((p) => p.lat)),
  ];
}

/** Mark a 고도 단절선 change: the line id and the areas it covered (before and after; boxes already marked for the id are kept). */
export function markBreakline(d: ElevationDirty, id: string, boxes: readonly (LngLatBox | null)[]): ElevationDirty {
  return { ...d, breaklines: withBoxes(d.breaklines, id, boxes) };
}

/** Mark a 평지 change: the plaza id and the areas it covered (before and after). */
export function markPlaza(d: ElevationDirty, id: string, boxes: readonly (LngLatBox | null)[]): ElevationDirty {
  return { ...d, plazas: withBoxes(d.plazas, id, boxes) };
}

/** Edge properties the height solver reads. Anything else (hours, covered, the derived values themselves) is not an input. */
const EDGE_INPUTS: readonly string[] = ['from', 'to', 'highway', 'edge_type', 'flat_exact', 'is_breakline', 'step_count', 'incline'];
const NODE_INPUTS: readonly string[] = ['node_type', 'building_id', 'level'];
const BUILDING_INPUTS: readonly string[] = ['levels', 'ground_levels', 'ext'];
/** A plaza's rings and its fixed height are solver inputs; its name and surface are not. */
const PLAZA_INPUTS: readonly string[] = ['fixed_height_m'];

/**
 * Mark what an edit changed, from its Immer patches (History entries; path[0] is the collection, path[1] the record
 * key, decision 2026-11-11). `state` is the state after the edit; it maps a building code to its Feature id.
 * The recompute's own write-back (derived values, rev) marks nothing, so applying a result never re-dirties it.
 */
export function markEditPatches(d: ElevationDirty, patches: readonly Patch[], state: EditState): ElevationDirty {
  const nodes = new Set(d.nodes);
  const edges = new Set(d.edges);
  const buildings = new Set(d.buildings);
  let plazas: ReadonlyMap<string, readonly LngLatBox[]> = d.plazas;
  for (const { path } of patches) {
    const [collection, key, field, prop] = path;
    if (typeof key !== 'string') continue;
    const whole = path.length <= 2 || (field === 'props' && path.length === 3);
    if (collection === 'nodes' && (whole || field === 'coord' || (field === 'props' && NODE_INPUTS.includes(String(prop))))) nodes.add(key);
    else if (collection === 'edges' && (whole || field === 'vertices' || (field === 'props' && EDGE_INPUTS.includes(String(prop))))) edges.add(key);
    else if (collection === 'buildings' && (whole || (field === 'props' && BUILDING_INPUTS.includes(String(prop))))) {
      buildings.add(state.buildings[key]?.id ?? `bldg_${key}`);
    } else if (collection === 'plazas' && (whole || field === 'polygon' || (field === 'props' && PLAZA_INPUTS.includes(String(prop))))) {
      plazas = withBoxes(plazas, key, [plazaBox(state.plazas[key]?.polygon)]);
    }
  }
  return { ...d, nodes, edges, buildings, plazas };
}

/**
 * Patch-shaped paths of what differs between two states, for markEditPatches when the History entry's own patches are
 * not at hand (the editor sees the state before and after every perform, undo, redo and drag). Records are compared by
 * reference, as Immer keeps every untouched record, field and property value shared: [collection, key] for a record
 * added or removed, [collection, key, field] for a changed field, [collection, key, 'props', prop] for each changed
 * property. Undo and redo of an edit therefore mark the same things as the edit did.
 */
export function statePatches(prev: EditState, next: EditState): Patch[] {
  const out: Patch[] = [];
  for (const c of COLLECTIONS) {
    const a = prev[c] as Record<string, object>;
    const b = next[c] as Record<string, object>;
    if (a === b) continue;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[key] as Record<string, unknown> | undefined;
      const y = b[key] as Record<string, unknown> | undefined;
      if (x === y) continue;
      if (!x || !y) {
        out.push(y ? { op: 'add', path: [c, key], value: y } : { op: 'remove', path: [c, key] });
        continue;
      }
      for (const field of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (x[field] === y[field]) continue;
        if (field !== 'props') {
          out.push({ op: 'replace', path: [c, key, field], value: y[field] });
          continue;
        }
        const px = (x[field] ?? {}) as Record<string, unknown>;
        const py = (y[field] ?? {}) as Record<string, unknown>;
        for (const prop of new Set([...Object.keys(px), ...Object.keys(py)])) {
          if (px[prop] !== py[prop]) out.push({ op: prop in py ? 'replace' : 'remove', path: [c, key, 'props', prop], value: py[prop] });
        }
      }
    }
  }
  return out;
}

/** markEditPatches for the change from `prev` to `next` (statePatches). */
export function markStateChange(d: ElevationDirty, prev: EditState, next: EditState): ElevationDirty {
  if (prev === next) return d;
  const out = markEditPatches(d, statePatches(prev, next), next);
  // The area a plaza covered before the change (a removed or reshaped plaza) is dirty too.
  let plazas = out.plazas;
  for (const id of out.plazas.keys()) if (!d.plazas.has(id) || out.plazas.get(id) !== d.plazas.get(id)) plazas = withBoxes(plazas, id, [plazaBox(prev.plazas[id]?.polygon)]);
  return plazas === out.plazas ? out : { ...out, plazas };
}

/** How many places wait for a recompute: nodes, edges, buildings, measured height variables and changed 고도 단절선. */
export function dirtyCount(d: ElevationDirty): number {
  return d.nodes.size + d.edges.size + d.buildings.size + d.heightNodes.size + d.breaklines.size + d.plazas.size;
}

/** Mark the height variables a measurement touched: both ends of every new edge and of every superseded one. */
export function markMeasurements(
  d: ElevationDirty,
  result: { newEdges: readonly DhEdge[]; supersede: readonly EdgeId[] },
  store: ElevationStore,
): ElevationDirty {
  const heightNodes = new Set(d.heightNodes);
  const superseded = new Set<string>(result.supersede);
  for (const e of [...result.newEdges, ...store.edges.filter((x) => superseded.has(x.edgeId))]) {
    heightNodes.add(e.from);
    heightNodes.add(e.to);
  }
  return { ...d, heightNodes };
}

/** The solver's `--dirty` input. Every list sorted, so the same dirt gives the same file. */
export interface RecomputeRequest {
  format: 'campo-elevation-dirty/1';
  heightNodes: string[];
  /** Campus nodes that moved or changed, and the ends of every listed edge. */
  campusNodes: string[];
  /** Campus edges that changed, and every edge at a listed node. Their derived values are rewritten (or removed). */
  campusEdges: string[];
  buildings: string[];
  /** 고도 단절선 changed (drawn, edited, removed) and the areas they covered: the solver redoes the crossing edges and the residual field there. */
  breaklines: { id: string; boxes: LngLatBox[] }[];
  /** 평지 drawn, reshaped or removed and the areas they covered. Only present when there is one (older requests stay as they were). */
  plazas?: { id: string; boxes: LngLatBox[] }[];
}

/** What to send to the solver for `d`, expanded over `state`: a changed node dirties its edges, a changed edge its ends. */
export function recomputeRequest(d: ElevationDirty, state: EditState): RecomputeRequest {
  const nodes = new Set([...d.nodes].filter((id) => id in state.nodes));
  const edges = new Set([...d.edges].filter((id) => id in state.edges));
  for (const id of nodes) for (const e of edgesAt(state, id)) edges.add(e.id);
  for (const id of edges) {
    const p = state.edges[id]!.props;
    nodes.add(p.from);
    nodes.add(p.to);
  }
  const sorted = (s: Iterable<string>) => [...s].sort();
  return {
    format: 'campo-elevation-dirty/1',
    heightNodes: sorted(d.heightNodes),
    campusNodes: sorted([...nodes].filter((id) => id in state.nodes)),
    campusEdges: sorted(edges),
    buildings: sorted(d.buildings),
    breaklines: [...d.breaklines].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, boxes]) => ({ id, boxes: boxes.map((b): LngLatBox => [...b]) })),
    ...(d.plazas.size > 0
      ? { plazas: [...d.plazas].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, boxes]) => ({ id, boxes: boxes.map((b): LngLatBox => [...b]) })) }
      : {}),
  };
}

/** Drop what `req` covered (marks made after the request was built stay). */
export function clearDirty(d: ElevationDirty, req: RecomputeRequest): ElevationDirty {
  const minus = <T extends string>(s: ReadonlySet<T>, gone: readonly string[]) => new Set([...s].filter((x) => !gone.includes(x)));
  return {
    nodes: minus(d.nodes, req.campusNodes),
    edges: minus(d.edges, req.campusEdges),
    buildings: minus(d.buildings, req.buildings),
    heightNodes: minus(d.heightNodes, req.heightNodes),
    // A line edited again while the solver ran (other areas than the request's) stays marked.
    breaklines: new Map([...d.breaklines].filter(([id, boxes]) => {
      const sent = req.breaklines.find((b) => b.id === id);
      return !sent || JSON.stringify(sent.boxes) !== JSON.stringify(boxes);
    })),
    plazas: new Map([...d.plazas].filter(([id, boxes]) => {
      const sent = req.plazas?.find((b) => b.id === id);
      return !sent || JSON.stringify(sent.boxes) !== JSON.stringify(boxes);
    })),
  };
}

/** derived/elevation.json (SPEC.md §5), written by tools/elevation/campo_height_solver.py --derived-out. */
export interface DerivedElevation {
  format: 'campo-derived-elevation/1';
  runId: string;
  solvedAt: number;
  /** Campus node id → corrected height (orthometric, same datum as the DEM) and its relative σ. */
  nodes: Record<string, { z_m: number; sigma_m: number; floating: boolean }>;
  /** Campus edge id → height of `to` minus `from` and its σ (correlations included). */
  edges: Record<string, { elev_diff_m: number; elev_sigma_m: number }>;
}

/** Check the shape of a parsed derived/elevation.json. Throws with a Korean message. */
export function readDerivedElevation(json: unknown): DerivedElevation {
  const j = json as Partial<DerivedElevation> | null;
  if (typeof j !== 'object' || j === null || j.format !== 'campo-derived-elevation/1') {
    throw new Error('고도 계산 결과 파일이 아닙니다(format: campo-derived-elevation/1).');
  }
  if (typeof j.nodes !== 'object' || j.nodes === null || typeof j.edges !== 'object' || j.edges === null) {
    throw new Error('고도 계산 결과에 nodes 또는 edges가 없습니다.');
  }
  for (const [id, e] of Object.entries(j.edges)) {
    if (!Number.isFinite(e?.elev_diff_m) || !Number.isFinite(e?.elev_sigma_m)) throw new Error(`구간 "${id}"의 고도 값이 숫자가 아닙니다.`);
  }
  return j as DerivedElevation;
}

/** Below this plan length an edge gets no grade_pct (indoor flights are drawn with both ends on one spot). */
export const MIN_GRADE_LENGTH_M = 0.5;

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * One setEdgeElevation action for a solver result: every edge in `derived` that is still in `state` (not elevators)
 * gets elev_diff_m / elev_sigma_m (cm) and grade_pct (0.1 %, over the node-to-node plan length). Edges listed in
 * `req.campusEdges` but missing from the result lose their old values (they could not be computed this time).
 * Disabled with a Korean reason when nothing would change.
 */
export function applyDerivedElevation(state: EditState, derived: DerivedElevation, req?: RecomputeRequest): Action {
  const values: Record<string, EdgeElevationValues | null> = {};
  for (const [id, e] of Object.entries(derived.edges)) {
    const edge = state.edges[id];
    if (!edge || edge.props.highway === 'elevator') continue;
    const from = state.nodes[edge.props.from];
    const to = state.nodes[edge.props.to];
    if (!from || !to) continue;
    const v: EdgeElevationValues = { elev_diff_m: round(e.elev_diff_m, 2), elev_sigma_m: Math.max(round(e.elev_sigma_m, 2), 0.01) };
    const length = metres(from.coord, to.coord);
    if (length >= MIN_GRADE_LENGTH_M) v.grade_pct = round((e.elev_diff_m / length) * 100, 1);
    values[id] = v;
  }
  for (const id of req?.campusEdges ?? []) {
    const edge = state.edges[id];
    if (!edge || id in values) continue;
    const p = edge.props as unknown as Record<string, unknown>;
    if (DERIVED_ELEVATION_PROPS.some((k) => k in p)) values[id] = null;
  }
  return setEdgeElevation(values);
}
