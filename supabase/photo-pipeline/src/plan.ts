// The "head" of the pipeline: pure functions that decide WHAT to upload. No files, no network.
// Everything that can create duplicates or wrong rows lives here, so it is what the tests cover.
import { createHash } from 'node:crypto';

export const CAMPUS_ID_DEFAULT = 'hanyang-seoul';
export const ID_MAX = 80;
export const HEADING_SOURCES = ['sensor', 'dial', 'manual'] as const;
export type HeadingSource = (typeof HEADING_SOURCES)[number];

/** Photo paths the survey schema allows (data/schema/survey.schema.json, attachment.photos). */
const PHOTO_PATH = /^photos\/[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|heic)$/i;

/** Building and floor of a map node, read from data/campuses/<id>/**.geojson. */
export interface NodeInfo {
  building_id: string | null;
  level: number | null;
}

/** One photo the pipeline may upload. Field names follow the campus_photos table. */
export interface PlannedPhoto {
  surveyId: string;
  /** Path inside the survey folder, e.g. photos/n_x-1.jpg */
  photoPath: string;
  id: string;
  campus_id: string;
  node_id: string;
  building_id: string | null;
  level: number | null;
  heading_deg: number | null;
  heading_source: HeadingSource | null;
  hfov_deg: number | null;
  direction_hint: string | null;
}

export interface SurveyPlan {
  photos: PlannedPhoto[];
  /** Korean, one line each: things a person should look at. */
  warnings: string[];
}

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');

/**
 * Stable photo id: node id + "-" + file name without extension, lowercase, [a-z0-9_-] only, at most 80 chars.
 * The same photo always gets the same id, so running the script again never makes a second row.
 * When the slug had to drop information (non-ASCII, spaces, or truncation), an 8-char hash of the original
 * is appended so two different photos can never end up with the same id.
 */
export function photoIdOf(nodeId: string, photoPath: string): string {
  const file = photoPath.split('/').pop() ?? photoPath;
  const stem = file.replace(/\.[^.]+$/, '');
  const raw = `${nodeId}-${stem}`;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  const lossless = slug === raw.toLowerCase() && slug.length <= ID_MAX;
  if (lossless && slug.length > 0) return slug;
  const hash = sha1(`${nodeId}|${photoPath}`).slice(0, 8);
  const head = slug.slice(0, ID_MAX - hash.length - 1).replace(/-+$/g, '');
  return head.length > 0 ? `${head}-${hash}` : hash;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** heading in [0, 360), else null. */
export function headingOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 360 ? v : null;
}

/** Reads node id -> building/level from GeoJSON FeatureCollections. Only Point features with kind "node". */
export function buildNodeIndex(collections: readonly unknown[]): Map<string, NodeInfo> {
  const index = new Map<string, NodeInfo>();
  for (const fc of collections) {
    if (!isObject(fc) || !Array.isArray(fc['features'])) continue;
    for (const f of fc['features'] as unknown[]) {
      if (!isObject(f) || typeof f['id'] !== 'string') continue;
      const props = isObject(f['properties']) ? f['properties'] : {};
      if (props['kind'] !== undefined && props['kind'] !== 'node') continue;
      const building = text(props['building_id']);
      const level = typeof props['level'] === 'number' && Number.isInteger(props['level']) && props['level'] !== 0 ? props['level'] : null;
      index.set(f['id'], { building_id: building, level });
    }
  }
  return index;
}

/**
 * Turns one survey.json into planned photos.
 * @param exists tells whether a photo path is present in the survey folder (the caller checks the disk).
 */
export function planSurvey(
  survey: unknown,
  surveyId: string,
  nodes: ReadonlyMap<string, NodeInfo>,
  exists: (photoPath: string) => boolean,
  campusId: string = CAMPUS_ID_DEFAULT,
): SurveyPlan {
  const photos: PlannedPhoto[] = [];
  const warnings: string[] = [];
  if (!isObject(survey)) return { photos, warnings: [`${surveyId}: survey.json을 읽을 수 없습니다.`] };
  const attachments = survey['attachments'];
  if (!isObject(attachments)) return { photos, warnings };

  for (const [nodeId, att] of Object.entries(attachments)) {
    if (!isObject(att) || !Array.isArray(att['photos'])) continue;
    const meta = isObject(att['photo_meta']) ? att['photo_meta'] : {};
    for (const p of att['photos'] as unknown[]) {
      if (typeof p !== 'string' || !PHOTO_PATH.test(p)) {
        warnings.push(`${surveyId}: 지점 ${nodeId}의 사진 경로 "${String(p)}"가 형식에 맞지 않아 건너뜁니다.`);
        continue;
      }
      if (!exists(p)) {
        warnings.push(`${surveyId}: ${p} 파일이 없습니다(조사 zip을 편집기로 다시 불러와 주세요).`);
        continue;
      }
      const m = isObject(meta[p]) ? (meta[p] as Record<string, unknown>) : {};
      const source = m['heading_source'];
      const hfov = m['hfov_deg'];
      const node = nodes.get(nodeId);
      photos.push({
        surveyId,
        photoPath: p,
        id: photoIdOf(nodeId, p),
        campus_id: campusId,
        node_id: nodeId,
        building_id: node?.building_id ?? null,
        level: node?.level ?? null,
        heading_deg: headingOf(m['heading_deg']),
        heading_source: typeof source === 'string' && (HEADING_SOURCES as readonly string[]).includes(source) ? (source as HeadingSource) : null,
        hfov_deg: typeof hfov === 'number' && Number.isFinite(hfov) && hfov > 0 && hfov < 180 ? hfov : null,
        direction_hint: text(m['direction_hint']),
      });
    }
  }
  return { photos, warnings };
}

/** What the table already holds for one photo (only the columns the decision needs). */
export interface ExistingRow {
  id: string;
  node_id: string;
  heading_deg: number | null;
  sha256: string | null;
}

export type Decision =
  | { action: 'upload'; reason: 'new' | 'changed' }
  | { action: 'skip'; reason: 'same' }
  | { action: 'skip'; reason: 'duplicate-elsewhere'; otherId: string };

/**
 * Upload or skip, so that running the script twice changes nothing.
 * - same id and same content (sha256): skip
 * - same content already stored under another id: skip; warn only if it is a different node or heading
 *   (a person should decide which one is right)
 * - same id, different content: upload again (the photo was replaced)
 * - otherwise: new
 */
export function decide(
  photo: Pick<PlannedPhoto, 'id' | 'node_id' | 'heading_deg'>,
  sha256: string,
  byId: ReadonlyMap<string, ExistingRow>,
  bySha: ReadonlyMap<string, ExistingRow>,
): Decision {
  const sameId = byId.get(photo.id);
  if (sameId && sameId.sha256 === sha256) return { action: 'skip', reason: 'same' };
  const sameSha = bySha.get(sha256);
  if (sameSha && sameSha.id !== photo.id) {
    if (sameSha.node_id === photo.node_id && sameSha.heading_deg === photo.heading_deg) return { action: 'skip', reason: 'same' };
    return { action: 'skip', reason: 'duplicate-elsewhere', otherId: sameSha.id };
  }
  return { action: 'upload', reason: sameId ? 'changed' : 'new' };
}

/** Storage paths for one photo. The file name equals the table id so a row and its files match 1:1. */
export const storagePaths = (id: string) => ({ thumb: `thumbs/${id}.webp`, full: `full/${id}.webp` });

/** "--limit=3" and "--limit 3" both work. Unknown options are reported. */
export interface CliOptions {
  dryRun: boolean;
  verbose: boolean;
  limit: number | null;
  survey: string | null;
  surveysDir: string | null;
  campus: string;
  unknown: string[];
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const o: CliOptions = { dryRun: false, verbose: false, limit: null, survey: null, surveysDir: null, campus: CAMPUS_ID_DEFAULT, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = (): string | null => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { i++; return next; }
      return null;
    };
    switch (name) {
      case '--dry-run': o.dryRun = true; break;
      case '--verbose': o.verbose = true; break;
      case '--limit': {
        const n = Number(value());
        if (Number.isInteger(n) && n > 0) o.limit = n; else o.unknown.push(arg);
        break;
      }
      case '--survey': o.survey = value(); break;
      case '--surveys-dir': o.surveysDir = value(); break;
      case '--campus': o.campus = value() ?? CAMPUS_ID_DEFAULT; break;
      default: o.unknown.push(arg);
    }
  }
  return o;
}

export const formatMB = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
