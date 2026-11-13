// The 제보 관리 tab (SPEC-v0.2 7.3): the report queue, applying a report, and saving what was processed.
// Screen state about reports lives here. The map itself is only changed by core actions run through `perform`.
// `new Date()` is read here, at the edge, and passed down.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  STATUS_LABELS, buildingById, findFeature, planBundle, planReport, removeFromBundle, reopenReport,
  type EditState, type Override, type Position, type Report, type ReportStatus,
} from '@campo/core';
import { fetchReportFiles, saveChangeset, saveReportFiles } from '../api.ts';
import type { PlanResult } from '../model/plan.ts';
import {
  REPORT_ACTOR, bundled, buildReportChangeset, changedReportFiles, loadReports, markApplied, overridesOf, planStatusSuggestion, queueCount, queueGroups, setGroupStatus,
  type PendingEdit, type QueueGroup,
} from '../model/reports.ts';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import type { Session } from '../model/session.ts';
import type { RowNote } from '../ui/ReportsPanel.tsx';

interface Deps {
  session: Session;
  state: EditState;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  /** Run a plan as one history entry; returns the error, or undefined when it ran. */
  perform: (plan: PlanResult) => string | undefined;
  /** Write the campus folder with these extra overrides.json entries; null when the person declined. */
  persistCampus: (queued: readonly Override[]) => Promise<{ written: string[] } | null>;
  /** Show and select a Feature (`from`: the state to look it up in, when newer than the rendered one). */
  locateFeature: (featureId: string, from?: EditState) => void;
  /** Show a place that is not a Feature: its floor (or the outdoors) and the coordinate. */
  showPlace: (scope: Scope, position: Position) => void;
  info: (text: string) => void;
  fail: (text: string) => void;
}

export function useReports({ session, state, saving, setSaving, perform, persistCampus, locateFeature, showPlace, info, fail }: Deps) {
  /** Report files of this campus as last loaded or saved (to know which ones changed). */
  const [entries, setEntries] = useState<{ path: string; report: Report }[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The reports with this session's status changes (not yet saved). */
  const [reports, setReports] = useState<Report[]>([]);
  /** Reports taken out of their bundle by hand: they are not bundled again. */
  const [excluded, setExcluded] = useState<string[]>([]);
  const [showFinished, setShowFinished] = useState(false);
  /** Permanent reports applied in this session and waiting for 저장 (they become one changeset). */
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  /** overrides.json entries of applied temporary reports, written with the next 제보 저장. */
  const [queuedOverrides, setQueuedOverrides] = useState<Override[]>([]);
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [result, setResult] = useState<string[] | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  /** The state the changeset is made from: as loaded, or as of the last 제보 저장 (History.base() also moves on the toolbar 저장). */
  const base = useRef<EditState>(session.history.base());

  useEffect(() => {
    fetchReportFiles().then(
      (files) => {
        const loaded = loadReports(files, session.campusId);
        setEntries(loaded.entries);
        setReports(loaded.entries.map((e) => e.report));
        setUnreadable(loaded.unreadable);
      },
      (err: Error) => setLoadError(err.message),
    );
  }, [session.campusId]);

  const view = useMemo(() => bundled(reports, excluded), [reports, excluded]);
  const groups = useMemo(() => queueGroups(view, showFinished), [view, showFinished]);
  const badge = useMemo(() => queueCount(view), [view]);
  const pending = useMemo(() => new Set(pendingEdits.map((p) => p.reportIds[0]!)), [pendingEdits]);
  const unsavedFiles = useMemo(() => Object.keys(changedReportFiles(entries, reports)).length, [entries, reports]);

  const setNote = (primaryId: string, note: RowNote | null) => setNotes((n) => {
    const { [primaryId]: _old, ...rest } = n;
    return note ? { ...rest, [primaryId]: note } : rest;
  });
  /** A group was handled: its row note and the last save's result no longer apply. */
  const settle = (primaryId: string, featureIds: string[]) => {
    setHighlight(featureIds);
    setNote(primaryId, null);
    setResult(null);
  };

  /** A report's place on the map: its Feature when the map has it, otherwise its coordinate on its floor. */
  const onLocate = (report: Report) => {
    if (report.feature_id !== undefined && findFeature(state, report.feature_id)) return locateFeature(report.feature_id);
    const { building_id, level, coord } = report.location;
    const b = building_id !== null && level !== null ? buildingById(state, building_id) : undefined;
    showPlace(b && level !== null ? { kind: 'building', buildingId: b.id, level } : OUTDOOR, coord);
  };

  const onApply = (group: QueueGroup) => {
    const now = new Date();
    const opts = { now, overrides: [...(overridesOf(session.extras) ?? []), ...queuedOverrides], ctx: session.ctx };
    const plan = group.bundleId !== null ? planBundle(view, group.bundleId, state, opts) : planReport(group.reports[0]!, state, opts);
    switch (plan.type) {
      case 'override': {
        // Temporary (고장, 공사): the map stays as it is, overrides.json gets the entry at the next save.
        const moved = setGroupStatus(view, group.primaryId, 'applied', { at: now });
        if (!moved.ok) return fail(moved.reason);
        setReports(moved.reports);
        setQueuedOverrides((q) => [...q, ...plan.overrides.filter((o) => !q.some((x) => x.feature_id === o.feature_id && x.report_id === o.report_id))]);
        settle(group.primaryId, plan.overrides.map((o) => o.feature_id));
        locateFeature(plan.overrides[0]!.feature_id);
        return info(`${plan.summary} 지도 원본은 그대로 두고, 저장하면 overrides.json에 더해집니다.`);
      }
      case 'edit': {
        // Permanent: one history entry now, one changeset at the next save.
        if (perform({ annotation: plan.annotation, steps: [() => plan.action], notices: plan.warnings }) !== undefined) return;
        setPendingEdits((p) => [...p, { reportIds: plan.reportIds, featureIds: plan.featureIds }]);
        settle(group.primaryId, plan.featureIds);
        if (plan.featureIds[0]) locateFeature(plan.featureIds[0], session.history.current());
        return;
      }
      default: {
        const suggestion = planStatusSuggestion(plan);
        setNote(group.primaryId, {
          text: plan.reason,
          tone: 'warn',
          ...(suggestion ? { suggestion } : {}),
          ...(plan.type === 'duplicate' ? { duplicateOf: plan.override.report_id } : {}),
        });
      }
    }
  };

  const onStatus = (group: QueueGroup, to: ReportStatus) => {
    const duplicateOf = notes[group.primaryId]?.duplicateOf;
    const moved = setGroupStatus(view, group.primaryId, to, {
      at: new Date(),
      ...(to === 'duplicate' && duplicateOf ? { duplicate_of: duplicateOf } : {}),
    });
    if (!moved.ok) return fail(moved.reason);
    setReports(moved.reports);
    setNote(group.primaryId, null);
    info(`제보 ${group.primaryId}을(를) "${STATUS_LABELS[to]}" 상태로 바꿨습니다. 저장하면 제보 파일에 기록됩니다.`);
  };

  const onReopen = (group: QueueGroup) => {
    let next = [...view];
    for (const r of group.reports) {
      const cur = next.find((x) => x.id === r.id);
      if (!cur) continue;
      const out = reopenReport(cur, { by: REPORT_ACTOR, at: new Date() });
      if (!out.ok) return fail(out.reason);
      next = next.map((x) => (x.id === r.id ? out.report : x));
    }
    setReports(next);
    info('제보를 다시 열었습니다. 저장하면 제보 파일에 기록됩니다.');
  };

  const onRemoveMember = (reportId: string) => {
    setReports(removeFromBundle(view, reportId, { by: REPORT_ACTOR, at: new Date() }));
    setExcluded((e) => (e.includes(reportId) ? e : [...e, reportId]));
    info(`제보 ${reportId}을(를) 묶음에서 뺐습니다.`);
  };

  /** 저장: the campus (with the overrides of temporary reports), the changeset of the permanent ones, and the report files. */
  const onSave = async () => {
    if (saving) return;
    const now = new Date();
    setSaving(true);
    try {
      const build = buildReportChangeset({ base: base.current, current: state, campus: session.campusId, pending: pendingEdits, reports: view, now });
      const saved = await persistCampus(queuedOverrides);
      if (!saved) return;
      const lines = [`캠퍼스 파일 ${saved.written.length}개를 저장했습니다.`];
      if (queuedOverrides.length > 0) lines.push(`overrides.json에 ${queuedOverrides.length}건을 더했습니다. 지도 원본은 바꾸지 않았습니다.`);

      let next = view;
      if (build.changeset && build.fileName && build.text) {
        const { changeset } = build;
        await saveChangeset(build.fileName, build.text);
        const marked = markApplied(next, build.kept, changeset.id, now);
        if (!marked.ok) throw new Error(marked.reason);
        next = marked.reports;
        const count = (op: string) => changeset.changes.filter((c) => c.op === op).length;
        lines.push(`changeset ${build.fileName}을(를) 만들었습니다. 추가 ${count('create')}개, 변경 ${count('modify')}개, 삭제 ${count('delete')}개. 제보 ${changeset.report_ids.join(', ')}.`);
      } else {
        lines.push(pendingEdits.length === 0 ? '지도에 반영할 제보가 없어 changeset 파일은 만들지 않았습니다.' : '바뀐 내용이 없어 changeset 파일을 만들지 않았습니다.');
      }
      if (build.dropped.length > 0) lines.push(`되돌린 제보는 대기열에 남겼습니다: ${build.dropped.flatMap((d) => d.reportIds).join(', ')}.`);

      const files = changedReportFiles(entries, next);
      const fileCount = Object.keys(files).length;
      if (fileCount > 0) {
        await saveReportFiles(files);
        lines.push(`제보 파일 ${fileCount}개의 상태를 기록했습니다.`);
      }
      setReports(next);
      setEntries((es) => es.map((e) => ({ path: e.path, report: next.find((r) => r.id === e.report.id) ?? e.report })));
      setPendingEdits([]);
      setQueuedOverrides([]);
      setNotes({});
      setHighlight([]);
      base.current = state;
      setResult(lines);
      info('제보 처리를 저장했습니다. 커밋은 Git에서 해 주세요.');
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return {
    /** Reports waiting in the queue (the tab's badge). */
    badge,
    /** Features of the report handled last, to mark on the map while the tab is open. */
    highlight,
    /** Everything ReportsPanel needs besides the edit state. */
    panel: {
      groups,
      total: reports.length,
      unreadable,
      loadError,
      showFinished,
      pending,
      notes,
      canSave: pendingEdits.length > 0 || queuedOverrides.length > 0 || unsavedFiles > 0,
      saving,
      result,
      onShowFinished: setShowFinished,
      onLocate,
      onApply,
      onStatus,
      onReopen,
      onRemoveMember,
      onSave: () => void onSave(),
    },
  };
}
