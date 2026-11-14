// The turned map: projection, panning, fitting, the SVG matrix and the scale bar (map/project.ts), and the compass smoothing.
import { describe, expect, it } from 'vitest';
import {
  coverSide, fitView, fromScreen, mapMatrix, panned, rotated, scaleBar, shortestTurn, toScreen, withRotation, zoomed, type View, type XY,
} from '../src/map/project.ts';
import { smoothHeading, turnDeg } from '../src/sensors/heading.ts';

const SIZE = { width: 400, height: 800 };
const close = (a: XY, b: XY): void => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('a turned map', () => {
  const view: View = { x: 10, y: 20, scale: 4, rotation: 90 };

  it('turned 90°, east is up and north points left; the crosshair stays the middle', () => {
    close(toScreen(view, SIZE, [10, 20]), [200, 400]);
    close(toScreen(view, SIZE, [11, 20]), [200, 396]); // one metre east: up
    close(toScreen(view, SIZE, [10, 21]), [196, 400]); // one metre north: left
  });

  it('fromScreen undoes toScreen at any turn', () => {
    for (const rotation of [0, 33, 90, 181, 300]) {
      const v = { ...view, rotation };
      for (const p of [[0, 0], [15, -7], [-40, 33]] as XY[]) close(fromScreen(v, SIZE, toScreen(v, SIZE, p)), p);
    }
  });

  it('the SVG matrix draws a point where toScreen puts it', () => {
    for (const rotation of [0, 45, 123]) {
      const v = { ...view, rotation };
      const [a, b, c, d, e, f] = mapMatrix(v, SIZE);
      for (const [x, y] of [[3, 4], [-20, 11]] as XY[]) close([a * x + c * y + e, b * x + d * y + f], toScreen(v, SIZE, [x, y]));
    }
  });

  it('dragging moves the map with the finger, whatever the turn', () => {
    for (const rotation of [0, 37, 90, 270]) {
      const v = { ...view, rotation };
      const before = toScreen(v, SIZE, [15, 25]);
      const after = toScreen(panned(v, 30, -12), SIZE, [15, 25]);
      close(after, [before[0] + 30, before[1] - 12]);
    }
  });

  it('two fingers turning clockwise turn the map clockwise around the crosshair; back to north drops the turn', () => {
    const north: View = { x: 0, y: 0, scale: 4 };
    const turned = rotated(north, 30);
    expect(turned.rotation).toBeCloseTo(330);
    const [x, y] = toScreen(turned, SIZE, [0, 10]); // north, 10 m: now up and to the right
    expect(x).toBeGreaterThan(200);
    expect(y).toBeLessThan(400);
    expect(rotated(turned, -30)).toEqual(north);
    expect(withRotation(turned, 0)).toEqual(north);
    expect(withRotation(north, 45).rotation).toBeCloseTo(45);
    expect(zoomed(turned, 2).rotation).toBe(turned.rotation);
  });

  it('the turn back to north goes the short way', () => {
    expect(shortestTurn(350, 0)).toBeCloseTo(10);
    expect(shortestTurn(10, 0)).toBeCloseTo(-10);
    expect(shortestTurn(180, 0)).toBeCloseTo(180);
  });

  it('fitView shows every point inside the margin at the given turn', () => {
    const points: XY[] = [[-50, -20], [70, 90], [0, 0], [30, -60]];
    for (const rotation of [0, 30, 90, 200]) {
      const fit = fitView(points, SIZE, 40, rotation);
      for (const p of points) {
        const [sx, sy] = toScreen(fit, SIZE, p);
        expect(sx).toBeGreaterThanOrEqual(40 - 1e-6);
        expect(sx).toBeLessThanOrEqual(360 + 1e-6);
        expect(sy).toBeGreaterThanOrEqual(40 - 1e-6);
        expect(sy).toBeLessThanOrEqual(760 + 1e-6);
      }
    }
    expect(fitView([], SIZE, 48, 0)).toEqual({ x: 0, y: 0, scale: 4 });
  });

  it('the tile square covers the screen at any turn', () => {
    expect(coverSide(SIZE)).toBeGreaterThanOrEqual(Math.hypot(400, 800));
  });
});

describe('scale bar', () => {
  it('picks a round length no wider than the bar allows', () => {
    expect(scaleBar(4)).toEqual({ metres: 20, px: 80, label: '20 m' });
    expect(scaleBar(60).metres).toBe(1);
    expect(scaleBar(1).metres).toBe(50);
    expect(scaleBar(0.05)).toMatchObject({ metres: 1000, label: '1 km' });
    for (const s of [1, 2.5, 7, 33, 60]) expect(scaleBar(s).px).toBeLessThanOrEqual(90 + 1e-9);
  });
});

describe('compass smoothing', () => {
  it('eases toward a new reading the short way round north', () => {
    expect(turnDeg(359, 1)).toBeCloseTo(2);
    const next = smoothHeading(359, 9, 0.5);
    expect(next).toBeCloseTo(4); // halfway along the 10° turn through north, not back round by 175°
    expect(smoothHeading(undefined, 370)).toBeCloseTo(10);
  });

  it('follows a turn-around at once instead of easing through it', () => {
    expect(smoothHeading(0, 180)).toBeCloseTo(180);
  });
});
