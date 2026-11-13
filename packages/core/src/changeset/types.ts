// File changesets (SPEC-v0.2 7.1): Feature-level create / modify / delete, osmChange style.
// The editor's undo keeps using Immer patches; files never store patches.
// Shape is checked by data/schema/changeset.schema.json.
import type { CampoFeature } from '../types.ts';

/** Repo-root folder of the changeset files: changesets/{yyyymmdd}-{slug}.json. */
export const CHANGESETS_DIR = 'changesets';

export const CHANGESET_SOURCES = ['editor', 'macro', 'report'] as const;
export type ChangesetSource = (typeof CHANGESET_SOURCES)[number];

/** A new Feature. `feature.properties.rev` is 1. */
export interface CreateChange {
  op: 'create';
  feature: CampoFeature;
}

/** A changed Feature, saved form (edges as full LineStrings). `feature.properties.rev` is base_rev + 1. */
export interface ModifyChange {
  op: 'modify';
  /** rev of the Feature in the state the changeset was made from. Filled by the engine, never by hand. */
  base_rev: number;
  feature: CampoFeature;
}

export interface DeleteChange {
  op: 'delete';
  base_rev: number;
  id: string;
}

export type Change = CreateChange | ModifyChange | DeleteChange;

export interface Changeset {
  /** "cs-{yyyymmdd}-{slug}", e.g. "cs-20261111-ev1-fix". */
  id: string;
  /** Campus id (campus.json `id`); the CLI applies it to data/campuses/{campus}. */
  campus: string;
  source: ChangesetSource;
  /** Reports this changeset handles. At least one when source is "report", otherwise empty. The bundle's primary comes first. */
  report_ids: string[];
  changes: Change[];
  /** Korean, one line. */
  summary: string;
}

/** Everything of a Changeset except the changes, which historyToChangeset computes. */
export interface ChangesetMeta {
  id: string;
  campus: string;
  source: ChangesetSource;
  /** Default []. */
  report_ids?: readonly string[];
  summary: string;
}

export type ConflictCode = 'rev_mismatch' | 'id_exists' | 'still_referenced';

/** Why a changeset cannot go onto the current data (SPEC-v0.2 7.2). */
export interface ChangesetConflict {
  code: ConflictCode;
  /** The Feature the change is about. */
  id: string;
  /** rev_mismatch: the changeset's base_rev. */
  baseRev?: number;
  /** rev_mismatch: the current rev, or null when the Feature is gone ("없음"). */
  currentRev?: number | null;
  /** still_referenced: Features that still point at `id` after the changeset (sorted). */
  referencedBy?: string[];
  /** Korean. */
  message: string;
}

export type ProblemCode = 'schema' | 'duplicate_change' | 'bad_rev' | 'campus' | 'invariant' | 'endpoint';

/** The changeset itself is malformed (independent of conflicts with the current data). */
export interface ChangesetProblem {
  code: ProblemCode;
  /** Feature id when the problem is about one change. */
  id: string | null;
  /** Korean. */
  message: string;
}
