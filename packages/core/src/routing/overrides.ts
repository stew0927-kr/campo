// Temporary closures from overrides.json (SPEC-v0.2 2.5), merged when the
// routing graph is built.

/**
 * Feature ids closed by the entries that are still active at `now`.
 *
 * `raw` is unvalidated JSON (LoadedCampus.overrides or a caller's list): anything
 * that is not an array blocks nothing, and items without a string `feature_id`
 * or a parseable `until` are skipped. An entry is active while
 * Date.parse(until) > now. Its `status` is not read: every active entry closes
 * its feature (the status text is free-form until the report kinds are fixed).
 */
export function activeClosures(raw: unknown, now: Date): Set<string> {
  const closed = new Set<string>();
  if (!Array.isArray(raw)) return closed;
  const t = now.getTime();
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { feature_id: id, until } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof until !== 'string') continue;
    const end = Date.parse(until);
    if (Number.isNaN(end) || end <= t) continue;
    closed.add(id);
  }
  return closed;
}
