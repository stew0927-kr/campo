// 평지(plaza): what a drawn ring becomes (a new plaza or a hole of one), the property edits, the facts the panel shows,
// and which plaza is under a click. Every change is a Plan of core actions (addPlaza, addPlazaHole, removePlazaHole,
// deletePlazas, setProps); nothing here edits the data itself.
import {
  PLAZA_HEIGHT_MAX_M,
  PLAZA_HEIGHT_MIN_M,
  PLAZA_SURFACES,
  addPlaza,
  addPlazaHole,
  classifyPlazaRing,
  closeRingPositions,
  deletePlazas,
  freshId,
  locateInPlaza,
  plazaAreaM2,
  plazaIdPrefix,
  plazaPerimeterM,
  plazaRegionsOverlap,
  removePlazaHole,
  setProps,
  type EditContext,
  type EditPlaza,
  type EditState,
  type PlazaSurface,
  type Position,
} from '@campo/core';
import type { PlanResult } from './plan.ts';

/** Plazas in id order. */
function plazasOf(state: EditState): EditPlaza[] {
  return Object.values(state.plazas).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const PLAZA_SURFACE_LABELS: Record<PlazaSurface, string> = {
  paved: '포장', gravel: '자갈', grass: '잔디', deck: '데크', other: '기타',
};

export const PLAZA_OVERLAPS_BUILDING_NOTICE = '건물과 겹쳐 있습니다. 건물 자리에는 구멍을 뚫어 주세요.';

/** 평지 '분수 광장', or the id when it has no name. */
export function plazaLabel(p: Pick<EditPlaza, 'id' | 'props'>): string {
  return `평지 '${p.props.name ?? p.id}'`;
}

export interface PlazaPlan {
  plan: PlanResult;
  /** The plaza the ring went into: the new one, or the one that got the hole. */
  plazaId: string | null;
  /** A new plaza (select it and open 상세 정보) rather than a hole. */
  created: boolean;
}

/**
 * The ring drawn with the 평지 tool: inside a plaza's solid area it is a hole of that plaza, apart from every plaza (or in
 * a hole of one) it is a new plaza, anything else is refused with the reason. A new plaza over a building still goes in,
 * with a notice to cut the building out.
 */
export function planPlaza(state: EditState, ctx: EditContext, ring: Position[]): PlazaPlan {
  const closed = closeRingPositions(ring);
  const what = classifyPlazaRing(plazasOf(state), closed);
  if (what.kind === 'error') return { plan: { error: what.message }, plazaId: null, created: false };
  if (what.kind === 'hole') {
    const p = state.plazas[what.plazaId]!;
    return { plan: { annotation: `${plazaLabel(p)}에 구멍 뚫기`, steps: [() => addPlazaHole(what.plazaId, closed)] }, plazaId: what.plazaId, created: false };
  }
  const id = freshId(state, ctx.ids, plazaIdPrefix());
  const overBuilding = Object.values(state.buildings).some((b) => plazaRegionsOverlap([closed], b.polygon));
  return {
    plan: {
      annotation: '평지 추가',
      steps: [() => addPlaza({ id, polygon: [closed], props: { kind: 'plaza', source: 'editor' } }, ctx)],
      ...(overBuilding ? { notices: [PLAZA_OVERLAPS_BUILDING_NOTICE] } : {}),
    },
    plazaId: id,
    created: true,
  };
}

/** What the status line says when the first corner of a plaza ring is put down. */
export function plazaDraftMessage(state: EditState, first: Position): string {
  const p = plazaAt(state, first);
  return p ? `${plazaLabel(p)} 안쪽에서 시작했습니다. 구멍으로 뚫립니다.` : '새 평지를 그립니다.';
}

/** The plaza whose solid area (edge included) holds the position, in id order; a hole is not the plaza. */
export function plazaAt(state: EditState, position: Position): EditPlaza | undefined {
  return plazasOf(state).find((p) => locateInPlaza(p.polygon, position) === 'solid');
}

export interface PlazaEdits {
  /** Empty text removes the name. */
  name?: string;
  /** null removes the surface. */
  surface?: PlazaSurface | null;
  /** Height text in metres; empty means 자동 (the key is removed). */
  height?: string;
}

/** Height text → metres, null for 자동 (empty), or the reason it cannot be used. */
export function parsePlazaHeight(text: string): number | null | { error: string } {
  const t = text.trim().replace(/\s*m$/i, '');
  if (t === '') return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return { error: '고정 높이는 숫자(m)로 적어 주세요. 비우면 자동입니다.' };
  if (v < PLAZA_HEIGHT_MIN_M || v > PLAZA_HEIGHT_MAX_M) return { error: `고정 높이는 ${PLAZA_HEIGHT_MIN_M}~${PLAZA_HEIGHT_MAX_M} m 사이로 적어 주세요.` };
  return v;
}

/** setProps for 이름 / 표면 / 고정 높이 of one plaza, as one Plan. Nothing that would not change is written. */
export function planPlazaEdit(state: EditState, plazaId: string, edits: PlazaEdits): PlanResult {
  const p = state.plazas[plazaId];
  if (!p) return { error: '평지를 찾을 수 없습니다.' };
  const patch: Record<string, unknown> = {};
  if (edits.name !== undefined) {
    const name = edits.name.trim();
    if ((name || undefined) !== p.props.name) patch['name'] = name === '' ? null : name;
  }
  if (edits.surface !== undefined) {
    if (edits.surface !== null && !(PLAZA_SURFACES as readonly string[]).includes(edits.surface)) return { error: '표면 값이 올바르지 않습니다.' };
    if ((edits.surface ?? undefined) !== p.props.surface) patch['surface'] = edits.surface;
  }
  if (edits.height !== undefined) {
    const h = parsePlazaHeight(edits.height);
    if (h !== null && typeof h === 'object') return { error: h.error };
    if ((h ?? undefined) !== p.props.fixed_height_m) patch['fixed_height_m'] = h;
  }
  if (Object.keys(patch).length === 0) return { error: '바뀐 내용이 없습니다.' };
  const what = edits.name !== undefined ? '이름' : edits.surface !== undefined ? '표면' : '고정 높이';
  return { annotation: `${plazaLabel(p)} ${what} 바꾸기`, steps: [() => setProps([plazaId], patch)] };
}

export function planRemovePlazaHole(state: EditState, plazaId: string, holeIndex: number): PlanResult {
  const p = state.plazas[plazaId];
  if (!p) return { error: '평지를 찾을 수 없습니다.' };
  return { annotation: `${plazaLabel(p)} 구멍 지우기`, steps: [() => removePlazaHole(plazaId, holeIndex)] };
}

export function planDeletePlaza(state: EditState, ctx: EditContext, plazaId: string): PlanResult {
  const p = state.plazas[plazaId];
  if (!p) return { error: '평지를 찾을 수 없습니다.' };
  return { annotation: `${plazaLabel(p)} 삭제`, steps: [() => deletePlazas([plazaId], ctx)] };
}

export interface PlazaFacts {
  areaM2: number;
  perimeterM: number;
  holes: { index: number; areaM2: number }[];
}

/** 면적(㎡), 둘레(m), and each hole's area for the panel. */
export function plazaFacts(p: Pick<EditPlaza, 'polygon'>): PlazaFacts {
  return {
    areaM2: plazaAreaM2(p.polygon),
    perimeterM: plazaPerimeterM(p.polygon),
    holes: p.polygon.slice(1).map((ring, index) => ({ index, areaM2: plazaAreaM2([ring]) })),
  };
}

/** "1,234.5 ㎡" */
export function formatArea(m2: number): string {
  return `${m2.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} ㎡`;
}
