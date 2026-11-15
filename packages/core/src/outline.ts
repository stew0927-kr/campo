// Floor outlines of a building (BuildingProperties.floor_outlines): the outline a floor is drawn with, and the ring edits
// the editor and the survey app share (move, add and remove a corner). Display only: routing never reads an outline.
import type { EditBuilding } from './edit/state.ts';
import type { BuildingFeature, Level, Position } from './types.ts';

/** The key of a level in floor_outlines: "1", "-1". */
export const floorOutlineKey = (level: Level): string => String(level);

/**
 * The outline of a building on `level`: its own floor outline when it has one, otherwise the building's geometry.
 * Without a level (the outdoors, the building as a whole) it is always the building's geometry.
 */
export function getBuildingOutlineForLevel(building: BuildingFeature, level?: Level | null): Position[][] {
  const own = level === undefined || level === null ? undefined : building.properties.floor_outlines?.[floorOutlineKey(level)];
  return own ?? building.geometry.coordinates;
}

/** The same for a building of the edit state. */
export function outlineOfLevel(building: Pick<EditBuilding, 'polygon' | 'props'>, level?: Level | null): Position[][] {
  const own = level === undefined || level === null ? undefined : building.props.floor_outlines?.[floorOutlineKey(level)];
  return own ?? building.polygon;
}

/** Whether `level` has an outline of its own. */
export const hasFloorOutline = (building: Pick<EditBuilding, 'props'>, level: Level): boolean =>
  building.props.floor_outlines?.[floorOutlineKey(level)] !== undefined;

// ---- the corners of a ring, as edited ----

const samePosition = (a: Position | undefined, b: Position | undefined): boolean => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** The corners of a closed ring (the closing repeat left out). */
export function ringCorners(ring: readonly Position[]): Position[] {
  const open = ring.map((p): Position => [p[0], p[1]]);
  if (open.length > 1 && samePosition(open[0], open[open.length - 1])) open.pop();
  return open;
}

/** Corners back to a closed ring (first = last). */
export function closeRing(corners: readonly Position[]): Position[] {
  const ring = corners.map((p): Position => [p[0], p[1]]);
  if (ring.length > 0) ring.push([ring[0]![0], ring[0]![1]]);
  return ring;
}

/** An outline needs this many corners (a closed ring of 4 positions). */
export const MIN_OUTLINE_CORNERS = 3;

export function moveCorner(corners: readonly Position[], index: number, to: Position): Position[] {
  return corners.map((p, i): Position => (i === index ? [to[0], to[1]] : [p[0], p[1]]));
}

/** A corner on the side from corner `side` to the next one (the last side runs back to corner 0). */
export function insertCorner(corners: readonly Position[], side: number, at: Position): Position[] {
  const out = corners.map((p): Position => [p[0], p[1]]);
  out.splice(side + 1, 0, [at[0], at[1]]);
  return out;
}

/** Without corner `index`; null when that would leave fewer than MIN_OUTLINE_CORNERS. */
export function removeCorner(corners: readonly Position[], index: number): Position[] | null {
  if (corners.length <= MIN_OUTLINE_CORNERS) return null;
  return corners.filter((_, i) => i !== index).map((p): Position => [p[0], p[1]]);
}

/** Why a polygon cannot be an outline (Korean), or false: closed rings of 4+ positions of finite numbers. */
export function outlineProblem(polygon: unknown): string | false {
  if (!Array.isArray(polygon) || polygon.length === 0) return '외곽선이 비어 있습니다.';
  for (const ring of polygon) {
    if (!Array.isArray(ring) || ring.length < 4) return '외곽선은 꼭짓점이 세 개 이상이어야 합니다.';
    if (!ring.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return '외곽선 좌표가 [경도, 위도] 숫자 쌍이 아닙니다.';
    if (!samePosition(ring[0] as Position, ring[ring.length - 1] as Position)) return '외곽선이 닫혀 있지 않습니다(첫 점과 끝 점이 다릅니다).';
  }
  return false;
}
