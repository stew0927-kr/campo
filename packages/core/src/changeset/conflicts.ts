// Checking a changeset against the current data (SPEC-v0.2 7.2). Every conflict is collected, never just the first.
import distance from '@turf/distance';
import { produce } from 'immer';
import type { CampoFeature, Position } from '../types.ts';
import { ENDPOINT_TOLERANCE_M } from '../validate.ts';
import { newViolations } from '../edit/invariants.ts';
import { buildingById, clone, deepEqual, edgesAt, findFeature, type EditState } from '../edit/state.ts';
import { sameFeature } from './diff.ts';
import type { Change, Changeset, ChangesetConflict, ChangesetProblem } from './types.ts';

export function changeIdOf(change: Change): string {
  return change.op === 'delete' ? change.id : change.feature.id;
}

/** The saved Feature for `id`, or undefined (also for an edge whose end node is missing). */
export function featureOf(state: EditState, id: string): CampoFeature | undefined {
  const where = findFeature(state, id);
  if (!where) return undefined;
  switch (where.collection) {
    case 'buildings': {
      const b = state.buildings[where.key]!;
      return { type: 'Feature', id: b.id, geometry: { type: 'Polygon', coordinates: clone(b.polygon) }, properties: clone(b.props) };
    }
    case 'nodes': {
      const n = state.nodes[id]!;
      return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [n.coord[0], n.coord[1]] }, properties: clone(n.props) };
    }
    case 'rooms': {
      const r = state.rooms[id]!;
      return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: clone(r.polygon) }, properties: clone(r.props) };
    }
    case 'edges': {
      const e = state.edges[id]!;
      const from = state.nodes[e.props.from];
      const to = state.nodes[e.props.to];
      if (!from || !to) return undefined;
      const coordinates = [from.coord, ...e.vertices, to.coord].map((p) => [p[0], p[1]] as Position);
      return { type: 'Feature', id, geometry: { type: 'LineString', coordinates }, properties: clone(e.props) };
    }
  }
}

function revOf(state: EditState, id: string): number | null {
  const f = featureOf(state, id);
  if (f) return f.properties.rev;
  const where = findFeature(state, id);
  if (!where) return null;
  return (state[where.collection] as Record<string, { props: { rev: number } }>)[where.key]!.props.rev;
}

/** Problems of the changeset on its own: one change per Feature, create rev 1, modify rev = base_rev + 1. */
export function changesetProblems(cs: Changeset): ChangesetProblem[] {
  const out: ChangesetProblem[] = [];
  const seen = new Set<string>();
  for (const c of cs.changes) {
    const id = changeIdOf(c);
    if (seen.has(id)) out.push({ code: 'duplicate_change', id, message: `"${id}"을(를) 바꾸는 항목이 둘 이상입니다. Feature 하나에 항목 하나만 둘 수 있습니다.` });
    seen.add(id);
    if (c.op === 'create' && c.feature.properties.rev !== 1) {
      out.push({ code: 'bad_rev', id, message: `새로 만드는 "${id}"의 rev가 ${c.feature.properties.rev}입니다. create의 rev는 1이어야 합니다.` });
    }
    if (c.op === 'modify' && c.feature.properties.rev !== c.base_rev + 1) {
      out.push({ code: 'bad_rev', id, message: `"${id}"의 rev가 ${c.feature.properties.rev}입니다. modify의 rev는 base_rev + 1(${c.base_rev + 1})이어야 합니다.` });
    }
  }
  return out;
}

/**
 * Conflicts of `cs` with `state` (SPEC-v0.2 7.2), all of them, in change order:
 * - rev_mismatch: a modify / delete target's rev is not base_rev, or the target is gone ("없음"),
 * - id_exists: a create id is taken,
 * - still_referenced: a deleted node or building is still pointed at by a Feature the changeset keeps or writes.
 */
export function changesetConflicts(state: EditState, cs: Changeset): ChangesetConflict[] {
  const out: ChangesetConflict[] = [];
  for (const c of cs.changes) {
    const id = changeIdOf(c);
    if (c.op === 'create') {
      if (findFeature(state, id)) out.push({ code: 'id_exists', id, message: `만들려는 id "${id}"이(가) 이미 있습니다.` });
      continue;
    }
    const current = revOf(state, id);
    if (current !== c.base_rev) {
      const now = current === null ? '없음' : `rev ${current}`;
      out.push({ code: 'rev_mismatch', id, baseRev: c.base_rev, currentRev: current, message: `"${id}": 기준 rev ${c.base_rev}, 현재 ${now}.` });
    }
  }

  const after = writeChangesTo(state, cs);
  for (const c of cs.changes) {
    if (c.op !== 'delete') continue;
    const refs = referencesTo(state, after, c.id);
    if (refs.length > 0) {
      out.push({ code: 'still_referenced', id: c.id, referencedBy: refs, message: `지우려는 "${c.id}"을(를) ${refs.join(', ')}이(가) 아직 가리킵니다.` });
    }
  }
  return out;
}

/** Features in `after` that point at `id` (as an edge end, a building, or a bridge end). `before` says what `id` was. */
function referencesTo(before: EditState, after: EditState, id: string): string[] {
  const refs = new Set<string>();
  if (id in before.nodes) {
    for (const e of edgesAt(after, id)) refs.add(e.id);
  } else if (buildingById(before, id)) {
    for (const n of Object.values(after.nodes)) if (n.props.building_id === id) refs.add(n.id);
    for (const r of Object.values(after.rooms)) if (r.props.building_id === id) refs.add(r.id);
    for (const e of Object.values(after.edges)) if (e.props.building_from === id || e.props.building_to === id) refs.add(e.id);
  }
  return [...refs].sort();
}

/**
 * Problems that show only once the changes are written: an invariant (I1, I3–I5) the changeset breaks, a written edge whose
 * line ends are more than ENDPOINT_TOLERANCE_M off its nodes, or a kept edge whose saved ends move because a node moved
 * and the edge is not in the changeset (the changeset must modify it too, SPEC-v0.2 7.1).
 */
export function changesetResultProblems(state: EditState, cs: Changeset): ChangesetProblem[] {
  const after = writeChangesTo(state, cs);
  const out: ChangesetProblem[] = [];
  for (const v of newViolations(state, after, ['I1', 'I3', 'I4', 'I5'])) {
    out.push({ code: 'invariant', id: v.ids[0] ?? null, message: v.message });
  }
  const written = new Set(cs.changes.map(changeIdOf));
  for (const c of cs.changes) {
    if (c.op === 'delete' || c.feature.properties.kind !== 'edge' || c.feature.geometry.type !== 'LineString') continue;
    const coords = c.feature.geometry.coordinates;
    const from = after.nodes[c.feature.properties.from];
    const to = after.nodes[c.feature.properties.to];
    if (!from || !to || coords.length < 2) continue;
    const off = [distance(coords[0]!, from.coord, { units: 'meters' }), distance(coords[coords.length - 1]!, to.coord, { units: 'meters' })];
    if (off.some((d) => d > ENDPOINT_TOLERANCE_M)) {
      out.push({ code: 'endpoint', id: c.feature.id, message: `구간 "${c.feature.id}"의 끝 좌표가 from / to 지점과 ${ENDPOINT_TOLERANCE_M}m 넘게 다릅니다.` });
    }
  }
  for (const e of Object.values(after.edges)) {
    if (written.has(e.id) || !(e.id in state.edges)) continue;
    const was = featureOf(state, e.id);
    const now = featureOf(after, e.id);
    if (was && now && !deepEqual(was.geometry, now.geometry)) {
      out.push({ code: 'endpoint', id: e.id, message: `지점이 옮겨져 구간 "${e.id}"의 끝 좌표가 바뀌는데, 이 구간이 changeset에 modify로 들어 있지 않습니다.` });
    }
  }
  return out;
}

/**
 * True when `state` already holds every change of `cs` exactly: each created and modified Feature is there with the
 * same content and rev, and each deleted one is gone. Applying such a changeset again is refused as "이미 적용됨".
 */
export function isAlreadyApplied(state: EditState, cs: Changeset): boolean {
  if (cs.changes.length === 0) return false;
  return cs.changes.every((c) => {
    if (c.op === 'delete') return findFeature(state, c.id) === undefined;
    const now = featureOf(state, c.feature.id);
    return now !== undefined && sameFeature(now, c.feature) && now.properties.rev === c.feature.properties.rev;
  });
}

export interface ChangesetCheck {
  problems: ChangesetProblem[];
  conflicts: ChangesetConflict[];
  alreadyApplied: boolean;
  /** No problems and no conflicts: applyChangeset(cs) can run. */
  ok: boolean;
}

/** Everything the CLI and the editor need before applying: problems, conflicts, and whether it is already applied. */
export function checkChangeset(state: EditState, cs: Changeset): ChangesetCheck {
  const problems = changesetProblems(cs);
  const conflicts = changesetConflicts(state, cs);
  const alreadyApplied = isAlreadyApplied(state, cs);
  if (problems.length === 0 && conflicts.length === 0) problems.push(...changesetResultProblems(state, cs));
  return { problems, conflicts, alreadyApplied, ok: problems.length === 0 && conflicts.length === 0 };
}

/** `state` with the changes written, no checks. */
export function writeChangesTo(state: EditState, cs: Changeset): EditState {
  return produce(state, (draft) => {
    writeChanges(draft as EditState, cs);
  });
}

/** Write the changes into a draft (or a fresh object). Features are copied, so the changeset object is never shared. */
export function writeChanges(draft: EditState, cs: Changeset): void {
  for (const c of cs.changes) {
    const id = changeIdOf(c);
    const where = findFeature(draft, id);
    if (where) delete (draft[where.collection] as Record<string, unknown>)[where.key];
    if (c.op === 'delete') continue;
    const f = clone(c.feature);
    switch (f.properties.kind) {
      case 'building':
        draft.buildings[f.properties.code] = { id: f.id, polygon: f.geometry.coordinates as Position[][], props: f.properties };
        break;
      case 'node':
        draft.nodes[f.id] = { id: f.id, coord: f.geometry.coordinates as Position, props: f.properties };
        break;
      case 'room':
        draft.rooms[f.id] = { id: f.id, polygon: f.geometry.coordinates as Position[][], props: f.properties };
        break;
      case 'edge': {
        const coords = f.geometry.coordinates as Position[];
        draft.edges[f.id] = { id: f.id, vertices: coords.slice(1, -1), props: f.properties };
        break;
      }
    }
  }
}
