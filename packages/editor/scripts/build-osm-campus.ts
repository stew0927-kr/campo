// Reads one school's buildings from OpenStreetMap and saves them as JSON for the editor (OSM 건물 가져오기).
//   npm run osm-campus -w @campo/editor -- [--name "한양대학교 서울캠퍼스"] [--out src/data/osm-campus/hanyang-seoul.json]
//                                          [--buffer 100] [--fallback <lng>,<lat>,<radiusM>]
// The area is the OSM amenity=university boundary of the school plus a margin on every side. Only when OSM has no such
// boundary is the --fallback centre and radius used. Data: © OpenStreetMap contributors (ODbL).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CAMPUS_BUFFER_M, DEFAULT_CAMPUS_NAME, boundsBbox, bufferBbox, campusBuildingsQuery, pickCampus, radiusBbox, uniqueBuildings,
  universityQuery, type Bbox, type OsmCampusData, type UniversityElement,
} from '../src/model/osmCampus.ts';
import { parseOverpass } from '../src/model/osm.ts';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const ROUNDS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Posts the query to each mirror in turn, and again after a growing pause, until one answers with JSON. */
async function overpass(query: string): Promise<unknown> {
  let last = '';
  for (let round = 0; round < ROUNDS; round++) {
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CampoEditor/0.0 (campus map data tool)', Accept: '*/*' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(240_000),
        });
        if (res.ok) return await res.json();
        last = `${url} → HTTP ${res.status}`;
      } catch (err) {
        last = `${url} → ${(err as Error).message}`;
      }
      console.error(`  failed: ${last}`);
    }
    const wait = 10_000 * 2 ** round;
    console.error(`  all mirrors failed; retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
  throw new Error(`Overpass did not answer: ${last}`);
}

const { values } = parseArgs({
  options: {
    name: { type: 'string', default: DEFAULT_CAMPUS_NAME },
    out: { type: 'string', default: 'src/data/osm-campus/hanyang-seoul.json' },
    buffer: { type: 'string', default: String(CAMPUS_BUFFER_M) },
    fallback: { type: 'string' },
  },
});
const name = values.name!;
const bufferM = Number(values.buffer);

let area: OsmCampusData['area'] = 'university-boundary';
let boundaryId: string | null = null;
let base: Bbox;

console.error(`Looking for the campus boundary of "${name}" ...`);
const universities = ((await overpass(universityQuery(name))) as { elements?: UniversityElement[] }).elements ?? [];
const campus = pickCampus(universities, name);
if (campus?.bounds) {
  boundaryId = `${campus.type![0]}${campus.id}`;
  base = boundsBbox(campus.bounds);
  console.error(`  boundary ${boundaryId} "${campus.tags?.['name'] ?? ''}" (of ${universities.length} university objects)`);
} else if (values.fallback) {
  const [lng, lat, radius] = values.fallback.split(',').map(Number) as [number, number, number];
  area = 'radius';
  base = radiusBbox([lng, lat], radius);
  console.error(`  no boundary in OSM; using the centre ${lng},${lat} and ${radius} m`);
} else {
  throw new Error(`OSM has no amenity=university boundary for "${name}". Pass --fallback <lng>,<lat>,<radiusM>.`);
}

const bbox = area === 'radius' ? base : bufferBbox(base, bufferM);
console.error(`Reading buildings in ${bbox.map((n) => n.toFixed(5)).join(', ')} ...`);
const buildings = uniqueBuildings(parseOverpass(await overpass(campusBuildingsQuery(bbox))));

const data: OsmCampusData = {
  campus: name, area, boundaryId, bufferM: area === 'radius' ? 0 : bufferM, bbox,
  source: '© OpenStreetMap contributors (ODbL), read through the Overpass API by scripts/build-osm-campus.ts',
  fetchedAt: new Date().toISOString(), buildings,
};
const out = resolve(process.cwd(), values.out!);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(data)}\n`);
const named = buildings.filter((b) => b.name !== null).length;
const known = buildings.filter((b) => b.levelsKnown).length;
console.error(`Wrote ${buildings.length} buildings (${named} named, ${known} with floor counts) to ${out}`);
