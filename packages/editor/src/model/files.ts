// File layout (SPEC §4.3) and on-disk format: Features sorted by id, one per line.
import { parseCampus, type BuildingFeature, type CampoFeature, type LoadedCampus, type NodeFeature } from '@campo/core';
import type { CampusDoc } from './document.ts';

export const META_FILE = 'campus.json';
export const OUTDOOR_FILE = 'outdoor.geojson';
export const CONNECTIONS_FILE = 'connections.geojson';

/** Which file a feature belongs in. */
export function fileFor(feature: CampoFeature, doc: Pick<CampusDoc, 'features'>): string {
  const p = feature.properties;
  if (p.kind === 'building') return `buildings/${p.code}/building.geojson`;
  if (p.kind === 'node') {
    return p.building_id === null || p.level === null ? OUTDOOR_FILE : levelFile(p.building_id, p.level, doc);
  }

  if (p.edge_type === 'portal' || p.edge_type === 'bridge') return CONNECTIONS_FILE;
  const from = nodeOf(doc, p.from);
  const to = nodeOf(doc, p.to);
  const indoor = [from, to].filter((n): n is NodeFeature => n !== undefined && n.properties.building_id !== null);
  if (indoor.length === 0) return OUTDOOR_FILE;
  // Indoor ↔ outdoor without edge_type "portal" still joins the two worlds.
  if (indoor.length === 1 && from && to) return CONNECTIONS_FILE;
  // Edges spanning floors live in the lower floor's file (SPEC §4.3).
  const lower = indoor.reduce((a, b) => ((b.properties.level ?? 0) < (a.properties.level ?? 0) ? b : a));
  return levelFile(lower.properties.building_id!, lower.properties.level!, doc);
}

/** All files of the campus folder, as text, ready to write. */
export function docToFiles(doc: CampusDoc): Record<string, string> {
  const byFile = new Map<string, unknown[]>();
  const push = (file: string, f: unknown) => {
    const list = byFile.get(file);
    if (list) list.push(f);
    else byFile.set(file, [f]);
  };
  for (const f of doc.features.values()) push(fileFor(f, doc), normalize(f));
  for (const { file, feature } of doc.passthrough) push(file, feature);

  const files: Record<string, string> = { [META_FILE]: `${JSON.stringify(doc.meta, null, 2)}\n` };
  for (const file of [...byFile.keys()].sort()) files[file] = formatFeatureCollection(byFile.get(file)!);
  return files;
}

/** `{"type":"FeatureCollection","features":[` + one Feature per line, sorted by id + `]}`. */
export function formatFeatureCollection(features: readonly unknown[]): string {
  if (features.length === 0) return '{"type":"FeatureCollection","features":[]}\n';
  const sorted = [...features].sort((a, b) => compareIds(idOf(a), idOf(b)));
  return `{"type":"FeatureCollection","features":[\n${sorted.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

/** Fixed key order so the same feature always serialises the same way. */
function normalize(f: CampoFeature): CampoFeature {
  return { type: 'Feature', id: f.id, geometry: f.geometry, properties: f.properties } as CampoFeature;
}

function levelFile(buildingId: string, level: number, doc: Pick<CampusDoc, 'features'>): string {
  const b = doc.features.get(buildingId);
  const code = b?.properties.kind === 'building' ? (b as BuildingFeature).properties.code : buildingId.replace(/^bldg_/, '');
  return `buildings/${code}/L${level}.geojson`;
}

function nodeOf(doc: Pick<CampusDoc, 'features'>, id: string): NodeFeature | undefined {
  const f = doc.features.get(id);
  return f?.properties.kind === 'node' ? (f as NodeFeature) : undefined;
}

function idOf(f: unknown): string | undefined {
  const id = (f as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
}

/** Plain code-unit order (not locale) so every machine sorts the same; id-less features last. */
function compareIds(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}

/** The campus exactly as it would be saved, read back the way core reads it. Used for checks and routes. */
export function docToCampus(doc: CampusDoc): LoadedCampus {
  return parseCampus(Object.entries(docToFiles(doc)).map(([path, text]) => ({ path, text })));
}
