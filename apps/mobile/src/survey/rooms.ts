// 호실 연속 입력 and 강의실 자동 연결 in the survey app, with the editor's rules (packages/editor/src/model/doors.ts): the
// door layout, the corridor split and the numbering all come from core (refAfter, stripDoors, roomStripAction), so a row
// laid in the app is the same data as one laid in the editor. One plan is one action and one 되돌리기.
import {
  chainOf,
  edgeCoords,
  refAfter,
  roomStripAction,
  stripDoors,
  type Action,
  type EditContext,
  type EditEdge,
  type EditState,
  type Position,
  type RoomStripOptions,
  type StripDoor,
} from '@campo/core';
import type { Scope } from '../model/scope.ts';

const ROOM_REF = /^[A-Za-z0-9-]+$/;
/** The corridor the crosshair picks for a row of rooms: the nearest one within this distance. */
export const CORRIDOR_PICK_M = 6;

// ---- 호실 연속 입력 ----

/** What the 호실 연속 입력 mode remembers between doors. */
export interface DoorRun {
  /** Number of the next front door ("301"); counts up by itself. */
  nextRef: string;
  /** 1, or 2 when one side of the corridor has only odd (or even) numbers. */
  step: 1 | 2;
  /** The room of the last front door, for its back door. */
  lastRef: string | null;
}

export const isRoomRef = (ref: string): boolean => ROOM_REF.test(ref.trim());

/** The run after a front door numbered `ref` went down: the next number is `ref` + step (unchanged when it ends in no digit). */
export function advanceRun(run: DoorRun, ref: string): DoorRun {
  return { ...run, nextRef: refAfter(ref, run.step) ?? ref, lastRef: ref };
}

// ---- 강의실 자동 연결 ----

const kx = (lat: number): number => Math.cos((lat * Math.PI) / 180);

/** Metres from `p` to the polyline, in a flat approximation (enough to pick the corridor under the crosshair). */
function distanceToLine(coords: readonly Position[], p: Position): number {
  const k = kx(p[1]) * 111_320;
  let best = Infinity;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [a, b] = [coords[i]!, coords[i + 1]!];
    const [vx, vy] = [(b[0] - a[0]) * k, (b[1] - a[1]) * 111_320];
    const [wx, wy] = [(p[0] - a[0]) * k, (p[1] - a[1]) * 111_320];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    best = Math.min(best, Math.hypot(wx - t * vx, wy - t * vy));
  }
  return best;
}

const isCorridorOf = (state: EditState, e: EditEdge, scope: Extract<Scope, { kind: 'building' }>): boolean => {
  if (e.props.highway !== 'corridor' || e.props.conveying !== undefined || e.props.edge_type !== 'indoor') return false;
  const [a, b] = [state.nodes[e.props.from], state.nodes[e.props.to]];
  return [a, b].every((n) => n !== undefined && n.props.building_id === scope.buildingId && n.props.level === scope.level);
};

/** The corridor edge of the floor nearest to `coord` (within CORRIDOR_PICK_M), for picking the corridor a row lines. */
export function corridorAt(state: EditState, scope: Scope, coord: Position, maxM = CORRIDOR_PICK_M): EditEdge | undefined {
  if (scope.kind !== 'building') return undefined;
  let best: EditEdge | undefined;
  let bestM = maxM;
  for (const e of Object.values(state.edges)) {
    if (!isCorridorOf(state, e, scope)) continue;
    const d = distanceToLine(edgeCoords(state, e), coord);
    if (d <= bestM) {
      best = e;
      bestM = d;
    }
  }
  return best;
}

/** Which side of the corridor line (walking it the way its first edge is drawn) the point is on. The editor's sideOf. */
export function sideOf(coords: readonly Position[], p: Position): 'left' | 'right' {
  const k = kx(p[1]);
  let best = { d: Infinity, cross: 0 };
  for (let i = 0; i + 1 < coords.length; i++) {
    const [a, b] = [coords[i]!, coords[i + 1]!];
    const [vx, vy] = [(b[0] - a[0]) * k, b[1] - a[1]];
    const [wx, wy] = [(p[0] - a[0]) * k, p[1] - a[1]];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    const d = Math.hypot(wx - t * vx, wy - t * vy);
    if (d < best.d) best = { d, cross: vx * wy - vy * wx };
  }
  return best.cross >= 0 ? 'left' : 'right';
}

export interface StripInput {
  /** The corridor edges the rooms line, joined end to end. */
  corridorEdgeIds: readonly string[];
  /** Where the first room's door is, and the last room's. */
  first: Position;
  last: Position;
  count: number;
  startRef: string;
  refStep: number;
  doorsPerRoom: 1 | 2;
  source: string;
}

export function stripOptions(state: EditState, s: StripInput): RoomStripOptions | { error: string } {
  if (s.corridorEdgeIds.length === 0) return { error: '먼저 복도를 골라 주세요.' };
  const chain = chainOf(state, s.corridorEdgeIds);
  if (typeof chain === 'string') return { error: chain };
  if (!isRoomRef(s.startRef)) return { error: '시작 호실 번호를 입력해 주세요. 영문, 숫자, - 만 쓸 수 있습니다. 예: 301' };
  return {
    corridorEdgeIds: s.corridorEdgeIds,
    side: sideOf(chain.coords, s.first),
    startRef: s.startRef.trim(),
    refStep: s.refStep,
    count: s.count,
    doorsPerRoom: s.doorsPerRoom,
    firstDoor: s.first,
    lastDoor: s.last,
    source: s.source,
  };
}

/** Where the doors would go (core's own layout), to draw before they are laid; or why they cannot be. */
export function stripPreview(state: EditState, s: StripInput): StripDoor[] | { error: string } {
  const opts = stripOptions(state, s);
  if ('error' in opts) return opts;
  const laid = stripDoors(state, opts);
  return typeof laid === 'string' ? { error: laid } : laid.doors;
}

/** The whole row as one action (roomStripAction). */
export function planStrip(state: EditState, ctx: EditContext, s: StripInput): { action: Action; doors: number } | { error: string } {
  const opts = stripOptions(state, s);
  if ('error' in opts) return opts;
  const laid = stripDoors(state, opts);
  if (typeof laid === 'string') return { error: laid };
  return { action: roomStripAction(opts, ctx) as Action, doors: laid.doors.length };
}
