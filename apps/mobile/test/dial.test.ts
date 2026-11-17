// The compass dial's arithmetic (ui/dial.ts) and the photo directions kept in the session (survey/session.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdGen, headedPhotos, pickPhotoByBearing, validateSurvey, type EditState } from '@campo/core';
import { compassWord, dialHeading, fanPath, polar, touchAngle, wholeDegrees } from '../src/ui/dial.ts';
import { planDoor } from '../src/survey/plans.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, SOURCE, fixture } from './helpers.ts';

describe('dial', () => {
  it('reads the direction of a touch from the centre, clockwise from up', () => {
    expect(touchAngle(0, -10)).toBe(0);
    expect(touchAngle(10, 0)).toBe(90);
    expect(touchAngle(0, 10)).toBe(180);
    expect(touchAngle(-10, 0)).toBe(270);
    expect(touchAngle(10, -10)).toBeCloseTo(45, 6);
  });

  it('turns the heading by the angle the finger goes round, across north and in both directions', () => {
    expect(dialHeading(90, 0, 30)).toBe(120);
    expect(dialHeading(350, 350, 10)).toBe(10);
    expect(dialHeading(10, 10, 350)).toBe(350);
    expect(dialHeading(0, 90, 0)).toBe(270);
    expect(wholeDegrees(359.6)).toBe(0);
    expect(wholeDegrees(-0.4)).toBe(0);
    expect(wholeDegrees(87.5)).toBe(88);
  });

  it('draws a fan of ±30° and names the direction', () => {
    expect(polar(0, 0, 10, 90)[0]).toBeCloseTo(10, 6);
    expect(fanPath(50, 50, 40, 0)).toMatch(/^M 50 50 L [\d.]+ [\d.]+ A 40 40 0 0 1 [\d.]+ [\d.]+ Z$/);
    expect(compassWord(0)).toBe('북');
    expect(compassWord(95)).toBe('동');
    expect(compassWord(359)).toBe('북');
  });
});

describe('photo directions in a walk', () => {
  let base: EditState;
  beforeAll(async () => {
    ({ state: base } = await fixture());
  });
  const newSession = () => new SurveySession({ campus: CAMPUS, base, ids: createIdGen(4), startedAt: AT });

  /** A door recorded with two photos, one each way along the corridor (87° and 267°). */
  function twoWay() {
    const s = newSession();
    const plan = planDoor({ state: s.state, ctx: s.ctx, scope: { kind: 'building', buildingId: 'bldg_A', level: 3 }, coord: [127.00061, 37.00042], anchorId: null, source: SOURCE }, { roomRef: '301', doorRole: 'front' });
    if ('error' in plan) throw new Error(plan.error);
    const paths = s.record(plan, { at: AT, pressureHpa: null, headingDeg: 12, photos: 2, photoHeadings: [87.4, 267] });
    return { s, plan, paths };
  }

  it('keeps a direction for each picture of a point, in whole degrees, and the survey file validates', () => {
    const { s, plan, paths } = twoWay();
    expect(paths).toHaveLength(2);
    const a = s.attachments[plan.featureId]!;
    expect(a.photo_meta).toEqual({ [paths[0]!]: { heading_deg: 87 }, [paths[1]!]: { heading_deg: 267 } });
    const survey = s.toSurvey('dial', AT);
    expect(validateSurvey(survey)).toMatchObject({ ok: true });
    expect(pickPhotoByBearing(headedPhotos(survey.attachments[plan.featureId]!), 80)?.path).toBe(paths[0]);
    expect(pickPhotoByBearing(headedPhotos(survey.attachments[plan.featureId]!), 260)?.path).toBe(paths[1]);
  });

  it('a photo without a direction has no entry; the direction can be changed or cleared afterwards, and 되돌리기 restores it', () => {
    const s = newSession();
    const plan = planDoor({ state: s.state, ctx: s.ctx, scope: { kind: 'building', buildingId: 'bldg_A', level: 3 }, coord: [127.00061, 37.00042], anchorId: null, source: SOURCE }, { roomRef: '302', doorRole: 'front' });
    if ('error' in plan) throw new Error(plan.error);
    const [p1, p2] = s.record(plan, { at: AT, pressureHpa: null, headingDeg: null, photos: 2, photoHeadings: [null, 10] }) as [string, string];
    const id = plan.featureId;
    expect(s.attachments[id]!.photo_meta).toEqual({ [p2]: { heading_deg: 10 } });
    expect(s.setPhotoHeading(id, p1, 359.6)).toBe(true);
    expect(s.attachments[id]!.photo_meta![p1]).toEqual({ heading_deg: 0 });
    expect(s.setPhotoHeading(id, p2, null)).toBe(true);
    expect(s.attachments[id]!.photo_meta).toEqual({ [p1]: { heading_deg: 0 } });
    expect(s.setPhotoHeading(id, 'photos/none.jpg', 5)).toBe(false);
    s.undo();
    expect(s.attachments[id]!.photo_meta).toEqual({ [p1]: { heading_deg: 0 }, [p2]: { heading_deg: 10 } });
    s.undo();
    expect(s.attachments[id]!.photo_meta).toEqual({ [p2]: { heading_deg: 10 } });
    // the snapshot keeps the directions across an app restart
    const snap = JSON.parse(JSON.stringify(s.snapshot()));
    const again = SurveySession.restore({ campus: CAMPUS, base, ids: createIdGen(4) }, snap);
    if ('error' in again) throw new Error(again.error);
    expect(again.session.attachments[id]!.photo_meta).toEqual({ [p2]: { heading_deg: 10 } });
  });
});

describe('bearing', () => {
  it('is measured clockwise from north', async () => {
    const { bearingDeg } = await import('../src/ui/dial.ts');
    expect(bearingDeg([127, 37], [127, 37.001])).toBe(0);
    expect(Math.round(bearingDeg([127, 37], [127.001, 37]))).toBe(90);
    expect(bearingDeg([127, 37], [127, 36.999])).toBe(180);
    expect(Math.round(bearingDeg([127, 37], [126.999, 37]))).toBe(270);
  });
});
