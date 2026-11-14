// 학교 캠퍼스 건물 사전 내장: the pieces of scripts/build-osm-campus.ts that can be tested without a network, and the
// lookup the editor uses at click time. A campus is read from OpenStreetMap once (amenity=university boundary + a margin),
// saved as JSON under src/data/osm-campus/, and the OSM 건물 가져오기 tool then reads that file instead of waiting for Overpass.
import type { Position } from '@campo/core';
import { pickBuilding, type OsmBuilding } from './osm.ts';

/** [west, south, east, north] in degrees. */
export type Bbox = [number, number, number, number];

/** The margin added around the campus boundary on every side. */
export const CAMPUS_BUFFER_M = 100;
export const DEFAULT_CAMPUS_NAME = '한양대학교 서울캠퍼스';

export interface OsmCampusData {
  /** The school name that was asked for. */
  campus: string;
  /** What the area came from: the OSM university boundary, or the centre+radius used when OSM has none. */
  area: 'university-boundary' | 'radius';
  /** OSM object of the boundary ("r123"), when there is one. */
  boundaryId: string | null;
  bufferM: number;
  /** The boundary's box plus the margin: buildings inside it are saved. */
  bbox: Bbox;
  /** ODbL notice and the way the file was made. */
  source: string;
  fetchedAt: string;
  buildings: OsmBuilding[];
}

export interface UniversityElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

const M_PER_DEG_LAT = 111_320;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The box grown by `metres` on every side (longitude degrees shrink with latitude). */
export function bufferBbox([w, s, e, n]: Bbox, metres: number): Bbox {
  const dLat = metres / M_PER_DEG_LAT;
  const dLon = metres / (M_PER_DEG_LAT * Math.cos(rad((s + n) / 2)));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

/** The box around a centre and a radius: the fallback for a school with no boundary in OSM. */
export function radiusBbox(center: Position, radiusM: number): Bbox {
  return bufferBbox([center[0], center[1], center[0], center[1]], radiusM);
}

export function inBbox(p: Position, [w, s, e, n]: Bbox): boolean {
  return p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
}

/** "한양대학교 서울캠퍼스" → "한양대학교": the part every campus of the school shares. */
export const schoolWord = (name: string): string => name.trim().replace(/\s*\S*캠퍼스$/, '').trim() || name.trim();

/** Overpass QL: the university objects of a school, with their tags and bounding boxes. */
export function universityQuery(name: string): string {
  const word = schoolWord(name).replace(/["\\]/g, '');
  return `[out:json][timeout:60];nwr["amenity"="university"]["name"~"${word}"];out tags bb;`;
}

/** Overpass QL: every building way and relation inside the box (south, west, north, east order), with tags and geometry. */
export function campusBuildingsQuery([w, s, e, n]: Bbox): string {
  const box = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:180];(way["building"]${box};relation["building"]${box};);out tags geom;`;
}

const namesOf = (el: UniversityElement): string[] =>
  [el.tags?.['name'], el.tags?.['name:ko'], el.tags?.['official_name']].filter((n): n is string => !!n);
const boxArea = (b: NonNullable<UniversityElement['bounds']>) => (b.maxlat - b.minlat) * (b.maxlon - b.minlon);

/**
 * The university object that is the asked campus: the exact name first, then a name that has the campus word
 * ("서울"), then the plain school name. Several equals: the biggest. null when OSM has no university with an area.
 */
export function pickCampus(elements: readonly UniversityElement[], name: string): UniversityElement | null {
  const word = schoolWord(name);
  const campusWord = name.trim().slice(word.length).trim().replace(/캠퍼스$/, '');
  const score = (el: UniversityElement): number => {
    const names = namesOf(el);
    if (!names.some((n) => n.includes(word))) return -1;
    if (names.includes(name.trim())) return 3;
    if (campusWord !== '' && names.some((n) => n.includes(campusWord))) return 2;
    if (names.some((n) => n.replace(/\s/g, '') === word.replace(/\s/g, ''))) return 1;
    return 0;
  };
  return elements
    .filter((el) => el.bounds && (el.type === 'way' || el.type === 'relation') && score(el) >= 0)
    .sort((a, b) => score(b) - score(a) || boxArea(b.bounds!) - boxArea(a.bounds!))[0] ?? null;
}

export const boundsBbox = (b: NonNullable<UniversityElement['bounds']>): Bbox => [b.minlon, b.minlat, b.maxlon, b.maxlat];

/** Keep each building once, in a stable order. */
export function uniqueBuildings(list: readonly OsmBuilding[]): OsmBuilding[] {
  const byId = new Map<string, OsmBuilding>();
  for (const b of list) byId.set(b.osmId, b);
  return [...byId.values()].sort((a, b) => a.osmId.localeCompare(b.osmId, 'en', { numeric: true }));
}

/** The embedded campus the click falls in: the building holding it, or why not. `outside` means the file does not cover the click. */
export type CampusLookup = { building: OsmBuilding } | { error: string } | { outside: true };

export function lookupCampusBuilding(data: OsmCampusData, position: Position): CampusLookup {
  if (!inBbox(position, data.bbox)) return { outside: true };
  const building = pickBuilding(data.buildings, position);
  return building ? { building } : { error: '누른 자리에 OSM 건물이 없습니다. 건물 안쪽을 눌러 주시거나 건물 외곽선 그리기로 직접 그려 주세요.' };
}
