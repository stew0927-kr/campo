// What a photo's record keeps besides its direction (survey/photoMeta.ts) and how the session writes it (survey/session.ts).
// The camera itself is not run: its picture object (uri, size, EXIF) is stood in for by plain objects.
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdGen, headedPhotos, validateSurvey, type EditState } from '@campo/core';
import { exifNumber, exifPhotoInfo, headingSourceFor, mergePhotoMeta, newPhotoMeta, photoCapture } from '../src/survey/photoMeta.ts';
import { planDoor } from '../src/survey/plans.ts';
import { SurveySession } from '../src/survey/session.ts';
import { SENSOR_HEADING_REF, headingAccuracyClass } from '../src/sensors/heading.ts';
import { AT, CAMPUS, SOURCE, fixture } from './helpers.ts';

/** What expo-camera's takePictureAsync({ exif: true }) gives on an iPhone (numbers) and on Android (strings). */
const IOS_EXIF = { FocalLength: 4.25, FocalLenIn35mmFilm: 27, PixelXDimension: 4032, PixelYDimension: 3024, Orientation: 1 };
const ANDROID_EXIF = { FocalLength: '4250/1000', FocalLengthIn35mmFilm: '26', ImageWidth: '4000', ImageLength: '3000', Orientation: '6' };

describe('exifPhotoInfo', () => {
  it('reads the focal lengths and the size, and works out the horizontal field of view (landscape about 65°)', () => {
    expect(exifPhotoInfo(IOS_EXIF, { width: 4032, height: 3024 })).toEqual({
      focal_length_mm: 4.25, focal_length_35mm: 27, width_px: 4032, height_px: 3024, hfov_deg: 65.3,
    });
  });

  it('a portrait picture (EXIF Orientation 6: turned a quarter) swaps width and height and is narrower (about 53° for 26 mm)', () => {
    const info = exifPhotoInfo(ANDROID_EXIF);
    expect(info).toMatchObject({ focal_length_mm: 4.25, focal_length_35mm: 26, width_px: 3000, height_px: 4000 });
    expect(info.hfov_deg).toBeGreaterThan(50);
    expect(info.hfov_deg).toBeLessThan(55);
    expect(exifPhotoInfo({ ...IOS_EXIF, PixelXDimension: 3024, PixelYDimension: 4032 }).hfov_deg).toBe(51.4);
  });

  it('without a focal length: the size only, and no field of view is written (no default goes into the record)', () => {
    expect(exifPhotoInfo({ PixelXDimension: 4032, PixelYDimension: 3024 })).toEqual({ width_px: 4032, height_px: 3024 });
    expect(exifPhotoInfo({ FocalLength: 4.25 })).toEqual({ focal_length_mm: 4.25 });
  });

  it('without EXIF pixel sizes the picture\'s own width and height are used; with nothing, nothing', () => {
    expect(exifPhotoInfo({}, { width: 3024, height: 4032 })).toEqual({ width_px: 3024, height_px: 4032 });
    expect(exifPhotoInfo(undefined, { width: 3024, height: 4032 })).toEqual({ width_px: 3024, height_px: 4032 });
    expect(exifPhotoInfo(null)).toEqual({});
    expect(exifPhotoInfo('not exif')).toEqual({});
    expect(exifPhotoInfo({ FocalLength: 'abc', FocalLenIn35mmFilm: -1, PixelXDimension: 0 }, {})).toEqual({});
  });

  it('a 35 mm equivalent without a size assumes 4:3 landscape', () => {
    expect(exifPhotoInfo({ FocalLenIn35mmFilm: 27 })).toEqual({ focal_length_35mm: 27, hfov_deg: 65.3 });
  });

  it('exifNumber reads numbers, decimal strings and rationals; rejects zero, negatives and junk', () => {
    expect(exifNumber(4.25)).toBe(4.25);
    expect(exifNumber('4.25')).toBe(4.25);
    expect(exifNumber('425/100')).toBe(4.25);
    expect(exifNumber('1/0')).toBeUndefined();
    expect(exifNumber('1/2/3')).toBeUndefined();
    expect(exifNumber(0)).toBeUndefined();
    expect(exifNumber(-3)).toBeUndefined();
    expect(exifNumber(null)).toBeUndefined();
  });
});

describe('photoCapture / headingSourceFor / mergePhotoMeta', () => {
  it('keeps the compass value before the dial, its accuracy and its north, and the EXIF', () => {
    expect(photoCapture({ at: AT, sensorDeg: 87.44, accuracy: 2, headingRef: SENSOR_HEADING_REF, exif: { focal_length_35mm: 27 } })).toEqual({
      captured_at: AT, heading_sensor_deg: 87.4, heading_accuracy: 2, heading_ref: 'magnetic', focal_length_35mm: 27,
    });
  });

  it('without a compass value there is no accuracy or north to write', () => {
    expect(photoCapture({ at: AT, sensorDeg: null, accuracy: 3, headingRef: 'magnetic' })).toEqual({ captured_at: AT });
    expect(photoCapture({ at: AT, sensorDeg: 10, accuracy: null, headingRef: null })).toEqual({ captured_at: AT, heading_sensor_deg: 10 });
  });

  it('names how a direction was set', () => {
    expect(headingSourceFor(null, 90)).toBe('manual');
    expect(headingSourceFor(undefined, 90)).toBe('manual');
    expect(headingSourceFor(87.4, 87)).toBe('sensor');
    expect(headingSourceFor(359.7, 0)).toBe('sensor');
    expect(headingSourceFor(87.4, 95)).toBe('dial');
  });

  it('merging never drops a field the patch does not name; undefined removes one', () => {
    const old = { heading_deg: 87, heading_sensor_deg: 95.5, focal_length_35mm: 27, width_px: 4032, height_px: 3024 };
    expect(mergePhotoMeta(old, { heading_deg: 90, heading_source: 'dial' })).toEqual({ ...old, heading_deg: 90, heading_source: 'dial' });
    expect(mergePhotoMeta(old, { heading_deg: undefined })).toEqual({ heading_sensor_deg: 95.5, focal_length_35mm: 27, width_px: 4032, height_px: 3024 });
    expect(mergePhotoMeta({ heading_deg: 1 }, { heading_deg: undefined })).toBeUndefined();
    expect(mergePhotoMeta(undefined, {})).toBeUndefined();
  });

  it('a new photo: the direction as stored, and how it was set only when the capture is known', () => {
    expect(newPhotoMeta(87.4, null)).toEqual({ heading_deg: 87 });
    expect(newPhotoMeta(null, null)).toBeUndefined();
    expect(newPhotoMeta(95, { captured_at: AT, heading_sensor_deg: 87.4 })).toEqual({ heading_deg: 95, heading_source: 'dial', captured_at: AT, heading_sensor_deg: 87.4 });
    expect(newPhotoMeta(87, { captured_at: AT, heading_sensor_deg: 87.4 })).toMatchObject({ heading_source: 'sensor' });
    expect(newPhotoMeta(87, { captured_at: AT })).toMatchObject({ heading_source: 'manual' });
    expect(newPhotoMeta(null, { captured_at: AT, heading_sensor_deg: 87.4 })).toEqual({ captured_at: AT, heading_sensor_deg: 87.4 });
  });
});

describe('heading sensor helpers', () => {
  it('passes only the four accuracy classes', () => {
    expect([0, 1, 2, 3].map(headingAccuracyClass)).toEqual([0, 1, 2, 3]);
    expect([-1, 4, 1.5, '2', null, undefined].map(headingAccuracyClass)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe('photo records in a walk', () => {
  let base: EditState;
  beforeAll(async () => {
    ({ state: base } = await fixture());
  });
  const newSession = () => new SurveySession({ campus: CAMPUS, base, ids: createIdGen(4), startedAt: AT });

  function recordDoor(s: SurveySession, roomRef: string, headings: (number | null)[], captures: Parameters<SurveySession['addPhotos']>[4]) {
    const plan = planDoor({ state: s.state, ctx: s.ctx, scope: { kind: 'building', buildingId: 'bldg_A', level: 3 }, coord: [127.00061, 37.00042], anchorId: null, source: SOURCE }, { roomRef, doorRole: 'front' });
    if ('error' in plan) throw new Error(plan.error);
    const paths = s.record(plan, { at: AT, pressureHpa: null, headingDeg: 12, photos: headings.length, photoHeadings: headings, ...(captures ? { photoCaptures: captures } : {}) });
    return { id: plan.featureId, paths };
  }

  it('writes each picture\'s capture with its direction and how it was set; the survey file validates', () => {
    const s = newSession();
    const lens = exifPhotoInfo(IOS_EXIF);
    const { id, paths } = recordDoor(s, '301', [87, 270], [
      photoCapture({ at: AT, sensorDeg: 87.2, accuracy: 3, headingRef: 'magnetic', exif: lens }),
      photoCapture({ at: AT, sensorDeg: 250, accuracy: 1, headingRef: 'magnetic', exif: lens }),
    ]);
    const meta = s.attachments[id]!.photo_meta!;
    expect(meta[paths[0]!]).toEqual({
      heading_deg: 87, heading_source: 'sensor', heading_sensor_deg: 87.2, heading_accuracy: 3, heading_ref: 'magnetic', captured_at: AT,
      focal_length_mm: 4.25, focal_length_35mm: 27, width_px: 4032, height_px: 3024, hfov_deg: 65.3,
    });
    expect(meta[paths[1]!]).toMatchObject({ heading_deg: 270, heading_source: 'dial', heading_sensor_deg: 250 });
    const survey = s.toSurvey('meta', AT);
    expect(validateSurvey(survey)).toMatchObject({ ok: true });
    expect(headedPhotos(survey.attachments[id]!).map((p) => p.heading_source)).toEqual(['sensor', 'dial']);
  });

  it('changing a saved direction keeps the other fields and the sensor value, and marks it dial-set; 되돌리기 restores it', () => {
    const s = newSession();
    const { id, paths } = recordDoor(s, '302', [87], [photoCapture({ at: AT, sensorDeg: 87.2, exif: { focal_length_35mm: 27, width_px: 4032, height_px: 3024 } })]);
    const p = paths[0]!;
    const before = s.attachments[id]!.photo_meta![p]!;
    expect(s.setPhotoHeading(id, p, 95)).toBe(true);
    expect(s.attachments[id]!.photo_meta![p]).toEqual({ ...before, heading_deg: 95, heading_source: 'dial' });
    expect(s.attachments[id]!.photo_meta![p]!.heading_sensor_deg).toBe(87.2);
    // Clearing the direction keeps what the camera said.
    expect(s.setPhotoHeading(id, p, null)).toBe(true);
    expect(s.attachments[id]!.photo_meta![p]).toEqual({ captured_at: AT, heading_sensor_deg: 87.2, focal_length_35mm: 27, width_px: 4032, height_px: 3024 });
    s.undo();
    expect(s.attachments[id]!.photo_meta![p]).toMatchObject({ heading_deg: 95, heading_source: 'dial', focal_length_35mm: 27 });
    s.undo();
    expect(s.attachments[id]!.photo_meta![p]).toEqual(before);
    expect(validateSurvey(s.toSurvey('meta', AT))).toMatchObject({ ok: true });
  });

  it('a picture with only a capture (no direction) still keeps it; callers without captures write what they did before', () => {
    const s = newSession();
    const { id, paths } = recordDoor(s, '303', [null, 10], [photoCapture({ at: AT, sensorDeg: null, exif: { width_px: 3024, height_px: 4032 } }), null]);
    expect(s.attachments[id]!.photo_meta).toEqual({
      [paths[0]!]: { captured_at: AT, width_px: 3024, height_px: 4032 },
      [paths[1]!]: { heading_deg: 10 },
    });
    expect(s.addPhotos(id, 1, AT, [42])).toHaveLength(1);
    const last = Object.entries(s.attachments[id]!.photo_meta!).at(-1)!;
    expect(last[1]).toEqual({ heading_deg: 42 });
  });

  it('the snapshot keeps the records across an app restart', () => {
    const s = newSession();
    const { id } = recordDoor(s, '304', [87], [photoCapture({ at: AT, sensorDeg: 80, accuracy: 0, headingRef: 'magnetic' })]);
    const snap = JSON.parse(JSON.stringify(s.snapshot()));
    const again = SurveySession.restore({ campus: CAMPUS, base, ids: createIdGen(4) }, snap);
    if ('error' in again) throw new Error(again.error);
    expect(again.session.attachments[id]!.photo_meta).toEqual(s.attachments[id]!.photo_meta);
  });
});
