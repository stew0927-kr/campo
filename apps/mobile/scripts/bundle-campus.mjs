// Copies one campus folder into the app as a single JSON asset, so the survey works without a network.
//   node scripts/bundle-campus.mjs [campus id]      (default: CAMPO_CAMPUS or hanyang-seoul)
// The OSM buildings of the campus (packages/editor/src/data/osm-campus/<campus>.json, made by the editor's osm-campus
// script) go in with it, so a building that is not in the campus data yet can be added on site without a network.
// The result (assets/campus.generated.json) is not committed: it is made again before every start and export.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const campus = process.argv[2] ?? process.env.CAMPO_CAMPUS ?? 'hanyang-seoul';
const dir = join(here, '../../../data/campuses', campus);
const osmFile = join(here, '../../../packages/editor/src/data/osm-campus', `${campus}.json`);
const out = join(here, '../assets/campus.generated.json');

// The map itself: campus.json and the GeoJSON layers (SPEC 4.3). Overrides, observations and calibration are not needed on site.
const wanted = (path) => path === 'campus.json' || path.endsWith('.geojson');

const entries = await readdir(dir, { recursive: true, withFileTypes: true });
const files = [];
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const abs = join(entry.parentPath, entry.name);
  const path = relative(dir, abs).split(sep).join('/');
  if (wanted(path)) files.push({ path, text: await readFile(abs, 'utf8') });
}
files.sort((a, b) => (a.path < b.path ? -1 : 1));
if (!files.some((f) => f.path === 'campus.json')) throw new Error(`${dir} has no campus.json`);

// Only what the app uses of each building: id, name, floors and outline.
let osm = null;
try {
  const data = JSON.parse(await readFile(osmFile, 'utf8'));
  osm = {
    bbox: data.bbox,
    buildings: data.buildings.map((b) => ({ osmId: b.osmId, name: b.name, levels: b.levels, levelsKnown: b.levelsKnown, ring: b.ring })),
  };
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify({ campus, files, osm })}
`, 'utf8');
console.log(`bundled ${files.length} files of ${campus}${osm ? ` and ${osm.buildings.length} OSM buildings` : ''} into assets/campus.generated.json`);
