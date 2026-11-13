// Edit state -> changeset file (SPEC-v0.2 7.1). The changes come from comparing two states Feature by Feature, not from
// reading Immer patches: neighbour edges whose end coordinates moved show up on their own, and a Feature edited and
// then put back is not a change.
import type { CampoFeature } from '../types.ts';
import { toFeatures } from '../edit/convert.ts';
import { deepEqual, type EditState } from '../edit/state.ts';
import type { Change, Changeset, ChangesetMeta, CreateChange, DeleteChange, ModifyChange } from './types.ts';

/** Saved Features of a state by id. */
export function featuresById(state: EditState): Map<string, CampoFeature> {
  return new Map(toFeatures(state).map((f) => [f.id, f]));
}

/** Same saved content, rev not counted. */
export function sameFeature(a: CampoFeature, b: CampoFeature): boolean {
  return deepEqual(withoutRev(a), withoutRev(b));
}

function withoutRev(f: CampoFeature): unknown {
  const { rev: _rev, ...props } = f.properties as unknown as Record<string, unknown>;
  return { ...f, properties: props };
}

function withRev(f: CampoFeature, rev: number): CampoFeature {
  return { ...f, properties: { ...f.properties, rev } } as CampoFeature;
}

/**
 * The changes from `base` (History.base(): the loaded or last saved state) to `current`:
 * - a Feature only in `current` is `create` with rev 1,
 * - a Feature whose saved form differs is `modify` with base_rev = its rev in `base` and rev = base_rev + 1,
 * - a Feature only in `base` is `delete` with its base rev.
 * Edges are compared in saved form (end coordinates included), so moving a node also modifies its edges.
 * Order: creates, modifies, deletes, each by id. `changes` is empty when nothing differs (do not write such a file).
 * Throws when `meta.source` is "report" without report ids, or has report ids otherwise.
 */
export function historyToChangeset(base: EditState, current: EditState, meta: ChangesetMeta): Changeset {
  const reportIds = [...(meta.report_ids ?? [])];
  if (meta.source === 'report' && reportIds.length === 0) throw new Error('historyToChangeset: source "report" needs at least one report id');
  if (meta.source !== 'report' && reportIds.length > 0) throw new Error(`historyToChangeset: report_ids must be empty when source is "${meta.source}"`);

  const before = featuresById(base);
  const after = featuresById(current);
  const creates: CreateChange[] = [];
  const modifies: ModifyChange[] = [];
  const deletes: DeleteChange[] = [];
  for (const id of [...after.keys()].sort()) {
    const now = after.get(id)!;
    const was = before.get(id);
    if (!was) creates.push({ op: 'create', feature: withRev(now, 1) });
    else if (!sameFeature(was, now)) {
      const baseRev = was.properties.rev;
      modifies.push({ op: 'modify', base_rev: baseRev, feature: withRev(now, baseRev + 1) });
    }
  }
  for (const id of [...before.keys()].sort()) {
    if (!after.has(id)) deletes.push({ op: 'delete', base_rev: before.get(id)!.properties.rev, id });
  }
  const changes: Change[] = [...creates, ...modifies, ...deletes];
  return { id: meta.id, campus: meta.campus, source: meta.source, report_ids: reportIds, changes, summary: meta.summary };
}

const ID_PATTERN = /^cs-(\d{8})-([a-z0-9][a-z0-9-]*)$/;

/** "cs-{yyyymmdd}-{slug}". `day` is yyyymmdd; the slug is lowercased and anything but a-z, 0-9 becomes "-". */
export function changesetId(day: string, slug: string): string {
  if (!/^\d{8}$/.test(day)) throw new Error(`changesetId: day must be yyyymmdd, got "${day}"`);
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (clean === '') throw new Error('changesetId: the slug has no letters or digits');
  return `cs-${day}-${clean}`;
}

/** File name under changesets/: "cs-20261111-ev1-fix" -> "20261111-ev1-fix.json". */
export function changesetFileName(id: string): string {
  const m = ID_PATTERN.exec(id);
  if (!m) throw new Error(`changesetFileName: "${id}" is not cs-{yyyymmdd}-{slug}`);
  return `${m[1]}-${m[2]}.json`;
}

/** Changeset file text: two-space indent, one change per line (so a git diff shows one line per Feature), LF, trailing newline. */
export function formatChangeset(cs: Changeset): string {
  const head = [
    `  "id": ${JSON.stringify(cs.id)}`,
    `  "campus": ${JSON.stringify(cs.campus)}`,
    `  "source": ${JSON.stringify(cs.source)}`,
    `  "report_ids": ${JSON.stringify(cs.report_ids)}`,
  ];
  const changes = cs.changes.length === 0 ? '  "changes": []' : `  "changes": [\n${cs.changes.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`;
  return `{\n${[...head, changes, `  "summary": ${JSON.stringify(cs.summary)}`].join(',\n')}\n}\n`;
}
