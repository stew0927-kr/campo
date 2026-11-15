/**
 * 지연 재계산(lazy recompute) — 편집할 때는 무엇이 바뀌었는지(dirty)만 기록하고, 사람이 "고도 다시 계산"을 누를 때만
 * 바뀐 성분과 타일을 다시 푼다.
 *
 *   편집 동작(History의 Immer 패치) ─markEditPatches─┐
 *   기압 측정(버퍼가 만든 엣지)      ─markMeasurements─┤→ ElevationDirty ─recomputeRequest→ JSON
 *                                                    │        → python tools/elevation/campo_height_solver.py --dirty
 *                                                    │          (그 성분만 다시 풀고 잔차장은 dirty 타일만 갱신)
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

/** What changed since the last recompute. Immutable: every mark returns a new value. */
export interface ElevationDirty {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
  /** Building Feature ids (floor height, levels). */
  readonly buildings: ReadonlySet<string>;
  /** Measured height variables (op:…, fp:…) that got or lost an edge. */
  readonly heightNodes: ReadonlySet<HeightNodeKey>;
}

export function emptyDirty(): ElevationDirty {
  return { nodes: new Set(), edges: new Set(), buildings: new Set(), heightNodes: new Set() };
}

export function isClean(d: ElevationDirty): boolean {
  return d.nodes.size === 0 && d.edges.size === 0 && d.buildings.size === 0 && d.heightNodes.size === 0;
}

/** Edge properties the height solver reads. Anything else (hours, covered, the derived values themselves) is not an input. */
const EDGE_INPUTS: readonly string[] = ['from', 'to', 'highway', 'edge_type', 'flat_exact', 'is_breakline', 'step_count', 'incline'];
const NODE_INPUTS: readonly string[] = ['node_type', 'building_id', 'level'];
const BUILDING_INPUTS: readonly string[] = ['levels', 'ground_levels', 'ext'];

/**
 * Mark what an edit changed, from its Immer patches (History entries; path[0] is the collection, path[1] the record
 * key, decision 2026-11-11). `state` is the state after the edit; it maps a building code to its Feature id.
 * The recompute's own write-back (derived values, rev) marks nothing, so applying a result never re-dirties it.
 */
export function markEditPatches(d: ElevationDirty, patches: readonly Patch[], state: EditState): ElevationDirty {
  const nodes = new Set(d.nodes);
  const edges = new Set(d.edges);
  const buildings = new Set(d.buildings);
  for (const { path } of patches) {
    const [collection, key, field, prop] = path;
    if (typeof key !== 'string') continue;
    const whole = path.length <= 2 || (field === 'props' && path.length === 3);
    if (collection === 'nodes' && (whole || field === 'coord' || (field === 'props' && NODE_INPUTS.includes(String(prop))))) nodes.add(key);
    else if (collection === 'edges' && (whole || field === 'vertices' || (field === 'props' && EDGE_INPUTS.includes(String(prop))))) edges.add(key);
    else if (collection === 'buildings' && (whole || (field === 'props' && BUILDING_INPUTS.includes(String(prop))))) {
      buildings.add(state.buildings[key]?.id ?? `bldg_${key}`);
    }
  }
  return { ...d, nodes, edges, buildings };
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
  return prev === next ? d : markEditPatches(d, statePatches(prev, next), next);
}

/** How many campus places wait for a recompute: nodes, edges, buildings and measured height variables. */
export function dirtyCount(d: ElevationDirty): number {
  return d.nodes.size + d.edges.size + d.buildings.size + d.heightNodes.size;
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
