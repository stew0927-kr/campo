// placeRoomDoors (SPEC-v0.2 6.3): doors of a room outline on the side that faces the nearest corridor.
import type { DoorRole, Position } from '../../types.ts';
import type { EditContext } from '../action.ts';
import { polygonProblem, scopeProblem } from '../actions/common.ts';
import { edgeCoords, scopeOf, type EditState } from '../state.ts';
import { attachDoorSteps } from './attachDoor.ts';
import { defineMacro, resultOf, type MacroAction, type MacroResult, type Runner } from './compose.ts';
import { corridorCandidates, nearestOf } from './corridor.ts';
import { footOnLine } from '../geo.ts';
import { lineLength, pointAlong, pointInRing, sideways } from './geo.ts';
import { ATTACH_MAX_DIST_M, DOOR_INSET_M, DOOR_SIDE_FRACTIONS } from '../tolerances.ts';

export type RoomDoors = 'front' | 'back' | 'both';

export interface PlaceRoomDoorsOptions {
  doors: RoomDoors;
  /** Needed when the room is given as a polygon. */
  building_id?: string;
  level?: number;
  /** room_ref of the doors. Default: the room's room_ref. */
  room_ref?: string;
  source?: string;
  maxDist?: number;
}

export interface PlaceRoomDoorsResult {
  /** New doors in the order front, back (only the ones asked for). */
  doorIds: string[];
  /** The side of the outline the doors are on. */
  side: [Position, Position];
}

export interface DoorSpot {
  coord: Position;
  door_role: DoorRole;
}

/**
 * Where the doors of a room go: on the side whose midpoint is nearest a corridor of the room's scope, at 20% and 80%
 * of it, 0.3m inside. The front door is the one farther along the corridor's drawn direction.
 */
export function roomDoorSpots(
  state: EditState,
  polygon: Position[][],
  scope: { building_id: string; level: number },
): { side: [Position, Position]; spots: [DoorSpot, DoorSpot] } | string {
  const ring = polygon[0]!;
  const corridors = corridorCandidates(state, scopeOf(scope));
  let best: { i: number; d: number; edgeId: string } | undefined;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const len = lineLength([a, b]);
    if (len === 0) continue;
    const near = nearestOf(state, corridors, pointAlong([a, b], len / 2));
    if (near && (!best || near.d < best.d)) best = { i, d: near.d, edgeId: near.edge.id };
  }
  if (!best) return '이 층에 복도 구간이 없어 문 자리를 정할 수 없습니다.';
  const a = ring[best.i]!;
  const b = ring[best.i + 1]!;
  const len = lineLength([a, b]);
  const inside = (p: Position): Position => {
    const left = sideways(a, b, p, DOOR_INSET_M, 'left');
    return pointInRing(left, ring) ? left : sideways(a, b, p, DOOR_INSET_M, 'right');
  };
  const [p, q] = DOOR_SIDE_FRACTIONS.map((f) => inside(pointAlong([a, b], len * f))) as [Position, Position];
  const corridor = edgeCoords(state, state.edges[best.edgeId]!);
  const pFront = footOnLine(corridor, p).totalDistance > footOnLine(corridor, q).totalDistance;
  return {
    side: [[a[0], a[1]], [b[0], b[1]]],
    spots: pFront ? [{ coord: p, door_role: 'front' }, { coord: q, door_role: 'back' }] : [{ coord: q, door_role: 'front' }, { coord: p, door_role: 'back' }],
  };
}

export function placeRoomDoorsAction(room: string | Position[][], opts: PlaceRoomDoorsOptions, ctx: EditContext): MacroAction<PlaceRoomDoorsResult> {
  const label = opts.doors === 'both' ? '강의실 앞문·뒷문 놓기' : opts.doors === 'front' ? '강의실 앞문 놓기' : '강의실 뒷문 놓기';
  return defineMacro<PlaceRoomDoorsResult>(label, ctx, (r: Runner) => {
    let polygon: Position[][];
    let scope: { building_id: string; level: number };
    let roomRef = opts.room_ref;
    if (typeof room === 'string') {
      const found = r.state.rooms[room];
      if (!found) r.fail(`강의실 영역 "${room}"이(가) 없습니다.`);
      polygon = found.polygon;
      scope = { building_id: found.props.building_id, level: found.props.level };
      roomRef ??= found.props.room_ref;
    } else {
      const bad = polygonProblem(room);
      if (bad) r.fail(bad);
      if (opts.building_id === undefined || opts.level === undefined) r.fail('강의실 영역의 건물(building_id)과 층(level)을 알려 주세요.');
      polygon = room;
      scope = { building_id: opts.building_id, level: opts.level };
    }
    const bad = scopeProblem(r.state, scope);
    if (bad) r.fail(bad);
    if (!['front', 'back', 'both'].includes(opts.doors)) r.fail('doors는 front, back, both 가운데 하나여야 합니다.');

    const where = roomDoorSpots(r.state, polygon, scope);
    if (typeof where === 'string') r.fail(where);
    const [front, back] = where.spots;
    const wanted = opts.doors === 'both' ? [front, back] : opts.doors === 'front' ? [front] : [back];
    const doorIds: string[] = [];
    for (const spot of wanted) {
      const res = attachDoorSteps(r, spot.coord, {
        ...scope,
        door_role: spot.door_role,
        maxDist: opts.maxDist ?? ATTACH_MAX_DIST_M,
        ...(roomRef !== undefined ? { room_ref: roomRef } : {}),
        ...(opts.source !== undefined ? { source: opts.source } : {}),
      }, ctx);
      doorIds.push(res.doorId);
    }
    return { doorIds, side: where.side };
  });
}

/** Place the front, back or both doors of a room (id of a room outline, or a polygon + building and level) and attach them. */
export function placeRoomDoors(state: EditState, room: string | Position[][], opts: PlaceRoomDoorsOptions, ctx: EditContext): MacroResult<PlaceRoomDoorsResult> {
  return resultOf(state, placeRoomDoorsAction(room, opts, ctx));
}
