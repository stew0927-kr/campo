// 선택 mode: what a tap or a dragged box on the map picks, and what the action bar does with it. Pure (no React), so it is
// tested in Node. Every change is a core action in one compose: one 되돌리기.
import {
  BUILDING_CODE,
  blend,
  buildingById,
  compose,
  deleteBuilding,
  deleteEdges,
  deleteNodes,
  dropOutliers,
  edgeCoords,
  isEscalator,
  metres,
  renameBuilding,
  setBuildingLevels,
  setProps,
  stairsTimeSec,
  weightedMedian,
  type Action,
  type ComposeStep,
  type Conveying,
  type EditContext,
  type EditEdge,
  type EditState,
  type PropsPatch,
  type SurveyTiming,
} from '@campo/core';
import { toScreen, type Projection, type Size, type View, type XY } from '../map/project.ts';
import { nodeInScope, type Scope } from '../model/scope.ts';

export interface Selection {
  nodes: readonly string[];
  edges: readonly string[];
  /** A building outline: picked alone. */
  building: string | null;
}

export const EMPTY_SELECTION: Selection = { nodes: [], edges: [], building: null };
export const selectionSize = (s: Selection): number => s.nodes.length + s.edges.length + (s.building ? 1 : 0);

/** Touch radius on the screen: a point within NODE_HIT_PX of the finger, else an edge within EDGE_HIT_PX. */
export const NODE_HIT_PX = 22;
export const EDGE_HIT_PX = 14;

export type Hit = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'building'; id: string };

interface Frame {
  state: EditState;
  scope: Scope;
  projection: Projection;
  view: View;
  size: Size;
}

/** The edges drawn strongly on this floor (or the outdoors): the ones that can be picked. */
export function edgesInScope(state: EditState, scope: Scope): EditEdge[] {
  return Object.values(state.edges).filter((e) => [e.props.from, e.props.to].some((id) => {
    const n = state.nodes[id];
    return n !== undefined && nodeInScope(n, scope);
  }));
}

function segmentDistance(p: XY, a: XY, b: XY): number {
  const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
  const [wx, wy] = [p[0] - a[0], p[1] - a[1]];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy);
}

/** Whether a point is inside a ring (even–odd rule). */
export function inRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** What is under the finger at screen pixel `px`: a point first, then an edge, then the building outline it is in. */
export function hitAt(f: Frame, px: XY): Hit | null {
  const screen = (p: readonly [number, number]): XY => toScreen(f.view, f.size, f.projection.toXY([p[0], p[1]]));
  let best: Hit | null = null;
  let bestD = NODE_HIT_PX;
  for (const n of Object.values(f.state.nodes)) {
    if (!nodeInScope(n, f.scope)) continue;
    const [x, y] = screen(n.coord);
    const d = Math.hypot(x - px[0], y - px[1]);
    if (d <= bestD) {
      best = { kind: 'node', id: n.id };
      bestD = d;
    }
  }
  if (best) return best;
  bestD = EDGE_HIT_PX;
  for (const e of edgesInScope(f.state, f.scope)) {
    const pts = edgeCoords(f.state, e).map(screen);
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = segmentDistance(px, pts[i]!, pts[i + 1]!);
      if (d <= bestD) {
        best = { kind: 'edge', id: e.id };
        bestD = d;
      }
    }
  }
  if (best) return best;
  // Indoors only the building being surveyed can be picked; outdoors any outline.
  for (const b of Object.values(f.state.buildings)) {
    if (f.scope.kind === 'building' && b.id !== f.scope.buildingId) continue;
    const ring = (b.polygon[0] ?? []).map(screen);
    if (ring.length >= 3 && inRing(px, ring)) return { kind: 'building', id: b.id };
  }
  return null;
}

/** A box dragged on the screen (any two corners, pixels). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The points of the scope inside the box, and the edges with both ends inside it. */
export function inBox(f: Frame, box: Box): { nodes: string[]; edges: string[] } {
  const [l, r] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
  const [t, b] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
  const inside = new Set<string>();
  for (const n of Object.values(f.state.nodes)) {
    if (!nodeInScope(n, f.scope)) continue;
    const [x, y] = toScreen(f.view, f.size, f.projection.toXY(n.coord));
    if (x >= l && x <= r && y >= t && y <= b) inside.add(n.id);
  }
  const edges = Object.values(f.state.edges).filter((e) => inside.has(e.props.from) && inside.has(e.props.to)).map((e) => e.id);
  return { nodes: [...inside].sort(), edges: edges.sort() };
}

/** The selection after a tap on `hit`: points and edges toggle in and out (multi-select); a building is picked alone; nothing clears. */
export function toggled(sel: Selection, hit: Hit | null): Selection {
  if (!hit) return EMPTY_SELECTION;
  if (hit.kind === 'building') return sel.building === hit.id ? EMPTY_SELECTION : { nodes: [], edges: [], building: hit.id };
  const key = hit.kind === 'node' ? 'nodes' : 'edges';
  const list = sel[key];
  const next = list.includes(hit.id) ? list.filter((id) => id !== hit.id) : [...list, hit.id];
  return { ...sel, building: null, [key]: next };
}

/** The selection with the box's points and edges added. */
export function withBox(sel: Selection, picked: { nodes: readonly string[]; edges: readonly string[] }): Selection {
  return {
    nodes: [...new Set([...sel.nodes, ...picked.nodes])],
    edges: [...new Set([...sel.edges, ...picked.edges])],
    building: null,
  };
}

/** What is left of a selection after the data changed (an undo, a delete). */
export function stillThere(state: EditState, sel: Selection): Selection {
  const building = sel.building !== null && Object.values(state.buildings).some((b) => b.id === sel.building) ? sel.building : null;
  return { nodes: sel.nodes.filter((id) => id in state.nodes), edges: sel.edges.filter((id) => id in state.edges), building };
}

// ---- 삭제 ----

/** Delete the picked edges, then the picked points that are still there (an edge's delete drops its bare walk points). */
export function planDeleteSelection(state: EditState, ctx: EditContext, sel: Selection): Action | { error: string } {
  const edges = sel.edges.filter((id) => id in state.edges);
  const nodes = sel.nodes.filter((id) => id in state.nodes);
  if (edges.length + nodes.length === 0) return { error: '지울 지점이나 구간을 골라 주세요.' };
  const steps: ComposeStep[] = [];
  if (edges.length > 0) steps.push(deleteEdges(edges, ctx));
  if (nodes.length > 0) {
    steps.push((s) => {
      const left = nodes.filter((id) => id in s.nodes);
      return left.length > 0 ? deleteNodes(left, {}, ctx) : null;
    });
  }
  return compose(steps, `지점 ${nodes.length}개, 구간 ${edges.length}개 삭제`);
}

// ---- 속성 편집 (구간) ----

export interface EdgeAnswer {
  /** Written on the edges that are not steps (steps always have a step). */
  stepFree?: boolean | null;
  /** Stairs that are not escalators; null clears it. */
  incline?: 'up' | 'down' | null;
  /** Escalators; bidirectional follows (reversible runs both ways). */
  conveying?: Conveying;
}

/** The answers of 구간 속성 on the picked edges, each only where it applies, as one action. */
export function planEdgeEdits(state: EditState, edgeIds: readonly string[], a: EdgeAnswer): Action | { error: string } {
  const edges = edgeIds.flatMap((id) => state.edges[id] ?? []);
  if (edges.length === 0) return { error: '구간을 골라 주세요.' };
  const ids = (keep: (e: EditEdge) => boolean): string[] => edges.filter(keep).map((e) => e.id);
  const steps: Action[] = [];
  const push = (list: string[], patch: PropsPatch): void => {
    if (list.length > 0) steps.push(setProps(list, patch));
  };
  if (a.stepFree !== undefined) push(ids((e) => e.props.highway !== 'steps' && e.props.step_free !== a.stepFree), { step_free: a.stepFree });
  if (a.incline !== undefined) push(ids((e) => e.props.highway === 'steps' && e.props.conveying === undefined && (e.props.incline ?? null) !== a.incline), { incline: a.incline ?? undefined });
  if (a.conveying !== undefined) push(ids((e) => isEscalator(e.props) && e.props.conveying !== a.conveying), { conveying: a.conveying, bidirectional: a.conveying === 'reversible' });
  if (steps.length === 0) return { error: '바뀐 내용이 없습니다.' };
  const action = compose(steps, `구간 ${edges.length}개 속성 바꾸기`);
  const reason = action.disabled(state);
  return reason === false ? action : { error: reason };
}

/** The floor all picked points and edges are on, for 다른 층에 복사; an error when they are outdoors or on several floors. */
export function selectionFloor(state: EditState, sel: Selection): { buildingId: string; level: number; nodeIds: string[] } | { error: string } {
  const ids = new Set(sel.nodes);
  for (const id of sel.edges) {
    const e = state.edges[id];
    if (e) {
      ids.add(e.props.from);
      ids.add(e.props.to);
    }
  }
  const nodes = [...ids].flatMap((id) => state.nodes[id] ?? []);
  if (nodes.length === 0) return { error: '복사할 지점이나 구간을 골라 주세요.' };
  const [first] = nodes;
  const buildingId = first!.props.building_id;
  const level = first!.props.level;
  if (buildingId === null || level === null) return { error: '건물 안의 지점만 다른 층에 복사할 수 있습니다.' };
  if (nodes.some((n) => n.props.building_id !== buildingId || n.props.level !== level)) return { error: '한 층의 지점과 구간만 골라 주세요.' };
  return { buildingId, level, nodeIds: nodes.map((n) => n.id) };
}

// ---- 건물 정보 ----

export interface BuildingForm {
  name: string;
  code: string;
  levels: number[];
}

/** Name, levels and code of a building as one action: setProps and setBuildingLevels under the old code, renameBuilding last. */
export function planBuildingEdit(state: EditState, ctx: EditContext, buildingId: string, form: BuildingForm): { action: Action; newId: string } | { error: string } {
  const b = buildingById(state, buildingId);
  if (!b) return { error: '건물을 찾을 수 없습니다.' };
  const name = form.name.trim();
  const code = form.code.trim();
  if (name === '') return { error: '건물 이름을 적어 주세요.' };
  if (!BUILDING_CODE.test(code)) return { error: '건물 코드는 영문과 숫자만 쓸 수 있습니다. 예: ENG1' };
  const steps: ComposeStep[] = [];
  if (name !== b.props.name) steps.push(setProps([b.id], { name }));
  const sorted = [...form.levels].sort((x, y) => x - y);
  const same = sorted.length === b.props.levels.length && sorted.every((l, i) => l === [...b.props.levels].sort((x, y) => x - y)[i]);
  if (!same) steps.push(setBuildingLevels(b.props.code, sorted));
  if (code !== b.props.code) steps.push(renameBuilding(b.props.code, code, ctx));
  if (steps.length === 0) return { error: '바뀐 내용이 없습니다.' };
  const action = compose(steps, `건물 ${b.props.code} 정보 바꾸기`);
  const reason = action.disabled(state);
  if (reason !== false) return { error: reason };
  const after = action.apply(state);
  const renamed = Object.values(after.buildings).find((x) => x.props.code === code);
  return { action, newId: renamed?.id ?? b.id };
}

export function planDeleteBuilding(state: EditState, ctx: EditContext, buildingId: string): Action | { error: string } {
  const b = buildingById(state, buildingId);
  if (!b) return { error: '건물을 찾을 수 없습니다.' };
  const action = deleteBuilding(b.props.code, ctx);
  const reason = action.disabled(state);
  return reason === false ? action : { error: reason };
}

// ---- 에스컬레이터 시간 ----

export interface TimingStats {
  /** Times kept after dropping the ones far off the prediction. */
  n: number;
  /** All times taken for this direction. */
  taken: number;
  /** The prediction without measurements (core's escalator rule), seconds. */
  priorSec: number;
  medianSec: number | null;
  /** Prediction and measurements blended the way calibrate does it (K = 3). */
  estimateSec: number;
}

/** Whether a picked edge is an escalator (steps + conveying): the stopwatch is offered for it. */
export const isEscalatorEdge = (state: EditState, edgeId: string): boolean => {
  const e = state.edges[edgeId];
  return e !== undefined && isEscalator(e.props);
};

/** The predicted ride (core's stairsTimeSec escalator rule, plan length between the two ends). */
export function escalatorPriorSec(state: EditState, edgeId: string, direction: 'forward' | 'backward'): number | undefined {
  const e = state.edges[edgeId];
  const [a, b] = e ? [state.nodes[e.props.from], state.nodes[e.props.to]] : [undefined, undefined];
  if (!e || !a || !b) return undefined;
  return stairsTimeSec({
    edge: e.props,
    endNodeTypes: [a.props.node_type, b.props.node_type],
    planLengthM: metres(a.coord, b.coord),
    traversal: direction === 'forward' ? 'along' : 'against',
  });
}

/** What the times taken so far say about one direction of an escalator: the same arithmetic as `npm run calibrate`. */
export function timingStats(state: EditState, edgeId: string, direction: 'forward' | 'backward', timings: readonly SurveyTiming[]): TimingStats | null {
  const prior = escalatorPriorSec(state, edgeId, direction);
  if (prior === undefined) return null;
  const mine = timings.filter((t) => t.target === `edge:${edgeId}` && (t.direction ?? 'forward') === direction);
  const kept = dropOutliers(mine.map((t) => ({ duration_sec: t.duration_sec, source: 'field' as const })), prior);
  const median = weightedMedian(kept) ?? null;
  const round1 = (x: number): number => Math.round(x * 10) / 10;
  return {
    n: kept.length,
    taken: mine.length,
    priorSec: round1(prior),
    medianSec: median === null ? null : round1(median),
    estimateSec: round1(median === null ? prior : blend(prior, median, kept.length)),
  };
}

/** The ride directions an escalator can be timed in: its belt's own way, both for a reversible one. */
export function rideDirections(state: EditState, edgeId: string): ('forward' | 'backward')[] {
  const c = state.edges[edgeId]?.props.conveying;
  if (c === 'forward') return ['forward'];
  if (c === 'backward') return ['backward'];
  return ['forward', 'backward'];
}
