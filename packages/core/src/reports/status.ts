// Report status changes (SPEC-v0.2 7.3). Pure: every function returns a new report and takes the time as an argument.
import type { Override } from '../types.ts';
import { isTemporaryKind } from './kinds.ts';
import {
  FINISHED_STATUSES,
  QUEUE_STATUSES,
  STATUS_TRANSITIONS,
  type ChangeBy,
  type Report,
  type ReportStatus,
  type StatusChange,
} from './types.ts';

export const STATUS_LABELS: Readonly<Record<ReportStatus, string>> = {
  new: '새 제보',
  triaged: '분류 완료',
  skipped: '나중에 보기',
  needs_survey: '현장 확인 필요',
  applied: '반영됨',
  already_fixed: '이미 맞음',
  rejected: '반려',
  duplicate: '중복',
  expired: '만료',
};

export function isInQueue(status: ReportStatus): boolean {
  return QUEUE_STATUSES.includes(status);
}

export function isFinished(status: ReportStatus): boolean {
  return FINISHED_STATUSES.includes(status);
}

/** Whether the table allows `from` → `to` (never the same status). */
export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return from !== to && STATUS_TRANSITIONS[from].includes(to);
}

export interface TransitionInput extends ChangeBy {
  /** applied: the pull request. */
  pr_url?: string;
  /** applied: the changeset file's id. */
  changeset_id?: string;
  /** duplicate: the report this one is merged into. */
  duplicate_of?: string;
}

export type TransitionResult = { ok: true; report: Report } | { ok: false; reason: string };

/**
 * Change the status and log who and when. Refused (with a Korean reason) when the table does not allow it, and for
 * applied on a permanent kind without a PR link or changeset id (temporary kinds go to overrides.json; the PR link
 * can be added later with attachPrUrl).
 */
export function transitionReport(report: Report, to: ReportStatus, input: TransitionInput): TransitionResult {
  const from = report.status;
  if (from === to) return { ok: false, reason: `이미 "${STATUS_LABELS[to]}" 상태입니다.` };
  if (!canTransition(from, to)) {
    const hint = isFinished(from) ? ' 끝난 제보는 먼저 "다시 열기"로 새 제보로 돌려 주세요.' : '';
    return { ok: false, reason: `"${STATUS_LABELS[from]}"에서 "${STATUS_LABELS[to]}"(으)로 바꿀 수 없습니다.${hint}` };
  }
  if (to === 'applied' && !isTemporaryKind(report.kind) && input.pr_url === undefined && input.changeset_id === undefined) {
    return { ok: false, reason: '반영됨으로 바꿀 때는 PR 링크(pr_url)나 changeset id를 함께 남겨 주세요.' };
  }
  return { ok: true, report: withStatus(report, to, input) };
}

/** Reopen a finished report: back to new (the only way out of a finished status). */
export function reopenReport(report: Report, input: ChangeBy): TransitionResult {
  if (!isFinished(report.status)) return { ok: false, reason: '끝난 제보만 다시 열 수 있습니다.' };
  return transitionReport(report, 'new', input);
}

/** Put the PR link on the latest applied entry of the log (the PR is often opened after the status change). */
export function attachPrUrl(report: Report, prUrl: string): TransitionResult {
  const i = report.status_log.map((e) => e.to).lastIndexOf('applied');
  if (report.status !== 'applied' || i < 0) return { ok: false, reason: '반영됨 상태인 제보에만 PR 링크를 붙일 수 있습니다.' };
  const log = report.status_log.map((e, j) => (j === i ? { ...e, pr_url: prUrl } : e));
  return { ok: true, report: { ...report, status_log: log } };
}

/**
 * applied temporary reports whose overrides have all run out at `now` (until <= now) become expired, logged as `by`
 * (default "system"). Without an override entry the report's own `until` decides. Other reports come back unchanged.
 */
export function expireReports(reports: readonly Report[], overrides: readonly Override[], now: Date, by = 'system'): Report[] {
  const t = now.getTime();
  return reports.map((r) => {
    if (r.status !== 'applied' || !isTemporaryKind(r.kind)) return r;
    const mine = overrides.filter((o) => o.report_id === r.id).map((o) => Date.parse(o.until));
    const ends = mine.length > 0 ? mine : r.until !== undefined ? [Date.parse(r.until)] : [];
    if (ends.length === 0 || ends.some((end) => Number.isNaN(end) || end > t)) return r;
    return withStatus(r, 'expired', { by, at: now, note: '만료 시각이 지나 overrides에서 풀렸습니다.' });
  });
}

/** The status change itself, no checks. */
export function withStatus(report: Report, to: ReportStatus, input: TransitionInput): Report {
  const entry: StatusChange = {
    from: report.status,
    to,
    by: input.by,
    at: input.at.toISOString(),
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.pr_url !== undefined ? { pr_url: input.pr_url } : {}),
    ...(input.changeset_id !== undefined ? { changeset_id: input.changeset_id } : {}),
  };
  const { duplicate_of: _old, ...rest } = report;
  const duplicateOf = to === 'duplicate' ? input.duplicate_of : undefined;
  return { ...rest, ...(duplicateOf !== undefined ? { duplicate_of: duplicateOf } : {}), status: to, status_log: [...report.status_log, entry] };
}
