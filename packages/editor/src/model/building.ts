// "건물" and "건물 선택" tools (SPEC §8).
import type { BuildingFeature, Position } from '@campo/core';
import { withFeatures, type CampusDoc } from './document.ts';
import { DRAWN_SOURCE } from './outdoor-path.ts';

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

export interface NewBuilding {
  /** Outer ring as drawn; closed here if needed. */
  ring: Position[];
  name: string;
  code: string;
  levels: number[];
  groundLevels: number[];
}

export function addBuilding(doc: CampusDoc, b: NewBuilding): { doc: CampusDoc; id: string } | { error: string } {
  const name = b.name.trim();
  const code = b.code.trim();
  if (!name) return { error: '건물 이름을 입력해 주세요.' };
  if (!/^[A-Za-z0-9]+$/.test(code)) return { error: '건물 코드는 영문과 숫자만 쓸 수 있습니다. 예: ENG1' };
  const id = `bldg_${code}`;
  if (doc.features.has(id)) return { error: `코드 ${code}인 건물이 이미 있습니다.` };
  if (b.levels.length === 0) return { error: '층 목록을 입력해 주세요.' };
  if (b.groundLevels.length === 0) return { error: '지면에 닿는 층을 하나 이상 입력해 주세요.' };
  const missing = b.groundLevels.filter((l) => !b.levels.includes(l));
  if (missing.length > 0) return { error: `지면 층 ${missing.join(', ')}이 층 목록에 없습니다.` };

  const ring = b.ring.map(([x, y]) => [x, y] as Position);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  if (ring.length < 4) return { error: '외곽선은 점이 세 개 이상이어야 합니다.' };

  const feature: BuildingFeature = {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      kind: 'building',
      name,
      code,
      levels: [...b.levels].sort((x, y) => x - y),
      ground_levels: [...b.groundLevels].sort((x, y) => x - y),
      source: DRAWN_SOURCE,
    },
  };
  return { doc: withFeatures(doc, [feature]), id };
}

/** The building whose outline contains `position` (the smallest one if outlines overlap). */
export function buildingAt(doc: Pick<CampusDoc, 'features'>, position: Position): BuildingFeature | undefined {
  let best: { b: BuildingFeature; area: number } | undefined;
  for (const f of doc.features.values()) {
    if (f.properties.kind !== 'building') continue;
    const ring = (f as BuildingFeature).geometry.coordinates[0] ?? [];
    if (!pointInRing(position, ring)) continue;
    const area = Math.abs(ringArea(ring));
    if (!best || area < best.area) best = { b: f as BuildingFeature, area };
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
