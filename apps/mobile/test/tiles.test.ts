// The OSM tile background (map/tiles.ts): Web Mercator arithmetic, which tiles cover the screen, and that a point read
// off its tile falls within a pixel of where the campus data draws it, at every zoom and after panning.
import { describe, expect, it } from 'vitest';
import type { Position } from '@campo/core';
import { MAX_SCALE, MIN_SCALE, panned, projection, toScreen, zoomed, type View } from '../src/map/project.ts';
import {
  MAX_TILE_ZOOM, TILE_HEADERS, TILE_URL, latToTileY, lonToTileX, screenViaTile, tileUrl, tileXToLon, tileYToLat, tileZoom, visibleTiles,
} from '../src/map/tiles.ts';

/** Hanyang University Seoul: the campus the app ships with. */
const CENTER: Position = [127.045, 37.5572];
const SIZE = { width: 412, height: 892 };
const proj = projection(CENTER);

describe('Web Mercator', () => {
  it('has the fixed points of the tile scheme, and goes there and back', () => {
    // the world is one square: the date line and the Mercator limit (85.0511°) are its edges, 0°/0° its middle
    expect(lonToTileX(-180, 3)).toBe(0);
    expect(lonToTileX(0, 3)).toBe(4);
    expect(lonToTileX(180, 3)).toBe(8);
    expect(latToTileY(0, 3)).toBeCloseTo(4, 12);
    expect(latToTileY(85.0511287798066, 3)).toBeCloseTo(0, 9);
    expect(latToTileY(-85.0511287798066, 3)).toBeCloseTo(8, 9);
    // north is up: a higher latitude is a smaller row
    expect(latToTileY(CENTER[1] + 0.001, 17)).toBeLessThan(latToTileY(CENTER[1], 17));
    expect(tileXToLon(lonToTileX(CENTER[0], 19), 19)).toBeCloseTo(CENTER[0], 10);
    expect(tileYToLat(latToTileY(CENTER[1], 19), 19)).toBeCloseTo(CENTER[1], 10);
  });

  it('only OpenStreetMap is asked, with a User-Agent that names the app', () => {
    expect(TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(tileUrl(17, 111791, 50762)).toBe('https://tile.openstreetmap.org/17/111791/50762.png');
    expect(TILE_URL).not.toMatch(/google|naver|kakao|daum/);
    expect(TILE_HEADERS['User-Agent']).toMatch(/Campo/);
  });

  it('picks the zoom whose tiles are drawn nearest their own size, up to the last level the server has', () => {
    expect(tileZoom(MIN_SCALE, CENTER[1])).toBe(17);
    expect(tileZoom(4, CENTER[1])).toBe(19);
    expect(tileZoom(MAX_SCALE, CENTER[1])).toBe(MAX_TILE_ZOOM);
  });
});

describe('visibleTiles', () => {
  const views: View[] = [
    { x: 0, y: 0, scale: MIN_SCALE }, { x: 0, y: 0, scale: 2.7 }, { x: 0, y: 0, scale: 4 }, { x: 310, y: -420, scale: 9 },
    { x: -800, y: 650, scale: 23 }, { x: 1200, y: 900, scale: MAX_SCALE },
  ];

  it('cover the whole screen without gaps or overlaps', () => {
    for (const view of views) {
      const tiles = visibleTiles(view, SIZE, proj);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length).toBeLessThanOrEqual(48);
      expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
      expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
      expect(Math.max(...tiles.map((t) => t.left + t.width))).toBeGreaterThanOrEqual(SIZE.width);
      expect(Math.max(...tiles.map((t) => t.top + t.height))).toBeGreaterThanOrEqual(SIZE.height);
      // a tile ends exactly where its right and lower neighbours begin
      const at = new Map(tiles.map((t) => [t.key, t]));
      for (const t of tiles) {
        const [z, x, y] = t.key.split('/').map(Number);
        const right = at.get(`${z}/${x! + 1}/${y}`);
        const below = at.get(`${z}/${x}/${y! + 1}`);
        if (right) expect(right.left).toBeCloseTo(t.left + t.width, 9);
        if (below) expect(below.top).toBeCloseTo(t.top + t.height, 9);
        expect(t.width).toBeGreaterThan(0);
        expect(t.height).toBeGreaterThan(0);
      }
    }
  });

  it('a point read off its tile is within a hundredth of a pixel of where the data draws it, at every zoom and place', () => {
    let worst = 0;
    for (const view of views) {
      const tiles = visibleTiles(view, SIZE, proj);
      // points all over the screen: a building corner, a door, the crosshair itself
      for (const [fx, fy] of [[0.5, 0.5], [0.03, 0.04], [0.97, 0.05], [0.1, 0.93], [0.88, 0.97], [0.37, 0.61]]) {
        const position = proj.toPosition([view.x + ((fx! - 0.5) * SIZE.width) / view.scale, view.y - ((fy! - 0.5) * SIZE.height) / view.scale]);
        const data = toScreen(view, SIZE, proj.toXY(position));
        const tile = tiles.find((t) => data[0] >= t.left && data[0] <= t.left + t.width && data[1] >= t.top && data[1] <= t.top + t.height)!;
        const viaTile = screenViaTile(tile, position);
        worst = Math.max(worst, Math.hypot(viaTile[0] - data[0], viaTile[1] - data[1]));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('panning and zooming move the tiles exactly as they move the data', () => {
    const door: Position = [127.0462, 37.5581];
    const start: View = { x: 40, y: -30, scale: 6 };
    for (const view of [start, panned(start, 133, -77), zoomed(panned(start, -260, 190), 1.9), zoomed(start, 0.3)]) {
      const data = toScreen(view, SIZE, proj.toXY(door));
      const z = Number(visibleTiles(view, SIZE, proj)[0]!.key.split('/')[0]);
      // the tile that holds the door, whether or not it is on screen
      const [x, y] = [Math.floor(lonToTileX(door[0], z)), Math.floor(latToTileY(door[1], z))];
      const [left, top] = toScreen(view, SIZE, proj.toXY([tileXToLon(x, z), tileYToLat(y, z)]));
      const [right, bottom] = toScreen(view, SIZE, proj.toXY([tileXToLon(x + 1, z), tileYToLat(y + 1, z)]));
      const viaTile = screenViaTile({ key: `${z}/${x}/${y}`, url: '', left, top, width: right - left, height: bottom - top }, door);
      expect(viaTile[0]).toBeCloseTo(data[0], 2);
      expect(viaTile[1]).toBeCloseTo(data[1], 2);
    }
  });
});
