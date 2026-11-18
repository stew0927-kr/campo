// Picking the photo of a point that matches the walking direction, and the photo_meta field of a survey file.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HFOV_DEG,
  angleDiffDeg,
  arrowFor,
  choosePhotoForStep,
  directionLabel,
  headedPhotos,
  horizontalFovDeg,
  normalizeDeg,
  photosForPoint,
  pickPhotoByBearing,
  validateSurvey,
  type HeadedPhoto,
  type Survey,
} from '../../src/index.ts';

const photos = [
  { path: 'photos/a-1.jpg', heading_deg: 10 },
  { path: 'photos/a-2.jpg', heading_deg: 190 },
  { path: 'photos/a-3.jpg', heading_deg: null },
];

describe('pickPhotoByBearing', () => {
  it('folds angles and measures the short way round', () => {
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(370)).toBe(10);
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(0, 180)).toBe(180);
  });

  it('picks the photo that looks most nearly along the bearing, in both directions of a corridor', () => {
    expect(pickPhotoByBearing(photos, 0)?.path).toBe('photos/a-1.jpg');
    expect(pickPhotoByBearing(photos, 200)?.path).toBe('photos/a-2.jpg');
    expect(pickPhotoByBearing(photos, 355)?.path).toBe('photos/a-1.jpg'); // across north
  });

  it('is limited by the tolerance (default ±45°) and ignores photos without a direction', () => {
    expect(pickPhotoByBearing(photos, 55)?.path).toBe('photos/a-1.jpg'); // exactly 45° away
    expect(pickPhotoByBearing(photos, 56)).toBeNull();
    expect(pickPhotoByBearing(photos, 100, 100)?.path).toBe('photos/a-1.jpg');
    expect(pickPhotoByBearing([{ path: 'photos/x.jpg', heading_deg: null }], 0, 180)).toBeNull();
    expect(pickPhotoByBearing([], 0)).toBeNull();
  });

  it('on a tie the earlier photo wins', () => {
    const two = [{ path: 'photos/p-1.jpg', heading_deg: 80 }, { path: 'photos/p-2.jpg', heading_deg: 100 }];
    expect(pickPhotoByBearing(two, 90)?.path).toBe('photos/p-1.jpg');
  });
});

describe('photo_meta in a survey file', () => {
  const survey = (meta: unknown): Survey => {
    const attachment: Record<string, unknown> = { recorded_at: '2026-11-14T10:00:00+09:00', photos: ['photos/n_1-1.jpg', 'photos/n_1-2.jpg'] };
    if (meta !== undefined) attachment['photo_meta'] = meta;
    return {
      format: 'campo-survey', version: 1, id: 'sv-20261114-test', campus: 'c', surveyed_at: '2026-11-14T10:00:00+09:00',
      attachments: { n_1: attachment }, vertical: [],
    } as unknown as Survey;
  };

  it('accepts a direction per photo and hands the directions to the picker; old files without photo_meta still load', () => {
    const ok = survey({ 'photos/n_1-1.jpg': { heading_deg: 87 }, 'photos/n_1-2.jpg': { heading_deg: 267 } });
    expect(validateSurvey(ok)).toMatchObject({ ok: true });
    expect(pickPhotoByBearing(headedPhotos(ok.attachments['n_1']!), 270)?.path).toBe('photos/n_1-2.jpg');
    const old = survey(undefined);
    expect(validateSurvey(old)).toMatchObject({ ok: true });
    expect(headedPhotos(old.attachments['n_1']!).map((p) => p.heading_deg)).toEqual([null, null]);
  });

  it('accepts the optional capture fields (source, sensor value, accuracy, focal length, size, hint) and refuses bad ones', () => {
    const full = {
      heading_deg: 87, heading_source: 'dial', heading_sensor_deg: 95.5, heading_accuracy: 2, heading_ref: 'magnetic',
      captured_at: '2026-11-14T10:00:05+09:00', focal_length_mm: 4.25, focal_length_35mm: 27, hfov_deg: 65.3,
      width_px: 4032, height_px: 3024, direction_hint: '사진 오른쪽 두 번째 문',
    };
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': full }))).toMatchObject({ ok: true });
    expect(headedPhotos(survey({ 'photos/n_1-1.jpg': full }).attachments['n_1']!)[0]).toEqual({ path: 'photos/n_1-1.jpg', heading_deg: 87, heading_source: 'dial' });
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { heading_source: 'guess' } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { heading_accuracy: 4 } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { width_px: 0 } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { captured_at: 'yesterday' } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { unknown_field: 1 } })).ok).toBe(false);
  });

  it('refuses a direction of 360 or more, a negative one, and a key that is not a photo path', () => {
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { heading_deg: 360 } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { heading_deg: -1 } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'notes.txt': { heading_deg: 10 } })).ok).toBe(false);
  });
});

describe('choosePhotoForStep', () => {
  const p = (path: string, heading_deg: number | null, heading_source?: HeadedPhoto['heading_source']): HeadedPhoto =>
    ({ path, heading_deg, ...(heading_source ? { heading_source } : {}) });

  it('1. the photo looking the way the route leaves, within ±45°', () => {
    const pick = choosePhotoForStep([p('a', 200), p('b', 30)], { outDeg: 0, inDeg: 180 });
    expect(pick).toEqual({ kind: 'ahead', photo: p('b', 30), deltaDeg: -30 });
  });

  it('2. else the photo looking the way it arrives; the arrow is still for the way it leaves', () => {
    // Arrived heading north (0°), leaves east (90°): a photo looking north (10°) says turn right by 80°.
    const pick = choosePhotoForStep([p('a', 10)], { outDeg: 90, inDeg: 0 });
    expect(pick).toEqual({ kind: 'approach', photo: p('a', 10), deltaDeg: 80 });
  });

  it('3. else the nearest within ±90° (badge); 4. else none', () => {
    expect(choosePhotoForStep([p('a', 160)], { outDeg: 90, inDeg: 270 })).toEqual({ kind: 'approximate', photo: p('a', 160), deltaDeg: -70 });
    expect(choosePhotoForStep([p('a', 181)], { outDeg: 90, inDeg: 0 })).toEqual({ kind: 'none' });
    expect(choosePhotoForStep([], { outDeg: 90, inDeg: 0 })).toEqual({ kind: 'none' });
    expect(choosePhotoForStep([p('a', 90)], { outDeg: null, inDeg: null })).toEqual({ kind: 'none' });
  });

  it('keeps the ±45° edge exact: 45° is ahead, 46° is not', () => {
    expect(choosePhotoForStep([p('a', 45)], { outDeg: 0, inDeg: null }).kind).toBe('ahead');
    expect(choosePhotoForStep([p('a', 46)], { outDeg: 0, inDeg: null }).kind).toBe('approximate');
    expect(choosePhotoForStep([p('a', 90)], { outDeg: 0, inDeg: null }).kind).toBe('approximate');
    expect(choosePhotoForStep([p('a', 91)], { outDeg: 0, inDeg: null }).kind).toBe('none');
  });

  it('at the destination (no way out) the way in takes its place', () => {
    expect(choosePhotoForStep([p('a', 100)], { outDeg: null, inDeg: 90 })).toEqual({ kind: 'ahead', photo: p('a', 100), deltaDeg: -10 });
  });

  it('never picks a photo without a direction, at any stage', () => {
    expect(choosePhotoForStep([p('a', null), p('b', null)], { outDeg: 0, inDeg: 0 })).toEqual({ kind: 'none' });
  });

  it('on a tie: closest angle, then a dial-checked direction, then the earlier photo', () => {
    expect(choosePhotoForStep([p('a', 20), p('b', 10)], { outDeg: 0, inDeg: null })).toMatchObject({ photo: { path: 'b' } });
    expect(choosePhotoForStep([p('a', 10, 'sensor'), p('b', 350, 'dial')], { outDeg: 0, inDeg: null })).toMatchObject({ photo: { path: 'b' } });
    expect(choosePhotoForStep([p('a', 10), p('b', 350)], { outDeg: 0, inDeg: null })).toMatchObject({ photo: { path: 'a' } });
  });

  it('pickPhotoByBearing is unchanged: on a tie the earlier wins even when the later one was checked on the dial', () => {
    expect(pickPhotoByBearing([p('a', 10, 'sensor'), p('b', 350, 'dial')], 0)?.path).toBe('a');
  });
});

describe('photosForPoint', () => {
  it('lists closest first (dial before sensor on a tie), photos without a direction last in their order', () => {
    const list = [
      { path: 'x', heading_deg: null },
      { path: 'a', heading_deg: 180 },
      { path: 'b', heading_deg: 10, heading_source: 'sensor' as const },
      { path: 'c', heading_deg: 350, heading_source: 'dial' as const },
      { path: 'y', heading_deg: null },
    ];
    expect(photosForPoint(list, 0).map((q) => q.path)).toEqual(['c', 'b', 'a', 'x', 'y']);
    expect(photosForPoint(list).map((q) => q.path)).toEqual(['c', 'a', 'b', 'x', 'y']);
    expect(photosForPoint([])).toEqual([]);
  });
});

describe('directionLabel', () => {
  it('names the way to go seen from the photo, in Korean', () => {
    expect(directionLabel(0)).toBe('정면');
    expect(directionLabel(14.9)).toBe('정면');
    expect(directionLabel(-14.9)).toBe('정면');
    expect(directionLabel(15)).toBe('약간 오른쪽');
    expect(directionLabel(-30)).toBe('약간 왼쪽');
    expect(directionLabel(60)).toBe('오른쪽');
    expect(directionLabel(-90)).toBe('왼쪽');
    expect(directionLabel(120)).toBe('뒤쪽 오른쪽');
    expect(directionLabel(-165)).toBe('뒤쪽 왼쪽');
    expect(directionLabel(166)).toBe('뒤로');
    expect(directionLabel(180)).toBe('뒤로');
    expect(directionLabel(-180)).toBe('뒤로');
    expect(directionLabel(350)).toBe('정면'); // folded to -10
  });
});

describe('arrowFor', () => {
  it('inside the frame (|Δ| ≤ hfov/2): rotated, and placed across the photo by the pinhole model', () => {
    expect(arrowFor(0)).toEqual({ mode: 'inFrame', rotateDeg: 0, xRatio: 0.5, label: '정면' });
    const right = arrowFor(32.5); // the right edge of a 65° photo
    expect(right.mode).toBe('inFrame');
    expect(right.xRatio).toBeCloseTo(1, 6);
    expect(arrowFor(-32.5).xRatio).toBeCloseTo(0, 6);
    const r20 = arrowFor(20);
    expect(r20.xRatio).toBeCloseTo(0.5 + (0.5 / Math.tan((32.5 * Math.PI) / 180)) * Math.tan((20 * Math.PI) / 180), 9);
    expect(r20.label).toBe('약간 오른쪽');
  });

  it('outside the frame: an edge arrow up to 135°, beyond that a U-turn', () => {
    expect(arrowFor(33)).toEqual({ mode: 'edge', rotateDeg: 33, label: '약간 오른쪽' });
    expect(arrowFor(-90)).toEqual({ mode: 'edge', rotateDeg: -90, label: '왼쪽' });
    expect(arrowFor(135).mode).toBe('edge');
    expect(arrowFor(136)).toEqual({ mode: 'behind', rotateDeg: 136, label: '뒤쪽 오른쪽' });
    expect(arrowFor(180).mode).toBe('behind');
  });

  it('a narrower photo (portrait, 51°) puts 30° outside it', () => {
    expect(arrowFor(30, 51).mode).toBe('edge');
    expect(arrowFor(30, 65).mode).toBe('inFrame');
    expect(arrowFor(30, Number.NaN).mode).toBe('inFrame'); // falls back to 65°
  });
});

describe('horizontalFovDeg', () => {
  it('from the 35 mm equivalent on the diagonal: about 65° landscape and 51° portrait for 27 mm', () => {
    expect(horizontalFovDeg(4032, 3024, 27)).toBeCloseTo(65.2, 0);
    expect(horizontalFovDeg(3024, 4032, 27)).toBeCloseTo(51.3, 0);
    expect(horizontalFovDeg(3024, 4032, 27)).toBeLessThan(horizontalFovDeg(4032, 3024, 27));
    expect(horizontalFovDeg(null, null, 27)).toBeCloseTo(horizontalFovDeg(4, 3, 27), 9); // 4:3 landscape assumed
    expect(horizontalFovDeg(4032, 3024, 13)).toBeGreaterThan(100); // ultra-wide
  });

  it('without a focal length: the default 65°', () => {
    expect(horizontalFovDeg(4032, 3024, undefined)).toBe(DEFAULT_HFOV_DEG);
    expect(horizontalFovDeg(4032, 3024, 0)).toBe(65);
    expect(horizontalFovDeg()).toBe(65);
  });
});
