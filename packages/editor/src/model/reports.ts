// The 제보 tab's model (SPEC-v0.2 7.3): what the queue shows, how a status change reaches a bundle, and how the reports
// applied in this session become one changeset. Pure: the time is always an argument. The edits themselves are core actions
// (planReport / planBundle give them); nothing here touches a Feature.
import {
  QUEUE_STATUSES,
  addOverrides,
  bundleMembers,
  bundleReports,
  buildingById,
  changesetFileName,
  changesetId,
  formatChangeset,
  historyToChangeset,
  isInQueue,
  isReport,
  REPORT_KIND_INFO,
  settleBundle,
  transitionReport,
  type Changeset,
  type EditState,
  type LoadedFile,
  type Override,
  type Report,
  type ReportLocation,
  type ReportPlan,
  type ReportStatus,
} from '@campo/core';
import { floorLabel } from './scope.ts';

/** The editing person's handle in the status log. */
export const REPORT_ACTOR = 'editor';

/** One report file as the dev server sends it. */
export interface ReportFile {
  path: string;
  text: string;
}

export interface LoadedReports {
  /** Reports of this campus, by file. */
  entries: { path: string; report: Report }[];
  /** Files that are not a valid report (named in the tab, never rewritten). */
  unreadable: string[];
}

/** Parse the files; keep the reports of `campusId`. A report of another campus is not an error: it is just not listed. */
export function loadReports(files: readonly ReportFile[], campusId: string): LoadedReports {
  const entries: LoadedReports['entries'] = [];
  const unreadable: string[] = [];
  for (const f of files) {
    let value: unknown;
    try {
      value = JSON.parse(f.text);
    } catch {
      unreadable.push(f.path);
      continue;
    }
    if (!isReport(value)) unreadable.push(f.path);
    else if (value.campus === campusId) entries.push({ path: f.path, report: value });
  }
  return { entries, unreadable };
}

/** One row of the queue: a lone report, or a bundle (primary first). */
export interface QueueGroup {
  /** The primary's id: unique per row. */
  primaryId: string;
  bundleId: string | null;
  /** Primary first, the other members oldest first. Only the ones the list shows. */
  reports: Report[];
}

const byAge = (a: Report, b: Report): number => (Date.parse(a.created_at) - Date.parse(b.created_at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * `view` is bundleReports(...) output (bundle_id / is_primary set). Groups of the queue, oldest first; with `showFinished`
 * the finished reports are listed too. Temporary reports are never in a bundle (core's findBundles), so they are lone rows.
 */
export function queueGroups(view: readonly Report[], showFinished = false): QueueGroup[] {
  const shown = (r: Report) => showFinished || isInQueue(r.status);
  const groups: QueueGroup[] = [];
  const seen = new Set<string>();
  for (const r of [...view].sort(byAge)) {
    if (seen.has(r.id) || !shown(r)) continue;
    if (r.bundle_id === undefined) {
      seen.add(r.id);
      groups.push({ primaryId: r.id, bundleId: null, reports: [r] });
      continue;
    }
    const members = bundleMembers(view, r.bundle_id).filter(shown);
    for (const m of members) seen.add(m.id);
    groups.push({ primaryId: members[0]!.id, bundleId: r.bundle_id, reports: members });
  }
  return groups;
}

/** The number on the tab: reports still in the queue. */
export function queueCount(reports: readonly Report[]): number {
  return reports.filter((r) => QUEUE_STATUSES.includes(r.status)).length;
}

/** "A동 4층", "바깥". */
export function locationText(state: EditState, loc: ReportLocation): string {
  if (loc.building_id === null) return '바깥';
  const name = buildingById(state, loc.building_id)?.props.name ?? loc.building_id;
  return loc.level === null ? name : `${name} ${floorLabel(loc.level)}`;
}

/** Same reports with the bundle ids set by core (existing bundles are kept, `excluded` ones stay out). */
export function bundled(reports: readonly Report[], excluded: readonly string[]): Report[] {
  return bundleReports(reports, new Set(excluded));
}

export type StatusResult = { ok: true; reports: Report[] } | { ok: false; reason: string };

export interface StatusInput {
  at: Date;
  note?: string;
  changeset_id?: string;
  duplicate_of?: string;
}

/** The primary goes to `to` by core's transition table; the bundle's queue members follow it (settleBundle). */
export function setGroupStatus(view: readonly Report[], primaryId: string, to: ReportStatus, input: StatusInput): StatusResult {
  const primary = view.find((r) => r.id === primaryId);
  if (!primary) return { ok: false, reason: '제보를 찾을 수 없습니다.' };
  const moved = transitionReport(primary, to, { by: REPORT_ACTOR, ...input });
  if (!moved.ok) return moved;
  let next = view.map((r) => (r.id === primaryId ? moved.report : r));
  if (primary.bundle_id !== undefined) next = settleBundle(next, primary.bundle_id, to, { by: REPORT_ACTOR, ...input });
  return { ok: true, reports: next };
}

// ---- overrides.json ----

/** Entries of overrides.json as loaded: [] when there is no file, null when it cannot be read (it is then never overwritten). */
export function overridesOf(extras: readonly LoadedFile[]): Override[] | null {
  const file = extras.find((f) => f.path === 'overrides.json');
  if (!file) return [];
  try {
    const parsed: unknown = JSON.parse(file.text);
    return Array.isArray(parsed) ? (parsed as Override[]) : null;
  } catch {
    return null;
  }
}

/** Text of overrides.json after adding the entries queued by the temporary reports (`base` already holds the carried-over entries). */
export function overridesWithQueued(base: readonly Override[], queued: readonly Override[], reportIds: string[] = []): { overrides: Override[]; text: string } {
  const overrides = addOverrides(base, { type: 'override', reportIds, overrides: [...queued], summary: '' });
  return { overrides, text: JSON.stringify(overrides, null, 2) + '\n' };
}

// ---- the changeset of this session ----

/** A permanent report (or bundle) applied in this session and waiting for 저장. */
export interface PendingEdit {
  /** Primary first. */
  reportIds: string[];
  /** Features the plan changed (to highlight, and to notice an undo). */
  featureIds: string[];
}

export interface ChangesetBuild {
  /** null when there is nothing to write (no pending report, or the pending ones were undone). */
  changeset: Changeset | null;
  fileName: string | null;
  text: string | null;
  /** The pending edits that went into the changeset, and the ones that did not (undone: their Features are as at the start). */
  kept: PendingEdit[];
  dropped: PendingEdit[];
}

/** yyyymmdd of the local day. */
export function dayOf(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`;
}

function summaryOf(reports: readonly Report[], ids: readonly string[]): string {
  const kinds = [...new Set(ids.map((id) => reports.find((r) => r.id === id)?.kind).filter((k): k is Report['kind'] => k !== undefined))];
  return `제보 ${ids.length}건 처리: ${kinds.map((k) => REPORT_KIND_INFO[k].label).join(', ')}`;
}

/**
 * The changeset for the reports applied since `base`: the Feature-level difference between `base` and `current`
 * (historyToChangeset; neighbour edges and base_rev are the engine's). A pending edit whose Features are not in the
 * difference was undone: it is left out and its reports stay in the queue. Without a change nothing is written.
 */
export function buildReportChangeset(args: {
  base: EditState;
  current: EditState;
  campus: string;
  pending: readonly PendingEdit[];
  reports: readonly Report[];
  now: Date;
}): ChangesetBuild {
  const { base, current, campus, pending, reports, now } = args;
  const none: ChangesetBuild = { changeset: null, fileName: null, text: null, kept: [], dropped: [...pending] };
  if (pending.length === 0) return none;

  const diff = historyToChangeset(base, current, { id: 'cs-00000000-x', campus, source: 'editor', summary: '' });
  const changed = new Set(diff.changes.map((c) => (c.op === 'delete' ? c.id : c.feature.id as string)));
  const kept = pending.filter((p) => p.featureIds.some((id) => changed.has(id)));
  const dropped = pending.filter((p) => !kept.includes(p));
  if (kept.length === 0 || diff.changes.length === 0) return { ...none, dropped: [...pending] };

  const reportIds = kept.flatMap((p) => p.reportIds);
  const slug = reportIds.length === 1 ? reportIds[0]! : `${reportIds[0]!}-and-${reportIds.length - 1}-more`;
  const changeset = historyToChangeset(base, current, {
    id: changesetId(dayOf(now), slug),
    campus,
    source: 'report',
    report_ids: reportIds,
    summary: summaryOf(reports, reportIds),
  });
  return { changeset, fileName: changesetFileName(changeset.id), text: formatChangeset(changeset), kept, dropped };
}

/** After the changeset is written: each applied bundle (or lone report) becomes `applied` with the changeset id. */
export function markApplied(view: readonly Report[], kept: readonly PendingEdit[], changesetIdValue: string, at: Date): StatusResult {
  let next = [...view];
  for (const p of kept) {
    const r = setGroupStatus(next, p.reportIds[0]!, 'applied', { at, changeset_id: changesetIdValue });
    if (!r.ok) return r;
    next = r.reports;
  }
  return { ok: true, reports: next };
}

/** What 저장 sends for the reports: the files whose status log grew since they were loaded. */
export function changedReportFiles(entries: readonly { path: string; report: Report }[], current: readonly Report[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) {
    const now = current.find((r) => r.id === e.report.id);
    if (now && now.status_log.length !== e.report.status_log.length) out[e.path] = JSON.stringify(now, null, 2) + '\n';
  }
  return out;
}

/** Korean text for a plan that is not an edit or an override: why, so the person can choose a status. */
export function planStatusSuggestion(plan: ReportPlan): { to: ReportStatus; label: string } | null {
  switch (plan.type) {
    case 'duplicate': return { to: 'duplicate', label: '중복으로 처리' };
    case 'already_fixed': return { to: 'already_fixed', label: '이미 맞음으로 처리' };
    case 'expired': return { to: 'expired', label: '만료로 처리' };
    default: return null;
  }
}
