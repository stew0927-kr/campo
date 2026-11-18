// Which camera controls to show (CameraCapture). Pure, so the rules are tested in Node; the camera itself is not.
// expo-camera 58 names a lens by its AVFoundation deviceType (not by the localized name any more).
import type { LensInfo } from 'expo-camera';

export const ULTRA_WIDE_LENS = 'AVCaptureDeviceTypeBuiltInUltraWideCamera';
export const WIDE_LENS = 'AVCaptureDeviceTypeBuiltInWideAngleCamera';

export interface LensChoices {
  /** deviceType of the 0.5x lens; null when the phone has none (or the list could not be read). */
  ultraWide: string | null;
  /** deviceType of the 1x lens; null leaves `selectedLens` out, which is the default lens. */
  wide: string | null;
}

export function lensChoices(lenses: readonly Pick<LensInfo, 'deviceType'>[] | null | undefined): LensChoices {
  const types = new Set((lenses ?? []).map((l) => l.deviceType));
  return { ultraWide: types.has(ULTRA_WIDE_LENS) ? ULTRA_WIDE_LENS : null, wide: types.has(WIDE_LENS) ? WIDE_LENS : null };
}

/** The 0.5x / 1x button: only when the phone reports an ultra-wide lens (iOS; the list is empty elsewhere). */
export const showLensToggle = (ultraWide: string | null): boolean => ultraWide !== null;

/**
 * 갤러리에서 선택: always on Android; on iOS only when the lens list has been read (`lensesKnown`, so the button does not
 * flash up while the list is still coming) and has no 0.5x lens to use instead. Not on the web.
 */
export function showGalleryButton(platform: string, ultraWide: string | null, lensesKnown = true): boolean {
  if (platform === 'android') return true;
  return platform === 'ios' && lensesKnown && ultraWide === null;
}

/** The `selectedLens` for the toggle: the ultra-wide when 0.5x is on, else the wide lens, else nothing (the default lens). */
export function selectedLensFor(choices: LensChoices, ultraOn: boolean): string | null {
  return ultraOn && choices.ultraWide !== null ? choices.ultraWide : choices.wide;
}
