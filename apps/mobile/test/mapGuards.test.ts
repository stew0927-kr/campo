// QA: MapCanvas update-depth / tile leaks — the pure parts: a fitted view is always finite, the crosshair snap uses a
// grid index (same answer as the full scan), and failed tiles are retried with a growing wait in a bounded record.
import { describe, expect, it } from 'vitest';
import { fitView, isFiniteView, type XY } from '../src/map/project.ts';
import { buildSnapIndex, type SnapPoint } from '../src/map/snapIndex.ts';
import { RETRY_BASE_MS, RETRY_MAX_MS, boundedKeys, createFailedTiles, retryDelayMs } from '../src/map/tileRetry.ts';

const SIZE = { width: 400, height: 800 };

describe('fitView never gives a view that is not a number', () => {
  it('ignores points that are not numbers, a turn that is not one, and a screen not laid out yet', () => {
    const good: XY[] = [[0, 0], [100, 50]];
    const bad: XY[] = [[NaN, 3], [Infinity, 0], [2, -Infinity]];
    expect(fitView([...good, ...bad], SIZE)).toEqual(fitView(good, SIZE));
    expect(isFiniteView(fitView(bad, SIZE))).toBe(true);
    expect(isFiniteView(fitView(good, SIZE, 48, NaN))).toBe(true);
    expect(isFiniteView(fitView(good, { width: 0, height: 0 }))).toBe(true);
    expect(isFiniteView(fitView(good, { width: NaN, height: 10 }))).toBe(true);
  });

  it('handles a very large floor without overflowing the call stack', () => {
    const many: XY[] = Array.from({ length: 300_000 }, (_, i) => [i % 1000, Math.floor(i / 1000)]);
    const v = fitView(many, SIZE);
    expect(isFiniteView(v)).toBe(true);
    expect(v.x).toBeCloseTo(499.5);
  });
});

describe('buildSnapIndex', () => {
  const R = 2;
  const scan = (pts: readonly SnapPoint[], at: XY): string | null => {
    let best: SnapPoint | null = null;
    let bestSq = R * R;
    for (const p of pts) {
      const sq = (p.xy[0] - at[0]) ** 2 + (p.xy[1] - at[1]) ** 2;
      if (sq <= bestSq) {
        best = p;
        bestSq = sq;
      }
    }
    return best?.id ?? null;
  };

  it('finds the same point as a scan of every point, near cell borders and at negative coordinates too', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 200 - 100;
    const pts: SnapPoint[] = Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, xy: [rnd(), rnd()] }));
    const index = buildSnapIndex(pts, R);
    for (let k = 0; k < 2000; k++) {
      const at: XY = [rnd(), rnd()];
      expect(index.nearest(at, R)?.id ?? null).toBe(scan(pts, at));
    }
    expect(index.nearest([pts[5]!.xy[0] + 1.99, pts[5]!.xy[1]], R)?.id).toBeDefined();
  });

  it('leaves out points that are not numbers and answers null for a crosshair that is not one', () => {
    const index = buildSnapIndex([{ id: 'a', xy: [NaN, 0] }, { id: 'b', xy: [0, 0] }], R);
    expect(index.size).toBe(1);
    expect(index.byId('a')).toBeNull();
    expect(index.nearest([NaN, NaN], R)).toBeNull();
    expect(index.nearest([0.5, 0.5], R)?.id).toBe('b');
  });
});

describe('failed tiles', () => {
  it('waits 2 s, 4 s, 8 s … up to a minute between tries', () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(2)).toBe(2 * RETRY_BASE_MS);
    expect(retryDelayMs(3)).toBe(4 * RETRY_BASE_MS);
    expect(retryDelayMs(50)).toBe(RETRY_MAX_MS);
  });

  it('a failed tile is blocked until its wait is over, then due again; a success forgets it', () => {
    const f = createFailedTiles();
    f.fail('17/1/2', 0);
    expect(f.blocked('17/1/2', 1000)).toBe(true);
    expect(f.nextAt(1000)).toBe(RETRY_BASE_MS);
    expect(f.due(RETRY_BASE_MS)).toEqual(['17/1/2']);
    // Due tiles are not a running wait: no timer loop on them.
    expect(f.nextAt(RETRY_BASE_MS)).toBeNull();
    f.fail('17/1/2', RETRY_BASE_MS);
    expect(f.nextAt(RETRY_BASE_MS)).toBe(RETRY_BASE_MS + 2 * RETRY_BASE_MS);
    f.succeed('17/1/2');
    expect(f.size).toBe(0);
  });

  it('remembers at most `max` failures, forgetting the oldest', () => {
    const f = createFailedTiles(3);
    for (let i = 0; i < 10; i++) f.fail(`k${i}`, i);
    expect(f.size).toBe(3);
    expect(f.due(1e9).sort()).toEqual(['k7', 'k8', 'k9']);
  });

  it('boundedKeys keeps the tiles on screen and the newest others', () => {
    const keys = new Set(['a', 'b', 'c', 'd', 'e']);
    expect(boundedKeys(keys, new Set(), 10)).toBe(keys);
    expect([...boundedKeys(keys, new Set(['a']), 3)].sort()).toEqual(['a', 'd', 'e']);
  });
});
