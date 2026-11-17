// Tiles that could not be had (no network for a moment, a server hiccup) are tried again later instead of being left
// out for the rest of the session: after 2 s, then 4 s, 8 s … up to a minute. The record is bounded, so a long walk
// over many tiles does not grow it without end.

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 60_000;
/** At most this many failed tiles are remembered; the oldest are forgotten first (and simply tried again). */
export const MAX_FAILED = 512;

/** How long to wait before try number `attempt + 1` (attempt 1 = the first failure). */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(n - 1, 20));
}

export interface FailedTiles {
  /** Record a failure at `now`. */
  fail(key: string, now: number): void;
  succeed(key: string): void;
  /** Whether the tile should not be asked for yet. */
  blocked(key: string, now: number): boolean;
  /** Keys whose wait is over at `now` (they may be asked for again). */
  due(now: number): string[];
  /** When the next wait that is still running at `now` ends, or null when none is. */
  nextAt(now: number): number | null;
  readonly size: number;
}

export function createFailedTiles(max = MAX_FAILED): FailedTiles {
  // Map keeps insertion order: the first entries are the oldest failures.
  const failed = new Map<string, { attempts: number; until: number }>();
  return {
    fail(key, now) {
      const attempts = (failed.get(key)?.attempts ?? 0) + 1;
      failed.delete(key);
      failed.set(key, { attempts, until: now + retryDelayMs(attempts) });
      while (failed.size > max) failed.delete(failed.keys().next().value!);
    },
    succeed(key) {
      failed.delete(key);
    },
    blocked(key, now) {
      const f = failed.get(key);
      return f !== undefined && f.until > now;
    },
    due(now) {
      return [...failed].filter(([, f]) => f.until <= now).map(([k]) => k);
    },
    nextAt(now) {
      let next: number | null = null;
      for (const f of failed.values()) if (f.until > now && (next === null || f.until < next)) next = f.until;
      return next;
    },
    get size() {
      return failed.size;
    },
  };
}

/** `keys` cut down to the newest `max` while keeping every key in `keep` (the tiles on screen). */
export function boundedKeys(keys: ReadonlySet<string>, keep: ReadonlySet<string>, max: number): ReadonlySet<string> {
  if (keys.size <= max) return keys;
  const out = new Set<string>([...keys].filter((k) => keep.has(k)));
  const rest = [...keys].filter((k) => !keep.has(k));
  for (let i = rest.length - 1; i >= 0 && out.size < max; i--) out.add(rest[i]!);
  return out;
}
