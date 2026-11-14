// The record buttons (docs/mobile/SPEC-mobile.md 2) as plans of core edit actions. A plan is one history entry
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
  type RestroomGender,
  type Wheelchair,
} from '@campo/core';
import { OUTDOOR, floorLabel, nodeInScope, sameScope, scopeOfNode, scopeProps, type Scope } from '../model/scope.ts';

/** The crosshair takes an existing point of the same scope within this distance instead of making a new one. */
export const SNAP_M = 2;
/** 포탈 joins the entrance to an outdoor point this close; farther than that it makes a new outdoor point at the door. */
export const PORTAL_SNAP_M = 15;

export const NOT_CONNECTED_NOTICE = '아직 복도와 연결되지 않았어요. 복도를 기록한 뒤 편집기에서 이어 주세요.';

export type NodeProps = Omit<NodeProperties, 'rev'>;
export type EdgeProps = Omit<EdgeProperties, 'rev'>;

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
   * The edge just walked (잇기: the new stretch; 에스컬레이터: the belt ridden; 계단/EV: the edge between the two floors), for the barometer measurement,
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
export function builder(state: EditState, ctx: EditContext) {
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

/** The closest node within `maxM` of `coord` that passes `accept`. */
function nearestWhere(state: EditState, coord: Position, maxM: number, accept: (n: EditNode) => boolean): EditNode | undefined {
  let best: EditNode | undefined;
  let bestM = maxM;
  for (const n of Object.values(state.nodes)) {
    if (!accept(n)) continue;
    const d = metres(n.coord, coord);
    if (d <= bestM) {
      best = n;
      bestM = d;
    }
  }
  return best;
}

/** The closest node of `scope` within `maxM` of `coord` that passes `accept`. */
export function nearestNode(state: EditState, scope: Scope, coord: Position, maxM: number, accept: (n: EditNode) => boolean = () => true): EditNode | undefined {
  return nearestWhere(state, coord, maxM, (n) => nodeInScope(n, scope) && accept(n));
}

/** Whether a ride from stop `a` reaches stop `b` over elevator edges, through any stops in between. Follows the edges only. */
function rideJoins(state: EditState, a: string, b: string): boolean {
  const rides = Object.values(state.edges).filter((e) => e.props.highway === 'elevator');
  const seen = new Set([a]);
  const queue = [a];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    if (at === b) return true;
    for (const e of rides) {
      const next = e.props.from === at ? e.props.to : e.props.to === at ? e.props.from : undefined;
      if (next !== undefined && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
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

// ---- 잇기 · 외부 길 ----

/** What the stretch is: level ground, steps or a ramp. Indoors only level ground (a corridor) and ramps are linked here. */
export type PathKind = 'flat' | 'steps' | 'ramp';

export interface LinkOptions {
  /** true only when the surveyor saw no step or sill on the stretch just walked; null when not looked at. */
  stepFree: boolean | null;
  /** Default 'flat'. */
  kind?: PathKind;
}

/** A stretch between two points of one scope, of `kind`. */
function pathEdge(scope: Scope, from: string, to: string, kind: PathKind, stepFree: boolean | null, source: string): EdgeProps {
  if (kind === 'flat') return walkEdge(scope, from, to, stepFree, source);
  const edgeType = scope.kind === 'outdoor' ? 'outdoor' : 'indoor';
  if (kind === 'ramp') return { kind: 'edge', highway: 'ramp', edge_type: edgeType, from, to, bidirectional: true, step_free: stepFree, source };
  return { kind: 'edge', highway: 'steps', edge_type: 'outdoor', from, to, bidirectional: true, step_free: false, source };
}

/** Node types that hang on a corridor and may be recorded before it (the editor's 작업 순서와 상관없이 잇기). */
export const ATTACHABLE_TYPES: readonly NodeType[] = ['door', 'restroom', 'elevator_stop'];

/** Points of a floor that have no way to walk to yet: only elevator edges (or none) at them. */
export function unattachedOnFloor(state: EditState, buildingId: string, level: number): EditNode[] {
  const walked = new Set<string>();
  for (const e of Object.values(state.edges)) {
    if (e.props.highway === 'elevator') continue;
    walked.add(e.props.from);
    walked.add(e.props.to);
  }
  return Object.values(state.nodes)
    .filter((n) => ATTACHABLE_TYPES.includes(n.props.node_type) && n.props.building_id === buildingId && n.props.level === level && !walked.has(n.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Attach every waiting point of the floor that a corridor edge of `edgeIds` reaches, after `state`. Returns the actions
 * (to run after the ones that made `state`) and the points attached. The pieces a split leaves join the set, as in the editor.
 */
export function attachWaiting(state: EditState, ctx: EditContext, scope: Extract<Scope, { kind: 'building' }>, edgeIds: readonly string[], source: string): { actions: Action[]; attached: string[] } {
  const allowed = new Set(edgeIds);
  const actions: Action[] = [];
  const attached: string[] = [];
  let s = state;
  for (const n of unattachedOnFloor(state, scope.buildingId, scope.level)) {
    const pv = previewAttachDoor(s, n.coord, { building_id: scope.buildingId, level: scope.level, edgeIds: allowed });
    if (!pv.ok) continue;
    const action = attachDoorAction(n.id, { source, edgeIds: new Set(allowed) }, ctx);
    if (action.disabled(s) !== false) continue;
    const next = action.apply(s);
    for (const id of Object.keys(next.edges)) if (!(id in s.edges)) allowed.add(id);
    s = next;
    actions.push(action);
    attached.push(n.id);
  }
  return { actions, attached };
}

/**
 * 잇기 (and 외부 길 outdoors): a point at the crosshair — the existing one there, or a new one — joined to the point the
 * chain is at (the walk's last point). With no point yet it only puts down the first one. A new corridor also picks
 * up the doors, restrooms and elevator stops of the floor that were waiting for one, in the same history entry.
 */
export function planLink(input: PlanInput, opts: LinkOptions = { stepFree: null }): Plan {
  const { state, ctx, scope, coord, source } = input;
  const kind = opts.kind ?? 'flat';
  if (scope.kind === 'building' && kind === 'steps') return { error: '건물 안의 계단은 [계단/EV]로 층 사이를 기록해 주세요.' };
  const anchor = anchorIn(input, scope);
  if (anchor && 'error' in anchor) return anchor;
  const near = nearestNode(state, scope, coord, SNAP_M);
  if (near && anchor && near.id === anchor.id) return { error: '시작 지점과 같은 자리입니다. 이을 지점으로 지도를 옮겨 주세요.' };

  const b = builder(state, ctx);
  const id = near?.id ?? b.node(coord, walkNode(scope, source));
  // The stretch from the point before: the edge that is already there, or a new one.
  const existing = anchor ? edgeBetween(state, anchor.id, id) : undefined;
  const edgeId = existing?.id ?? (anchor ? b.edge(pathEdge(scope, anchor.id, id, kind, opts.stepFree, source)) : undefined);
  const notices: string[] = [];
  if (!anchor) notices.push(near ? '이 지점에서 잇기 시작합니다.' : '시작 지점을 찍었습니다. 이을 곳에 십자선을 맞추고 다시 눌러 주세요.');
  else if (existing) notices.push('이미 이어진 두 지점입니다. 다음 지점으로 이어 가세요.');
  else if (near) notices.push('이미 있는 지점에 이었습니다.');

  const what = scope.kind === 'outdoor' ? (kind === 'steps' ? '바깥 계단' : kind === 'ramp' ? '바깥 경사로' : '외부 길') : kind === 'ramp' ? '경사로' : '복도';
  let action = b.action(anchor && !existing ? `${what} 잇기` : '지점 기록');
  if (action && scope.kind === 'building' && kind === 'flat' && edgeId !== undefined && !existing) {
    const waiting = attachWaiting(action.apply(state), ctx, scope, [edgeId], source);
    if (waiting.actions.length > 0) {
      action = compose([action, ...waiting.actions], `${what} 잇기, 지점 ${waiting.actions.length}개 연결`);
      notices.push(`기다리던 문·화장실·엘리베이터 ${waiting.actions.length}개를 이 복도에 이었습니다.`);
    }
  }
  return {
    action,
    anchorId: id,
    scope,
    featureId: id,
    ...(edgeId !== undefined ? { edgeId, edgeReversed: existing !== undefined && existing.props.from !== anchor?.id } : {}),
    notices,
  };
}

// ---- 에스컬레이터 ----

/** One belt that runs the way it was ridden, the up and down pair side by side, or one that changes direction. */
export type BeltKind = 'one' | 'pair' | 'reversible';

export interface EscalatorOptions {
  /** Where the ride ended: the crosshair on arriving, and the floor (or the outdoors) arrived on. */
  arrive: { coord: Position; scope: Scope };
  /** Whether the ride went up (the surveyor says so, or the barometer does). */
  rodeUp: boolean;
  belt: BeltKind;
}

const isWalkPoint = (n: EditNode): boolean => n.props.node_type === 'corridor' || n.props.node_type === 'outdoor';

/**
 * An escalator from where the ride began (the input's coord and scope) to where it ended: a walk point at each end (an
 * existing one within SNAP_M, else a new one) and a steps edge with `conveying`, drawn from the lower end to the upper
 * one (SPEC-v0.2 2.7). Which end is lower is what the surveyor rode, not a comparison of floor numbers.
 */
export function planEscalator(input: PlanInput, opts: EscalatorOptions): Plan {
  const { state, ctx, scope, coord, source } = input;
  const to = opts.arrive.scope;
  if ((scope.kind === 'outdoor') !== (to.kind === 'outdoor')) return { error: '바깥과 건물 안은 에스컬레이터로 잇지 않습니다. 출입구로 기록해 주세요.' };
  if (scope.kind === 'building' && to.kind === 'building') {
    if (scope.buildingId !== to.buildingId) return { error: '에스컬레이터는 한 건물 안에서만 기록합니다.' };
    if (scope.level === to.level) return { error: '도착한 층을 골라 주세요. 같은 층끼리는 [잇기]로 이어 주세요.' };
    if (!buildingById(state, to.buildingId)?.props.levels.includes(to.level)) return { error: '이 건물의 층 목록에 없는 층입니다.' };
  }
  const anchor = anchorIn(input, scope);
  if (anchor && 'error' in anchor) return anchor;

  const b = builder(state, ctx);
  const startId = nearestNode(state, scope, coord, SNAP_M, isWalkPoint)?.id ?? b.node(coord, walkNode(scope, source));
  const endId = nearestNode(state, to, opts.arrive.coord, SNAP_M, isWalkPoint)?.id ?? b.node(opts.arrive.coord, walkNode(to, source));
  if (startId === endId) return { error: '탄 곳과 내린 곳이 같은 지점입니다. 내린 자리에 십자선을 맞춰 주세요.' };

  const [lower, upper] = opts.rodeUp ? [startId, endId] : [endId, startId];
  const [lowerScope, upperScope] = opts.rodeUp ? [scope, to] : [to, scope];
  const levels = lowerScope.kind === 'building' && upperScope.kind === 'building' ? { level_from: lowerScope.level, level_to: upperScope.level } : {};
  const belt = (conveying: 'forward' | 'backward' | 'reversible'): EdgeProps => ({
    kind: 'edge', highway: 'steps', edge_type: scope.kind === 'outdoor' ? 'outdoor' : 'indoor', from: lower, to: upper,
    bidirectional: conveying === 'reversible', step_free: false, conveying, ...levels, source,
  });
  const already = Object.values(state.edges).filter((e) => e.props.conveying !== undefined
    && ((e.props.from === lower && e.props.to === upper) || (e.props.from === upper && e.props.to === lower)));

  // The belt the surveyor rode: up = forward (lower → upper as drawn), down = backward.
  let rideId: string | undefined;
  if (already.length > 0) {
    // A belt carries the surveyor from start to end when it runs along its drawing that way, or against it the other way.
    rideId = already.find((e) => e.props.conveying === 'reversible' || e.props.conveying === (e.props.from === startId ? 'forward' : 'backward'))?.id;
  } else if (opts.belt === 'reversible') {
    rideId = b.edge(belt('reversible'));
  } else {
    const up = opts.belt === 'pair' || opts.rodeUp ? b.edge(belt('forward')) : undefined;
    const down = opts.belt === 'pair' || !opts.rodeUp ? b.edge(belt('backward')) : undefined;
    rideId = opts.rodeUp ? up : down;
  }
  if (anchor && anchor.id !== startId && !edgeBetween(state, anchor.id, startId)) b.edge(walkEdge(scope, anchor.id, startId, null, source));

  const where = to.kind === 'building' && scope.kind === 'building' ? ` ${floorLabel(scope.level)} → ${floorLabel(to.level)}` : '';
  const ridden = rideId !== undefined ? state.edges[rideId] : undefined;
  return {
    action: b.action(`에스컬레이터${where} 기록`),
    anchorId: endId,
    scope: to,
    featureId: startId,
    ...(rideId !== undefined ? { edgeId: rideId, edgeReversed: ridden ? ridden.props.from !== startId : !opts.rodeUp } : {}),
    notices: already.length > 0 ? ['이미 있는 에스컬레이터를 따라 이동했습니다.'] : [],
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

// ---- 화장실 ----

export interface RestroomOptions {
  gender: RestroomGender;
  /** 'unknown' until it was checked on site (the schema requires a value). */
  wheelchair: Wheelchair;
  /** null: not looked at. */
  changingTable: boolean | null;
}

/** A restroom point at the crosshair, joined to the nearest corridor when there is one (the editor's compose([addNode, attachDoorAction])). */
export function planRestroom(input: PlanInput, opts: RestroomOptions): Plan {
  const { state, ctx, scope, coord, source } = input;
  if (scope.kind !== 'building') return { error: '화장실은 건물 안에서 기록합니다. 위쪽에서 건물과 층을 먼저 골라 주세요.' };
  const b = builder(state, ctx);
  const id = b.node(coord, {
    kind: 'node', node_type: 'restroom', building_id: scope.buildingId, level: scope.level,
    restroom_gender: opts.gender, wheelchair: opts.wheelchair, changing_table: opts.changingTable, source,
  });
  const notices: string[] = [];
  if (previewAttachDoor(state, coord, { building_id: scope.buildingId, level: scope.level }).ok) b.steps.push(() => attachDoorAction(id, { source }, ctx));
  else notices.push(NOT_CONNECTED_NOTICE);
  return { action: b.action(`화장실 기록(${floorLabel(scope.level)})`), anchorId: input.anchorId ?? id, scope, featureId: id, notices };
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
    const shaft = nearestWhere(state, coord, SNAP_M, (n) =>
      n.props.building_id === scope.buildingId && n.props.node_type === 'elevator_stop' && n.props.elevator_id !== undefined);
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
  // Two stops the elevator already joins through its other stops get no direct edge: that would be a second, shorter ride.
  // Stops that are not joined yet (two parts of a shaft recorded on different rides) are joined by this ride (검사 E11).
  const alreadyJoined = opts.kind === 'elevator' && fromNode !== undefined && toNode !== undefined && rideJoins(state, fromNode.id, toNode.id);
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
