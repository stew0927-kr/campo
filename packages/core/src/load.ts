import type { LoadedCampus, LoadedFile } from './types.ts';

export const CAMPUS_META_FILE = 'campus.json';
export const OVERRIDES_FILE = 'overrides.json';

/**
 * Merge the files of one campus folder (SPEC §4.3) into a single feature list.
 * Pure: works in the browser and in Node. Use `loadCampus(dir)` from
 * `@campo/core/node` to read a folder from disk.
 *
 * Never throws on bad data: unreadable files are reported in `fileErrors`
 * and turned into validation errors by validateCampus().
 */
export function parseCampus(files: readonly LoadedFile[]): LoadedCampus {
  const campus: LoadedCampus = { meta: undefined, features: [], fileErrors: [] };
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const { path, text } of sorted) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      campus.fileErrors.push({ file: path, message: `JSON으로 읽을 수 없습니다: ${(err as Error).message}` });
      continue;
    }

    if (path === CAMPUS_META_FILE) {
      campus.meta = json;
      continue;
    }
    if (path === OVERRIDES_FILE) {
      campus.overrides = json;
      continue;
    }

    if (!isRecord(json) || json['type'] !== 'FeatureCollection' || !Array.isArray(json['features'])) {
      campus.fileErrors.push({ file: path, message: 'GeoJSON FeatureCollection이 아닙니다.' });
      continue;
    }
    for (const feature of json['features'] as unknown[]) {
      campus.features.push({ file: path, feature });
    }
  }
  return campus;
}

/** True for the files that belong to a campus folder: campus.json, overrides.json and *.geojson. */
export function isCampusFile(path: string): boolean {
  return path === CAMPUS_META_FILE || path === OVERRIDES_FILE || path.endsWith('.geojson');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
