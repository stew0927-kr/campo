// attachDoor (SPEC-v0.2 6.1): door + link + corridor split as one action.
import type { DoorRole, EdgeProperties, NodeProperties, Position } from '../../types.ts';
import type { EditContext } from '../action.ts';
import { addEdge } from '../actions/addEdge.ts';
import { addNode } from '../actions/addNode.ts';
import { scopeProblem } from '../actions/common.ts';
import { splitEdgeAt } from '../actions/splitEdgeAt.ts';
import { edgeFileScope, edgeIdPrefix, nodeIdPrefix } from '../ids.ts';
import { isPosition, scopeOf, type EditState } from '../state.ts';
import { addedKeys, defineMacro, resultOf, type MacroAction, type MacroResult, type Runner } from './compose.ts';
import { findFoot, type CandidateOptions } from './corridor.ts';
import { ATTACH_MAX_DIST_M } from '../tolerances.ts';

export interface AttachDoorOptions {
  /** Building of a new door. Needed when the door is a coordinate; ignored for an existing door. */
  building_id?: string;
  /** Level of a new door. Needed when the door is a coordinate. */
  level?: number;
  /** Farthest corridor, metres. Default ATTACH_MAX_DIST_M (8). */
  maxDist?: number;
  /** New door only. */
  room_ref?: string;
  /** New door only. */
  door_role?: DoorRole;
  /** `source` of the new door and the link. Default "estimate". */
  source?: string;
  /** Only these corridor edges are candidates (roomStrip's chain). */
  edgeIds?: ReadonlySet<string>;
}

export interface AttachDoorResult {
  doorId: string;
  /** The corridor node the door is linked to (reused or made by the split). */
  footId: string;
  /** The new door → foot edge. */
  linkEdgeId: string;
  /** The corridor edge the door attached to (it keeps or gives up its id in the split). */
  corridorEdgeId: string;
  /** Edges the split made (empty when a node was reused). */
  splitEdgeIds: string[];
  /** True when an existing node within 1.0m of the foot was used. */
  reusedNode: boolean;
  /** True when the door node was made by this macro. */
  createdDoor: boolean;
}

export type DoorTarget = Position | string;

/** The steps of attachDoor inside any macro plan. */
export function attachDoorSteps(r: Runner, target: DoorTarget, opts: AttachDoorOptions, ctx: EditContext): AttachDoorResult {
  const start = r.state;
  const maxDist = opts.maxDist ?? ATTACH_MAX_DIST_M;
  if (!(maxDist >= 0)) r.fail('maxDist는 0 이상의 숫자여야 합니다.');
  let doorId: string | undefined;
  let coord: Position;
  let scope: { building_id: string; level: number };
  if (typeof target === 'string') {
    const door = start.nodes[target];
    if (!door) r.fail(`지점 "${target}"이(가) 없습니다.`);
    if (door.props.building_id === null || door.props.level === null) r.fail('바깥 지점은 복도에 이을 수 없습니다.');
    doorId = target;
    coord = door.coord;
    scope = { building_id: door.props.building_id, level: door.props.level };
  } else {
    if (!isPosition(target)) r.fail('좌표가 [경도, 위도] 숫자 쌍이 아닙니다.');
    if (opts.building_id === undefined || opts.level === undefined) r.fail('새 문의 건물(building_id)과 층(level)을 알려 주세요.');
    const bad = scopeProblem(start, { building_id: opts.building_id, level: opts.level });
    if (bad) r.fail(bad);
    coord = target;
    scope = { building_id: opts.building_id, level: opts.level };
  }

  const candidate: CandidateOptions = { allowed: opts.edgeIds, skipNode: doorId };
  const foot = findFoot(start, coord, scopeOf(scope), maxDist, candidate);
  if (typeof foot === 'string') r.fail(foot);
  if (doorId !== undefined && foot.nodeId !== undefined) {
    const dup = Object.values(start.edges).some((e) =>
      (e.props.from === doorId && e.props.to === foot.nodeId) || (e.props.to === doorId && e.props.from === foot.nodeId));
    if (dup) r.fail(`지점 "${doorId}"은(는) 이미 "${foot.nodeId}"에 이어져 있습니다.`);
  }
  const source = opts.source ?? 'estimate';

  // 1. the door
  const createdDoor = doorId === undefined;
  if (doorId === undefined) {
    const props: Omit<NodeProperties, 'rev'> = {
      kind: 'node',
      node_type: 'door',
      building_id: scope.building_id,
      level: scope.level,
      ...(opts.room_ref !== undefined ? { room_ref: opts.room_ref } : {}),
      ...(opts.door_role !== undefined ? { door_role: opts.door_role } : {}),
      source,
    };
    const id = r.newId(nodeIdPrefix(r.state, props));
    r.step(`door ${id} ${coord.join(',')}`, () => addNode({ id, coord: [coord[0], coord[1]], props }));
    doorId = id;
  }

  // 2. the foot: an existing node, or a split of the corridor (never of steps: only corridor edges are candidates)
  let footId = foot.nodeId;
  let splitEdgeIds: string[] = [];
  if (footId === undefined) {
    const before = r.state;
    const at = foot.at;
    r.step(`split ${foot.edgeId} ${at.join(',')}`, () => splitEdgeAt(foot.edgeId, at, {}, ctx));
    const made = addedKeys(before, r.state, 'nodes');
    if (made.length !== 1) r.fail('복도를 나눈 자리에 새 지점이 생기지 않았습니다.');
    footId = made[0]!;
    splitEdgeIds = addedKeys(before, r.state, 'edges');
  }

  // 3. the link
  const door = r.state.nodes[doorId]!;
  const linkProps: Omit<EdgeProperties, 'rev'> = {
    kind: 'edge',
    highway: 'corridor',
    edge_type: 'indoor',
    from: doorId,
    to: footId,
    bidirectional: true,
    step_free: null,
    source,
  };
  const linkEdgeId = r.newId(edgeIdPrefix(r.state, edgeFileScope('indoor', door.props, door.props)));
  const from = doorId;
  const to = footId;
  r.step(`link ${linkEdgeId} ${from} ${to}`, () => addEdge({ id: linkEdgeId, props: { ...linkProps, from, to } }));

  return { doorId, footId, linkEdgeId, corridorEdgeId: foot.edgeId, splitEdgeIds, reusedNode: foot.nodeId !== undefined, createdDoor };
}

/** attachDoor as an Action for History.perform. */
export function attachDoorAction(target: DoorTarget, opts: AttachDoorOptions, ctx: EditContext): MacroAction<AttachDoorResult> {
  return defineMacro<AttachDoorResult>(
    (res) => (res.createdDoor ? '문 추가하고 복도에 잇기' : '문을 복도에 잇기'),
    ctx,
    (r: Runner) => attachDoorSteps(r, target, opts, ctx),
  );
}

/**
 * Attach a door to the nearest corridor of its building and level (SPEC-v0.2 6.1). `target` is an existing node id
 * or the coordinate of a new door. When no corridor is found the state comes back unchanged with ok: false.
 */
export function attachDoor(state: EditState, target: DoorTarget, opts: AttachDoorOptions, ctx: EditContext): MacroResult<AttachDoorResult> {
  return resultOf(state, attachDoorAction(target, opts, ctx));
}

export type AttachPreview =
  | {
      ok: true;
      /** The corridor edge the door would attach to. */
      edgeId: string;
      /** Where the link would end (reused node or split point). */
      foot: Position;
      /** Metres from the door to the corridor. */
      distanceM: number;
      /** The existing node that would be reused. */
      nodeId?: string;
    }
  | { ok: false; reason: string };

export interface PreviewOptions {
  building_id: string;
  level: number;
  maxDist?: number;
  edgeIds?: ReadonlySet<string>;
}

/** What attachDoor would do for a new door at `coord`, without changing anything (for the mouse-move preview). */
export function previewAttachDoor(state: EditState, coord: Position, opts: PreviewOptions): AttachPreview {
  if (!isPosition(coord)) return { ok: false, reason: '좌표가 [경도, 위도] 숫자 쌍이 아닙니다.' };
  const bad = scopeProblem(state, opts);
  if (bad) return { ok: false, reason: bad };
  const foot = findFoot(state, coord, scopeOf(opts), opts.maxDist ?? ATTACH_MAX_DIST_M, { allowed: opts.edgeIds });
  if (typeof foot === 'string') return { ok: false, reason: foot };
  return {
    ok: true,
    edgeId: foot.edgeId,
    foot: foot.at,
    distanceM: foot.pointDistance,
    ...(foot.nodeId !== undefined ? { nodeId: foot.nodeId } : {}),
  };
}
