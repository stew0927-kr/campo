// "OSM 건물 가져오기": the outline of the building under a click, read from OpenStreetMap through the Overpass API,
// becomes a campo building (addBuilding, one history entry). OpenStreetMap is an open source (ODbL, © OpenStreetMap
// contributors); Google, Naver and Kakao maps are never asked (SPEC §3). The outline and the floor count are a starting
// point: the building is marked needs_check and its source says where it came from.
import { addBuilding, setProps, type EditState, type Position } from '@campo/core';
import { buildingAt, pointInRing, ringArea } from './building.ts';
import type { PlanResult } from './plan.ts';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** `source` of a building read from OpenStreetMap. */
export const OSM_SOURCE = 'osm';
/** Buildings whose outline comes within this many metres of the click are asked for; the one that holds the click is taken. */
export const OSM_SEARCH_M = 120;
const TIMEOUT_MS = 20_000;
const MAX_LEVELS = 150;
const MAX_UNDERGROUND = 20;

/** Overpass QL: every building way and relation near the position, with tags and geometry. */
export function overpassQuery(position: Position, radiusM = OSM_SEARCH_M): string {
  const around = `(around:${radiusM},${position[1]},${position[0]})`;
  return `[out:json][timeout:15];(way["building"]${around};relation["building"]${around};);out tags geom;`;
}

export interface OsmBuilding {
  /** "w123" for a way, "r45" for a relation. */
  osmId: string;
  /** null when OpenStreetMap has no name for it. */
  name: string | null;
  /** 1 … building:levels, and -1 … for building:levels:underground. [1] when OpenStreetMap does not say. */
  levels: number[];
  /** OpenStreetMap had a floor count. */
  levelsKnown: boolean;
  /** Closed outer ring, [lng, lat]. */
  ring: Position[];
}

type Tags = Record<string, string>;
interface Geom { lat: number; lon: number }
interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Tags;
  geometry?: Geom[];
  members?: { type?: string; role?: string; geometry?: Geom[] }[];
}

const count = (text: string | undefined, max: number): number | null => {
  const n = Number(text);
  return text !== undefined && Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};

/** Floors from building:levels and building:levels:underground. 0 is never a level (SPEC §3). */
export function osmLevels(tags: Tags): { levels: number[]; known: boolean } {
  const above = count(tags['building:levels'], MAX_LEVELS);
  const below = count(tags['building:levels:underground'], MAX_UNDERGROUND) ?? 0;
  const levels = [
    ...Array.from({ length: below }, (_, i) => i - below),
    ...Array.from({ length: above ?? 1 }, (_, i) => i + 1),
  ];
  return { levels, known: above !== null };
}

/** The points as a closed ring without repeated neighbours, or null when fewer than three places remain. */
function ringOf(geometry: Geom[] | undefined): Position[] | null {
  const ring: Position[] = [];
  for (const g of geometry ?? []) {
    if (typeof g?.lon !== 'number' || typeof g.lat !== 'number') continue;
    const last = ring[ring.length - 1];
    if (!last || last[0] !== g.lon || last[1] !== g.lat) ring.push([g.lon, g.lat]);
  }
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  return ring.length >= 4 ? ring : null;
}

const area = (ring: readonly Position[]) => Math.abs(ringArea(ring));

/** The buildings of an Overpass answer. A relation gives its largest outer ring (courtyards and separate parts are left out). */
export function parseOverpass(json: unknown): OsmBuilding[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  return (elements as OverpassElement[]).flatMap((el): OsmBuilding[] => {
    if (typeof el?.id !== 'number' || (el.type !== 'way' && el.type !== 'relation')) return [];
    const rings = el.type === 'way'
      ? [ringOf(el.geometry)]
      : (el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => ringOf(m.geometry));
    const ring = rings.filter((r): r is Position[] => r !== null).sort((a, b) => area(b) - area(a))[0];
    if (!ring) return [];
    const tags = el.tags ?? {};
    const name = (tags['name'] ?? tags['name:ko'] ?? '').trim();
    const { levels, known } = osmLevels(tags);
    return [{ osmId: `${el.type[0]}${el.id}`, name: name === '' ? null : name, levels, levelsKnown: known, ring }];
  });
}

/** The building whose outline holds `position`: the smallest when outlines are nested (a building inside a campus block). */
export function pickBuilding(list: readonly OsmBuilding[], position: Position): OsmBuilding | undefined {
  return list.filter((b) => pointInRing(position, b.ring)).sort((a, b) => area(a.ring) - area(b.ring))[0];
}

/** The campo building code of an OpenStreetMap object: letters and digits only (SPEC 4.4). */
export const osmCode = (osmId: string): string => `OSM${osmId}`;

/** addBuilding for the outline, marked needs_check. The name, code and floors can be changed afterwards in 상세 정보. */
export function planOsmBuilding(state: EditState, b: OsmBuilding): PlanResult {
  const code = osmCode(b.osmId);
  if (state.buildings[code]) return { error: `이 건물은 이미 가져왔습니다(${state.buildings[code]!.props.name}).` };
  const name = b.name ?? `이름 없는 건물 ${b.osmId}`;
  return {
    annotation: `OSM 건물 "${name}" 가져오기`,
    steps: [
      () => addBuilding({ polygon: [b.ring.map(([x, y]): Position => [x, y])], code, name, levels: b.levels, source: OSM_SOURCE }),
      () => setProps([`bldg_${code}`], { needs_check: true }),
    ],
    notices: [
      b.levelsKnown ? `OSM의 층수(${b.levels.length}개 층)를 넣었습니다.` : 'OSM에 층수가 없어 1층만 넣었습니다.',
      '이름·코드·층은 상세 정보에서 고칠 수 있습니다. 현장에서 확인해 주세요.',
    ],
  };
}

export type OsmLookup = { building: OsmBuilding } | { error: string };

/**
 * Ask Overpass for the building at `position`. Every failure comes back as a Korean sentence: no network, a busy or
 * failing server, an answer that is not JSON, no building there.
 */
export async function fetchOsmBuilding(state: EditState, position: Position, fetchFn: typeof fetch = fetch): Promise<OsmLookup> {
  const here = buildingAt(state, position);
  if (here) return { error: `여기에는 이미 건물(${here.props.name})이 있습니다. 건물이 없는 자리를 눌러 주세요.` };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let json: unknown;
  try {
    const res = await fetchFn(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery(position))}`,
      signal: abort.signal,
    });
    if (res.status === 429 || res.status === 504) return { error: 'OSM 서버(Overpass)가 바쁩니다. 잠시 뒤에 다시 눌러 주세요.' };
    if (!res.ok) return { error: `OSM 서버(Overpass)가 오류를 돌려주었습니다(HTTP ${res.status}). 잠시 뒤에 다시 해 보시거나 건물 외곽선 그리기로 직접 그려 주세요.` };
    json = await res.json();
  } catch (err) {
    return {
      error: (err as Error).name === 'AbortError'
        ? `OSM 서버(Overpass)가 ${TIMEOUT_MS / 1000}초 안에 답하지 않았습니다. 잠시 뒤에 다시 눌러 주세요.`
        : 'OSM 서버(Overpass)에 닿지 못했습니다. 인터넷 연결을 확인하시거나 건물 외곽선 그리기로 직접 그려 주세요.',
    };
  } finally {
    clearTimeout(timer);
  }
  const building = pickBuilding(parseOverpass(json), position);
  return building ? { building } : { error: '누른 자리에 OSM 건물이 없습니다. 건물 안쪽을 눌러 주시거나 건물 외곽선 그리기로 직접 그려 주세요.' };
}
