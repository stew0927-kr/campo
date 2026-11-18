// 평지 모양 수정: the plaza rings being edited, kept here until 완료 makes it one history entry (core setPlazaOutline).
// 같은 방식의 건물 외곽선 수정(model/outlineEdit.ts)과 달리 바깥 링과 구멍 링을 모두 고칩니다. 꼭짓점이 움직이고,
// 생기고, 사라지는 것은 draft 안에서 일어나며, draft의 되돌리기 / 다시 하기가 그 변화만 되돌립니다. 취소는 draft를 버립니다.
import {
  MIN_OUTLINE_CORNERS,
  closeRing,
  insertCorner,
  moveCorner,
  plazaProblem,
  removeCorner,
  ringCorners,
  setPlazaOutline,
  type EditState,
  type Position,
} from '@campo/core';
import type { PlanResult } from './plan.ts';
import { plazaLabel } from './plaza.ts';

export interface PlazaEditDraft {
  plazaId: string;
  /** The rings being edited: 0 is the outer ring, 1 and up are holes. Open (no repeated closing corner). */
  rings: Position[][];
  /** Earlier rings (되돌리기) and rings taken back (다시 하기). One entry per change. */
  past: Position[][][];
  future: Position[][][];
}

const copyRings = (rings: readonly Position[][]): Position[][] => rings.map((ring) => ring.map((p): Position => [p[0], p[1]]));

export function startPlazaEdit(state: EditState, plazaId: string): PlazaEditDraft | { error: string } {
  const p = state.plazas[plazaId];
  if (!p) return { error: '평지를 찾을 수 없습니다.' };
  return { plazaId, rings: p.polygon.map((ring) => ringCorners(ring)), past: [], future: [] };
}

const changed = (d: PlazaEditDraft, rings: Position[][]): PlazaEditDraft => ({ ...d, rings, past: [...d.past, copyRings(d.rings)], future: [] });

/** A ring of the draft, or undefined. */
export const draftRing = (d: PlazaEditDraft, ring: number): Position[] | undefined => d.rings[ring];

export function movePlazaCorner(d: PlazaEditDraft, ring: number, index: number, to: Position): PlazaEditDraft {
  const corners = d.rings[ring];
  if (!corners) return d;
  return changed(d, d.rings.map((r, i) => (i === ring ? moveCorner(r, index, to) : r)));
}

export function insertPlazaCorner(d: PlazaEditDraft, ring: number, side: number, at: Position): PlazaEditDraft {
  const corners = d.rings[ring];
  if (!corners) return d;
  return changed(d, d.rings.map((r, i) => (i === ring ? insertCorner(r, side, at) : r)));
}

/** Without corner `index`, or why not: every ring keeps at least three corners. */
export function removePlazaCorner(d: PlazaEditDraft, ring: number, index: number): PlazaEditDraft | { error: string } {
  const corners = d.rings[ring];
  if (!corners) return { error: '그 링을 찾을 수 없습니다.' };
  const next = removeCorner(corners, index);
  if (!next) return { error: `링에는 꼭짓점이 ${MIN_OUTLINE_CORNERS}개 이상 있어야 해서 지울 수 없습니다.` };
  return changed(d, d.rings.map((r, i) => (i === ring ? next : r)));
}

export function undoPlazaEdit(d: PlazaEditDraft): PlazaEditDraft {
  const prev = d.past.at(-1);
  return prev ? { ...d, rings: prev, past: d.past.slice(0, -1), future: [copyRings(d.rings), ...d.future] } : d;
}

export function redoPlazaEdit(d: PlazaEditDraft): PlazaEditDraft {
  const [next, ...rest] = d.future;
  return next ? { ...d, rings: next, past: [...d.past, copyRings(d.rings)], future: rest } : d;
}

/** The rings as they would be saved (closed; setPlazaOutline closes and orients them again). */
export const draftPolygon = (d: PlazaEditDraft): Position[][] => d.rings.map((ring) => closeRing(ring));

/** What the draft says now about the shape (E16·E17), or false: shown before 완료 is pressed. */
export function draftProblem(d: PlazaEditDraft): string | false {
  return plazaProblem(draftPolygon(d));
}

/** 완료: the draft as one history entry (평지 모양 수정). */
export function planPlazaShape(state: EditState, d: PlazaEditDraft): PlanResult {
  const p = state.plazas[d.plazaId];
  if (!p) return { error: '평지를 찾을 수 없습니다.' };
  return { annotation: `${plazaLabel(p)} 모양 수정`, steps: [() => setPlazaOutline(d.plazaId, draftPolygon(d))] };
}
