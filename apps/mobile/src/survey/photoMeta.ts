// What a photo's record keeps besides its direction (survey.schema.json photo_meta): the camera's focal length and the
// picture's size from the EXIF it was taken with, the compass value before the dial, and how the direction was set.
// Pure, so it is tested in Node; the camera only hands its EXIF object in. EXIF is only read here, never written.
import { horizontalFovDeg, type PhotoMeta } from '@campo/core';
import { storedHeading, storedPhotoHeading } from './readings.ts';

/** What is known about a photo when it is taken, before its direction is settled on the dial. */
export type PhotoCapture = Pick<
  PhotoMeta,
  | 'heading_source'
  | 'heading_sensor_deg'
  | 'heading_accuracy'
  | 'heading_ref'
  | 'captured_at'
  | 'focal_length_mm'
  | 'focal_length_35mm'
  | 'hfov_deg'
  | 'width_px'
  | 'height_px'
>;

/** What the camera read from the picture's EXIF. */
export type ExifPhotoInfo = Pick<PhotoCapture, 'focal_length_mm' | 'focal_length_35mm' | 'hfov_deg' | 'width_px' | 'height_px'>;

/** A positive number from an EXIF value: a number, a decimal string, or a rational "425/100" (Android gives strings). */
export function exifNumber(value: unknown): number | undefined {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const parts = value.trim().split('/');
    if (parts.length > 2) return undefined;
    const top = Number(parts[0]);
    const bottom = parts.length === 2 ? Number(parts[1]) : 1;
    n = bottom === 0 ? Number.NaN : top / bottom;
  } else return undefined;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const wholePx = (x: number | undefined): number | undefined => (x !== undefined && x >= 1 ? Math.round(x) : undefined);

/**
 * The focal lengths and the picture's size as taken, from the EXIF of a picture (`exif`), with the camera's own width and
 * height as the fallback for the size. EXIF pixel sizes are stored as the sensor reads them: an Orientation of 5–8 means
 * the picture is shown turned a quarter, so its width and height swap. hfov_deg only when a 35 mm equivalent is known
 * (no default is written into the record).
 */
export function exifPhotoInfo(exif: unknown, picture?: { width?: number; height?: number }): ExifPhotoInfo {
  const e = typeof exif === 'object' && exif !== null ? (exif as Record<string, unknown>) : {};
  const focal = exifNumber(e['FocalLength']);
  const focal35 = exifNumber(e['FocalLenIn35mmFilm']) ?? exifNumber(e['FocalLengthIn35mmFilm']);
  let width = wholePx(exifNumber(e['PixelXDimension']) ?? exifNumber(e['ImageWidth']));
  let height = wholePx(exifNumber(e['PixelYDimension']) ?? exifNumber(e['ImageLength']));
  if (width !== undefined && height !== undefined) {
    const orientation = exifNumber(e['Orientation']);
    if (orientation !== undefined && orientation >= 5 && orientation <= 8) [width, height] = [height, width];
  } else {
    width = wholePx(exifNumber(picture?.width));
    height = wholePx(exifNumber(picture?.height));
  }
  const info: ExifPhotoInfo = {};
  if (focal !== undefined) info.focal_length_mm = Math.round(focal * 100) / 100;
  if (focal35 !== undefined) info.focal_length_35mm = Math.round(focal35 * 10) / 10;
  if (width !== undefined && height !== undefined) {
    info.width_px = width;
    info.height_px = height;
  }
  if (focal35 !== undefined) info.hfov_deg = round1(horizontalFovDeg(info.width_px, info.height_px, focal35));
  return info;
}

/**
 * The record of one photo as it is taken: when, what the compass said (stored like the record's heading, before any dial
 * correction) and how sure it was, and what the EXIF says. `headingRef` only when the sensor said which north it uses.
 */
export function photoCapture(input: {
  at: string;
  sensorDeg: number | null;
  accuracy?: 0 | 1 | 2 | 3 | null | undefined;
  headingRef?: 'true' | 'magnetic' | null | undefined;
  exif?: ExifPhotoInfo | undefined;
}): PhotoCapture {
  const capture: PhotoCapture = { captured_at: input.at, ...input.exif };
  if (input.sensorDeg !== null) {
    capture.heading_sensor_deg = storedHeading(input.sensorDeg);
    if (input.accuracy !== null && input.accuracy !== undefined) capture.heading_accuracy = input.accuracy;
    if (input.headingRef) capture.heading_ref = input.headingRef;
  }
  return capture;
}

/**
 * How a direction was set: 'manual' with no compass value to start from, 'sensor' when it is the compass value as taken
 * (in whole degrees, as the dial shows it), 'dial' when it was turned on the dial.
 */
export function headingSourceFor(sensorDeg: number | null | undefined, headingDeg: number): 'sensor' | 'dial' | 'manual' {
  if (sensorDeg === null || sensorDeg === undefined) return 'manual';
  return storedPhotoHeading(sensorDeg) === storedPhotoHeading(headingDeg) ? 'sensor' : 'dial';
}

/**
 * A photo's record with `patch` laid over it: every field the patch does not name is kept (a new direction never drops
 * the focal length or the sensor value). A field set to undefined in the patch is removed. undefined when nothing is left.
 */
export function mergePhotoMeta(old: PhotoMeta | undefined, patch: { [K in keyof PhotoMeta]?: PhotoMeta[K] | undefined }): PhotoMeta | undefined {
  const next: Record<string, unknown> = { ...old };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length > 0 ? (next as PhotoMeta) : undefined;
}

/**
 * The record of a new photo: its capture, and its direction when one was set. How the direction was set is written only
 * when the capture is known (older callers pass none, and nothing is guessed for them).
 */
export function newPhotoMeta(headingDeg: number | null | undefined, capture: PhotoCapture | null | undefined): PhotoMeta | undefined {
  const heading = headingDeg === null || headingDeg === undefined ? undefined : storedPhotoHeading(headingDeg);
  const source = heading !== undefined && capture ? capture.heading_source ?? headingSourceFor(capture.heading_sensor_deg, heading) : undefined;
  const { heading_source: _given, ...rest } = capture ?? {};
  return mergePhotoMeta(heading !== undefined ? { heading_deg: heading } : undefined, { ...rest, heading_source: source });
}
