// Picking the photo of a point that matches the walking direction, and the photo_meta field of a survey file.
import { describe, expect, it } from 'vitest';
import { angleDiffDeg, headedPhotos, normalizeDeg, pickPhotoByBearing, validateSurvey, type Survey } from '../../src/index.ts';

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

  it('refuses a direction of 360 or more, a negative one, and a key that is not a photo path', () => {
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { heading_deg: 360 } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'photos/n_1-1.jpg': { heading_deg: -1 } })).ok).toBe(false);
    expect(validateSurvey(survey({ 'notes.txt': { heading_deg: 10 } })).ok).toBe(false);
  });
});
