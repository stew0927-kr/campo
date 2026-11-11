// Saved data: exactly what goes into data/campuses/<id>/. Uses @campo/core types as-is.
// Screen state (tool, selection, background…) lives in src/ui/ui-state.ts, never here.
import {
  SCHEMA_VERSION,
  isValidFeature,
  type CampoFeature,
  type CampusMeta,
  type LoadedCampus,
  type LoadedFeature,
} from '@campo/core';

export interface CampusDoc {
  campusId: string;
  meta: CampusMeta;
  /** Schema-valid features by id. */
  features: ReadonlyMap<string, CampoFeature>;
  /** Features that failed the schema check on load. Written back untouched so nothing is lost. */
  passthrough: readonly LoadedFeature[];
}

/** Rough centre of Hanyang University Seoul campus, used when campus.json is missing. */
export function defaultMeta(campusId: string): CampusMeta {
  return {
    id: campusId,
    schema_version: SCHEMA_VERSION,
    name: campusId,
    center: [127.045, 37.5572],
    bbox: [127.0395, 37.5530, 127.0505, 37.5615],
  };
}

export function docFromLoaded(campusId: string, loaded: LoadedCampus): CampusDoc {
  const features = new Map<string, CampoFeature>();
  const passthrough: LoadedFeature[] = [];
  for (const item of loaded.features) {
    if (isValidFeature(item.feature) && !features.has(item.feature.id)) features.set(item.feature.id, item.feature);
    else passthrough.push(item);
  }
  // A campus.json without schema_version is v0.1: saving stamps it v0.2 (its old features stay as they are, and validate says so).
  const meta = isMeta(loaded.meta) ? { ...loaded.meta, schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION } : defaultMeta(campusId);
  return { campusId, meta, features, passthrough };
}

export function withFeatures(doc: CampusDoc, added: readonly CampoFeature[]): CampusDoc {
  if (added.length === 0) return doc;
  const features = new Map(doc.features);
  for (const f of added) features.set(f.id, f);
  return { ...doc, features };
}

function isMeta(value: unknown): value is Omit<CampusMeta, 'schema_version'> {
  const m = value as Partial<CampusMeta> | null;
  return typeof m === 'object' && m !== null && typeof m.id === 'string' && typeof m.name === 'string' &&
    Array.isArray(m.center) && m.center.length === 2 && Array.isArray(m.bbox) && m.bbox.length === 4;
}
