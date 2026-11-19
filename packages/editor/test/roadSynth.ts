// Synthetic roads (solve_report roads[] shape) shared by road-ribbon.test.ts and terrain-footprint-road.test.ts.
import type { RoadSegmentJson } from '../src/model/roadRibbon.ts';
import { rng } from './terrainSynth.ts';

type Seg = RoadSegmentJson['segments'][number];

export const road = (id: string, width: number, segments: Seg[]): RoadSegmentJson => ({ id, width_m: width, segments });

/**
 * 139 curved roads, about 2,000 segments of 1 to 2 m (as an edge's bends are drawn), widths 1.5 to 6 m, scattered over a
 * 1,400 × 1,100 m area whose north-west corner is (ox, oy) (EPSG:5186 m); heights wander round 40 to 70 m.
 */
export function manyRoads(seed = 3, ox = 203_900, oy = 551_000): RoadSegmentJson[] {
  const rand = rng(seed);
  const out: RoadSegmentJson[] = [];
  for (let i = 0; i < 139; i++) {
    let [x, y] = [ox + 50 + rand() * 1300, oy - 50 - rand() * 1000];
    let h = 40 + rand() * 30;
    let dir = rand() * 2 * Math.PI;
    const n = 10 + Math.floor(rand() * 9);
    const segments: Seg[] = [];
    for (let j = 0; j < n; j++) {
      dir += (rand() - 0.5) * 0.5;
      const len = 1 + rand();
      const [nx, ny, nh] = [x + len * Math.cos(dir), y + len * Math.sin(dir), h + (rand() - 0.5) * 0.2];
      segments.push([x, y, h, nx, ny, nh]);
      [x, y, h] = [nx, ny, nh];
    }
    out.push(road(`e${String(i).padStart(3, '0')}`, [1.5, 2, 2, 3, 6][i % 5]!, segments));
  }
  return out;
}
