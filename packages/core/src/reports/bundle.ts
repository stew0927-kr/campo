// Report bundles (SPEC-v0.2 7.3, MapRoulette bundle): nearby permanent reports of the same kind are handled together.
// Not duplicate removal: the members keep their own ids and follow the primary. Temporary reports are never bundled;
// one that hits an active override is a duplicate instead (duplicateOverride).
import distance from '@turf/distance';
import type { Override } from '../types.ts';
import { scopeOf } from '../edit/state.ts';
import { BUNDLE_DISTANCE_M } from './constants.ts';
import { isPermanentKind } from './kinds.ts';
import { isInQueue, withStatus, type TransitionInput } from './status.ts';
import type { ChangeBy, Report, ReportStatus } from './types.ts';

export interface Bundle {
  bundle_id: string;
  primary_id: string;
  /** Primary first, then the rest by created_at and id. */
  member_ids: string[];
}

/** Oldest first, then by id. */
function byAge(a: Report, b: Report): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Metres between two reports' locations. */
export function reportDistanceM(a: Report, b: Report): number {
  return distance(a.location.coord, b.location.coord, { units: 'meters' });
}

/**
 * Whether two reports belong in one bundle: same campus, both permanent, same kind, and either the same feature_id or
 * the same scope (outdoor, or building + level) within BUNDLE_DISTANCE_M.
 */
export function canBundle(a: Report, b: Report): boolean {
  if (a.id === b.id || a.campus !== b.campus || a.kind !== b.kind) return false;
  if (!isPermanentKind(a.kind)) return false;
  if (a.feature_id !== undefined && a.feature_id === b.feature_id) return true;
  return scopeOf(a.location) === scopeOf(b.location) && reportDistanceM(a, b) <= BUNDLE_DISTANCE_M;
}

/** Bundle id made from the primary's id. */
export function bundleIdFor(primaryId: string): string {
  return `bd-${primaryId}`;
}

/**
 * The bundles for the queue. Existing bundles keep their id and primary, and take in new queue reports that match the
 * primary. Then, oldest first, each unbundled permanent queue report becomes a primary for the later ones that match it
 * (matched against the primary only, so a bundle never stretches further than BUNDLE_DISTANCE_M from it).
 * `exclude` are reports taken out by hand: they are not bundled again.
 */
export function findBundles(reports: readonly Report[], exclude: ReadonlySet<string> = new Set()): Bundle[] {
  const sorted = [...reports].sort(byAge);
  const free = sorted.filter((r) => r.bundle_id === undefined && isInQueue(r.status) && isPermanentKind(r.kind) && !exclude.has(r.id));
  const taken = new Set<string>();
  const bundles: Bundle[] = [];

  const existing = new Map<string, Report[]>();
  for (const r of sorted) if (r.bundle_id !== undefined) existing.set(r.bundle_id, [...(existing.get(r.bundle_id) ?? []), r]);
  for (const [bundleId, members] of [...existing].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const primary = members.find((m) => m.is_primary === true) ?? members[0]!;
    const joined = free.filter((r) => !taken.has(r.id) && canBundle(primary, r));
    for (const r of joined) taken.add(r.id);
    const rest = [...members.filter((m) => m.id !== primary.id), ...joined].sort(byAge);
    bundles.push({ bundle_id: bundleId, primary_id: primary.id, member_ids: [primary.id, ...rest.map((m) => m.id)] });
  }

  for (const seed of free) {
    if (taken.has(seed.id)) continue;
    const members = free.filter((r) => r.id !== seed.id && !taken.has(r.id) && canBundle(seed, r));
    if (members.length === 0) continue;
    taken.add(seed.id);
    for (const m of members) taken.add(m.id);
    bundles.push({ bundle_id: bundleIdFor(seed.id), primary_id: seed.id, member_ids: [seed.id, ...members.map((m) => m.id)] });
  }
  return bundles;
}

/** Reports with bundle_id / is_primary set from findBundles. Reports outside every bundle come back unchanged. */
export function bundleReports(reports: readonly Report[], exclude: ReadonlySet<string> = new Set()): Report[] {
  const of = new Map<string, { bundle_id: string; is_primary: boolean }>();
  for (const b of findBundles(reports, exclude)) {
    for (const id of b.member_ids) of.set(id, { bundle_id: b.bundle_id, is_primary: id === b.primary_id });
  }
  return reports.map((r) => {
    const set = of.get(r.id);
    if (!set || (r.bundle_id === set.bundle_id && r.is_primary === set.is_primary)) return r;
    return { ...r, ...set };
  });
}

/** Members of a bundle, primary first: use as the changeset's report_ids. */
export function bundleMembers(reports: readonly Report[], bundleId: string): Report[] {
  const members = reports.filter((r) => r.bundle_id === bundleId).sort(byAge);
  const primary = members.find((m) => m.is_primary === true);
  return primary ? [primary, ...members.filter((m) => m !== primary)] : members;
}

/**
 * Take a report out of its bundle: it goes back to new (SPEC-v0.2 7.3), logged. When it was the primary the oldest
 * remaining member becomes the primary; a bundle left with one member is dissolved.
 */
export function removeFromBundle(reports: readonly Report[], reportId: string, input: ChangeBy): Report[] {
  const target = reports.find((r) => r.id === reportId);
  if (!target || target.bundle_id === undefined) return [...reports];
  const bundleId = target.bundle_id;
  const left = bundleMembers(reports, bundleId).filter((r) => r.id !== reportId);
  const newPrimary = target.is_primary === true ? left[0]?.id : left.find((r) => r.is_primary === true)?.id;
  return reports.map((r) => {
    if (r.id === reportId) {
      const { bundle_id: _b, is_primary: _p, ...rest } = r;
      const back = { ...rest, status: r.status } as Report;
      return r.status === 'new' ? back : withStatus(back, 'new', { ...input, note: input.note ?? '묶음에서 뺐습니다.' });
    }
    if (r.bundle_id !== bundleId) return r;
    if (left.length < 2) {
      const { bundle_id: _b, is_primary: _p, ...rest } = r;
      return rest as Report;
    }
    return { ...r, is_primary: r.id === newPrimary };
  });
}

/**
 * Move every queue member of a bundle to `to` (members follow the primary). Members already finished are left alone.
 * The caller checks the primary's transition first (transitionReport); members are moved without the table because
 * they follow it.
 */
export function settleBundle(reports: readonly Report[], bundleId: string, to: ReportStatus, input: TransitionInput): Report[] {
  return reports.map((r) => (r.bundle_id === bundleId && isInQueue(r.status) ? withStatus(r, to, input) : r));
}

/**
 * For a temporary report: the active override (until > now) already on one of `targetIds`, if any. Such a report is a
 * duplicate. `targetIds` default to the report's feature_id; planReport passes every stop of a broken elevator.
 */
export function duplicateOverride(
  report: Report,
  overrides: readonly Override[],
  now: Date,
  targetIds: readonly string[] = report.feature_id !== undefined ? [report.feature_id] : [],
): Override | undefined {
  const t = now.getTime();
  return overrides.find((o) => targetIds.includes(o.feature_id) && o.report_id !== report.id && Date.parse(o.until) > t);
}
