// On-disk format of a campus folder: one FeatureCollection per file, one Feature per line, sorted by id.
// The editor and `npm run migrate` both write this, so a file read and written back stays byte-for-byte equal.

/** `{"type":"FeatureCollection","features":[` + one Feature per line, sorted by id + `]}`. */
export function formatFeatureCollection(features: readonly unknown[]): string {
  if (features.length === 0) return '{"type":"FeatureCollection","features":[]}\n';
  const sorted = [...features].sort((a, b) => compareIds(idOf(a), idOf(b)));
  return `{"type":"FeatureCollection","features":[\n${sorted.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

/** campus.json: two-space indent, trailing newline. */
export function formatMeta(meta: unknown): string {
  return `${JSON.stringify(meta, null, 2)}\n`;
}

function idOf(f: unknown): string | undefined {
  const id = (f as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
}

/** Plain code-unit order (not locale) so every machine sorts the same; id-less features last. */
function compareIds(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}
