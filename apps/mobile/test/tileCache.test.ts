// Tiles kept on the phone (map/tileCache.ts): one download per tile, reading from the cache afterwards, and the list of
// tiles saved for offline use. The device's file API is replaced by a store in memory.
import { describe, expect, it } from 'vitest';
import { createTileCache, campusBbox, tilePath, tilesInBbox, type TileStore } from '../src/map/tileCache.ts';
import { TILE_HEADERS, tileUrl, visibleTiles } from '../src/map/tiles.ts';
import { projection, type View } from '../src/map/project.ts';
import { fixture } from './helpers.ts';

function memoryTiles(failing: ReadonlySet<string> = new Set()) {
  const files = new Map<string, number>();
  const calls: { url: string; path: string; headers: Record<string, string> }[] = [];
  const store: TileStore = {
    has: (path) => files.has(path),
    uri: (path) => `file:///cache/${path}`,
    async download(url, path, headers) {
      calls.push({ url, path, headers });
      await Promise.resolve();
      if (failing.has(path)) throw new Error('offline');
      files.set(path, 1000);
    },
    usage: () => ({ files: files.size, bytes: [...files.values()].reduce((a, b) => a + b, 0) }),
    clear: () => files.clear(),
  };
  return { store, calls, files };
}

describe('tile cache', () => {
  it('downloads a tile once (also when asked twice at the same time) and then reads it from the cache', async () => {
    const { store, calls } = memoryTiles();
    const cache = createTileCache(store);
    const tile = { z: 17, x: 111791, y: 50762 };
    expect(cache.cached(tile)).toBeNull();
    const [a, b] = await Promise.all([cache.get(tile), cache.get(tile)]);
    expect(a).toBe(`file:///cache/${tilePath(tile)}`);
    expect(b).toBe(a);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: tileUrl(17, 111791, 50762), headers: { ...TILE_HEADERS } });
    expect(cache.cached(tile)).toBe(a);
    await cache.get(tile);
    expect(calls).toHaveLength(1);
  });

  it('a failed download rejects, leaves nothing cached, and can be tried again', async () => {
    const tile = { z: 16, x: 1, y: 2 };
    const failing = new Set([tilePath(tile)]);
    const { store, calls } = memoryTiles(failing);
    const cache = createTileCache(store);
    await expect(cache.get(tile)).rejects.toThrow('offline');
    expect(cache.cached(tile)).toBeNull();
    failing.clear();
    await expect(cache.get(tile)).resolves.toContain('tiles/16/1/2.png');
    expect(calls).toHaveLength(2);
  });

  it('prefetch fetches what is missing, counts what was there and what failed, reports progress, and can be cancelled', async () => {
    const tiles = [0, 1, 2, 3, 4, 5].map((x) => ({ z: 15, x, y: 0 }));
    const { store, files } = memoryTiles(new Set([tilePath(tiles[5]!)]));
    files.set(tilePath(tiles[0]!), 1);
    const cache = createTileCache(store);
    const seen: number[] = [];
    expect(await cache.prefetch(tiles, (done) => seen.push(done))).toEqual({ downloaded: 4, already: 1, failed: 1 });
    expect(Math.max(...seen)).toBe(6);
    expect(cache.usage().files).toBe(5);

    const more = createTileCache(memoryTiles().store);
    const stop = { cancelled: true };
    expect(await more.prefetch(tiles, undefined, stop)).toEqual({ downloaded: 0, already: 0, failed: 0 });
    cache.clear();
    expect(cache.usage()).toEqual({ files: 0, bytes: 0 });
  });
});

describe('tiles to save for offline use', () => {
  it('covers the campus box at each zoom, nearest zoom first, within the cap', async () => {
    const { state } = await fixture();
    const box = campusBbox(state)!;
    expect(box[0]).toBeLessThan(box[2]);
    const tiles = tilesInBbox(box);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[0]!.z).toBe(18);
    expect(new Set(tiles.map((t) => t.z))).toEqual(new Set([15, 16, 17, 18]));
    expect(new Set(tiles.map((t) => tilePath(t))).size).toBe(tiles.length);
    expect(tilesInBbox(box, [15, 16, 17, 18], 5)).toHaveLength(5);
  });
});

describe('zoom fallback layer', () => {
  it('the tiles of another zoom cover the same screen, so they can stay under the new ones while those load', () => {
    const proj = projection([127.045, 37.5572]);
    const view: View = { x: 0, y: 0, scale: 2.4 };
    const size = { width: 412, height: 892 };
    const now = visibleTiles(view, size, proj);
    const z = Number(now[0]!.key.split('/')[0]);
    const coarse = visibleTiles(view, size, proj, z - 1);
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length).toBeLessThanOrEqual(now.length);
    const extent = (ts: typeof now) => [Math.min(...ts.map((t) => t.left)), Math.min(...ts.map((t) => t.top)), Math.max(...ts.map((t) => t.left + t.width)), Math.max(...ts.map((t) => t.top + t.height))];
    const [l, t, r, b] = extent(coarse);
    expect(l!).toBeLessThanOrEqual(0);
    expect(t!).toBeLessThanOrEqual(0);
    expect(r!).toBeGreaterThanOrEqual(size.width);
    expect(b!).toBeGreaterThanOrEqual(size.height);
    expect(coarse[0]!.width).toBeCloseTo(now[0]!.width * 2, 1); // one zoom coarser is drawn twice as big
  });
});
