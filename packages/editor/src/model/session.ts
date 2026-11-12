// The editor's data: one edit engine state plus its history (SPEC-v0.2 §5.1: the engine is the only source of truth).
// The screen never changes a Feature itself; it asks an action of @campo/core/edit (see plan.ts) and reads the new state.
import {
  SCHEMA_VERSION,
  applyOverrideCopies,
  createHistory,
  createIdGen,
  findFeature,
  formatFeatureCollection,
  fromCampus,
  isValidFeature,
  observationTargetsOf,
  overrideIdsOf,
  parseCampus,
  serialize,
  type BuildingProperties,
  type CampusMeta,
  type EdgeProperties,
  type EditContext,
  type EditState,
  type History,
  type LoadIssue,
  type LoadedCampus,
  type LoadedFeature,
  type LoadedFile,
  type NodeProperties,
  type Observation,
  type Override,
  type RoomProperties,
} from '@campo/core';

export interface Session {
  campusId: string;
  meta: CampusMeta;
  history: History;
  ctx: EditContext;
  /** Features the engine left out on load (schema errors, missing end nodes, repeated ids). Written back untouched on save. */
  passthrough: readonly LoadedFeature[];
  issues: readonly LoadIssue[];
  /** overrides.json, observations/*.jsonl, calibration.json: checks and routes read them. overrides.json is rewritten by pendingOverrides, observations/editor.jsonl by pendingObservationsText. */
  extras: LoadedFile[];
  /** Measurements typed in since the last save. They are written to OBSERVATION_FILE with the next save (not part of the edit history). */
  pendingObservations: Observation[];
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

function isMeta(value: unknown): value is Omit<CampusMeta, 'schema_version'> {
  const m = value as Partial<CampusMeta> | null;
  return typeof m === 'object' && m !== null && typeof m.id === 'string' && typeof m.name === 'string' &&
    Array.isArray(m.center) && m.center.length === 2 && Array.isArray(m.bbox) && m.bbox.length === 4;
}

const EXTRA_FILE = /^(overrides\.json|calibration\.json|observations\/.+\.jsonl)$/;

/** Files as the dev server sends them -> a session. `seed` fixes the new-id generator (tests). */
export function createSession(campusId: string, files: readonly LoadedFile[], seed = (Math.random() * 2 ** 32) >>> 0): Session {
  const loaded = parseCampus(files);
  const { state, issues } = fromCampus(loaded);
  // A campus.json without schema_version is v0.1: saving stamps it v0.2.
  const meta = isMeta(loaded.meta) ? { ...loaded.meta, schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION } : defaultMeta(campusId);
  return {
    campusId,
    meta,
    history: createHistory(state),
    ctx: { ids: createIdGen(seed), observationTargets: observationTargetsOf(loaded), overrideIds: overrideIdsOf(loaded) },
    passthrough: leftOut(loaded, issues),
    issues,
    extras: files.filter((f) => EXTRA_FILE.test(f.path)),
    pendingObservations: [],
  };
}

/** overrides.json after the unsaved edits carried their entries over (split: copy to the new piece, heal: move). */
export interface PendingOverrides {
  /** New text of overrides.json. */
  text: string;
  overrides: Override[];
}

const OVERRIDES = 'overrides.json';

/** What overrides.json must hold when saving now, or null when no edit since the last save carries an override. */
export function pendingOverrides(session: Session): PendingOverrides | null {
  const copies = session.history.overrideCopies();
  if (copies.length === 0) return null;
  let list: Override[] = [];
  const file = session.extras.find((f) => f.path === OVERRIDES);
  if (file) {
    try {
      const parsed: unknown = JSON.parse(file.text);
      if (Array.isArray(parsed)) list = parsed as Override[];
    } catch {
      return null; // an unreadable file is left for the check tab to report, not overwritten
    }
  }
  const overrides = applyOverrideCopies(list, copies);
  return { text: JSON.stringify(overrides, null, 2) + '\n', overrides };
}

/** After a save: the new overrides.json is the loaded one, and the ids that have an entry are up to date. */
export function commitOverrides(session: Session, pending: PendingOverrides): void {
  session.extras = [...session.extras.filter((f) => f.path !== OVERRIDES), { path: OVERRIDES, text: pending.text }];
  session.ctx.overrideIds = new Set(pending.overrides.map((o) => o.feature_id));
}

/** The one observations file the editor adds lines to. Other observations/*.jsonl are read, never rewritten. */
export const OBSERVATION_FILE = 'observations/editor.jsonl';

/** Text of OBSERVATION_FILE after the unsaved measurements are appended, or null when there are none. */
export function pendingObservationsText(session: Session): string | null {
  if (session.pendingObservations.length === 0) return null;
  const old = session.extras.find((f) => f.path === OBSERVATION_FILE)?.text ?? '';
  const head = old === '' || old.endsWith('\n') ? old : `${old}\n`;
  return head + session.pendingObservations.map((o) => `${JSON.stringify(o)}\n`).join('');
}

/** The extras as a save would leave them: with the unsaved measurements in OBSERVATION_FILE. */
export function extrasWithPending(session: Session, overrides?: LoadedFile): LoadedFile[] {
  const text = pendingObservationsText(session);
  let extras = overrides ? [...session.extras.filter((f) => f.path !== overrides.path), overrides] : session.extras;
  if (text !== null) extras = [...extras.filter((f) => f.path !== OBSERVATION_FILE), { path: OBSERVATION_FILE, text }];
  return extras;
}

/** After a save: the unsaved measurements are part of the loaded file now. */
export function commitObservations(session: Session): void {
  const text = pendingObservationsText(session);
  if (text === null) return;
  session.extras = [...session.extras.filter((f) => f.path !== OBSERVATION_FILE), { path: OBSERVATION_FILE, text }];
  session.pendingObservations = [];
}

/** The loaded Features that did not go into the state: schema failures, and the ones the issues name. */
function leftOut(loaded: LoadedCampus, issues: readonly LoadIssue[]): LoadedFeature[] {
  const named = new Set(issues.filter((i) => i.code !== 'I2' && i.featureId !== null).map((i) => `${i.file}\u0000${i.featureId}`));
  return loaded.features.filter((lf) => {
    if (!isValidFeature(lf.feature)) return true;
    return named.has(`${lf.file}\u0000${(lf.feature as { id: string }).id}`);
  });
}

/** Every file of the campus folder as it would be saved: the engine's files plus the left-out Features in their own files. */
export function stateToFiles(state: EditState, meta: CampusMeta, passthrough: readonly LoadedFeature[] = []): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of serialize(state, meta)) files[f.path] = f.text;
  const byFile = new Map<string, unknown[]>();
  for (const { file, feature } of passthrough) byFile.set(file, [...(byFile.get(file) ?? []), feature]);
  for (const [file, extra] of byFile) {
    const present = files[file] === undefined ? [] : (JSON.parse(files[file]) as { features: unknown[] }).features;
    files[file] = formatFeatureCollection([...present, ...extra]);
  }
  return files;
}

/** The campus exactly as it would be saved, read back the way core reads it. Used for checks and routes. */
export function stateToCampus(state: EditState, meta: CampusMeta, passthrough: readonly LoadedFeature[], extras: readonly LoadedFile[]): LoadedCampus {
  const files = Object.entries(stateToFiles(state, meta, passthrough)).map(([path, text]) => ({ path, text }));
  return parseCampus([...files, ...extras]);
}

/** Properties of any Feature by id (for the 속성 tab). */
export type AnyProps = NodeProperties | EdgeProperties | BuildingProperties | RoomProperties;

export function propsOf(state: EditState, id: string): { id: string; props: AnyProps } | undefined {
  const where = findFeature(state, id);
  if (!where) return undefined;
  switch (where.collection) {
    case 'nodes': return { id, props: state.nodes[where.key]!.props };
    case 'edges': return { id, props: state.edges[where.key]!.props };
    case 'buildings': return { id, props: state.buildings[where.key]!.props };
    case 'rooms': return { id, props: state.rooms[where.key]!.props };
  }
}
