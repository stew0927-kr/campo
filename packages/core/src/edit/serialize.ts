// Edit state -> campus files (SPEC §4.3). Comparing levels here only picks the file an edge goes in; routing never does.
//
// Placement:
//   buildings/{code}/building.geojson   the building
//   outdoor.geojson                     outdoor nodes and rooms, edges with both ends outdoors
//   buildings/{code}/L{level}.geojson   indoor nodes and rooms; edges with both ends in that building, in the lower end's level
//   connections.geojson                 portal and bridge edges, and edges whose ends are not in one building
//
// Only files with at least one Feature are returned, plus campus.json when `meta` is given.
// Deleting files that are no longer produced (a deleted building's folder, an emptied level) is the caller's job:
// compare the returned paths with the *.geojson files on disk. overrides.json, observations/ and calibration.json
// are never written here.
import { formatFeatureCollection, formatMeta } from '../format.ts';
import { CAMPUS_META_FILE } from '../load.ts';
import type { CampoFeature, LoadedFile } from '../types.ts';
import { toFeatures } from './convert.ts';
import { edgeFileScope } from './ids.ts';
import { codeOf, type EditState } from './state.ts';

export const OUTDOOR_FILE = 'outdoor.geojson';
export const CONNECTIONS_FILE = 'connections.geojson';

function levelFile(state: EditState, buildingId: string, level: number | null): string {
  return `buildings/${codeOf(state, buildingId)}/L${String(level)}.geojson`;
}

/** The file a saved Feature belongs in. */
export function fileOf(state: EditState, feature: CampoFeature): string {
  const p = feature.properties;
  switch (p.kind) {
    case 'building':
      return `buildings/${p.code}/building.geojson`;
    case 'node':
    case 'room':
      return p.building_id === null ? OUTDOOR_FILE : levelFile(state, p.building_id, p.level);
    case 'edge': {
      const from = state.nodes[p.from]!.props;
      const to = state.nodes[p.to]!.props;
      const scope = edgeFileScope(p.edge_type, from, to);
      if (scope.kind === 'outdoor') return OUTDOOR_FILE;
      if (scope.kind === 'connections') return CONNECTIONS_FILE;
      return levelFile(state, scope.buildingId, scope.level);
    }
  }
}

/** Write the state as campus files: one FeatureCollection per file, one Feature per line, LF, sorted by path. */
export function serialize(state: EditState, meta?: unknown): LoadedFile[] {
  const buckets = new Map<string, CampoFeature[]>();
  for (const f of toFeatures(state)) {
    const path = fileOf(state, f);
    buckets.set(path, [...(buckets.get(path) ?? []), f]);
  }
  const files: LoadedFile[] = [...buckets].map(([path, features]) => ({ path, text: formatFeatureCollection(features) }));
  if (meta !== undefined) files.push({ path: CAMPUS_META_FILE, text: formatMeta(meta) });
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
