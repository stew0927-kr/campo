// Reading the disk: survey folders and the campus map files.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './config.ts';
import { buildNodeIndex, type NodeInfo } from './plan.ts';

export interface SurveyFolder {
  id: string;
  dir: string;
  json: unknown;
}

export const DEFAULT_SURVEYS_DIR = join(REPO_ROOT, 'data', 'surveys');

/** Folders under surveysDir that contain survey.json. `only` picks one folder by name. */
export function findSurveys(surveysDir: string, only: string | null): SurveyFolder[] {
  const root = resolve(surveysDir);
  if (!existsSync(root)) return [];
  const out: SurveyFolder[] = [];
  for (const name of readdirSync(root).sort()) {
    if (only !== null && name !== only) continue;
    const dir = join(root, name);
    const file = join(dir, 'survey.json');
    if (!statSync(dir).isDirectory() || !existsSync(file)) continue;
    let json: unknown = null;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      json = null;
    }
    out.push({ id: name, dir, json });
  }
  return out;
}

function geojsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...geojsonFiles(p));
    else if (name.endsWith('.geojson')) out.push(p);
  }
  return out;
}

/** node id -> building/level from data/campuses/<campus>/**.geojson. Empty when the map data is still empty. */
export function loadNodeIndex(campusId: string): Map<string, NodeInfo> {
  const files = geojsonFiles(join(REPO_ROOT, 'data', 'campuses', campusId));
  const collections: unknown[] = [];
  for (const f of files) {
    try {
      collections.push(JSON.parse(readFileSync(f, 'utf8')));
    } catch {
      // A broken file is the data owner's to fix (npm run validate); here it only means no building/level.
    }
  }
  return buildNodeIndex(collections);
}
