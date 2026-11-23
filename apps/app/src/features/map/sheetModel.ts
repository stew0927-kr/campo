// 하단 시트의 세 높이(펼침 / 기본 / 접힘)와 끌기·누르기에 따른 다음 상태. React를 import하지 않는 순수 모듈.

export type SheetSnap = 'expanded' | 'default' | 'collapsed';
export interface SheetHeights { expanded: number; default: number; collapsed: number }

/** 접힘 상태에서 남는 높이(핸들 + 미니 바). */
export const SHEET_COLLAPSED_HEIGHT = 64;
/** 이보다 빠르게 튕기면(px/ms) 그 방향으로 한 칸 이동한다. */
const FLING = 0.5;
/** 이 거리(px)보다 짧게 움직이면 누른 것으로 본다. */
export const SHEET_TAP_SLOP = 6;

const ORDER: SheetSnap[] = ['collapsed', 'default', 'expanded'];

export function sheetHeight(snap: SheetSnap, h: SheetHeights): number {
  return h[snap];
}

/** 끌고 있는 동안의 높이. dy는 아래로 +. 접힘~펼침 사이로 자른다. */
export function dragHeight(snap: SheetSnap, dy: number, h: SheetHeights): number {
  return Math.min(h.expanded, Math.max(h.collapsed, h[snap] - dy));
}

/**
 * 손을 뗐을 때 갈 상태. 빠르게 튕기면 그 방향으로 한 칸, 아니면 지금 높이에서 가장 가까운 상태.
 * vy: 세로 속도(아래로 +).
 */
export function releaseSnap(snap: SheetSnap, dy: number, vy: number, h: SheetHeights): SheetSnap {
  const i = ORDER.indexOf(snap);
  if (vy > FLING) return ORDER[Math.max(0, i - 1)]!;
  if (vy < -FLING) return ORDER[Math.min(ORDER.length - 1, i + 1)]!;
  const height = dragHeight(snap, dy, h);
  return ORDER.reduce((best, s) => (Math.abs(h[s] - height) < Math.abs(h[best] - height) ? s : best), snap);
}

/** 핸들을 눌렀을 때: 접힘이면 기본으로, 그 밖에는 접는다. */
export function tapSnap(snap: SheetSnap): SheetSnap {
  return snap === 'collapsed' ? 'default' : 'collapsed';
}

/** 접기/펼치기 버튼 문구(스크린리더). */
export function toggleLabel(snap: SheetSnap): string {
  return snap === 'collapsed' ? '시트 펼치기' : '시트 접기';
}
