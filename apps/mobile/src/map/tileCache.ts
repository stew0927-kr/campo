// Tiles kept on the phone: a tile is downloaded once into the cache folder and read from there afterwards, so the map
// background works again without a network and does not wait for the server twice. The device's file API is behind
// TileStore (expoTileStore.ts); the rules here (paths, one download per tile, the prefetch list) run in Node.
import type { EditState, Position } from '@campo/core';
import { metres } from '@campo/core';
import { TILE_HEADERS, MAX_TILE_ZOOM, latToTileY, lonToTileX, tileUrl } from './tiles.ts';

export interface TileStore {
  /** Whether the file is in the cache. */
  has(path: string): boolean;
  /** The URI an Image can show for a cached file. */
  uri(path: string): string;
  /** Downloads `url` into the cache (parent folders are made). Rejects on a failed download, leaving no file. */
  download(url: string, path: string, headers: Record<string, string>): Promise<void>;
  /** How many tiles are cached and how many bytes they take. */
  usage(): { files: number; bytes: number };
  clear(): void;
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export const tilePath = ({ z, x, y }: TileId): string => `tiles/${z}/${x}/${y}.png`;

export interface TileCache {
  /** The URI of the cached tile, or null when it is not cached. */
  cached(tile: TileId): string | null;
  /** The cached URI, downloading the tile first when needed. One download per tile at a time. Rejects when it cannot be had. */
  get(tile: TileId): Promise<string>;
  /** Download every tile of `tiles` that is not cached, a few at a time. Failed tiles are counted, not thrown. */
  prefetch(tiles: readonly TileId[], onProgress?: (done: number, total: number) => void, signal?: { cancelled: boolean }): Promise<{ downloaded: number; already: number; failed: number }>;
  usage(): { files: number; bytes: number };
  clear(): void;
}

const PARALLEL = 4;

export function createTileCache(store: TileStore): TileCache {
  const running = new Map<string, Promise<string>>();
  const cached = (tile: TileId): string | null => {
    const path = tilePath(tile);
    return store.has(path) ? store.uri(path) : null;
  };
  const get = (tile: TileId): Promise<string> => {
    const hit = cached(tile);
    if (hit !== null) return Promise.resolve(hit);
    const path = tilePath(tile);
    let job = running.get(path);
    if (!job) {
      job = store.download(tileUrl(tile.z, tile.x, tile.y), path, { ...TILE_HEADERS })
        .then(() => store.uri(path))
        .finally(() => running.delete(path));
      running.set(path, job);
    }
    return job;
  };
  return {
    cached,
    get,
    async prefetch(tiles, onProgress, signal) {
      const result = { downloaded: 0, already: 0, failed: 0 };
      let next = 0;
      let done = 0;
      const worker = async (): Promise<void> => {
        while (next < tiles.length && !signal?.cancelled) {
          const tile = tiles[next++]!;
          if (cached(tile) !== null) result.already++;
          else {
            try {
              await get(tile);
              result.downloaded++;
            } catch {
              result.failed++;
            }
          }
          onProgress?.(++done, tiles.length);
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      return result;
    },
    usage: () => store.usage(),
    clear: () => store.clear(),
  };
}

// ---- which tiles to keep for offline use ----

/** [west, south, east, north] */
export type Bbox = [number, number, number, number];

/** The box around the campus data (buildings and points), grown by `marginM`. null for an empty campus. */
export function campusBbox(state: EditState, marginM = 150): Bbox | null {
  const points: Position[] = [
    ...Object.values(state.nodes).map((n) => n.coord),
    ...Object.values(state.buildings).flatMap((b) => b.polygon[0] ?? []),
  ];
  if (points.length === 0) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  const dLat = marginM / 111_320;
  const dLon = marginM / (111_320 * Math.cos(((s + n) / 2 * Math.PI) / 180));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

/** Zoom levels saved for offline use: the ones the survey map draws when working on a campus (street to building). */
export const PREFETCH_ZOOMS = [15, 16, 17, 18] as const;
/** Never more than this many tiles in one go. */
export const PREFETCH_MAX = 1500;

/** Every tile of the box at each zoom, nearest zoom first (so the useful ones arrive first), at most `max`. */
export function tilesInBbox(box: Bbox, zooms: readonly number[] = PREFETCH_ZOOMS, max = PREFETCH_MAX): TileId[] {
  const out: TileId[] = [];
  for (const z of [...zooms].filter((z) => z <= MAX_TILE_ZOOM).sort((a, b) => b - a)) {
    const last = 2 ** z - 1;
    const clamp = (v: number) => Math.min(last, Math.max(0, Math.floor(v)));
    const [x0, x1] = [clamp(lonToTileX(box[0], z)), clamp(lonToTileX(box[2], z))];
    const [y0, y1] = [clamp(latToTileY(box[3], z)), clamp(latToTileY(box[1], z))];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  }
  return out.slice(0, max);
}

/** How far the campus box reaches, for the settings line ("약 900 m"). */
export const bboxSpanM = (box: Bbox): number => Math.round(metres([box[0], box[1]], [box[2], box[3]]));
