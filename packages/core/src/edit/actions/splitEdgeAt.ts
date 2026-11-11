// Split rules: SPEC-v0.2 4.1.1. The approach of inserting an existing node follows iD's actionAddMidpoint (no code copied).
import type { NodeProperties, NodeType, Position } from '../../types.ts';
import { bumpRev, defineAction, idMemo, observationMessage, type Action, type EditContext } from '../action.ts';
import { edgeFileScope, edgeIdPrefix, freshId, nodeIdPrefix } from '../ids.ts';
import { footOnLine, lineLength, metres } from '../geo.ts';
import { clone, copy, edgeCoords, edgesAt, isPosition, scopeOfNode, type EditState } from '../state.ts';
import { SNAP_VERTEX_M } from '../tolerances.ts';

export interface SplitOptions {
  /** Insert this existing node (the node being dragged) at the split point instead of making a new one. */
  nodeId?: string;
  /** `source` of a new node. Default: the edge's source. */
  source?: string;
}

export interface SplitPlan {
  /** The split point. */
  at: Position;
  /** from … at */
  first: Position[];
  /** at … to */
  second: Position[];
  /** The from side keeps the original id (it is longer, or equally long). */
  keepFirst: boolean;
  /** step_count of [first, second] for steps. */
  stepCounts?: [number, number];
}

/** Where and how splitEdgeAt would cut, or the Korean reason it will not. */
export function splitPlan(state: EditState, edgeId: string, coord: Position, nodeId?: string): SplitPlan | string {
  const edge = state.edges[edgeId];
  if (!edge) return `구간 "${edgeId}"이(가) 없습니다.`;
  const p = edge.props;
  if (p.highway === 'elevator') return '엘리베이터 구간은 나눌 수 없습니다.';
  if (p.edge_type === 'bridge') return '연결통로 구간은 나눌 수 없습니다. 중간 지점이 필요하면 다리를 building_type: "bridge" 건물(층 1개)로 등록해 주세요.';
  if (p.edge_type === 'portal') return '포탈 구간은 나눌 수 없습니다.';
  if (p.conveying !== undefined) return '에스컬레이터·무빙워크(conveying) 구간은 나눌 수 없습니다.';
  if (p.highway === 'steps' && (p.step_count === undefined || p.step_count < 2)) return '계단 구간은 step_count가 2 이상일 때만 나눌 수 있습니다.';
  const from = state.nodes[p.from];
  const to = state.nodes[p.to];
  if (!from || !to) return `구간 "${edgeId}"의 끝 지점이 없습니다.`;
  if (scopeOfNode(from) !== scopeOfNode(to)) return '양 끝의 범위(바깥, 건물+층)가 다른 구간은 새 지점의 층을 정할 수 없어 나눌 수 없습니다.';
  if (!isPosition(coord)) return '좌표가 [경도, 위도] 숫자 쌍이 아닙니다.';
  if (nodeId !== undefined) {
    const node = state.nodes[nodeId];
    if (!node) return `지점 "${nodeId}"이(가) 없습니다.`;
    if (nodeId === p.from || nodeId === p.to) return '구간의 끝 지점은 그 구간 가운데에 끼울 수 없습니다.';
    if (scopeOfNode(node) !== scopeOfNode(from)) return `지점 "${nodeId}"의 범위가 구간과 달라 끼울 수 없습니다.`;
    if (node.props.node_type === 'elevator_stop') return '엘리베이터 정차 지점은 승강로를 벗어나 구간 가운데로 옮길 수 없습니다.';
  }

  const coords = edgeCoords(state, edge);
  const foot = footOnLine(coords, coord);
  let first: Position[];
  let second: Position[];
  let at: Position;
  let vertex = -1;
  let best = SNAP_VERTEX_M;
  for (let i = 1; i < coords.length - 1; i++) {
    const d = metres(coords[i]!, foot.coord);
    if (d <= best) {
      best = d;
      vertex = i;
    }
  }
  if (vertex > 0) {
    at = copy(coords[vertex]!);
    first = coords.slice(0, vertex + 1);
    second = coords.slice(vertex);
  } else {
    const i = foot.segmentIndex;
    at = copy(foot.coord);
    first = [...coords.slice(0, i + 1), at];
    second = [at, ...coords.slice(i + 1)];
  }
  if (metres(at, coords[0]!) <= SNAP_VERTEX_M || metres(at, coords[coords.length - 1]!) <= SNAP_VERTEX_M) {
    return `구간 끝에서 ${SNAP_VERTEX_M}m 안이라 나눌 수 없습니다.`;
  }
  const l1 = lineLength(first);
  const l2 = lineLength(second);
  const plan: SplitPlan = { at, first, second, keepFirst: l1 >= l2 };
  if (p.highway === 'steps' && p.step_count !== undefined) {
    const n = p.step_count;
    const share = l1 + l2 > 0 ? Math.round((n * l1) / (l1 + l2)) : Math.floor(n / 2);
    const n1 = Math.min(n - 1, Math.max(1, share));
    plan.stepCounts = [n1, n - n1];
  }
  return plan;
}

function newNodeType(buildingId: string | null, highway: string): NodeType {
  if (buildingId === null) return 'outdoor';
  return highway === 'steps' ? 'stair_landing' : 'corridor';
}

/**
 * Split an edge in two at the foot of `coord` (SPEC-v0.2 4.1.1). The longer piece keeps the id with rev+1,
 * the other gets a new id at rev 1 (equal length: the from side keeps the id). Parallel edges are left alone.
 */
export function splitEdgeAt(edgeId: string, coord: Position, options: SplitOptions, ctx: EditContext): Action {
  const memo = idMemo();
  return defineAction({
    annotation: '구간 나누기',
    disabled(state) {
      const plan = splitPlan(state, edgeId, coord, options.nodeId);
      return typeof plan === 'string' ? plan : false;
    },
    recipe(draft) {
      const plan = splitPlan(draft, edgeId, coord, options.nodeId) as SplitPlan;
      const edge = draft.edges[edgeId]!;
      const base = clone(edge.props);
      const fromNode = draft.nodes[base.from]!;

      let nid: string;
      if (options.nodeId !== undefined) {
        nid = options.nodeId;
        const node = draft.nodes[nid]!;
        node.coord = copy(plan.at);
        bumpRev(node.props);
        for (const e of edgesAt(draft, nid)) bumpRev(e.props);
      } else {
        const { building_id, level } = fromNode.props;
        const props: NodeProperties = {
          kind: 'node',
          node_type: newNodeType(building_id, base.highway),
          building_id,
          level,
          source: options.source ?? base.source,
          rev: 1,
        };
        nid = memo(0, draft, () => freshId(draft, ctx.ids, nodeIdPrefix(draft, props)));
        draft.nodes[nid] = { id: nid, coord: copy(plan.at), props };
      }

      const scope = edgeFileScope(base.edge_type, fromNode.props, fromNode.props);
      const eid = memo(1, draft, () => freshId(draft, ctx.ids, edgeIdPrefix(draft, scope)));
      const inner = (line: Position[]) => line.slice(1, -1).map(copy);
      const [c1, c2] = plan.stepCounts ?? [undefined, undefined];
      const fresh = { ...clone(base), rev: 1 };
      if (plan.keepFirst) {
        edge.props.to = nid;
        edge.vertices = inner(plan.first);
        if (c1 !== undefined) edge.props.step_count = c1;
        fresh.from = nid;
        if (c2 !== undefined) fresh.step_count = c2;
        draft.edges[eid] = { id: eid, vertices: inner(plan.second), props: fresh };
      } else {
        edge.props.from = nid;
        edge.vertices = inner(plan.second);
        if (c2 !== undefined) edge.props.step_count = c2;
        fresh.to = nid;
        if (c1 !== undefined) fresh.step_count = c1;
        draft.edges[eid] = { id: eid, vertices: inner(plan.first), props: fresh };
      }
      bumpRev(edge.props);
    },
    warnings(state) {
      return ctx.observationTargets?.has(`edge:${edgeId}`) && state.edges[edgeId] ? [observationMessage(edgeId)] : [];
    },
  });
}
