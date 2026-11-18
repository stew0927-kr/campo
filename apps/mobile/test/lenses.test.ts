import { describe, expect, it } from 'vitest';
import { ULTRA_WIDE_LENS, WIDE_LENS, lensChoices, selectedLensFor, showGalleryButton, showLensToggle } from '../src/ui/lenses.ts';

const lens = (deviceType: string) => ({ deviceType, localizedName: 'Back Ultra Wide Camera' });

describe('lensChoices', () => {
  it('finds the 0.5x and 1x lenses by deviceType (not by the localized name)', () => {
    const all = [lens(WIDE_LENS), lens(ULTRA_WIDE_LENS), lens('AVCaptureDeviceTypeBuiltInTelephotoCamera')];
    expect(lensChoices(all)).toEqual({ ultraWide: ULTRA_WIDE_LENS, wide: WIDE_LENS });
    expect(lensChoices([lens('x')])).toEqual({ ultraWide: null, wide: null });
  });
  it('an empty, missing or wide-only list has no 0.5x lens', () => {
    expect(lensChoices([])).toEqual({ ultraWide: null, wide: null });
    expect(lensChoices(undefined)).toEqual({ ultraWide: null, wide: null });
    expect(lensChoices(null)).toEqual({ ultraWide: null, wide: null });
    expect(lensChoices([lens(WIDE_LENS)])).toEqual({ ultraWide: null, wide: WIDE_LENS });
  });
});

describe('which buttons show', () => {
  it('the 0.5x toggle only with an ultra-wide lens', () => {
    expect(showLensToggle(ULTRA_WIDE_LENS)).toBe(true);
    expect(showLensToggle(null)).toBe(false);
  });
  it('the gallery button: always on Android; on iOS only without 0.5x and once the lens list is known; never on the web', () => {
    expect(showGalleryButton('android', null)).toBe(true);
    expect(showGalleryButton('android', ULTRA_WIDE_LENS)).toBe(true);
    expect(showGalleryButton('ios', null)).toBe(true);
    expect(showGalleryButton('ios', ULTRA_WIDE_LENS)).toBe(false);
    expect(showGalleryButton('ios', null, false)).toBe(false);
    expect(showGalleryButton('web', null)).toBe(false);
  });
  it('selectedLens: 0.5x → ultra-wide; 1x → the wide lens, or nothing (default lens) when there is none', () => {
    expect(selectedLensFor({ ultraWide: ULTRA_WIDE_LENS, wide: WIDE_LENS }, true)).toBe(ULTRA_WIDE_LENS);
    expect(selectedLensFor({ ultraWide: ULTRA_WIDE_LENS, wide: WIDE_LENS }, false)).toBe(WIDE_LENS);
    expect(selectedLensFor({ ultraWide: ULTRA_WIDE_LENS, wide: null }, false)).toBeNull();
    expect(selectedLensFor({ ultraWide: null, wide: null }, true)).toBeNull();
  });
});
