// User reports (SPEC-v0.2 7.3). v0.2 reads fake reports from data/reports/**/*.json; later they come from Supabase in the
// same shape. Shape is checked by data/schema/report.schema.json. A report carries no field for who sent it
// (no user id, device id, name or contact).
import type { Position, RestroomGender, Wheelchair } from '../types.ts';

/** Fake reports for development: data/reports/sample/*.json. */
export const SAMPLE_REPORTS_DIR = 'data/reports/sample';

export const REPORT_KINDS = [
  'elevator_out',
  'door_locked',
  'construction',
  'stairs_unmarked',
  'wrong_room_location',
  'new_restroom',
  'step_free_confirmed',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_STATUSES = [
  'new',
  'triaged',
  'skipped',
  'needs_survey',
  'applied',
  'already_fixed',
  'rejected',
  'duplicate',
  'expired',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Statuses that stay in the 제보 tab queue (SPEC-v0.2 7.3 table). */
export const QUEUE_STATUSES: readonly ReportStatus[] = ['new', 'triaged', 'skipped', 'needs_survey'];
/** Finished statuses: they change only through an explicit reopen (back to new). */
export const FINISHED_STATUSES: readonly ReportStatus[] = ['applied', 'already_fixed', 'rejected', 'duplicate', 'expired'];

/**
 * Allowed status changes (SPEC-v0.2 7.3), a change to the same status is never allowed:
 * - new: to any other status,
 * - skipped / needs_survey: to applied, already_fixed, rejected, skipped, needs_survey,
 * - triaged: like skipped / needs_survey, plus duplicate (the table does not list triaged; this is the choice made here),
 * - finished statuses: only to new (reopen).
 * Two changes outside the table go through their own functions: applied → expired for temporary kinds (expireReports)
 * and any queue status → new when a report leaves its bundle (removeFromBundle).
 */
export const STATUS_TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> = {
  new: ['triaged', 'skipped', 'needs_survey', 'applied', 'already_fixed', 'rejected', 'duplicate', 'expired'],
  triaged: ['skipped', 'needs_survey', 'applied', 'already_fixed', 'rejected', 'duplicate'],
  skipped: ['needs_survey', 'applied', 'already_fixed', 'rejected'],
  needs_survey: ['skipped', 'applied', 'already_fixed', 'rejected'],
  applied: ['new'],
  already_fixed: ['new'],
  rejected: ['new'],
  duplicate: ['new'],
  expired: ['new'],
};

export interface ReportLocation {
  coord: Position;
  /** null outdoors. */
  building_id: string | null;
  /** null outdoors. */
  level: number | null;
}

/** Kind-specific answers from the report form. */
export interface ReportDetails {
  /** wrong_room_location: the room whose door is drawn in the wrong place. */
  room_ref?: string;
  /** new_restroom */
  restroom_gender?: RestroomGender;
  /** new_restroom. The plan never writes "yes" from a report alone (needs a check on site, SPEC-v0.2 2.3). */
  wheelchair?: Wheelchair;
  /** new_restroom */
  changing_table?: boolean | null;
  /** stairs_unmarked */
  step_count?: number;
}

/** One entry of the status log: who changed the status, when, and for applied the PR (or changeset) that holds the change. */
export interface StatusChange {
  /** null for the first entry (the report coming in). */
  from: ReportStatus | null;
  to: ReportStatus;
  /** The editing team member's handle, or "app" / "system". Never the reporter. */
  by: string;
  /** ISO 8601 date-time with a time zone. */
  at: string;
  note?: string;
  /** applied: the pull request with the changeset or overrides.json change. */
  pr_url?: string;
  /** applied: the changeset file's id. */
  changeset_id?: string;
}

export interface Report {
  /** "rp-{yyyymmdd}-{n}" */
  id: string;
  /** Campus id (campus.json id). */
  campus: string;
  kind: ReportKind;
  status: ReportStatus;
  /** ISO 8601 date-time with a time zone. */
  created_at: string;
  location: ReportLocation;
  /** The Feature the report is about, when known (picked in the app, or by the editor while triaging). */
  feature_id?: string;
  description?: string;
  photos?: string[];
  /** Temporary kinds: when the state should end. Without it the plan uses the kind's default duration. */
  until?: string;
  details?: ReportDetails;
  /** Reports bundled together share this; the primary (is_primary) is handled and the rest follow it. */
  bundle_id?: string;
  is_primary?: boolean;
  /** status duplicate: the report this one was merged into. */
  duplicate_of?: string;
  /** Oldest first. The last entry's `to` is `status`. */
  status_log: StatusChange[];
}

/** Who and when, for a status change. The time is always passed in. */
export interface ChangeBy {
  by: string;
  at: Date;
  note?: string;
}
