// 외곽선 수정: the outline being edited, kept here until 완료 makes it one history entry (core setBuildingOutline).
// The corners move, appear and go in the draft; its own 되돌리기 / 다시 하기 step through those changes, and 취소 drops it.
import {
  MIN_OUTLINE_CORNERS, buildingById, closeRing, hasFloorOutline, insertCorner, moveCorner, outlineOfLevel, removeCorner, resetFloorOutline,
  ringCorners, setBuildingOutline, type EditState, type Position,
} from '@campo/core';
import type { PlanResult } from './plan.ts';
import { floorLabel } from './scope.ts';

export interface OutlineDraft {
  buildingId: string;
  code: string;
  /** The floor whose own outline is edited; null: the building outline every other floor follows. */
  level: number | null;
  corners: Position[];
  /** Holes of the outline (courtyards): kept as they are. */
  holes: Position[][];
  /** Earlier corners (되돌리기) and corners taken back (다시 하기). */
  past: Position[][];
  future: Position[][];
}

export function startOutline(state: EditState, buildingId: string, level: number | null): OutlineDraft | { error: string } {
  const b = buildingById(state, buildingId);
  if (!b) return { error: '건물을 찾을 수 없습니다.' };
  if (level !== null && !b.props.levels.includes(level)) return { error: '이 건물에 없는 층입니다.' };
  // A floor without its own outline starts from the building's: 완료 then gives the floor its own.
  const [outer, ...holes] = outlineOfLevel(b, level);
  return { buildingId, code: b.props.code, level, corners: ringCorners(outer ?? []), holes: holes.map((r) => r.map((p): Position => [p[0], p[1]])), past: [], future: [] };
}

const changed = (d: OutlineDraft, corners: Position[]): OutlineDraft => ({ ...d, corners, past: [...d.past, d.corners], future: [] });

export const moveDraftCorner = (d: OutlineDraft, index: number, to: Position): OutlineDraft => changed(d, moveCorner(d.corners, index, to));
export const insertDraftCorner = (d: OutlineDraft, side: number, at: Position): OutlineDraft => changed(d, insertCorner(d.corners, side, at));
/** Without corner `index`, or why not (three corners are the least an outline has). */
export function removeDraftCorner(d: OutlineDraft, index: number): OutlineDraft | { error: string } {
  const next = removeCorner(d.corners, index);
  return next ? changed(d, next) : { error: `외곽선에는 꼭짓점이 ${MIN_OUTLINE_CORNERS}개 이상 있어야 해서 지울 수 없습니다.` };
}
export function undoDraft(d: OutlineDraft): OutlineDraft {
  const prev = d.past.at(-1);
  return prev ? { ...d, corners: prev, past: d.past.slice(0, -1), future: [d.corners, ...d.future] } : d;
}
export function redoDraft(d: OutlineDraft): OutlineDraft {
  const [next, ...rest] = d.future;
  return next ? { ...d, corners: next, past: [...d.past, d.corners], future: rest } : d;
}

/** The outline as it would be saved. */
export const draftPolygon = (d: OutlineDraft): Position[][] => [closeRing(d.corners), ...d.holes];

/** 완료: the draft as one history entry. */
export function planOutline(d: OutlineDraft): PlanResult {
  const action = setBuildingOutline(d.code, d.level, draftPolygon(d));
  return { annotation: d.level === null ? '건물 외곽선 수정' : `${floorLabel(d.level)} 외곽선 수정`, steps: [() => action] };
}

/** 건물 외곽선으로 되돌리기: the floor's own outline goes. */
export function planResetOutline(state: EditState, buildingId: string, level: number): PlanResult {
  const b = buildingById(state, buildingId);
  if (!b) return { error: '건물을 찾을 수 없습니다.' };
  if (!hasFloorOutline(b, level)) return { error: '이 층은 이미 건물 외곽선을 따릅니다.' };
  const action = resetFloorOutline(b.props.code, level);
  return { annotation: `${floorLabel(level)} 외곽선을 건물 외곽선으로 되돌리기`, steps: [() => action] };
}
