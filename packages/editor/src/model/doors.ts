// 문 연속 찍기 (D), 강의실 줄 (R) and 화장실 (SPEC-v0.2 6.5, 2.3): plans of core macros plus the previews the map draws.
// The perpendicular foot, the corridor split and the door layout all come from core (previewAttachDoor, stripDoors, roomStripAction).
import {
  chainOf,
  previewAttachDoor,
  refAfter,
  roomStripAction,
  stripDoors,
  type DoorRole,
  type EditState,
  type EditContext,
  type Position,
  type RestroomGender,
  type RoomStripOptions,
  type Wheelchair,
} from '@campo/core';
import type { FeatureCollection } from 'geojson';
import { noCorridor, planPointWithAttach } from './connect.ts';
import type { PlanResult } from './plan.ts';
import { floorLabel, type Scope } from './scope.ts';

export const NEED_FLOOR = '건물 안을 눌러 주세요. (O 키를 누르고 있으면 건물 위라도 바깥으로 찍힙니다.)';
const ROOM_REF = /^[A-Za-z0-9-]+$/;

// ---- 문 연속 찍기 ----

/** What the 문 연속 찍기 tool remembers between clicks: the number the next room gets, the step, and the last room. */
export interface DoorRun {
  /** Number of the next front door ("301"). Typed once; counts up by itself. */
  nextRef: string;
  /** 1, or 2 when the key 2 was pressed (one side has only odd numbers). */
  step: 1 | 2;
  /** The room of the last front door, for Shift+click (its back door). */
  lastRef: string | null;
  /** The last door placed (F flips it). */
  lastDoorId: string | null;
}

export const initialDoorRun: DoorRun = { nextRef: '', step: 1, lastRef: null, lastDoorId: null };

/** The next number after `ref`, counting by `step`. Without trailing digits the number stays (the user types the next one). */
export function nextRefAfter(ref: string, step: number): string {
  return refAfter(ref, step) ?? ref;
}

/** One click of 문 연속 찍기: a door (front, or back with `back`) joined to the nearest corridor, in one plan. */
export function planDoor(state: EditState, ctx: EditContext, p: { position: Position; scope: Scope; ref: string; back: boolean }): PlanResult {
  if (p.scope.kind !== 'building') return { error: NEED_FLOOR };
  const ref = p.ref.trim();
  if (!ROOM_REF.test(ref)) return { error: '호실 번호를 먼저 입력해 주세요. 영문, 숫자, - 만 쓸 수 있습니다. 예: 301, B102' };
  const role: DoorRole = p.back ? 'back' : 'front';
  return planPointWithAttach(state, ctx, {
    position: p.position,
    buildingId: p.scope.buildingId,
    level: p.scope.level,
    props: { node_type: 'door', room_ref: ref, door_role: role },
    annotation: p.back ? `${ref}호 뒷문 추가` : `${ref}호 문 추가`,
  });
}

export interface Preview {
  shapes: FeatureCollection | null;
  /** Short Korean text next to the cursor, e.g. why nothing attaches. */
  text: string | null;
}

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Mouse-move preview: the foot of the perpendicular on the nearest corridor and the line to it (previewAttachDoor). */
export function doorPreview(state: EditState, position: Position, scope: Scope): Preview {
  if (scope.kind !== 'building') return { shapes: null, text: NEED_FLOOR };
  const pv = previewAttachDoor(state, position, { building_id: scope.buildingId, level: scope.level });
  if (!pv.ok) return { shapes: null, text: noCorridor(pv.reason) ? '복도가 가까이 없어요. 지점만 만들어집니다.' : pv.reason };
  return {
    text: `복도까지 ${pv.distanceM.toFixed(1)}m${pv.nodeId ? '' : ' · 복도를 나눕니다'}`,
    shapes: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [position, pv.foot] }, properties: { role: 'link' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: pv.foot }, properties: { role: 'foot' } },
      ],
    },
  };
}

// ---- 강의실 줄 ----

export interface StripInput {
  corridorEdgeIds: string[];
  first: Position;
  last: Position;
  count: number;
  startRef: string;
  refStep: number;
  doorsPerRoom: 1 | 2;
}

/** Which side of the corridor line (walking its first edge's way) the point is on. */
export function sideOf(coords: readonly Position[], p: Position): 'left' | 'right' {
  const kx = Math.cos((p[1] * Math.PI) / 180);
  let best = { d: Infinity, cross: 0 };
  for (let i = 0; i + 1 < coords.length; i++) {
    const [a, b] = [coords[i]!, coords[i + 1]!];
    const vx = (b[0] - a[0]) * kx;
    const vy = b[1] - a[1];
    const wx = (p[0] - a[0]) * kx;
    const wy = p[1] - a[1];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    const d = Math.hypot(wx - t * vx, wy - t * vy);
    if (d < best.d) best = { d, cross: vx * wy - vy * wx };
  }
  return best.cross >= 0 ? 'left' : 'right';
}

export function stripOptions(state: EditState, s: StripInput): RoomStripOptions | { error: string } {
  const chain = chainOf(state, s.corridorEdgeIds);
  if (typeof chain === 'string') return { error: chain };
  if (!ROOM_REF.test(s.startRef.trim())) return { error: '시작 호실 번호를 입력해 주세요. 영문, 숫자, - 만 쓸 수 있습니다. 예: 301' };
  return {
    corridorEdgeIds: s.corridorEdgeIds,
    side: sideOf(chain.coords, s.first),
    startRef: s.startRef.trim(),
    refStep: s.refStep,
    count: s.count,
    doorsPerRoom: s.doorsPerRoom,
    firstDoor: s.first,
    lastDoor: s.last,
  };
}

/** The plan of the whole row: roomStripAction, one history entry. */
export function planStrip(state: EditState, ctx: EditContext, s: StripInput): PlanResult {
  const opts = stripOptions(state, s);
  if ('error' in opts) return opts;
  const laid = stripDoors(state, opts);
  if (typeof laid === 'string') return { error: laid };
  return { annotation: `강의실 ${s.count}개 문 놓기`, steps: [() => roomStripAction(opts, ctx)] };
}

/** Where the doors of the row would go (core's own layout), for the preview before Enter. */
export function stripPreview(state: EditState, s: StripInput): Preview {
  const opts = stripOptions(state, s);
  if ('error' in opts) return { shapes: null, text: opts.error };
  const laid = stripDoors(state, opts);
  if (typeof laid === 'string') return { shapes: null, text: laid };
  return {
    text: `문 ${laid.doors.length}개 · Enter로 놓기`,
    shapes: {
      type: 'FeatureCollection',
      features: laid.doors.map((d) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: d.coord }, properties: { role: d.door_role === 'back' ? 'back' : 'door', ref: d.room_ref } })),
    },
  };
}

export const NO_PREVIEW: Preview = { shapes: empty, text: null };

// ---- 화장실 ----

export const GENDERS: { id: RestroomGender; label: string }[] = [
  { id: 'male', label: '남자' },
  { id: 'female', label: '여자' },
  { id: 'unisex', label: '성별 구분 없음' },
  { id: 'family', label: '가족 화장실' },
];
export const WHEELCHAIRS: { id: Wheelchair; label: string }[] = [
  { id: 'unknown', label: '확인하지 않았어요' },
  { id: 'yes', label: '휠체어로 쓸 수 있어요(현장에서 확인함)' },
  { id: 'limited', label: '일부만 쓸 수 있어요' },
  { id: 'no', label: '쓸 수 없어요' },
];

export interface RestroomForm {
  gender: RestroomGender;
  wheelchair: Wheelchair;
  /** null: not known. */
  changingTable: boolean | null;
  name?: string;
}

/** A restroom point joined to the corridor when one is near: compose([addNode, attachDoorAction]). */
export function planRestroom(state: EditState, ctx: EditContext, p: { position: Position; scope: Scope; form: RestroomForm }): PlanResult {
  if (p.scope.kind !== 'building') return { error: NEED_FLOOR };
  const name = p.form.name?.trim();
  return planPointWithAttach(state, ctx, {
    position: p.position,
    buildingId: p.scope.buildingId,
    level: p.scope.level,
    props: {
      node_type: 'restroom',
      restroom_gender: p.form.gender,
      wheelchair: p.form.wheelchair,
      changing_table: p.form.changingTable,
      ...(name ? { name } : {}),
    },
    annotation: `${GENDERS.find((g) => g.id === p.form.gender)?.label ?? ''}${p.form.gender === 'family' ? '' : ' 화장실'} 추가(${floorLabel(p.scope.level)})`,
  });
}
