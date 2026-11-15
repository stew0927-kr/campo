// The floors of a building stacked by height, for the 3D views of the editor (MapLibre fill-extrusion) and the survey app
// (2.5D slabs). Display only: routing never reads a floor height or compares floor numbers.
//
// A floor's height is, in order: the measured height difference to the floor above (the recompute's estimates of the
// floor planes, fp:<building>:<floor>), the building's ext.floor_height_m, else DEFAULT_FLOOR_HEIGHT_M (3.9 m, the same
// prior the height solver uses). Floor 1 stands on the ground (base 0); floors above stand on the ones below, basements
// hang below the ground (B1's top is 0).
import { outlineOfLevel } from './outline.ts';
import type { EditBuilding } from './edit/state.ts';
import type { Level, Position } from './types.ts';

export const DEFAULT_FLOOR_HEIGHT_M = 3.9;

export interface FloorSlab {
  level: Level;
  /** Height of the floor's bottom and top above the ground (metres; negative below it). */
  baseM: number;
  topM: number;
  /** The floor's outline (its own, or the building's). */
  outline: Position[][];
  /** Where the height came from. */
  heightFrom: 'measured' | 'building' | 'default';
}

/** The next level up in the floor numbering (1F after B1: there is no level 0). */
const above = (level: Level): Level => (level === -1 ? 1 : level + 1);

/**
 * Height of every level from 1 (or -1) to `level`, by `heightOf`: the floors between are counted too, even when the
 * building does not list them (a building on a slope whose lowest floor is 5F stands 4 floors up).
 */
export function floorHeights(
  building: Pick<EditBuilding, 'props'>,
  measured: ReadonlyMap<Level, number> = new Map(),
): (level: Level) => { heightM: number; from: FloorSlab['heightFrom'] } {
  const own = building.props.ext?.floor_height_m;
  return (level) => {
    const here = measured.get(level);
    const up = measured.get(above(level));
    if (here !== undefined && up !== undefined && up - here > 0.5) return { heightM: up - here, from: 'measured' };
    if (own !== undefined && own > 0) return { heightM: own, from: 'building' };
    return { heightM: DEFAULT_FLOOR_HEIGHT_M, from: 'default' };
  };
}

/** The floors of a building, lowest first, each with its base, top and outline. */
export function buildingStack(building: Pick<EditBuilding, 'polygon' | 'props'>, measured: ReadonlyMap<Level, number> = new Map()): FloorSlab[] {
  const heightOf = floorHeights(building, measured);
  const levels = [...building.props.levels].sort((a, b) => a - b);
  return levels.map((level) => {
    const { heightM, from } = heightOf(level);
    let baseM = 0;
    if (level > 0) {
      for (let l = 1; l < level; l++) baseM += heightOf(l).heightM;
    } else {
      for (let l = -1; l > level; l--) baseM -= heightOf(l).heightM;
      baseM -= heightM;
    }
    return { level, baseM, topM: baseM + heightM, outline: outlineOfLevel(building, level), heightFrom: from };
  });
}

/**
 * Measured floor heights of one building from the recompute's estimates (ElevationStore.estimates, key
 * fp:<building id>:<floor id>, floor id 1F / B1): level → height in metres.
 */
export function measuredFloorLevels(estimates: readonly { key: string; hM: number }[] | undefined, buildingId: string): Map<Level, number> {
  const out = new Map<Level, number>();
  const prefix = `fp:${buildingId}:`;
  for (const e of estimates ?? []) {
    if (!e.key.startsWith(prefix)) continue;
    const m = /^(B?)(\d+)F?$/.exec(e.key.slice(prefix.length));
    if (!m) continue;
    const n = Number(m[2]);
    if (n === 0) continue;
    out.set(m[1] === 'B' ? -n : n, e.hM);
  }
  return out;
}

/**
 * The 3D view's toggle icon, shared by the editor and the survey app (24 grid): three diamond floors stacked with a gap,
 * bottom faint, top solid, so it reads as floors seen from above at an angle.
 */
export const LAYER_STACK_ICON: readonly { d: string; opacity: number }[] = [
  { d: 'M12 16L21 19L12 22L3 19Z', opacity: 0.35 },
  { d: 'M12 9L21 12L12 15L3 12Z', opacity: 0.6 },
  { d: 'M12 2L21 5L12 8L3 5Z', opacity: 1 },
];

/** Colours of the 3D views (both apps): the floor shown, floors above the ground, basements, and the ground plate. */
export const STACK_COLORS = { selected: '#f2b705', floor: '#c5ced8', below: '#4f6378', ground: '#6f8a5c', edge: '#1e2933' } as const;
