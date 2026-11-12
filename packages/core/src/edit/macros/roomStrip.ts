// roomStrip (SPEC-v0.2 6.4): a row of classrooms along a corridor from two clicks (first door, last door).
import type { DoorRole, Position } from '../../types.ts';
import type { EditContext } from '../action.ts';
import { isPosition, type EditState } from '../state.ts';
import { attachDoorSteps } from './attachDoor.ts';
import { defineMacro, resultOf, type MacroAction, type MacroResult, type Runner } from './compose.ts';
import { chainOf, type Chain } from './corridor.ts';
import { pointAlong, project, segmentAt, sideways } from './geo.ts';
import { ATTACH_MAX_DIST_M, DOOR_SIDE_FRACTIONS, SNAP_VERTEX_M } from './tolerances.ts';

export interface RoomStripOptions {
  /** Corridor edges the rooms line, joined into one line that runs in the drawn direction of the first edge. */
  corridorEdgeIds: readonly string[];
  /** Side of that line the doors are on. */
  side: 'left' | 'right';
  /** Room number of the first room, e.g. "301" or "B101". */
  startRef: string;
  /** Step between room numbers (2 when one side has only odd numbers). Default 1. */
  refStep?: number;
  count: number;
  doorsPerRoom: 1 | 2;
  /** Clicked position of the first door (its distance from the corridor sets how far off the corridor the doors go). */
  firstDoor: Position;
  /** Clicked position of the last door. */
  lastDoor: Position;
  source?: string;
  maxDist?: number;
}

export interface StripRoom {
  room_ref: string;
  /** Front door first. */
  doorIds: string[];
}

export interface RoomStripResult {
  rooms: StripRoom[];
  doorIds: string[];
}

export interface StripDoor {
  coord: Position;
  room_ref: string;
  door_role: DoorRole;
  /** Metres along the corridor line. */
  along: number;
}

/** `startRef` + `k`, keeping a letter prefix and leading zeros ("B099" + 2 → "B101"). */
export function refAfter(startRef: string, k: number): string | undefined {
  const m = /^(.*?)(\d+)$/.exec(startRef);
  if (!m) return undefined;
  const value = Number.parseInt(m[2]!, 10) + k;
  if (value < 0) return undefined;
  return `${m[1]!}${String(value).padStart(m[2]!.length, '0')}`;
}

/** Where every door of the strip goes (pure; used by the editor preview and the macro). */
export function stripDoors(state: EditState, opts: RoomStripOptions): { chain: Chain; doors: StripDoor[] } | string {
  const { count, doorsPerRoom } = opts;
  const refStep = opts.refStep ?? 1;
  if (!Number.isInteger(count) || count < 1) return '강의실 개수(count)는 1 이상의 정수여야 합니다.';
  if (doorsPerRoom !== 1 && doorsPerRoom !== 2) return '강의실마다 문 개수(doorsPerRoom)는 1 또는 2여야 합니다.';
  if (!Number.isInteger(refStep) || refStep < 1) return '호실 번호 간격(refStep)은 1 이상의 정수여야 합니다.';
  if (opts.side !== 'left' && opts.side !== 'right') return 'side는 left 또는 right여야 합니다.';
  if (refAfter(opts.startRef, 0) === undefined) return '시작 호실 번호(startRef)는 숫자로 끝나야 합니다. 예: "301"';
  if (!isPosition(opts.firstDoor) || !isPosition(opts.lastDoor)) return '첫 문과 마지막 문 좌표가 [경도, 위도] 숫자 쌍이 아닙니다.';
  const chain = chainOf(state, opts.corridorEdgeIds);
  if (typeof chain === 'string') return chain;

  const a = project(chain.coords, opts.firstDoor);
  const b = project(chain.coords, opts.lastDoor);
  const offset = (a.pointDistance + b.pointDistance) / 2;
  if (offset <= SNAP_VERTEX_M) return `문 자리를 복도에서 ${SNAP_VERTEX_M}m 넘게 떨어진 곳에 찍어 주세요.`;
  const span = b.totalDistance - a.totalDistance;
  const doors = count * doorsPerRoom;
  if (doors > 1 && Math.abs(span) <= SNAP_VERTEX_M) return '첫 문과 마지막 문이 복도를 따라 너무 가깝습니다.';

  const [f0, f1] = DOOR_SIDE_FRACTIONS;
  const along: number[][] = [];
  if (doorsPerRoom === 1) {
    for (let i = 0; i < count; i++) along.push([count === 1 ? a.totalDistance : a.totalDistance + (span * i) / (count - 1)]);
  } else {
    const width = span / (count - 1 + f1 - f0);
    for (let i = 0; i < count; i++) {
      const s = a.totalDistance + i * width;
      along.push([s, s + (f1 - f0) * width]);
    }
  }
  const out: StripDoor[] = [];
  along.forEach((room, i) => {
    const ref = refAfter(opts.startRef, i * refStep)!;
    const front = Math.max(...room);
    for (const s of room) {
      const [p, q] = segmentAt(chain.coords, s);
      out.push({
        coord: sideways(p, q, pointAlong(chain.coords, s), offset, opts.side),
        room_ref: ref,
        // front door: the one farther along the corridor's direction (SPEC-v0.2 6.3); one door per room is the front door
        door_role: room.length === 1 || s === front ? 'front' : 'back',
        along: s,
      });
    }
  });
  return { chain, doors: out };
}

export function roomStripAction(opts: RoomStripOptions, ctx: EditContext): MacroAction<RoomStripResult> {
  return defineMacro<RoomStripResult>((res) => `강의실 ${res.rooms.length}개 문 ${res.doorIds.length}개 놓기`, ctx, (r: Runner) => {
    const plan = stripDoors(r.state, opts);
    if (typeof plan === 'string') r.fail(plan);
    const allowed = new Set(plan.chain.edgeIds);
    const rooms: StripRoom[] = [];
    const doorIds: string[] = [];
    for (const door of plan.doors) {
      const res = attachDoorSteps(r, door.coord, {
        building_id: plan.chain.building_id,
        level: plan.chain.level,
        room_ref: door.room_ref,
        door_role: door.door_role,
        maxDist: opts.maxDist ?? ATTACH_MAX_DIST_M,
        edgeIds: allowed,
        ...(opts.source !== undefined ? { source: opts.source } : {}),
      }, ctx);
      for (const e of res.splitEdgeIds) allowed.add(e);
      doorIds.push(res.doorId);
      let room = rooms.find((x) => x.room_ref === door.room_ref);
      if (!room) rooms.push((room = { room_ref: door.room_ref, doorIds: [] }));
      if (door.door_role === 'front') room.doorIds.unshift(res.doorId);
      else room.doorIds.push(res.doorId);
    }
    return { rooms, doorIds };
  });
}

/** Lay out `count` rooms' doors between two clicks along a corridor and attach them all (SPEC-v0.2 6.4). */
export function roomStrip(state: EditState, opts: RoomStripOptions, ctx: EditContext): MacroResult<RoomStripResult> {
  return resultOf(state, roomStripAction(opts, ctx));
}
