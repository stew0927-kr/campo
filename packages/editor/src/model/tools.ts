// The drawing tools (SPEC §8) as Plans of core actions: 길 그리기, 지점 추가, 계단, 잇기, 출입구 연결. (엘리베이터: elevator.ts, 연결통로: bridge.ts, 에스컬레이터: escalator.ts)
// New ids come from core (freshId with the session's generator), new Features start at rev 1 inside addNode / addEdge.
// step_free defaults follow SPEC-v0.2 §2.1: steps false, elevator true, everything else null (not known).
import {
  SNAP_VERTEX_M,
  addEdge,
  addNode,
  buildingById,
  edgeCoords,
  freshId,
  localFrame,
  nearestOnPlazaBoundary,
  nodeIdPrefix,
  splitEdgeAt,
  splitPlan,
  type EdgeProperties,
  type EditContext,
  type EditEdge,
  type EditState,
  type NodeProperties,
  type Position,
} from '@campo/core';
import { curveSegments } from './curve.ts';
import type { PlanResult, Step } from './plan.ts';
import { OUTDOOR, floorLabel, nodeInScope, snappable, type Scope } from './scope.ts';

/** Default source for data drawn in the editor until someone checks it on site (SPEC §4.1). */
export const DRAWN_SOURCE = 'estimate';

export const OUTDOOR_KINDS = ['flat', 'steps', 'ramp'] as const;
export type OutdoorKind = (typeof OUTDOOR_KINDS)[number];

export const INDOOR_NODE_KINDS = ['entrance', 'door', 'classroom', 'corridor'] as const;
export type IndoorNodeKind = (typeof INDOOR_NODE_KINDS)[number];

export type NodeProps = Omit<NodeProperties, 'rev'>;
export type EdgeProps = Omit<EdgeProperties, 'rev'>;

/** Hands out new node ids that cannot clash with each other or with the state. */
export function idMaker(state: EditState, ctx: EditContext) {
  const reserved = new Set<string>();
  return (props: Pick<NodeProps, 'building_id' | 'level' | 'node_type'>): string => {
    const id = freshId(state, ctx.ids, nodeIdPrefix(state, props), reserved);
    reserved.add(id);
    return id;
  };
}

export const nodeStep = (id: string, coord: Position, props: NodeProps, ctx: EditContext): Step => () => addNode({ id, coord: [coord[0], coord[1]], props }, ctx);
export const edgeStep = (props: EdgeProps, ctx: EditContext, vertices?: Position[]): Step => () => addEdge({ props, ...(vertices && vertices.length > 0 ? { vertices } : {}) }, ctx);

// ---- 바깥 길 ----

const EDGE_BY_KIND: Record<OutdoorKind, Pick<EdgeProps, 'highway' | 'step_free'>> = {
  flat: { highway: 'footway', step_free: null },
  steps: { highway: 'steps', step_free: false },
  ramp: { highway: 'ramp', step_free: null },
};

/**
 * A clicked point: snapped onto an existing node, snapped onto an existing edge of the same scope (the edge is split there
 * with splitEdgeAt and the path joins the node the split makes), or a new position.
 */
export type PathVertex = { nodeId: string } | { edgeId: string; position: Position } | { position: Position };

/**
 * Whether a 길 그리기 point may land on this edge (마그넷 + 나누기): both ends in the path's scope, and an edge splitEdgeAt can
 * cut (not an elevator, bridge, portal or conveyor; steps only with step_count 2 or more).
 */
export function pathCanLandOn(state: EditState, edge: EditEdge, scope: Scope): boolean {
  const p = edge.props;
  if (p.highway === 'elevator' || p.edge_type === 'bridge' || p.edge_type === 'portal' || p.conveying !== undefined) return false;
  if (p.highway === 'steps' && (p.step_count === undefined || p.step_count < 2)) return false;
  const [a, b] = [state.nodes[p.from], state.nodes[p.to]];
  return !!a && !!b && nodeInScope(a, scope) && nodeInScope(b, scope);
}

/** Metres along `coords` to the foot of `p` on it (local plane), and how far `p` is from the line. */
function footAlong(coords: readonly Position[], p: Position): { along: number; off: number } {
  const f = localFrame(p);
  const pts = coords.map(f.toXY);
  let best = { along: 0, off: Infinity };
  let before = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dy);
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, (-a[0] * dx - a[1] * dy) / (len * len)));
    const off = Math.hypot(a[0] + t * dx, a[1] + t * dy);
    if (off < best.off) best = { along: before + t * len, off };
    before += len;
  }
  return best;
}

const metresBetween = (a: Position, b: Position): number => Math.hypot(...localFrame(a).toXY(b));

/** The piece of an edge (the edge itself, or a piece split off it in this plan) that holds `at`, in `s`. */
function pieceAt(s: EditState, original: EditState, edgeId: string, at: Position): string | undefined {
  let best: { id: string; off: number } | undefined;
  for (const e of Object.values(s.edges)) {
    if (e.id !== edgeId && e.id in original.edges) continue;
    if (!s.nodes[e.props.from] || !s.nodes[e.props.to]) continue;
    const { off } = footAlong(edgeCoords(s, e), at);
    if (off <= 0.05 && (!best || off < best.off)) best = { id: e.id, off };
  }
  return best?.id;
}

/** The node a split in this plan made at `at` (new since `original`, within 5 cm). */
function splitNodeAt(s: EditState, original: EditState, at: Position): string | undefined {
  let best: { id: string; d: number } | undefined;
  for (const n of Object.values(s.nodes)) {
    if (n.id in original.nodes) continue;
    const d = metresBetween(at, n.coord);
    if (d <= 0.05 && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id;
}

/** The kinds of way the 길 그리기 tool draws. Elevators are not one of them: they come from the 엘리베이터 tool (SPEC-v0.2 6.5). */
export const ELEVATOR_NOT_DRAWN = '엘리베이터는 엘리베이터 도구로 만드세요';

/**
 * A drawn polyline in `scope` (SPEC-v0.2 5.2): new nodes for new positions (outdoor points, or corridor nodes on the floor),
 * one edge per consecutive pair. An outdoor path that reaches an entrance makes that edge a portal. Null when there is nothing to draw.
 */
export function planPath(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind, scope: Scope): PlanResult | null {
  return planPathShape(state, ctx, vertices, kind, scope, false);
}

/**
 * 곡선 길: the same rules as planPath, but the clicks are control points of a smooth curve (curve.ts). Nodes are made only at the
 * control points; each edge gets the samples of its segment as `vertices` (bend points), so the data stays plain nodes + edges.
 */
export function planCurvePath(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind, scope: Scope): PlanResult | null {
  return planPathShape(state, ctx, vertices, kind, scope, true);
}

function planPathShape(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind, scope: Scope, curved: boolean): PlanResult | null {
  const indoor = scope.kind === 'building';
  if (indoor && kind === 'steps') return { error: '같은 층 안의 계단 구간은 그리지 않습니다. 층 사이 계단은 지점 추가의 계단으로 만드세요.' };
  const building = indoor ? buildingById(state, scope.buildingId) : undefined;
  if (indoor && (!building || !building.props.levels.includes(scope.level))) return { error: '건물이나 층을 찾을 수 없습니다.' };
  const here = indoor ? { building_id: scope.buildingId, level: scope.level } : { building_id: null, level: null };
  const nodeType = indoor ? 'corridor' : 'outdoor';
  const newId = idMaker(state, ctx);
  const steps: Step[] = [];
  /** Node ids, or `split:k` for the node the k-th split will make (its id is splitEdgeAt's own, read when the edges are added). */
  const path: string[] = [];
  const newAt = new Map<string, string>(); // "lng,lat" -> id, so closing a loop reuses the first new node
  const coordOf = new Map<string, Position>(); // new nodes' positions (existing nodes are read from the state)
  /** Splits of existing edges, in click order: the original edge, where, and how far along it. */
  const splits: { edgeId: string; at: Position; along: number }[] = [];
  for (const v of vertices) {
    let id: string;
    if ('nodeId' in v) {
      const node = state.nodes[v.nodeId];
      if (!node) throw new Error(`no node ${v.nodeId}`);
      if (!snappable(node, scope)) return { error: '다른 층이나 다른 범위의 지점에는 붙일 수 없습니다.' };
      id = v.nodeId;
    } else if ('edgeId' in v) {
      const edge = state.edges[v.edgeId];
      if (!edge) throw new Error(`no edge ${v.edgeId}`);
      const ends = [state.nodes[edge.props.from], state.nodes[edge.props.to]];
      if (!ends.every((n) => n && nodeInScope(n, scope))) return { error: '다른 층이나 다른 범위의 구간에는 붙일 수 없습니다.' };
      // On (or within SNAP_VERTEX_M of) an end of the edge: that end node, nothing to split.
      const end = ends.map((n) => ({ n: n!, d: metresBetween(n!.coord, v.position) })).sort((a, b) => a.d - b.d)[0]!;
      const plan = splitPlan(state, v.edgeId, v.position);
      if (end.d <= SNAP_VERTEX_M || typeof plan === 'string') {
        if (end.d <= SNAP_VERTEX_M || plan === `구간 끝에서 ${SNAP_VERTEX_M}m 안이라 나눌 수 없습니다.`) id = end.n.id;
        else return { error: `이 구간에는 길을 붙일 수 없습니다: ${plan as string}` };
      } else {
        // The same edge clicked twice at (nearly) one place: one split, one node.
        const k = splits.findIndex((x) => x.edgeId === v.edgeId && metresBetween(x.at, plan.at) <= SNAP_VERTEX_M);
        if (k >= 0) id = `split:${k}`;
        else {
          const at: Position = [plan.at[0], plan.at[1]];
          const along = footAlong(edgeCoords(state, edge), at).along;
          splits.push({ edgeId: v.edgeId, at, along });
          id = `split:${splits.length - 1}`;
          coordOf.set(id, at);
          const edgeId = v.edgeId;
          // The piece holding the point: the first split of an edge cuts it, a later one cuts whichever piece the point is on.
          steps.push((s) => splitEdgeAt(pieceAt(s, state, edgeId, at) ?? edgeId, at, { source: DRAWN_SOURCE }, ctx));
        }
      }
    } else {
      const key = `${v.position[0]},${v.position[1]}`;
      const known = newAt.get(key);
      if (known !== undefined) id = known;
      else {
        id = newId({ ...here, node_type: nodeType });
        newAt.set(key, id);
        coordOf.set(id, [v.position[0], v.position[1]]);
        steps.push(nodeStep(id, v.position, { kind: 'node', node_type: nodeType, ...here, source: DRAWN_SOURCE }, ctx));
      }
    }
    if (path[path.length - 1] !== id) path.push(id); // clicking the same node twice is not a segment
  }
  if (path.length < 2) return null; // a lone click draws nothing
  let bends: Position[][] | null = null;
  if (curved) {
    bends = curveSegments(path.map((id) => coordOf.get(id) ?? state.nodes[id]!.coord));
    if (bends.length !== path.length - 1) return { error: '같은 자리에 겹친 지점이 있어 곡선을 만들 수 없습니다.' };
  }
  /**
   * Two consecutive points on one existing edge with nothing of it between them: the edge (a piece of it after the
   * splits) already joins them, and a new edge there would only lie on top of it.
   */
  const alongOn = (edgeId: string, id: string): number | undefined => {
    const e = state.edges[edgeId]!;
    if (id === e.props.from) return 0;
    if (id === e.props.to) return footAlong(edgeCoords(state, e), state.nodes[e.props.to]!.coord).along;
    const k = id.startsWith('split:') ? Number(id.slice(6)) : -1;
    return k >= 0 && splits[k]!.edgeId === edgeId ? splits[k]!.along : undefined;
  };
  const alongExisting = (a: string, b: string): boolean => {
    for (const edgeId of new Set(splits.map((x) => x.edgeId))) {
      const [ta, tb] = [alongOn(edgeId, a), alongOn(edgeId, b)];
      if (ta === undefined || tb === undefined) continue;
      const [lo, hi] = [Math.min(ta, tb), Math.max(ta, tb)];
      if (!splits.some((x) => x.edgeId === edgeId && x.along > lo + 1e-9 && x.along < hi - 1e-9)) return true;
    }
    return false;
  };
  const resolve = (s: EditState, id: string): string => (id.startsWith('split:') ? splitNodeAt(s, state, coordOf.get(id)!) ?? id : id);
  // A new point (or a split of an outdoor edge) is outdoors; only used for an outdoor path.
  const outside = (id: string) => (id.startsWith('split:') || !state.nodes[id] ? true : state.nodes[id]!.props.building_id === null);
  let n = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    if (alongExisting(a, b)) continue;
    if (!indoor && !outside(a) && !outside(b)) return { error: '출입구와 출입구는 바로 이을 수 없습니다. 사이에 바깥 지점을 두세요.' };
    const toEntrance = !indoor && (!outside(a) || !outside(b));
    const props: EdgeProps = toEntrance ? {
      kind: 'edge', highway: 'footway', edge_type: 'portal', step_free: null, from: a, to: b, bidirectional: true, source: DRAWN_SOURCE,
    } : indoor ? {
      kind: 'edge', highway: kind === 'ramp' ? 'ramp' : 'corridor', edge_type: 'indoor', step_free: null, from: a, to: b, bidirectional: true, source: DRAWN_SOURCE,
    } : {
      kind: 'edge', ...EDGE_BY_KIND[kind], edge_type: 'outdoor', from: a, to: b, bidirectional: true, source: DRAWN_SOURCE,
    };
    const vertices = bends?.[i];
    steps.push((s) => addEdge({ props: { ...props, from: resolve(s, a), to: resolve(s, b) }, ...(vertices && vertices.length > 0 ? { vertices } : {}) }, ctx));
    n++;
  }
  if (n === 0) return { error: '기존 구간 위만 따라 찍었습니다. 새 길이 지나갈 곳에 점을 찍어 주세요.' };
  const word = curved ? '곡선 ' : '';
  const cut = splits.length > 0 ? ` (기존 구간 ${splits.length}곳 나눠 잇기)` : '';
  return { annotation: `${indoor ? `${word}${kind === 'ramp' ? '경사로' : '복도'} ${n}구간 그리기` : `${word}바깥 길 ${n}구간 그리기`}${cut}`, steps };
}

/** 바깥 길 only (the scope-less form). */
export function planOutdoorPath(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind): PlanResult | null {
  return planPath(state, ctx, vertices, kind, OUTDOOR);
}

// ---- 지점 추가 ----

/** A plain outdoor point, or a departure / arrival candidate (poi) with a name. */
export function planOutdoorNode(state: EditState, ctx: EditContext, position: Position, poiName?: string): PlanResult {
  const name = poiName?.trim();
  if (poiName !== undefined && !name) return { error: '출발·도착 후보의 이름을 입력해 주세요. 예: 정문, 한양대역 2번 출구' };
  const type = name ? 'poi' : 'outdoor';
  const id = idMaker(state, ctx)({ building_id: null, level: null, node_type: type });
  return {
    annotation: name ? '출발·도착 후보 추가' : '지점 추가',
    steps: [nodeStep(id, position, { kind: 'node', node_type: type, building_id: null, level: null, ...(name ? { name } : {}), source: DRAWN_SOURCE }, ctx)],
  };
}

export interface NewIndoorNode {
  buildingId: string;
  level: number;
  kind: IndoorNodeKind;
  position: Position;
  /** Room number, for classroom doors ("408"). */
  ref?: string;
  /** Room name, for classroom doors ("408호 강의실"). */
  spaceName?: string;
}

export function planIndoorNode(state: EditState, ctx: EditContext, n: NewIndoorNode): PlanResult {
  const building = buildingById(state, n.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  if (!building.props.levels.includes(n.level)) return { error: `${floorLabel(n.level)}은 이 건물의 층 목록에 없습니다.` };
  let extra: Pick<NodeProps, 'ref' | 'space_name'> = {};
  if (n.kind === 'classroom') {
    const ref = n.ref?.trim() ?? '';
    if (!/^[A-Za-z0-9-]+$/.test(ref)) return { error: '호수는 영문, 숫자, - 만 쓸 수 있습니다. 예: 408, B102' };
    extra = { ref, space_name: n.spaceName?.trim() || `${ref}호 강의실` };
  }
  const props: NodeProps = {
    kind: 'node', node_type: n.kind === 'classroom' ? 'door' : n.kind, building_id: building.id, level: n.level, ...extra, source: DRAWN_SOURCE,
  };
  const id = idMaker(state, ctx)(props);
  return { annotation: n.kind === 'classroom' ? '강의실 문 추가' : '지점 추가', steps: [nodeStep(id, n.position, props, ctx)] };
}

// ---- 엘리베이터, 계단 ----

/** One landing per level from `from` to `to`, and one steps edge per floor in between (SPEC §3 계단). */
export function planStairs(state: EditState, ctx: EditContext, s: { buildingId: string; position: Position; from: number; to: number }): PlanResult {
  const building = buildingById(state, s.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  const { levels } = building.props;
  if (!levels.includes(s.from) || !levels.includes(s.to)) return { error: '시작 층과 끝 층은 이 건물의 층 목록에서 골라 주세요.' };
  if (s.from === s.to) return { error: '시작 층과 끝 층이 같습니다.' };
  const [lo, hi] = [Math.min(s.from, s.to), Math.max(s.from, s.to)];
  const flights = levels.filter((l) => l >= lo && l <= hi).sort((a, b) => a - b);

  const newId = idMaker(state, ctx);
  const ids = flights.map((level) => newId({ building_id: building.id, level, node_type: 'stair_landing' }));
  const steps: Step[] = flights.map((level, i) => nodeStep(ids[i]!, s.position, {
    kind: 'node', node_type: 'stair_landing', building_id: building.id, level, source: DRAWN_SOURCE,
  }, ctx));
  for (let i = 0; i + 1 < flights.length; i++) {
    steps.push(edgeStep({
      kind: 'edge', highway: 'steps', edge_type: 'indoor', step_free: false, from: ids[i]!, to: ids[i + 1]!, bidirectional: true,
      level_from: flights[i]!, level_to: flights[i + 1]!, source: DRAWN_SOURCE,
    }, ctx));
  }
  return { annotation: `계단 추가(${flights.length}개 층)`, steps };
}

// ---- 잇기, 출입구 연결 (portal) ----

const joined = (state: EditState, a: string, b: string, match?: (e: EditState['edges'][string]) => boolean) =>
  Object.values(state.edges).some((e) => ((e.props.from === a && e.props.to === b) || (e.props.from === b && e.props.to === a)) && (!match || match(e)));

/**
 * "잇기": an edge between two nodes on the same floor of one building (corridor), or between two outdoor nodes (footway).
 * Floors, buildings and the outside are joined by the stairs / elevator / portal / bridge tools instead.
 */
export function planConnect(state: EditState, ctx: EditContext, fromId: string, toId: string): PlanResult {
  const from = state.nodes[fromId];
  const to = state.nodes[toId];
  if (!from || !to) return { error: '이을 지점을 찾을 수 없습니다.' };
  if (from.id === to.id) return { error: '같은 지점입니다. 다른 지점을 골라 주세요.' };
  const [a, b] = [from.props, to.props];
  let props: Pick<EdgeProps, 'highway' | 'edge_type' | 'step_free'>;
  if (a.building_id === null && b.building_id === null) props = { highway: 'footway', edge_type: 'outdoor', step_free: null };
  else if (a.building_id === null || b.building_id === null) return { error: '건물 안과 바깥은 출입구 연결 도구로 이어 주세요.' };
  else if (a.building_id !== b.building_id) return { error: '다른 건물끼리는 연결통로 도구로 이어 주세요.' };
  else if (a.level !== b.level) return { error: '다른 층끼리는 계단이나 엘리베이터 도구로 이어 주세요.' };
  else props = { highway: 'corridor', edge_type: 'indoor', step_free: null };
  if (joined(state, fromId, toId)) return { error: '두 지점은 이미 이어져 있습니다.' };
  return {
    annotation: '구간 추가',
    steps: [edgeStep({ kind: 'edge', ...props, from: fromId, to: toId, bidirectional: true, source: DRAWN_SOURCE }, ctx)],
  };
}

/** Entrance <-> outdoor point. step_free is null (not known) until checked on site (SPEC-v0.2 §2.1). */
export function planPortal(state: EditState, ctx: EditContext, entranceId: string, outdoorId: string): PlanResult {
  const entrance = state.nodes[entranceId];
  const outside = state.nodes[outdoorId];
  if (!entrance || entrance.props.node_type !== 'entrance') return { error: '출입구 연결은 건물 출입구에서 시작합니다. 출입구 지점을 먼저 골라 주세요.' };
  if (!outside || outside.props.building_id !== null) return { error: '이어질 바깥 지점을 골라 주세요.' };
  if (joined(state, entranceId, outdoorId, (e) => e.props.edge_type === 'portal')) return { error: '이 출입구와 바깥 지점은 이미 이어져 있습니다.' };
  return {
    annotation: '출입구 연결 추가',
    steps: [edgeStep({
      kind: 'edge', highway: 'footway', edge_type: 'portal', step_free: null, from: entranceId, to: outdoorId, bidirectional: true, source: DRAWN_SOURCE,
    }, ctx)],
  };
}

/** 같은 자리로 보는 거리(m): 이미 있는 바깥 지점을 다시 만들지 않고 그 지점을 씻니다. */
export const PORTAL_FOOT_REUSE_M = 0.05;

/**
 * 출입구 → 평지: the foot of the perpendicular from the entrance to the plaza's boundary (outer ring or hole) becomes an
 * outdoor point, and a portal edge joins the entrance to it — the shortest way from the door onto the plaza, so a route
 * can get on and off it (W17). An outdoor point already standing on that foot is reused, not duplicated.
 */
export function planPortalToPlaza(state: EditState, ctx: EditContext, entranceId: string, plazaId: string): PlanResult {
  const entrance = state.nodes[entranceId];
  if (!entrance || entrance.props.node_type !== 'entrance') return { error: '출입구 연결은 건물 출입구에서 시작합니다. 출입구 지점을 먼저 골라 주세요.' };
  const plaza = state.plazas[plazaId];
  if (!plaza) return { error: '이어질 평지를 찾을 수 없습니다.' };
  const hit = nearestOnPlazaBoundary(plaza.polygon, entrance.coord);
  if (!hit) return { error: '이 평지에는 테두리가 없습니다. 평지 도구로 도형을 다시 그려 주세요.' };
  const foot = hit.position;
  // Distances here are metres, not degrees: a reused point must sit on the foot itself.
  const frame = localFrame(foot);
  const there = Object.values(state.nodes).find((n) => n.props.building_id === null &&
    Math.hypot(...frame.toXY(n.coord)) <= PORTAL_FOOT_REUSE_M);
  if (there && joined(state, entranceId, there.id, (e) => e.props.edge_type === 'portal')) {
    return { error: '이 출입구는 이미 그 평지 가장자리와 이어져 있습니다.' };
  }
  const props: NodeProps = { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: DRAWN_SOURCE };
  const steps: Step[] = [];
  const outdoorId = there?.id ?? idMaker(state, ctx)(props);
  if (!there) steps.push(nodeStep(outdoorId, foot, props, ctx));
  steps.push(edgeStep({
    kind: 'edge', highway: 'footway', edge_type: 'portal', step_free: null, from: entranceId, to: outdoorId, bidirectional: true, source: DRAWN_SOURCE,
  }, ctx));
  return { annotation: '출입구를 평지에 연결', steps };
}
