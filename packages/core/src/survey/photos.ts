// Which photo of a point to show for the way a route goes: the one that looks most nearly along the walking direction.
import { signedDiffDeg, type StepBearing } from '../route/bearing.ts';
import type { PhotoMeta, SurveyAttachment } from './types.ts';
import { normalizeDeg } from './vertical.ts';

export { signedDiffDeg };

/** A photo may be used for a bearing within this many degrees of its own direction. */
export const DEFAULT_BEARING_TOLERANCE_DEG = 45;

/** A photo with the direction it looks (null when nobody set one). */
export interface HeadedPhoto {
  path: string;
  heading_deg: number | null;
  /** How the direction was set, when known: a dial check is trusted over a bare sensor value on a tie. */
  heading_source?: PhotoMeta['heading_source'];
}

/** The angle between two directions, 0 to 180. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

/** The photos of an attachment with their directions, in the attachment's order. */
export const headedPhotos = (attachment: Pick<SurveyAttachment, 'photos' | 'photo_meta'>): HeadedPhoto[] =>
  (attachment.photos ?? []).map((path) => {
    const meta = attachment.photo_meta?.[path];
    return { path, heading_deg: meta?.heading_deg ?? null, ...(meta?.heading_source ? { heading_source: meta.heading_source } : {}) };
  });

/**
 * The photo whose direction is closest to `bearingDeg`, if it is within `toleranceDeg` (default ±45°). Photos without a
 * direction are never picked; when two are equally close the earlier one wins. null when none fits.
 */
export function pickPhotoByBearing(photos: readonly HeadedPhoto[], bearingDeg: number, toleranceDeg = DEFAULT_BEARING_TOLERANCE_DEG): HeadedPhoto | null {
  let best: HeadedPhoto | null = null;
  let bestDiff = Infinity;
  for (const p of photos) {
    if (p.heading_deg === null) continue;
    const diff = angleDiffDeg(p.heading_deg, bearingDeg);
    if (diff <= toleranceDeg && diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

// ---- choosing a photo for a route step, and the arrow drawn on it ----

/** Wider than DEFAULT_BEARING_TOLERANCE_DEG, with a "may not face that way" badge. Beyond it a photo looks the other way. */
export const APPROXIMATE_TOLERANCE_DEG = 90;
/** Horizontal field of view of a 1x phone camera (35 mm equivalent about 26–27 mm, 4:3 landscape) when nothing better is known. */
export const DEFAULT_HFOV_DEG = 65;
/** Beyond this angle off the photo's direction the way to go is behind the viewer: a U-turn. */
export const BEHIND_DEG = 135;

/** The photo shown for a step and how it was found. deltaDeg: the way to go minus the photo's direction (-180..180, + = right). */
export type PhotoPick =
  /** Looks the way the route leaves the point (±45°). */
  | { kind: 'ahead'; photo: HeadedPhoto; deltaDeg: number }
  /** Looks the way the route arrives (±45°); the arrow still points the way it leaves (deltaDeg is against outDeg). */
  | { kind: 'approach'; photo: HeadedPhoto; deltaDeg: number }
  /** The nearest within ±90°: show with a "정면이 아닐 수 있음" badge. */
  | { kind: 'approximate'; photo: HeadedPhoto; deltaDeg: number }
  | { kind: 'none' };

const rankOf = (p: HeadedPhoto): number => (p.heading_source === 'dial' ? 0 : 1);

/**
 * The photos with a direction within `toleranceDeg` of `bearingDeg`, best first: closest angle, then a dial-checked
 * direction, then the original order. Photos without a direction are never in it.
 */
function ranked(photos: readonly HeadedPhoto[], bearingDeg: number, toleranceDeg: number): HeadedPhoto[] {
  return photos
    .map((photo, i) => ({ photo, i, diff: photo.heading_deg === null ? Infinity : angleDiffDeg(photo.heading_deg, bearingDeg) }))
    .filter((x) => x.diff <= toleranceDeg)
    .sort((a, b) => a.diff - b.diff || rankOf(a.photo) - rankOf(b.photo) || a.i - b.i)
    .map((x) => x.photo);
}

/**
 * The photo of a point for a route step, falling back in order (none of them ever picks a photo without a direction):
 * 1. looking the way the route leaves, within `toleranceDeg` (default ±45°) → 'ahead';
 * 2. looking the way it arrives, within `toleranceDeg` → 'approach' (the arrow is still drawn for the way it leaves);
 * 3. the nearest within ±90° of the way it leaves → 'approximate' (badge);
 * 4. 'none' (the step is told in words and on the map).
 * At the destination (no outDeg) the way it arrives takes the place of the way it leaves.
 */
export function choosePhotoForStep(photos: readonly HeadedPhoto[], bearing: Pick<StepBearing, 'outDeg' | 'inDeg'>, toleranceDeg = DEFAULT_BEARING_TOLERANCE_DEG): PhotoPick {
  const target = bearing.outDeg ?? bearing.inDeg;
  if (target === null) return { kind: 'none' };
  const delta = (photo: HeadedPhoto): number => signedDiffDeg(target, photo.heading_deg!);
  const ahead = ranked(photos, target, toleranceDeg)[0];
  if (ahead) return { kind: 'ahead', photo: ahead, deltaDeg: delta(ahead) };
  if (bearing.outDeg !== null && bearing.inDeg !== null) {
    const approach = ranked(photos, bearing.inDeg, toleranceDeg)[0];
    if (approach) return { kind: 'approach', photo: approach, deltaDeg: delta(approach) };
  }
  const near = ranked(photos, target, Math.max(toleranceDeg, APPROXIMATE_TOLERANCE_DEG))[0];
  return near ? { kind: 'approximate', photo: near, deltaDeg: delta(near) } : { kind: 'none' };
}

/**
 * All photos of a point in the order the viewer lists them ("이 지점 다른 사진"): with a bearing, closest angle first;
 * then a dial-checked direction; then the original order. Photos without a direction come last, in their order.
 */
export function photosForPoint(photos: readonly HeadedPhoto[], bearingDeg: number | null = null): HeadedPhoto[] {
  const withHeading = photos
    .map((photo, i) => ({ photo, i, diff: photo.heading_deg === null || bearingDeg === null ? 0 : angleDiffDeg(photo.heading_deg, bearingDeg) }))
    .filter((x) => x.photo.heading_deg !== null)
    .sort((a, b) => a.diff - b.diff || rankOf(a.photo) - rankOf(b.photo) || a.i - b.i)
    .map((x) => x.photo);
  return [...withHeading, ...photos.filter((p) => p.heading_deg === null)];
}

/** Where the way to go is, seen from the middle of the photo (Korean, polite; shown and read out as is). */
export function directionLabel(deltaDeg: number): string {
  const d = signedDiffDeg(deltaDeg, 0);
  const a = Math.abs(d);
  if (a < 15) return '정면';
  if (a > 165) return '뒤로';
  const side = d > 0 ? '오른쪽' : '왼쪽';
  if (a < 60) return `약간 ${side}`;
  if (a < 120) return side;
  return `뒤쪽 ${side}`;
}

/** How to draw the way to go on a photo. */
export interface ArrowModel {
  /** inFrame: the way to go is inside the photo; edge: off to one side; behind: more than 135° off (a U-turn). */
  mode: 'inFrame' | 'edge' | 'behind';
  /** Turn of the arrow from straight up (the photo's direction), degrees clockwise. */
  rotateDeg: number;
  /** inFrame only: where the way to go is across the photo, 0 (left edge) to 1 (right edge), by the pinhole model. */
  xRatio?: number;
  /** directionLabel of the same angle. */
  label: string;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const rad = (d: number): number => (d * Math.PI) / 180;

/** The arrow for a way to go `deltaDeg` off the photo's direction, in a photo `hfovDeg` wide (default 65°). */
export function arrowFor(deltaDeg: number, hfovDeg = DEFAULT_HFOV_DEG): ArrowModel {
  const d = signedDiffDeg(deltaDeg, 0);
  const half = (Number.isFinite(hfovDeg) && hfovDeg > 0 && hfovDeg < 180 ? hfovDeg : DEFAULT_HFOV_DEG) / 2;
  const label = directionLabel(d);
  const a = Math.abs(d);
  if (a <= half) {
    const f = 0.5 / Math.tan(rad(half));
    return { mode: 'inFrame', rotateDeg: d, xRatio: clamp01(0.5 + f * Math.tan(rad(d))), label };
  }
  return { mode: a > BEHIND_DEG ? 'behind' : 'edge', rotateDeg: d, label };
}

/** Diagonal of a 36 × 24 mm frame: what a 35 mm equivalent focal length is measured against. */
const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
const positive = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/**
 * Horizontal field of view (degrees) of a photo from its 35 mm equivalent focal length. The equivalent is taken on the
 * diagonal, so the photo's own shape decides the horizontal share: a portrait photo is narrower (about 51° against 65°
 * for a 1x phone camera). Without pixel sizes 4:3 landscape is assumed; without a focal length, DEFAULT_HFOV_DEG.
 */
export function horizontalFovDeg(widthPx?: number | null, heightPx?: number | null, focal35mm?: number | null): number {
  if (!positive(focal35mm)) return DEFAULT_HFOV_DEG;
  const [w, h] = positive(widthPx) && positive(heightPx) ? [widthPx, heightPx] : [4, 3];
  const sensorWidthMm = (FULL_FRAME_DIAGONAL_MM * w) / Math.hypot(w, h);
  return (2 * Math.atan(sensorWidthMm / (2 * focal35mm)) * 180) / Math.PI;
}
