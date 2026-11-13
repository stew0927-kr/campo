// Map arithmetic and time formatting.
import { describe, expect, it } from 'vitest';
import { metres, type Position } from '@campo/core';
import { MAX_SCALE, MIN_SCALE, fitView, panned, projection, toScreen, zoomed, type View } from '../src/map/project.ts';
import { dayOf, isoLocal } from '../src/time.ts';

const CENTER: Position = [127.0006, 37.0005];
const SIZE = { width: 400, height: 800 };

describe('projection', () => {
  it('goes to metres and back, and agrees with the geodesic distance to a centimetre across a campus', () => {
    const p = projection(CENTER);
    const far: Position = [127.0106, 37.0095];
    const back = p.toPosition(p.toXY(far));
    expect(back[0]).toBeCloseTo(far[0], 9);
    expect(back[1]).toBeCloseTo(far[1], 9);
    expect(p.toXY(CENTER)).toEqual([0, 0]);
    const near: Position = [127.0016, 37.0012];
    const [x, y] = p.toXY(near);
    expect(Math.abs(Math.hypot(x, y) - metres(CENTER, near))).toBeLessThan(0.3);
  });
});

describe('view', () => {
  const view: View = { x: 10, y: 20, scale: 4 };

  it('the crosshair is the middle of the screen, east is right and north is up', () => {
    expect(toScreen(view, SIZE, [10, 20])).toEqual([200, 400]);
    expect(toScreen(view, SIZE, [11, 20])).toEqual([204, 400]);
    expect(toScreen(view, SIZE, [10, 21])).toEqual([200, 396]);
  });

  it('dragging moves the map with the finger', () => {
    const point: [number, number] = [15, 25];
    const before = toScreen(view, SIZE, point);
    const after = toScreen(panned(view, 30, -12), SIZE, point);
    expect(after[0]).toBeCloseTo(before[0] + 30);
    expect(after[1]).toBeCloseTo(before[1] - 12);
  });

  it('zoom keeps the crosshair in place and stays inside the limits', () => {
    expect(zoomed(view, 2)).toEqual({ x: 10, y: 20, scale: 8 });
    expect(zoomed(view, 1000).scale).toBe(MAX_SCALE);
    expect(zoomed(view, 0.0001).scale).toBe(MIN_SCALE);
  });

  it('fitView shows every point inside the margin', () => {
    const points: [number, number][] = [[-50, -20], [70, 90], [0, 0]];
    const fit = fitView(points, SIZE, 40);
    for (const p of points) {
      const [sx, sy] = toScreen(fit, SIZE, p);
      expect(sx).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(sx).toBeLessThanOrEqual(360 + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(sy).toBeLessThanOrEqual(760 + 1e-6);
    }
    expect(fitView([], SIZE)).toEqual({ x: 0, y: 0, scale: 4 });
    expect(fitView([[5, 5]], SIZE).scale).toBe(MAX_SCALE); // one point: as close as allowed
  });
});

describe('time', () => {
  it('local time with its offset, as the data files write it', () => {
    const t = new Date('2026-11-14T01:02:03Z');
    expect(isoLocal(t, 540)).toBe('2026-11-14T10:02:03+09:00');
    expect(isoLocal(t, 0)).toBe('2026-11-14T01:02:03+00:00');
    expect(isoLocal(t, -210)).toBe('2026-11-13T21:32:03-03:30');
    expect(dayOf('2026-11-14T10:02:03+09:00')).toBe('20261114');
  });
});
