// Node-only helpers. Kept out of the main entry so @campo/core stays browser-safe.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { isCampusFile, parseCampus } from '../load.ts';
import type { LoadedCampus, LoadedFile } from '../types.ts';

/** Read every campus file (campus.json, overrides.json, *.geojson) under `dir` as text. */
export async function readCampusFiles(dir: string): Promise<LoadedFile[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: LoadedFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    const path = relative(dir, abs).split(sep).join('/');
    if (!isCampusFile(path)) continue;
    files.push({ path, text: await readFile(abs, 'utf8') });
  }
  return files;
}

/** Read every campus file under `dir` and merge them (SPEC §4.3). */
export async function loadCampus(dir: string): Promise<LoadedCampus> {
  return parseCampus(await readCampusFiles(dir));
}
