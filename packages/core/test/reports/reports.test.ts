// Report pipeline (SPEC-v0.2 7.3): kinds, schema, status changes, bundles, plans, and temporary reports in routing.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUNDLE_DISTANCE_M,
  REPORT_KINDS,
  REPORT_KIND_INFO,
  REPORT_STATUSES,
  STATUS_TRANSITIONS,
  addOverrides,
  attachPrUrl,
  buildGraph,
  bundleMembers,
  bundleReports,
  canBundle,
  canTransition,
  checkInvariants,
  createHistory,
  expireReports,
  findBundles,
  findFeature,
  findRoute,
  historyToChangeset,
  isTemporaryKind,
  parseCampus,
  planBundle,
  planReport,
  removeFromBundle,
  reopenReport,
  reportDistanceM,
  serialize,
  transitionReport,
  validateCampus,
  validateReport,
  type EditState,
  type LoadedCampus,
  type Override,
  type Position,
  type Report,
  type ReportKind,
  type ReportPlan,
} from '../../src/index.ts';
import { ctx, fixture } from '../edit/helpers.ts';

const SAMPLE_DIR = fileURLToPath(new URL('../../../../data/reports/sample', import.meta.url));
const CONSTANTS_FILE = fileURLToPath(new URL('../../src/reports/constants.ts', import.meta.url));
const NOW = new Date('2026-11-13T09:00:00+09:00');
const BY = { by: 'tester', at: NOW };

let loaded: LoadedCampus;
let start: EditState;
let samples: Report[];
const sample = (id: string) => samples.find((r) => r.id === id)!;

beforeAll(async () => {
  ({ loaded, state: start } = await fixture());
  const names = (await readdir(SAMPLE_DIR)).filter((f) => f.endsWith('.json')).sort();
  samples = await Promise.all(names.map(async (f) => JSON.parse(await readFile(join(SAMPLE_DIR, f), 'utf8')) as Report));
});

/** A minimal valid report; `over` replaces fields. */
function report(over: Partial<Report> & { id: string }): Report {
  const created_at = over.created_at ?? '2026-11-12T09:00:00+09:00';
  return {
    campus: 'fixture-basic',
    kind: 'step_free_confirmed',
    status: 'new',
    created_at,
    location: { coord: [127.0003, 37.0004], building_id: null, level: null },
    status_log: [{ from: null, to: 'new', by: 'app', at: created_at }],
    ...over,
  };
}

/** `coord` moved `m` metres north (Turf's earth radius: 1° of latitude = 111194.93 m). */
const north = (coord: Position, m: number): Position => [coord[0], coord[1] + m / 111194.93];

function validate(state: EditState) {
  return validateCampus(parseCampus(serialize(state, loaded.meta)), { now: NOW });
}

describe('sample reports (data/reports/sample)', () => {
  it('are 8 valid reports covering all 7 kinds, pointing at Features of campus-basic', () => {
    expect(samples).toHaveLength(8);
    for (const r of samples) {
      expect(validateReport(r), r.id).toEqual({ ok: true, errors: [] });
      expect(r.campus).toBe('fixture-basic');
      if (r.feature_id !== undefined) expect(findFeature(start, r.feature_id), r.feature_id).toBeDefined();
      if (r.location.building_id !== null) expect(findFeature(start, r.location.building_id)).toBeDefined();
    }
    expect(new Set(samples.map((r) => r.kind))).toEqual(new Set(REPORT_KINDS));
  });

  it('include one pair at the same place that bundles; temporary samples are never bundled', () => {
    const bundles = findBundles(samples);
    expect(bundles).toEqual([{ bundle_id: 'bd-rp-20261112-0007', primary_id: 'rp-20261112-0007', member_ids: ['rp-20261112-0007', 'rp-20261112-0008'] }]);
    expect(reportDistanceM(sample('rp-20261112-0007'), sample('rp-20261112-0008'))).toBe(0);
  });
});

describe('report schema: no personal fields', () => {
  it.each(['user_id', 'device_id', 'name', 'contact', 'email', 'phone', 'reporter'])('refuses a top-level "%s"', (field) => {
    const r = { ...report({ id: 'rp-20261112-0100' }), [field]: 'x' };
    const check = validateReport(r);
    expect(check.ok).toBe(false);
    expect(check.errors.join(' ')).toContain(field);
  });

  it('refuses unknown fields inside location, details and the status log too', () => {
    const r = report({ id: 'rp-20261112-0101' });
    expect(validateReport({ ...r, location: { ...r.location, device_id: 'x' } }).ok).toBe(false);
    expect(validateReport({ ...r, details: { contact: '010' } }).ok).toBe(false);
    expect(validateReport({ ...r, status_log: [{ ...r.status_log[0]!, user_id: 'u1' }] }).ok).toBe(false);
    expect(validateReport(r).ok).toBe(true);
  });

  it('checks the id, the time zone, bundle fields in pairs, and status = last log entry', () => {
    const r = report({ id: 'rp-20261112-0102' });
    expect(validateReport({ ...r, id: 'report-1' }).ok).toBe(false);
    expect(validateReport({ ...r, created_at: '2026-11-12T09:00:00' }).ok).toBe(false);
    expect(validateReport({ ...r, bundle_id: 'bd-x' }).ok).toBe(false);
    expect(validateReport({ ...r, location: { coord: [127, 37], building_id: null, level: 3 } }).ok).toBe(false);
    expect(validateReport({ ...r, status: 'triaged' }).ok).toBe(false);
  });
});

describe('kinds (SPEC-v0.2 7.3 table)', () => {
  it('3 temporary and 4 permanent kinds', () => {
    const temporary = REPORT_KINDS.filter(isTemporaryKind);
    expect(temporary).toEqual(['elevator_out', 'door_locked', 'construction']);
    expect(REPORT_KINDS.filter((k) => REPORT_KIND_INFO[k].handling === 'permanent')).toEqual([
      'stairs_unmarked', 'wrong_room_location', 'new_restroom', 'step_free_confirmed',
    ]);
  });
});

describe('BUNDLE_DISTANCE_M', () => {
  it('is 8, written as its own literal (not tied to the attach distance)', async () => {
    expect(BUNDLE_DISTANCE_M).toBe(8);
    const text = await readFile(CONSTANTS_FILE, 'utf8');
    expect(text).toContain('export const BUNDLE_DISTANCE_M = 8;');
    expect(text).toContain('붙이는 거리와 제보 묶는 거리는 뜻이 달라서, 한쪽을 바꿔도 다른 쪽이 따라 바뀌면 안 된다.');
    expect(text).not.toMatch(/ATTACH_MAX_DIST_M|tolerances|import /);
  });
});

describe('bundles', () => {
  const at: Position = [127.0003, 37.0004];
  it('bundles the same kind in the same scope within 8 m, not beyond', () => {
    const a = report({ id: 'rp-20261112-0001', location: { coord: at, building_id: null, level: null } });
    const near = report({ id: 'rp-20261112-0002', created_at: '2026-11-12T10:00:00+09:00', location: { coord: north(at, 7.9), building_id: null, level: null } });
    const far = report({ id: 'rp-20261112-0003', created_at: '2026-11-12T11:00:00+09:00', location: { coord: north(at, 8.1), building_id: null, level: null } });
    expect(reportDistanceM(a, near)).toBeLessThan(BUNDLE_DISTANCE_M);
    expect(reportDistanceM(a, far)).toBeGreaterThan(BUNDLE_DISTANCE_M);
    expect(canBundle(a, near)).toBe(true);
    expect(canBundle(a, far)).toBe(false);
    expect(findBundles([far, near, a])).toEqual([{ bundle_id: 'bd-rp-20261112-0001', primary_id: 'rp-20261112-0001', member_ids: ['rp-20261112-0001', 'rp-20261112-0002'] }]);
  });

  it('needs the same kind and scope; the same feature_id bundles at any distance; temporary kinds never', () => {
    const a = report({ id: 'rp-20261112-0001', feature_id: 'e_portal_A_1_main' });
    const otherKind = report({ id: 'rp-20261112-0002', kind: 'stairs_unmarked' });
    const otherLevel = report({ id: 'rp-20261112-0003', location: { coord: [127.0006, 37.0005], building_id: 'bldg_A', level: 1 } });
    const otherLevel2 = report({ id: 'rp-20261112-0004', location: { coord: [127.0006, 37.0005], building_id: 'bldg_A', level: 2 } });
    const sameFeatureFar = report({ id: 'rp-20261112-0005', feature_id: 'e_portal_A_1_main', location: { coord: north(at, 50), building_id: null, level: null } });
    expect(canBundle(a, otherKind)).toBe(false);
    expect(canBundle(otherLevel, otherLevel2)).toBe(false);
    expect(canBundle(a, sameFeatureFar)).toBe(true);
    const t1 = report({ id: 'rp-20261112-0006', kind: 'elevator_out', feature_id: 'n_A_elevA_L1' });
    const t2 = report({ id: 'rp-20261112-0007', kind: 'elevator_out', feature_id: 'n_A_elevA_L1' });
    expect(canBundle(t1, t2)).toBe(false);
    expect(findBundles([t1, t2])).toEqual([]);
  });

  it('matches against the primary only, so a chain does not stretch the bundle', () => {
    const a = report({ id: 'rp-20261112-0001' });
    const b = report({ id: 'rp-20261112-0002', created_at: '2026-11-12T10:00:00+09:00', location: { coord: north(at, 6), building_id: null, level: null } });
    const c = report({ id: 'rp-20261112-0003', created_at: '2026-11-12T11:00:00+09:00', location: { coord: north(at, 12), building_id: null, level: null } });
    expect(findBundles([a, b, c]).map((x) => x.member_ids)).toEqual([['rp-20261112-0001', 'rp-20261112-0002']]);
  });

  it('bundleReports sets bundle_id / is_primary; removing a member sends it back to new and dissolves a pair', () => {
    const bundled = bundleReports(samples);
    expect(bundleMembers(bundled, 'bd-rp-20261112-0007').map((r) => [r.id, r.is_primary])).toEqual([
      ['rp-20261112-0007', true],
      ['rp-20261112-0008', false],
    ]);
    for (const r of bundled) expect(validateReport(r), r.id).toEqual({ ok: true, errors: [] });

    const triaged = bundled.map((r) => (r.id === 'rp-20261112-0008' ? transitionOk(r, 'triaged') : r));
    const out = removeFromBundle(triaged, 'rp-20261112-0008', BY);
    const removed = out.find((r) => r.id === 'rp-20261112-0008')!;
    expect(removed.status).toBe('new');
    expect(removed.bundle_id).toBeUndefined();
    expect(removed.status_log.at(-1)).toMatchObject({ from: 'triaged', to: 'new', by: 'tester' });
    expect(out.find((r) => r.id === 'rp-20261112-0007')!.bundle_id).toBeUndefined();
    for (const r of out) expect(validateReport(r).ok).toBe(true);
    // removed by hand: not bundled again while excluded
    expect(findBundles(out, new Set(['rp-20261112-0008']))).toEqual([]);
  });
});

function transitionOk(r: Report, to: Report['status'], extra: object = {}): Report {
  const res = transitionReport(r, to, { ...BY, ...extra });
  if (!res.ok) throw new Error(res.reason);
  return res.report;
}

describe('status changes', () => {
  it('follow the table: new goes anywhere, finished statuses only back to new', () => {
    for (const to of REPORT_STATUSES) expect(canTransition('new', to)).toBe(to !== 'new');
    for (const from of ['applied', 'already_fixed', 'rejected', 'duplicate', 'expired'] as const) {
      expect(STATUS_TRANSITIONS[from]).toEqual(['new']);
    }
    for (const from of ['skipped', 'needs_survey'] as const) {
      expect(new Set([...STATUS_TRANSITIONS[from], from])).toEqual(new Set(['applied', 'already_fixed', 'rejected', 'skipped', 'needs_survey']));
    }
    expect(canTransition('skipped', 'triaged')).toBe(false);
    expect(canTransition('skipped', 'skipped')).toBe(false);
  });

  it('log who and when; applied needs a PR link or changeset id for permanent kinds; reopen is the way out', () => {
    const r = sample('rp-20261112-0007');
    const skipped = transitionOk(r, 'skipped');
    expect(skipped.status_log.at(-1)).toEqual({ from: 'new', to: 'skipped', by: 'tester', at: NOW.toISOString() });

    const noLink = transitionReport(skipped, 'applied', BY);
    expect(noLink.ok).toBe(false);
    const applied = transitionOk(skipped, 'applied', { changeset_id: 'cs-20261113-portal' });
    expect(applied.status_log.at(-1)).toMatchObject({ to: 'applied', changeset_id: 'cs-20261113-portal' });
    const linked = attachPrUrl(applied, 'https://github.com/example/campo/pull/12');
    if (!linked.ok) throw new Error(linked.reason);
    expect(linked.report.status_log.at(-1)!.pr_url).toBe('https://github.com/example/campo/pull/12');
    expect(validateReport(linked.report).ok).toBe(true);

    const blocked = transitionReport(applied, 'rejected', BY);
    expect(blocked).toEqual({ ok: false, reason: expect.stringContaining('다시 열기') });
    expect(transitionReport(applied, 'applied', BY).ok).toBe(false);
    const reopened = reopenReport(applied, BY);
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.report.status).toBe('new');
    expect(transitionOk(reopened.report, 'rejected').status).toBe('rejected');
    expect(reopenReport(r, BY).ok).toBe(false);

    // temporary kinds go to overrides.json and need no changeset
    expect(transitionReport(sample('rp-20261110-0001'), 'applied', BY).ok).toBe(true);
  });

  it('expireReports turns applied temporary reports into expired once their overrides ran out', () => {
    const applied = transitionOk(sample('rp-20261110-0001'), 'applied');
    const overrides: Override[] = [{ feature_id: 'n_A_elevA_L1', status: 'elevator_out', until: '2026-11-14T18:00:00+09:00', report_id: applied.id }];
    expect(expireReports([applied], overrides, NOW)[0]).toBe(applied);
    const [expired] = expireReports([applied], overrides, new Date('2026-11-14T18:00:00+09:00'));
    expect(expired!.status).toBe('expired');
    expect(expired!.status_log.at(-1)).toMatchObject({ from: 'applied', to: 'expired', by: 'system' });
    // permanent reports never expire
    const permanent = transitionOk(sample('rp-20261112-0007'), 'applied', { changeset_id: 'cs-20261113-x' });
    expect(expireReports([permanent], [], new Date('2030-01-01T00:00:00Z'))[0]).toBe(permanent);
  });
});

describe('temporary reports: overrides only', () => {
  const plan = (r: Report, overrides: Override[] = [], now = NOW): ReportPlan => planReport(r, start, { now, overrides, ctx: ctx(1) });

  it('a broken elevator closes every stop of its elevator_id until `until`; the map data is not touched', () => {
    const p = plan(sample('rp-20261110-0001'));
    if (p.type !== 'override') throw new Error(p.type);
    expect(p.overrides).toEqual(['n_A_elevA_L1', 'n_A_elevA_L2', 'n_A_elevA_L3', 'n_A_elevA_L4'].map((feature_id) => ({
      feature_id, status: 'elevator_out', until: '2026-11-14T18:00:00+09:00', report_id: 'rp-20261110-0001',
    })));
    expect(p).not.toHaveProperty('action');
    expect(addOverrides(addOverrides([], p), p)).toHaveLength(4);
  });

  it('drops out of routing once until <= now (buildGraph with an injected now)', () => {
    const p = plan(sample('rp-20261110-0001'));
    if (p.type !== 'override') throw new Error(p.type);
    const overrides = addOverrides([], p);
    const route = (now: Date) => {
      const g = buildGraph(loaded, { overrides, now, calibration: {} });
      const r = findRoute(g, 'n_A_1_hall', 'n_A_4_408door', 'step_free');
      if (!r.found) throw new Error(r.message);
      return { closed: g.closed, nodes: r.nodes };
    };
    const open = buildGraph(loaded, { overrides: [], now: NOW, calibration: {} });
    const openRoute = findRoute(open, 'n_A_1_hall', 'n_A_4_408door', 'step_free');
    expect(openRoute.found && openRoute.nodes).toContain('n_A_elevA_L4');

    const during = route(NOW);
    expect([...during.closed].sort()).toEqual(['n_A_elevA_L1', 'n_A_elevA_L2', 'n_A_elevA_L3', 'n_A_elevA_L4']);
    expect(during.nodes.some((n) => n.startsWith('n_A_elevA'))).toBe(false);

    const atUntil = route(new Date('2026-11-14T18:00:00+09:00'));
    expect(atUntil.closed.size).toBe(0);
    expect(atUntil.nodes).toContain('n_A_elevA_L4');
  });

  it('a second report on a Feature with an active override is a duplicate; after it ran out it is a new override', () => {
    const first = plan(sample('rp-20261110-0001'));
    if (first.type !== 'override') throw new Error(first.type);
    const again = report({ id: 'rp-20261113-0009', kind: 'elevator_out', feature_id: 'n_A_elevA_L3', location: { coord: [127.0008, 37.0005], building_id: 'bldg_A', level: 3 } });
    const dup = plan(again, first.overrides);
    expect(dup).toMatchObject({ type: 'duplicate', override: { report_id: 'rp-20261110-0001' } });
    const later = plan(again, first.overrides, new Date('2026-11-15T00:00:00+09:00'));
    expect(later.type).toBe('override');
  });

  it('without until the kind default is used; a report whose until has passed is expired; no feature_id needs a person', () => {
    const p = plan(sample('rp-20261110-0002'));
    if (p.type !== 'override') throw new Error(p.type);
    expect(p.overrides).toEqual([{ feature_id: 'n_B_1_main', status: 'door_locked', until: new Date(NOW.getTime() + 24 * 3_600_000).toISOString(), report_id: 'rp-20261110-0002' }]);
    expect(plan(sample('rp-20261110-0003'), [], new Date('2026-11-21T00:00:00+09:00')).type).toBe('expired');
    const { feature_id: _f, ...noTarget } = sample('rp-20261110-0003');
    expect(plan(noTarget as Report).type).toBe('manual');
  });
});

describe('permanent reports: pre-filled edit actions', () => {
  const plan = (r: Report | Report[], bundleId?: string): ReportPlan =>
    Array.isArray(r) ? planBundle(r, bundleId!, start, { now: NOW, ctx: ctx(5) }) : planReport(r, start, { now: NOW, ctx: ctx(5) });

  function perform(p: ReportPlan) {
    if (p.type !== 'edit') throw new Error(`${p.type}: ${'reason' in p ? p.reason : ''}`);
    const h = createHistory(start);
    const after = h.perform(p.action);
    expect(h.size()).toBe(1);
    expect(checkInvariants(after)).toEqual([]);
    expect(validate(after).errors).toEqual([]);
    expect(h.undo()).toEqual(start);
    return { after, h };
  }

  it('step_free_confirmed: step_free true and source report-…, one modify in the changeset; the bundle plan lists both reports', () => {
    const bundled = bundleReports(samples);
    const p = plan(bundled, 'bd-rp-20261112-0007');
    expect(p.reportIds).toEqual(['rp-20261112-0007', 'rp-20261112-0008']);
    const { after } = perform(p);
    expect(after.edges['e_portal_A_1_main']!.props).toMatchObject({ step_free: true, source: 'report-rp-20261112-0007', rev: 2 });
    const cs = historyToChangeset(start, after, { id: 'cs-20261113-portal', campus: 'fixture-basic', source: 'report', report_ids: p.reportIds, summary: 'A동 출입구 턱 없음' });
    expect(cs.changes).toHaveLength(1);
    expect(cs.changes[0]).toMatchObject({ op: 'modify', base_rev: 1, feature: { id: 'e_portal_A_1_main' } });
    if (p.type === 'edit') expect(p.featureIds).toEqual(['e_portal_A_1_main']);
  });

  it('step_free_confirmed on an edge that is already step_free is already_fixed', () => {
    const r = report({ id: 'rp-20261112-0010', feature_id: 'e_portal_A_4_north' });
    expect(plan(r).type).toBe('already_fixed');
    expect(plan(report({ id: 'rp-20261112-0011', feature_id: 'e_out_0002__out_0003' })).type).toBe('manual');
  });

  it('stairs_unmarked: an outdoor footway becomes steps with the reported step count', () => {
    const { after } = perform(plan(sample('rp-20261111-0004')));
    expect(after.edges['e_out_0001__out_0006']!.props).toMatchObject({ highway: 'steps', step_free: false, step_count: 3, needs_check: true, source: 'report-rp-20261111-0004' });
  });

  it('wrong_room_location: the door moves to the reported spot and is linked to the nearest corridor again', () => {
    const r = sample('rp-20261111-0005');
    const { after } = perform(plan(r));
    const door = after.nodes['n_A_4_408door']!;
    expect(door.coord).toEqual(r.location.coord);
    expect(door.props.source).toBe('report-rp-20261111-0005');
    const links = Object.values(after.edges).filter((e) => e.props.from === door.id || e.props.to === door.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.props).toMatchObject({ highway: 'corridor', edge_type: 'indoor', step_free: null });
  });

  it('new_restroom: a restroom node (wheelchair unknown, needs_check) joined to the corridor in one history entry', () => {
    const r = sample('rp-20261111-0006');
    const p = plan(r);
    const { after } = perform(p);
    const added = Object.values(after.nodes).filter((n) => !(n.id in start.nodes));
    const restroom = added.find((n) => n.props.node_type === 'restroom')!;
    expect(restroom.coord).toEqual(r.location.coord);
    expect(restroom.props).toMatchObject({ building_id: 'bldg_A', level: 1, restroom_gender: 'unisex', wheelchair: 'unknown', needs_check: true, source: 'report-rp-20261111-0006' });
    expect(Object.values(after.edges).some((e) => e.props.from === restroom.id || e.props.to === restroom.id)).toBe(true);

    const yes = plan({ ...r, details: { restroom_gender: 'female', wheelchair: 'yes' } });
    if (yes.type !== 'edit') throw new Error(yes.type);
    expect(yes.warnings.join(' ')).toContain('wheelchair: yes');
    expect(plan({ ...r, details: {} }).type).toBe('manual');
  });

  it('every sample gets a plan of the expected type', () => {
    const want: Record<ReportKind, ReportPlan['type']> = {
      elevator_out: 'override', door_locked: 'override', construction: 'override',
      stairs_unmarked: 'edit', wrong_room_location: 'edit', new_restroom: 'edit', step_free_confirmed: 'edit',
    };
    for (const r of samples) expect(plan(r).type, r.id).toBe(want[r.kind]);
  });

  it('a plan does not change its input state', () => {
    const before = JSON.stringify(start);
    for (const r of samples) plan(r);
    expect(JSON.stringify(start)).toBe(before);
  });
});
