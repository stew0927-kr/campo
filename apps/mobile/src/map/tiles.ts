// The background of the survey map: OpenStreetMap raster tiles (SPEC §3 allows OSM for display; Google, Naver and Kakao
// maps are never used). Pure arithmetic: which tiles cover the screen and where each goes, in the same projection the
// campus data is drawn with. A tile is placed by its own corners, so its error against the data is only the bend of
// Web Mercator inside one tile: a few thousandths of a pixel at any zoom the app allows.
import type { Position } from '@campo/core';
import { toScreen, type Projection, type Size, type View } from './project.ts';

/** OSM's standard tile server. {z}/{x}/{y} are filled by tileUrl. */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '© OpenStreetMap 기여자';
/** The tile server asks every app to say who it is (https://operations.osmfoundation.org/policies/tiles/). */
export const TILE_HEADERS = { 'User-Agent': 'CampoSurvey/0.0 (campus field survey app)' } as const;
/** Pixels of a tile at its own zoom. */
export const TILE_PX = 256;
export const MIN_TILE_ZOOM = 12;
/** The server has no tiles past this; closer in, the level 19 tiles are drawn larger. */
export const MAX_TILE_ZOOM = 19;
/** Never more than this many tiles at once (a guard against a view that makes no sense). */
const MAX_TILES = 48;

const EQUATOR_M = 40_075_016.686;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Web Mercator: fractional tile column of a longitude at zoom `z`. */
export const lonToTileX = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
/** Web Mercator: fractional tile row of a latitude at zoom `z` (0 at the top). */
export const latToTileY = (lat: number, z: number): number => ((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2) * 2 ** z;
export const tileXToLon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;
export const tileYToLat = (y: number, z: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** The zoom whose tiles are drawn closest to their own size at `scale` pixels per metre (between 181 and 362 pixels wide). */
export function tileZoom(scale: number, lat: number): number {
  const z = Math.round(Math.log2((EQUATOR_M * Math.cos(rad(lat)) * scale) / TILE_PX));
  return Math.min(MAX_TILE_ZOOM, Math.max(MIN_TILE_ZOOM, z));
}

export const tileUrl = (z: number, x: number, y: number): string => TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

export interface Tile {
  /** "z/x/y" */
  key: string;
  url: string;
  /** Where the tile goes on the screen, in pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The tiles that cover the screen, each placed by projecting its north-west and south-east corners like any map point. */
export function visibleTiles(view: View, size: Size, projection: Projection): Tile[] {
  const halfW = size.width / 2 / view.scale;
  const halfH = size.height / 2 / view.scale;
  const nw = projection.toPosition([view.x - halfW, view.y + halfH]);
  const se = projection.toPosition([view.x + halfW, view.y - halfH]);
  const z = tileZoom(view.scale, (nw[1] + se[1]) / 2);
  const last = 2 ** z - 1;
  const clamp = (n: number) => Math.min(last, Math.max(0, Math.floor(n)));
  const [x0, x1] = [clamp(lonToTileX(nw[0], z)), clamp(lonToTileX(se[0], z))];
  const [y0, y1] = [clamp(latToTileY(nw[1], z)), clamp(latToTileY(se[1], z))];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return [];
  const corner = (x: number, y: number) => toScreen(view, size, projection.toXY([tileXToLon(x, z), tileYToLat(y, z)]));
  const tiles: Tile[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [left, top] = corner(x, y);
      const [right, bottom] = corner(x + 1, y + 1);
      tiles.push({ key: `${z}/${x}/${y}`, url: tileUrl(z, x, y), left, top, width: right - left, height: bottom - top });
    }
  }
  return tiles;
}

/** Where a position falls on the screen when read off the tile that holds it: the check that tiles and data line up. */
export function screenViaTile(tile: Tile, position: Position): [number, number] {
  const [z, x, y] = tile.key.split('/').map(Number) as [number, number, number];
  return [tile.left + (lonToTileX(position[0], z) - x) * tile.width, tile.top + (latToTileY(position[1], z) - y) * tile.height];
}
