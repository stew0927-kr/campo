// The five record buttons (docs/mobile/SPEC-mobile.md 2) as plans of core edit actions. A plan is one history entry
// (compose), so one 되돌리기 takes a whole record back. Nothing here compares floor numbers to decide what connects:
// a floor change joins exactly the two floors the surveyor walked between.
import {
  ELEVATOR_STOP_M,
  addEdge,
  addNode,
  attachDoorAction,
  buildingById,
  compose,
  edgeFileScope,
  edgeIdPrefix,
  freshId,
  metres,
  nodeIdPrefix,
  previewAttachDoor,
  type Action,
  type ComposeStep,
  type DoorRole,
  type EdgeProperties,
  type EditContext,
  type EditEdge,
  type EditNode,
  type EditState,
  type NodeProperties,
  type NodeType,
  type Position,
} from '@campo/core';
import { OUTDOOR, floorLabel, nodeInScope, sameScope, scopeOfNode, scopeProps, type Scope } from '../model/scope.ts';

/** The crosshair takes an existing point of the same scope within this distance instead of making a new one. */
export const SNAP_M = 2;
/** 포탈 joins the entrance to an outdoor point this close; farther than that it makes a new outdoor point at the door. */
export const PORTAL_SNAP_M = 15;

export const NOT_CONNECTED_NOTICE = '아직 복도와 연결되지 않았어요. 복도를 기록한 뒤 편집기에서 이어 주세요.';

type NodeProps = Omit<NodeProperties, 'rev'>;
type EdgeProps = Omit<EdgeProperties, 'rev'>;

export interface PlanInput {
  state: EditState;
  ctx: EditContext;
  /** Where the surveyor is. */
  scope: Scope;
  /** Under the crosshair. */
  coord: Position;
  /** The point recorded last (the walk continues from it), or null. */
  anchorId: string | null;
  /** `source` of new Features: "field-survey-{yyyy-mm}". */
  source: string;
}

export interface PlanOk {
  /** null when the record only moves the surveyor onto existing data. */
  action: Action | null;
  /** The point the walk continues from. */
  anchorId: string;
  /** Where the surveyor is afterwards. */
  scope: Scope;
  /** The Feature that photos and readings of this record belong to. */
  featureId: string;
  /**
   * The edge just walked (갈림길: the new stretch; 계단/EV: the edge between the two floors), for the barometer measurement,
   * and whether it runs against the walk (an existing edge drawn the other way). Left out when no single edge is the walk:
   * the first point of a walk, or an elevator ride between two stops joined through other stops.
   */
  edgeId?: string;
  edgeReversed?: boolean;
  notices: string[];
}

export type Plan = PlanOk | { error: string };

// ---- shared pieces ----

/** Collects the steps of one plan and hands out ids that clash neither with the state nor with each other. */
function builder(state: EditState, ctx: EditContext) {
  const reserved = new Set<string>();
  const made = new Map<string, NodeProps>();
  const steps: ComposeStep[] = [];
  const propsOf = (id: string): NodeProps => made.get(id) ?? state.nodes[id]!.props;
  return {
    steps,
    node(coord: Position, props: NodeProps): string {
      const id = freshId(state, ctx.ids, nodeIdPrefix(state, props), reserved);
      reserved.add(id);
      made.set(id, props);
      steps.push(addNode({ id, coord: [coord[0], coord[1]], props }, ctx));
      return id;
    },
    edge(props: EdgeProps): string {
      const id = freshId(state, ctx.ids, edgeIdPrefix(state, edgeFileScope(props.edge_type, propsOf(props.from), propsOf(props.to))), reserved);
      reserved.add(id);
      steps.push(addEdge({ id, props }, ctx));
      return id;
    },
    action(annotation: string): Action | null {
      return steps.length > 0 ? compose(steps, annotation) : null;
    },
  };
}

/** The closest node of `scope` within `maxM` of `coord` that passes `accept`. */
export function nearestNode(state: EditState, scope: Scope, coord: Position, maxM: number, accept: (n: EditNode) => boolean = () => true): EditNode | undefined {
  let best: EditNode | undefined;
  let bestM = maxM;
  for (const n of Object.values(state.nodes)) {
    if (!nodeInScope(n, scope) || !accept(n)) continue;
    const d = metres(n.coord, coord);
    if (d <= bestM) {
      best = n;
      bestM = d;
    }
  }
  return best;
}

function edgeBetween(state: EditState, a: string, b: string): EditEdge | undefined {
  return Object.values(state.edges).find((e) => (e.props.from === a && e.props.to === b) || (e.props.from === b && e.props.to === a));
}

const isType = (type: NodeType) => (n: EditNode): boolean => n.props.node_type === type;

function walkNode(scope: Scope, source: string): NodeProps {
  return { kind: 'node', node_type: scope.kind === 'outdoor' ? 'outdoor' : 'corridor', ...scopeProps(scope), source };
}

/** A walked stretch inside one scope: a footway outdoors, a corridor indoors. */
function walkEdge(scope: Scope, from: string, to: string, stepFree: boolean | null, source: string): EdgeProps {
  return scope.kind === 'outdoor'
    ? { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: stepFree, source }
    : { kind: 'edge', highway: 'corridor', edge_type: 'indoor', from, to, bidirectional: true, step_free: stepFree, source };
}

/** The anchor when it can be walked from in `scope`; an error text when it is somewhere else. */
function anchorIn(input: PlanInput, scope: Scope): EditNode | undefined | { error: string } {
  const anchor = input.anchorId !== null ? input.state.nodes[input.anchorId] : undefined;
  if (anchor && !nodeInScope(anchor, scope)) {
    return { error: '직전 지점이 다른 층(또는 바깥)에 있습니다. 출입구는 [포탈], 층 이동은 [계단/EV 층 변경]으로 기록해 주세요.' };
  }
  return anchor;
}

// ---- 출발점 지정 ----

/** Start (or restart) the walk at the crosshair: an existing point when one is near, otherwise a new one. */
export function planStart(input: PlanInput): Plan {
  const { state, ctx, scope, coord, source } = input;
  const near = nearestNode(state, scope, coord, SNAP_M);
  if (near) return { action: null, anchorId: near.id, scope, featureId: near.id, notices: ['이미 있는 지점을 출발점으로 삼았습니다.'] };
  const b = builder(state, ctx);
  const id = b.node(coord, walkNode(scope, source));
  return { action: b.action('출발점 지정'), anchorId: id, scope, featureId: id, notices: [] };
}

// ---- 갈림길 기록 ----

export interface JunctionOptions {
  /** true only when the surveyor saw no step or sill on the stretch just walked; null when not looked at. */
  stepFree: boolean | null;
}

/** A point at the crosshair, joined to the point recorded before it. */
export function planJunction(input: PlanInput, opts: JunctionOptions = { stepFree: null }): Plan {
  const { state, ctx, scope, coord, source } = input;
  const anchor = anchorIn(input, scope);
  if (anchor && 'error' in anchor) return anchor;
  const near = nearestNode(state, scope, coord, SNAP_M);
  if (near && anchor && near.id === anchor.id) return { error: '직전 지점과 같은 자리입니다. 지도를 옮긴 뒤 기록해 주세요.' };

  const b = builder(state, ctx);
  const id = near?.id ?? b.node(coord, walkNode(scope, source));
  // The stretch from the point before: the edge that is already there, or a new one.
  const existing = anchor ? edgeBetween(state, anchor.id, id) : undefined;
  const edgeId = existing?.id ?? (anchor ? b.edge(walkEdge(scope, anchor.id, id, opts.stepFree, source)) : undefined);
  return {
    action: b.action('갈림길 기록'),
    anchorId: id,
    scope,
    featureId: id,
    ...(edgeId !== undefined ? { edgeId, edgeReversed: existing !== undefined && existing.props.from !== anchor?.id } : {}),
    notices: near ? ['이미 있는 지점에 이었습니다.'] : [],
  };
}

// ---- 문/강의실 번호 ----

export interface DoorOptions {
  /** Room number as written on the door ("408"). Empty for a door without one. */
  roomRef: string;
  doorRole: DoorRole;
}

/** A door at the crosshair, joined to the nearest corridor of the floor (core attachDoor). The walk stays where it was. */
export function planDoor(input: PlanInput, opts: DoorOptions): Plan {
  const { state, ctx, scope, coord, source } = input;
  if (scope.kind !== 'building') return { error: '문은 건물 안에서 기록합니다. 위쪽에서 건물과 층을 먼저 골라 주세요.' };
  const roomRef = opts.roomRef.trim();
  const b = builder(state, ctx);
  const id = b.node(coord, {
    kind: 'node', node_type: 'door', building_id: scope.buildingId, level: scope.level,
    ...(roomRef !== '' ? { room_ref: roomRef, door_role: opts.doorRole } : {}),
    source,
  });
  const notices: string[] = [];
  const corridor = previewAttachDoor(state, coord, { building_id: scope.buildingId, level: scope.level });
  if (corridor.ok) b.steps.push(() => attachDoorAction(id, { source }, ctx));
  else notices.push(NOT_CONNECTED_NOTICE);
  return { action: b.action(roomRef !== '' ? `${roomRef}호 문 기록` : '문 기록'), anchorId: input.anchorId ?? id, scope, featureId: id, notices };
}

// ---- 계단/EV 층 변경 ----

export type VerticalKind = 'stairs' | 'elevator';

export interface FloorChangeOptions {
  kind: VerticalKind;
  /** The floor walked (or ridden) to. */
  toLevel: number;
  /** Stairs: whether the walk went up or down, from the barometer or the surveyor. Left out when not known. */
  incline?: 'up' | 'down';
}

/** The next free "{code}_elev{A-Z}" of the building (the editor's 엘리베이터 tool names them the same way). */
function newElevatorId(state: EditState, code: string): string | undefined {
  const used = new Set(Object.values(state.nodes).map((n) => n.props.elevator_id));
  for (let c = 65; c <= 90; c++) {
    const id = `${code}_elev${String.fromCharCode(c)}`;
    if (!used.has(id)) return id;
  }
  return undefined;
}

/**
 * A staircase or an elevator from the floor the surveyor is on to `toLevel`, at the crosshair: a landing (or stop) on
 * both floors at the same spot and the edge between them. The walk continues on the other floor.
 */
export function planFloorChange(input: PlanInput, opts: FloorChangeOptions): Plan {
  const { state, ctx, scope, source } = input;
  if (scope.kind !== 'building') return { error: '계단과 엘리베이터는 건물 안에서 기록합니다. 위쪽에서 건물과 층을 먼저 골라 주세요.' };
  const building = buildingById(state, scope.buildingId);
  if (!building) return { error: '건물을 찾을 수 없습니다.' };
  const levels = [...building.props.levels].sort((a, b) => a - b);
  if (opts.toLevel === scope.level || !levels.includes(opts.toLevel)) return { error: '도착한 층을 골라 주세요.' };
  if (opts.kind === 'stairs' && Math.abs(levels.indexOf(opts.toLevel) - levels.indexOf(scope.level)) !== 1) {
    return { error: '계단은 한 층씩 기록해 주세요. 층마다 계단참에서 [계단/EV 층 변경]을 눌러 주세요.' };
  }
  const anchor = anchorIn(input, scope);
  if (anchor && 'error' in anchor) return anchor;

  const toScope: Scope = { kind: 'building', buildingId: scope.buildingId, level: opts.toLevel };
  const nodeType: NodeType = opts.kind === 'stairs' ? 'stair_landing' : 'elevator_stop';
  let coord = input.coord;
  let elevatorId: string | undefined;
  if (opts.kind === 'elevator') {
    // The same shaft on any floor: its stops share one spot and one elevator_id (I5).
    const shaft = Object.values(state.nodes)
      .filter((n) => n.props.building_id === scope.buildingId && n.props.node_type === 'elevator_stop' && n.props.elevator_id !== undefined)
      .map((n) => ({ n, d: metres(n.coord, coord) }))
      .filter((s) => s.d <= SNAP_M)
      .sort((a, b) => a.d - b.d)[0]?.n;
    if (shaft) coord = shaft.coord;
    elevatorId = shaft?.props.elevator_id ?? newElevatorId(state, building.props.code);
    if (elevatorId === undefined) return { error: '이 건물에는 엘리베이터를 더 만들 수 없습니다(A~Z 모두 사용 중).' };
  }
  const sameShaft = (n: EditNode): boolean => n.props.node_type === nodeType && (elevatorId === undefined || n.props.elevator_id === elevatorId);
  const snapM = opts.kind === 'elevator' ? ELEVATOR_STOP_M : SNAP_M;

  const b = builder(state, ctx);
  const endProps = (s: Scope): NodeProps => ({
    kind: 'node', node_type: nodeType, ...scopeProps(s), ...(elevatorId !== undefined ? { elevator_id: elevatorId } : {}), source,
  });
  const fromNode = nearestNode(state, scope, coord, snapM, sameShaft);
  // Both ends sit at one spot: indoor stairs and elevators have no plan length (SPEC-v0.2 3.1).
  const spot = fromNode?.coord ?? coord;
  const toNode = nearestNode(state, toScope, spot, snapM, sameShaft);
  const fromId = fromNode?.id ?? b.node(spot, endProps(scope));
  const toId = toNode?.id ?? b.node(spot, endProps(toScope));

  const existing = edgeBetween(state, fromId, toId);
  // Two stops one elevator already has are joined through its other stops (검사 E11): a direct edge would be a second, shorter ride.
  const alreadyJoined = opts.kind === 'elevator' && fromNode !== undefined && toNode !== undefined;
  const edgeId = existing?.id ?? (alreadyJoined ? undefined : b.edge(opts.kind === 'stairs'
    ? {
        kind: 'edge', highway: 'steps', edge_type: 'indoor', from: fromId, to: toId, bidirectional: true, step_free: false,
        level_from: scope.level, level_to: opts.toLevel, ...(opts.incline !== undefined ? { incline: opts.incline } : {}), source,
      }
    : {
        kind: 'edge', highway: 'elevator', edge_type: 'indoor', from: fromId, to: toId, bidirectional: true, step_free: true,
        level_from: scope.level, level_to: opts.toLevel, source,
      }));
  if (anchor && anchor.id !== fromId && !edgeBetween(state, anchor.id, fromId)) b.edge(walkEdge(scope, anchor.id, fromId, null, source));

  const what = opts.kind === 'stairs' ? '계단' : '엘리베이터';
  return {
    action: b.action(`${what} ${floorLabel(scope.level)} → ${floorLabel(opts.toLevel)} 기록`),
    anchorId: toId,
    scope: toScope,
    featureId: fromId,
    ...(edgeId !== undefined ? { edgeId, edgeReversed: existing !== undefined && existing.props.from !== fromId } : {}),
    notices: existing || alreadyJoined ? [`이미 있는 ${what}을(를) 따라 이동했습니다.`] : [],
  };
}

// ---- 포탈 ----

export interface PortalOptions {
  /** Going in: the building and floor behind the door. Not read when going out (the surveyor's own floor is used). */
  buildingId: string;
  level: number;
  /** true only when the doorway has no step or sill; null when not looked at. */
  stepFree: boolean | null;
}

/**
 * A building entrance at the crosshair and its portal edge to the outdoors. Coming from outside the walk goes in
 * (onto `level`); coming from inside it goes out. The floor may be any floor: on a hill the fourth floor's door can
 * open onto the ground, and the portal edge is what says so.
 */
export function planPortal(input: PlanInput, opts: PortalOptions): Plan {
  const { state, ctx, coord, source } = input;
  const anchor = input.anchorId !== null ? state.nodes[input.anchorId] : undefined;
  const goingOut = input.scope.kind === 'building';
  const inside: Scope = goingOut ? input.scope : { kind: 'building', buildingId: opts.buildingId, level: opts.level };
  const building = buildingById(state, inside.kind === 'building' ? inside.buildingId : '');
  if (inside.kind !== 'building' || !building || !building.props.levels.includes(inside.level)) return { error: '들어갈 건물과 층을 골라 주세요.' };
  if (anchor && !sameScope(scopeOfNode(anchor), input.scope)) {
    return { error: '직전 지점이 다른 층(또는 바깥)에 있습니다. [출발점 지정]으로 지금 있는 자리를 먼저 찍어 주세요.' };
  }

  const b = builder(state, ctx);
  const entranceId = nearestNode(state, inside, coord, SNAP_M, isType('entrance'))?.id
    ?? b.node(coord, { kind: 'node', node_type: 'entrance', ...scopeProps(inside), source });
  // The outdoor end: the point just walked from when coming in, otherwise the nearest outdoor point, otherwise a new one at the door.
  const outdoorId = (!goingOut ? anchor?.id : undefined)
    ?? nearestNode(state, OUTDOOR, coord, PORTAL_SNAP_M)?.id
    ?? b.node(coord, walkNode(OUTDOOR, source));
  if (goingOut && anchor && anchor.id !== entranceId && !edgeBetween(state, anchor.id, entranceId)) {
    b.edge(walkEdge(inside, anchor.id, entranceId, null, source));
  }
  const existing = edgeBetween(state, entranceId, outdoorId);
  if (!existing) {
    b.edge({ kind: 'edge', highway: 'footway', edge_type: 'portal', from: entranceId, to: outdoorId, bidirectional: true, step_free: opts.stepFree, source });
  }
  return {
    action: b.action(goingOut ? '출입구로 나가기 기록' : '출입구로 들어가기 기록'),
    anchorId: goingOut ? outdoorId : entranceId,
    scope: goingOut ? OUTDOOR : inside,
    featureId: entranceId,
    notices: existing ? ['이미 이어진 출입구입니다.'] : [],
  };
}
