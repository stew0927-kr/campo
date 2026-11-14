// Which photo of a point to show for the way a route goes: the one that looks most nearly along the walking direction.
import type { SurveyAttachment } from './types.ts';
import { normalizeDeg } from './vertical.ts';

/** A photo may be used for a bearing within this many degrees of its own direction. */
export const DEFAULT_BEARING_TOLERANCE_DEG = 45;

/** A photo with the direction it looks (null when nobody set one). */
export interface HeadedPhoto {
  path: string;
  heading_deg: number | null;
}

/** The angle between two directions, 0 to 180. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

/** The photos of an attachment with their directions, in the attachment's order. */
export const headedPhotos = (attachment: Pick<SurveyAttachment, 'photos' | 'photo_meta'>): HeadedPhoto[] =>
  (attachment.photos ?? []).map((path) => ({ path, heading_deg: attachment.photo_meta?.[path]?.heading_deg ?? null }));

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
