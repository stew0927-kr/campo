// The 제보 tab (SPEC-v0.2 7.3): the work queue. Each row is one report, or a bundle of nearby reports of one kind (primary first).
// 적용 asks core for the pre-filled action (App runs it as one history entry); 저장 writes the changeset and the report files.
import { REPORT_KIND_INFO, STATUS_LABELS, isInQueue, type EditState, type Report, type ReportStatus } from '@campo/core';
import { locationText, type QueueGroup } from '../model/reports.ts';

/** What the last 적용 of a row told: the reason when nothing could be changed, and the status that fits. */
export interface RowNote {
  text: string;
  tone: 'info' | 'warn';
  suggestion?: { to: ReportStatus; label: string };
  /** duplicate: the report whose override is already there. */
  duplicateOf?: string;
}

interface Props {
  state: EditState;
  groups: QueueGroup[];
  /** Reports of this campus, all statuses (for the counts). */
  total: number;
  unreadable: string[];
  loadError: string | null;
  showFinished: boolean;
  /** Primary ids applied in this session and waiting for 저장. */
  pending: ReadonlySet<string>;
  notes: Readonly<Record<string, RowNote>>;
  /** Something to save: a pending edit, a queued override, or a status change. */
  canSave: boolean;
  saving: boolean;
  /** Lines of the last 저장 (what was written, or that there was no change). */
  result: string[] | null;
  onShowFinished: (show: boolean) => void;
  onLocate: (report: Report) => void;
  onApply: (group: QueueGroup) => void;
  onStatus: (group: QueueGroup, to: ReportStatus) => void;
  onReopen: (group: QueueGroup) => void;
  onRemoveMember: (reportId: string) => void;
  onSave: () => void;
}

const SIMPLE_STATUSES: { to: ReportStatus; label: string }[] = [
  { to: 'skipped', label: '나중에 보기' },
  { to: 'needs_survey', label: '현장 확인 필요' },
  { to: 'rejected', label: '반려' },
];

export function ReportsPanel(p: Props) {
  if (p.loadError) return <p className="panel-empty notice-error" role="alert">제보를 불러오지 못했습니다. {p.loadError}</p>;
  return (
    <div className="reports-panel">
      <div className="reports-head">
        <label className="reports-filter">
          <input type="checkbox" checked={p.showFinished} onChange={(e) => p.onShowFinished(e.target.checked)} />
          끝난 제보도 보기
        </label>
        <button type="button" className="primary" aria-label="제보 처리 저장" disabled={!p.canSave || p.saving} onClick={p.onSave}>
          {p.saving ? '저장하는 중…' : '제보 처리 저장'}
        </button>
      </div>
      <p className="field-help">
        적용하면 지도에서 바뀐 곳이 강조됩니다. 저장하면 변경 묶음(changeset) 파일이 만들어지고 제보가 반영됨으로 바뀝니다. 지도에서 직접 고친 내용도 함께 담깁니다.
      </p>
      {p.result && (
        <ul className="reports-result" aria-label="저장 결과">
          {p.result.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {p.unreadable.length > 0 && <p className="field-help notice-error" role="status">읽지 못한 제보 파일 {p.unreadable.length}개: {p.unreadable.join(', ')}</p>}
      {p.groups.length === 0 ? (
        <p className="panel-empty">{p.total === 0 ? '이 캠퍼스의 제보가 없습니다.' : '대기열에 남은 제보가 없습니다.'}</p>
      ) : (
        <ul className="report-list" aria-label="제보 대기열">
          {p.groups.map((g) => <Group key={g.primaryId} group={g} {...p} />)}
        </ul>
      )}
    </div>
  );
}

function Group({ group, state, pending, notes, onLocate, onApply, onStatus, onReopen, onRemoveMember }: Props & { group: QueueGroup }) {
  const primary = group.reports[0]!;
  const bundle = group.bundleId !== null && group.reports.length > 1;
  const waiting = pending.has(group.primaryId);
  const note = notes[group.primaryId];
  const queued = isInQueue(primary.status);
  return (
    <li className={`report-group${bundle ? ' report-bundle' : ''}`} aria-label={`제보 ${primary.id}`}>
      <Item report={primary} state={state} onLocate={onLocate} badge={bundle ? `묶음 ${group.reports.length}건 · 대표` : null} />
      {bundle && (
        <ul className="report-members" aria-label={`묶음 ${group.bundleId} 구성원`}>
          {group.reports.slice(1).map((m) => (
            <li key={m.id}>
              <Item report={m} state={state} onLocate={onLocate} badge="같이 처리" />
              <button type="button" className="report-small" aria-label={`${m.id} 묶음에서 빼기`} disabled={waiting} onClick={() => onRemoveMember(m.id)}>묶음에서 빼기</button>
            </li>
          ))}
        </ul>
      )}
      {note && <p className={`report-note report-note-${note.tone}`} role="status">{note.text}</p>}
      {waiting ? (
        <p className="report-note report-note-info" role="status">적용했습니다. 저장하면 반영됩니다. (취소하려면 Ctrl+Z)</p>
      ) : queued ? (
        <div className="report-actions">
          <button type="button" className="primary" aria-label={`${primary.id} 적용`} onClick={() => onApply(group)}>적용</button>
          {note?.suggestion && (
            <button type="button" aria-label={`${primary.id} ${note.suggestion.label}`} onClick={() => onStatus(group, note.suggestion!.to)}>{note.suggestion.label}</button>
          )}
          {SIMPLE_STATUSES.filter((s) => s.to !== primary.status).map((s) => (
            <button key={s.to} type="button" aria-label={`${primary.id} ${s.label}`} onClick={() => onStatus(group, s.to)}>{s.label}</button>
          ))}
        </div>
      ) : (
        <div className="report-actions">
          <button type="button" aria-label={`${primary.id} 다시 열기`} onClick={() => onReopen(group)}>다시 열기</button>
        </div>
      )}
    </li>
  );
}

function Item({ report, state, badge, onLocate }: { report: Report; state: EditState; badge: string | null; onLocate: (r: Report) => void }) {
  const where = locationText(state, report.location);
  return (
    <button type="button" className="report-item" aria-label={`${report.id} ${REPORT_KIND_INFO[report.kind].label}, ${where}, ${STATUS_LABELS[report.status]}. 지도에서 보기`} onClick={() => onLocate(report)}>
      <span className="report-kind">{REPORT_KIND_INFO[report.kind].label}</span>
      <span className="report-where">{where}</span>
      <span className={`report-status report-status-${report.status}`}>{STATUS_LABELS[report.status]}</span>
      {badge && <span className="report-badge">{badge}</span>}
      <span className="report-id">{report.id}</span>
      {report.description && <span className="report-desc">{report.description}</span>}
    </button>
  );
}
