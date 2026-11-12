// "건물" and "건물 선택" tools (SPEC §8).
// Registering a new building needs a core action (addBuilding) that does not exist yet, so only the form helpers live here.
import type { EditBuilding, EditState, Position } from '@campo/core';

/**
 * "1-4", "1~4", "-2~3", "-1, 1, 2" → sorted levels. 0 is never a level (SPEC §3);
 * a range that crosses it skips it ("-1~2" → -1, 1, 2).
 */
export function parseLevels(text: string): { levels: number[] } | { error: string } {
  const levels = new Set<number>();
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return { error: '층을 하나 이상 입력해 주세요.' };
  for (const token of tokens) {
    const range = /^(-?\d+)\s*~\s*(-?\d+)$/.exec(token) ?? /^(\d+)-(\d+)$/.exec(token);
    const single = /^-?\d+$/.exec(token);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let l = Math.min(a, b); l <= Math.max(a, b); l++) if (l !== 0) levels.add(l);
    } else if (single) {
      const l = Number(token);
      if (l === 0) return { error: '0층은 쓰지 않습니다. 지하 1층은 -1, 1층은 1입니다.' };
      levels.add(l);
    } else {
      return { error: `"${token}"을 층으로 읽을 수 없습니다. 예: 1-4, -1~3, 1,2,4` };
    }
  }
  return { levels: [...levels].sort((a, b) => a - b) };
}

/** The building whose outline contains `position` (the smallest one if outlines overlap). */
export function buildingAt(state: Pick<EditState, 'buildings'>, position: Position): EditBuilding | undefined {
  let best: { b: EditBuilding; area: number } | undefined;
  for (const b of Object.values(state.buildings)) {
    const ring = b.polygon[0] ?? [];
    if (!pointInRing(position, ring)) continue;
    const area = Math.abs(ringArea(ring));
    if (!best || area < best.area) best = { b, area };
  }
  return best?.b;
}

function pointInRing([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  return a / 2;
}
