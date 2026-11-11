// v0.1 → v0.2 data migration (docs/v0.2/SPEC-v0.2.md §2).
//
// Pure: takes the files of one campus folder as text and returns the files that change.
// Running it again on its own output changes nothing. It converts the data format; it does
// not go through packages/core/src/edit because it must also read data that does not pass
// validation yet. Elevator groups follow elevator edges only; floor numbers are not used.
import { CAMPUS_META_FILE } from './load.ts';
import { formatFeatureCollection, formatMeta } from './format.ts';
import { SCHEMA_VERSION, type LoadedFile } from './types.ts';

export interface MigrateSummary {
  /** Walkable edges that were false without a site check: now null (not known). Ramps included (audit R19). */
  stepFreeToNull: number;
  /** Elevator edges that were false or null: now true. */
  elevatorEdgeStepFreeTrue: number;
  /** Edges that had no step_free at all and got the v0.2 default. */
  stepFreeFilled: number;
  /** Elevator stops that took their elevator_id from an existing shaft_id. */
  elevatorIdFromShaft: number;
  /** Elevator stops that got a new elevator_id. */
  elevatorIdGenerated: number;
  /** Nodes whose shaft_id was removed (elevator stops are counted here too). */
  shaftIdRemoved: number;
  /** Features that got rev: 1. */
  revAdded: number;
  /** campus.json got schema_version. */
  schemaVersionSet: number;
}

export interface MigrateProblem {
  code: 'bad-file' | 'unknown-version' | 'mixed-shaft' | 'too-many-elevators';
  message: string;
  /** For mixed-shaft: every stop of the group with the value it carries. */
  nodes?: { id: string; shaft_id: string | null; elevator_id: string | null }[];
}

export interface MigrateResult {
  /** Only the files whose text changes. Empty when `problems` is not. */
  files: LoadedFile[];
  summary: MigrateSummary;
  /** Anything here means: stop and write nothing. */
  problems: MigrateProblem[];
  /** Worth a look, but the migration went through. */
  warnings: string[];
}

// The migration reads unvalidated JSON, so loose types are the honest ones here.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const emptySummary = (): MigrateSummary => ({
  stepFreeToNull: 0,
  elevatorEdgeStepFreeTrue: 0,
  stepFreeFilled: 0,
  elevatorIdFromShaft: 0,
  elevatorIdGenerated: 0,
  shaftIdRemoved: 0,
  revAdded: 0,
  schemaVersionSet: 0,
});

const isFieldSurvey = (source: unknown): boolean => typeof source === 'string' && source.startsWith('field-survey-');

export function migrateCampusFiles(files: readonly LoadedFile[]): MigrateResult {
  const summary = emptySummary();
  const problems: MigrateProblem[] = [];
  const warnings: string[] = [];
  const fail = (): MigrateResult => ({ files: [], summary: emptySummary(), problems, warnings });

  // ---- Read ----
  let meta: Json;
  let metaText = '';
  const collections: { path: string; text: string; features: Json[] }[] = [];
  for (const { path, text } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (path !== CAMPUS_META_FILE && !path.endsWith('.geojson')) continue; // overrides.json etc. stay as they are
    let json: Json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      problems.push({ code: 'bad-file', message: `${path}: JSON으로 읽을 수 없습니다: ${(err as Error).message}` });
      continue;
    }
    if (path === CAMPUS_META_FILE) {
      meta = json;
      metaText = text;
    } else if (json?.type === 'FeatureCollection' && Array.isArray(json.features)) {
      collections.push({ path, text, features: json.features });
    } else {
      problems.push({ code: 'bad-file', message: `${path}: GeoJSON FeatureCollection이 아닙니다.` });
    }
  }
  if (meta === undefined && problems.length === 0) {
    problems.push({ code: 'bad-file', message: `${CAMPUS_META_FILE} 파일이 없습니다.` });
  }
  if (meta !== undefined && (typeof meta !== 'object' || meta === null || Array.isArray(meta))) {
    problems.push({ code: 'bad-file', message: `${CAMPUS_META_FILE}: 객체가 아닙니다.` });
  }
  const version = meta?.schema_version;
  if (version !== undefined && version !== '0.1' && version !== SCHEMA_VERSION) {
    problems.push({ code: 'unknown-version', message: `${CAMPUS_META_FILE}: 알 수 없는 schema_version "${String(version)}"입니다.` });
  }
  if (problems.length > 0) return fail();

  const features: Json[] = collections.flatMap((c) => c.features).filter((f) => typeof f === 'object' && f !== null && typeof f.properties === 'object' && f.properties !== null);
  const kindOf = (f: Json): unknown => f.properties.kind;
  const nodes = new Map<string, Json>(features.filter((f) => kindOf(f) === 'node' && typeof f.id === 'string').map((f) => [f.id, f]));
  const edges = features.filter((f) => kindOf(f) === 'edge');
  const buildings = new Map<string, Json>(features.filter((f) => kindOf(f) === 'building').map((f) => [f.id, f]));

  // ---- step_free (SPEC-v0.2 §2.1; ramps and elevators: audit R19) ----
  for (const edge of edges) {
    const p = edge.properties;
    if (p.highway === 'elevator') {
      // Default true. Only a site check that found "not step-free" keeps false.
      if (p.step_free !== true && !(p.step_free === false && isFieldSurvey(p.source))) {
        p.step_free = true;
        summary.elevatorEdgeStepFreeTrue++;
      }
    } else if (p.step_free === undefined) {
      p.step_free = p.highway === 'steps' ? false : null;
      summary.stepFreeFilled++;
    } else if (p.step_free === false && p.highway !== 'steps' && !isFieldSurvey(p.source)) {
      p.step_free = null;
      summary.stepFreeToNull++;
    }
  }

  // ---- elevator_id (SPEC-v0.2 §2.2): group stops by elevator edges, never by level ----
  const stops = [...nodes.values()].filter((n) => n.properties.node_type === 'elevator_stop');
  const parent = new Map<string, string>(stops.map((n) => [n.id, n.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let cur = id; cur !== root;) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const edge of edges) {
    const { highway, from, to } = edge.properties;
    if (highway === 'elevator' && parent.has(from) && parent.has(to)) parent.set(find(from), find(to));
  }
  const byRoot = new Map<string, Json[]>();
  for (const stop of [...stops].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const root = find(stop.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), stop]);
  }
  const groups = [...byRoot.values()].sort((a, b) => (a[0].id < b[0].id ? -1 : 1));

  const valueOf = (n: Json): string | undefined => {
    const v = n.properties.elevator_id ?? n.properties.shaft_id;
    return typeof v === 'string' && v !== '' ? v : undefined;
  };
  const reserved = new Set<string>();
  for (const n of nodes.values()) {
    for (const key of ['elevator_id', 'shaft_id']) {
      const v = n.properties[key];
      if (typeof v === 'string') reserved.add(v);
    }
  }

  const assigned = new Map<string, string>(); // stop id → elevator_id
  const groupsPerId = new Map<string, number>();
  for (const group of groups) {
    const values = [...new Set(group.map(valueOf).filter((v): v is string => v !== undefined))];
    if (values.length > 1) {
      problems.push({
        code: 'mixed-shaft',
        message: `엘리베이터 구간으로 이어진 정차 지점 ${group.length}개에 서로 다른 shaft_id/elevator_id가 섞여 있습니다: ${values.join(', ')}`,
        nodes: group.map((n: Json) => ({ id: n.id, shaft_id: n.properties.shaft_id ?? null, elevator_id: n.properties.elevator_id ?? null })),
      });
      continue;
    }
    let id = values[0];
    if (id === undefined) {
      const building = buildings.get(group[0].properties.building_id);
      const code = String(building?.properties.code ?? String(group[0].properties.building_id).replace(/^bldg_/, ''));
      const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !reserved.has(`${code}_elev${l}`));
      if (letter === undefined) {
        problems.push({ code: 'too-many-elevators', message: `건물 ${code}의 엘리베이터 id를 A~Z로 채울 수 없습니다.` });
        continue;
      }
      id = `${code}_elev${letter}`;
      reserved.add(id);
    }
    groupsPerId.set(id, (groupsPerId.get(id) ?? 0) + 1);
    for (const n of group) assigned.set(n.id, id);
  }
  if (problems.length > 0) return fail();
  for (const [id, count] of groupsPerId) {
    if (count > 1) warnings.push(`elevator_id "${id}"가 엘리베이터 구간으로 이어지지 않은 정차 지점 묶음 ${count}곳에 있습니다.`);
  }

  for (const n of nodes.values()) {
    const p = n.properties;
    const id = assigned.get(n.id);
    if (id === undefined && p.shaft_id === undefined) continue;
    if (id === undefined) warnings.push(`지점 "${n.id}"는 정차 지점이 아니어서 shaft_id "${String(p.shaft_id)}"만 지웠습니다.`);
    if (id !== undefined) {
      if (p.elevator_id === undefined && p.shaft_id !== undefined) summary.elevatorIdFromShaft++;
      else if (p.elevator_id === undefined) summary.elevatorIdGenerated++;
    }
    const entries: [string, unknown][] = [];
    let placed = false;
    for (const [k, v] of Object.entries(p)) {
      if ((k === 'shaft_id' || k === 'elevator_id') && id !== undefined) {
        if (!placed) entries.push(['elevator_id', id]);
        placed = true;
      } else if (k !== 'shaft_id') {
        entries.push([k, v]);
      }
    }
    if (id !== undefined && !placed) entries.push(['elevator_id', id]);
    if (p.shaft_id !== undefined) summary.shaftIdRemoved++;
    n.properties = Object.fromEntries(entries);
  }

  // ---- rev (SPEC-v0.2 §2.5) ----
  for (const f of features) {
    if (f.properties.rev === undefined) {
      f.properties.rev = 1;
      summary.revAdded++;
    }
  }

  // ---- campus.json ----
  let newMeta = meta;
  if (version !== SCHEMA_VERSION) {
    const { id, schema_version: _old, ...rest } = meta;
    newMeta = { id, schema_version: SCHEMA_VERSION, ...rest };
    summary.schemaVersionSet = 1;
  }

  // ---- Write back only what changed ----
  const out: LoadedFile[] = [];
  const metaOut = formatMeta(newMeta);
  if (metaOut !== metaText) out.push({ path: CAMPUS_META_FILE, text: metaOut });
  for (const c of collections) {
    const text = formatFeatureCollection(c.features);
    if (text !== c.text) out.push({ path: c.path, text });
  }
  return { files: out, summary, problems, warnings };
}
