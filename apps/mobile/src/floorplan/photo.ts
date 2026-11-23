// How big the floor guide photo is sent: the long side at most FLOORPLAN_MAX_PX, JPEG FLOORPLAN_JPEG_QUALITY. A larger
// body is slower to upload and can pass the Edge Function's request size limit; the room numbers stay readable at this size.

export const FLOORPLAN_MAX_PX = 1600;
export const FLOORPLAN_JPEG_QUALITY = 0.65;

/** The resize to ask for: null when the photo is already small enough (or its size is not known). */
export function shrinkTo(width: number, height: number, maxPx = FLOORPLAN_MAX_PX): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0) || Math.max(width, height) <= maxPx) return null;
  return width >= height ? { width: maxPx } : { height: maxPx };
}

