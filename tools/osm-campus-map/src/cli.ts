// Usage: npm run osm-campus-map -- [--bbox w,s,e,n] [--input overpass.json] [--out dir]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { convertOverpass } from './convert.ts';
import { fetchOverpass } from './overpass.ts';
import { buildSketchStyle } from './style.ts';
import type { Bbox, OverpassJson } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(here, '..');
const repoRoot = resolve(toolDir, '..', '..');
const DEFAULT_CAMPUS = join(repoRoot, 'data', 'campuses', 'hanyang-seoul', 'campus.json');

export function parseBbox(text: string): Bbox {
  const parts = text.split(',').map((s) => Number(s.trim()));
  const [w, s, e, n] = parts;
  if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x)) || w! >= e! || s! >= n!) {
    throw new Error(`--bbox must be "west,south,east,north" (got "${text}")`);
  }
  return [w!, s!, e!, n!];
}

async function defaultBbox(): Promise<Bbox> {
  const campus = JSON.parse(await readFile(DEFAULT_CAMPUS, 'utf8')) as { bbox?: number[] };
  if (!campus.bbox) throw new Error(`no bbox in ${DEFAULT_CAMPUS}; pass --bbox`);
  return parseBbox(campus.bbox.join(','));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      bbox: { type: 'string' },
      input: { type: 'string' },
      out: { type: 'string', default: join(toolDir, 'out') },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('osm-campus-map [--bbox west,south,east,north] [--input overpass.json] [--out dir]');
    return;
  }
  const bbox = values.bbox !== undefined ? parseBbox(values.bbox) : await defaultBbox();
  const json: OverpassJson =
    values.input !== undefined
      ? (JSON.parse(await readFile(resolve(values.input), 'utf8')) as OverpassJson)
      : await fetchOverpass(bbox);

  const { collection, stats } = convertOverpass(json, { bbox });
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  await writeFile(join(out, 'campus-sketch.geojson'), JSON.stringify(collection) + '\n');
  await writeFile(
    join(out, 'campus-sketch-style.json'),
    JSON.stringify(buildSketchStyle({ center }), null, 2) + '\n',
  );
  console.log(`wrote ${out}`);
  console.log(`kept ${JSON.stringify(stats.kept)}, dropped ${stats.dropped}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
