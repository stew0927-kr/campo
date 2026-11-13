import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compose, planBundle, planReport, removeFromBundle, type PlanOptions } from '@campo/core';
import {
  bundled, buildReportChangeset, changedReportFiles, dayOf, loadReports, locationText, markApplied, overridesOf, overridesWithQueued, queueCount, queueGroups, setGroupStatus,
  type PendingEdit,
} from '../src/model/reports.ts';
import { fixtureSession } from './fixture.ts';

const SAMPLE = fileURLToPath(new URL('../../../data/reports/sample', import.meta.url));
const files = readdirSync(SAMPLE).filter((f) => f.endsWith('.json')).map((f) => ({ path: f, text: readFileSync(join(SAMPLE, f), 'utf8') }));
const NOW = new Date('2026-11-13T09:00:00+09:00');
const { entries } = loadReports(files, 'fixture-basic');
const all = entries.map((e) => e.report);

describe('loadReports', () => {
  it('keeps the reports of the open campus and names unreadable files', () => {
    expect(entries).toHaveLength(8);
    expect(loadReports(files, 'other-campus').entries).toHaveLength(0);
    const bad = loadReports([...files, { path: 'x.json', text: '{ not json' }, { path: 'y.json', text: '{"id":"rp-1"}' }], 'fixture-basic');
    expect(bad.unreadable).toEqual(['x.json', 'y.json']);
    expect(bad.entries).toHaveLength(8);
  });
});

describe('queue view model', () => {
  const view = bundled(all, []);
  const byId = (id: string) => view.find((r) => r.id === id)!;

  it('groups the same-feature step_free reports into one bundle, oldest as primary, and never bundles temporary reports', () => {
    const groups = queueGroups(view);
    expect(groups).toHaveLength(7);
    const bundle = groups.filter((g) => g.bundleId !== null);
    expect(bundle).toHaveLength(1);
    expect(bundle[0]!.reports.map((r) => r.id)).toEqual(['rp-20261112-0007', 'rp-20261112-0008']);
    expect(bundle[0]!.primaryId).toBe('rp-20261112-0007');
    for (const id of ['rp-20261110-0001', 'rp-20261110-0002', 'rp-20261110-0003']) expect(byId(id).bundle_id).toBeUndefined();
    expect(groups.map((g) => g.primaryId)).toEqual([...groups.map((g) => g.primaryId)].sort((a, b) => (byId(a).created_at < byId(b).created_at ? -1 : 1)));
  });

  it('counts the queue per report and hides finished ones until asked', () => {
    expect(queueCount(view)).toBe(8);
    const done = setGroupStatus(view, 'rp-20261112-0007', 'rejected', { at: NOW });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(queueCount(done.reports)).toBe(6); // the bundle's member follows its primary
    expect(done.reports.find((r) => r.id === 'rp-20261112-0008')!.status).toBe('rejected');
    expect(queueGroups(done.reports)).toHaveLength(6);
    expect(queueGroups(done.reports, true)).toHaveLength(7);
  });

  it('removing a member sends it back to new and keeps it out of the bundle', () => {
    const next = bundled(removeFromBundle(view, 'rp-20261112-0008', { by: 'editor', at: NOW }), ['rp-20261112-0008']);
    expect(queueGroups(next).filter((g) => g.bundleId !== null)).toHaveLength(0);
    expect(queueGroups(next)).toHaveLength(8);
    expect(next.find((r) => r.id === 'rp-20261112-0008')!.status).toBe('new');
  });

  it('refuses a status change the table does not allow', () => {
    const applied = setGroupStatus(view, 'rp-20261110-0001', 'applied', { at: NOW });
    if (!applied.ok) throw new Error(applied.reason);
    const again = setGroupStatus(applied.reports, 'rp-20261110-0001', 'rejected', { at: NOW });
    expect(again.ok).toBe(false);
  });

  it('writes a location text from the building name', () => {
    const s = fixtureSession().history.current();
    expect(locationText(s, byId('rp-20261111-0005').location)).toBe('A동 4층');
    expect(locationText(s, byId('rp-20261111-0004').location)).toBe('바깥');
  });
});

describe('changeset from a session', () => {
  const opts = (s: ReturnType<typeof fixtureSession>): PlanOptions => ({ now: NOW, overrides: [], ctx: s.ctx });

  /** Apply the four permanent sample reports (the step_free pair as one bundle) like the tab does. */
  function applyPermanent() {
    const s = fixtureSession(7);
    const base = s.history.base();
    const view = bundled(all, []);
    const pending: PendingEdit[] = [];
    const groups = queueGroups(view).filter((g) => ['stairs_unmarked', 'wrong_room_location', 'new_restroom', 'step_free_confirmed'].includes(g.reports[0]!.kind));
    for (const g of groups) {
      const state = s.history.current();
      const plan = g.bundleId !== null ? planBundle(view, g.bundleId, state, opts(s)) : planReport(g.reports[0]!, state, opts(s));
      if (plan.type !== 'edit') throw new Error(`${g.primaryId}: ${plan.type}`);
      s.history.perform(compose([plan.action], plan.annotation));
      pending.push({ reportIds: plan.reportIds, featureIds: plan.featureIds });
    }
    return { s, base, view, pending };
  }

  it('builds one changeset with the primary of each bundle first, and marks every member applied', () => {
    const { s, base, view, pending } = applyPermanent();
    expect(pending.map((p) => p.reportIds[0])).toContain('rp-20261112-0007');
    expect(pending.find((p) => p.reportIds[0] === 'rp-20261112-0007')!.reportIds).toEqual(['rp-20261112-0007', 'rp-20261112-0008']);

    const build = buildReportChangeset({ base, current: s.history.current(), campus: 'fixture-basic', pending, reports: view, now: NOW });
    expect(build.changeset).not.toBeNull();
    const cs = build.changeset!;
    expect(cs.source).toBe('report');
    expect(cs.id).toBe(`cs-${dayOf(NOW)}-rp-20261111-0004-and-4-more`);
    expect(build.fileName).toBe(`${dayOf(NOW)}-rp-20261111-0004-and-4-more.json`);
    expect(cs.report_ids).toHaveLength(5);
    expect(cs.report_ids.indexOf('rp-20261112-0007')).toBeLessThan(cs.report_ids.indexOf('rp-20261112-0008'));
    expect(cs.changes.some((c) => c.op === 'create')).toBe(true); // the new restroom
    expect(cs.changes.some((c) => c.op === 'modify')).toBe(true);
    expect(build.text!.endsWith('\n')).toBe(true);
    expect(build.dropped).toEqual([]);

    const marked = markApplied(view, build.kept, cs.id, NOW);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    for (const id of cs.report_ids) {
      const r = marked.reports.find((x) => x.id === id)!;
      expect(r.status).toBe('applied');
      expect(r.status_log.at(-1)).toMatchObject({ to: 'applied', changeset_id: cs.id });
    }
    const written = changedReportFiles(entries, marked.reports);
    expect(Object.keys(written).sort()).toEqual(cs.report_ids.map((id) => `${id}.json`).sort());
  });

  it('leaves out a report whose edit was undone, and writes nothing when no change is left', () => {
    const { s, base, view, pending } = applyPermanent();
    while (s.history.canUndo()) s.history.undo();
    const build = buildReportChangeset({ base, current: s.history.current(), campus: 'fixture-basic', pending, reports: view, now: NOW });
    expect(build.changeset).toBeNull();
    expect(build.text).toBeNull();
    expect(build.dropped).toHaveLength(pending.length);
    expect(buildReportChangeset({ base, current: base, campus: 'fixture-basic', pending: [], reports: view, now: NOW }).changeset).toBeNull();
  });

  it('turns temporary reports into overrides.json entries and leaves the map alone', () => {
    const s = fixtureSession(3);
    const view = bundled(all, []);
    const before = s.history.current();
    const queued = ['rp-20261110-0001', 'rp-20261110-0002', 'rp-20261110-0003'].flatMap((id) => {
      const plan = planReport(view.find((r) => r.id === id)!, before, opts(s));
      if (plan.type !== 'override') throw new Error(`${id}: ${plan.type}`);
      return plan.overrides;
    });
    expect(s.history.current()).toBe(before);
    expect(queued.length).toBeGreaterThanOrEqual(3);
    const out = overridesWithQueued(overridesOf(s.extras) ?? [], queued);
    expect(JSON.parse(out.text)).toHaveLength(queued.length);
    expect(out.overrides.every((o) => typeof o.until === 'string' && o.report_id !== undefined)).toBe(true);
    // adding the same entries again does not repeat them
    expect(overridesWithQueued(out.overrides, queued).overrides).toHaveLength(queued.length);
  });

  it('does not read an unreadable overrides.json as empty', () => {
    expect(overridesOf([{ path: 'overrides.json', text: '{ oops' }])).toBeNull();
    expect(overridesOf([])).toEqual([]);
  });
});
