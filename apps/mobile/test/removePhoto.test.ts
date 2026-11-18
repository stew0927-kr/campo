// 지점 사진 삭제: the session list (photos, photo_meta, 되돌리기) and the files that follow it (photos/deleted).
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdGen, validateSurvey, type EditState, type SurveyAttachment } from '@campo/core';
import { strFromU8, unzipSync } from 'fflate';
import { buildArchive } from '../src/export/archive.ts';
import { PHOTO_TRASH_DIR, createPhotoTrash, emptyPhotoTrash } from '../src/storage/photoTrash.ts';
import { SURVEY_DIR } from '../src/storage/store.ts';
import { planDoor } from '../src/survey/plans.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, SOURCE, fixture, memoryStore } from './helpers.ts';

describe('SurveySession.removePhoto', () => {
  let base: EditState;
  beforeAll(async () => {
    ({ state: base } = await fixture());
  });
  const newSession = () => new SurveySession({ campus: CAMPUS, base, ids: createIdGen(7), startedAt: AT });
  function recordDoor(s: SurveySession, headings: (number | null)[]) {
    const plan = planDoor({ state: s.state, ctx: s.ctx, scope: { kind: 'building', buildingId: 'bldg_A', level: 3 }, coord: [127.00061, 37.00042], anchorId: null, source: SOURCE }, { roomRef: '301', doorRole: 'front' });
    if ('error' in plan) throw new Error(plan.error);
    const paths = s.record(plan, { at: AT, pressureHpa: null, headingDeg: 12, photos: headings.length, photoHeadings: headings });
    return { id: plan.featureId, paths };
  }

  it('drops the path and its photo_meta entry, keeps the other photos, and one 되돌리기 brings it all back', () => {
    const s = newSession();
    const { id, paths } = recordDoor(s, [87, 270]);
    const [a, b] = paths as [string, string];
    const before = s.attachments[id]!;
    expect(s.removePhoto(id, a)).toBe(true);
    expect(s.attachments[id]!.photos).toEqual([b]);
    expect(s.attachments[id]!.photo_meta).toEqual({ [b]: { heading_deg: 270 } });
    expect(s.counts().photos).toBe(1);
    expect(validateSurvey(s.toSurvey('rm', AT))).toMatchObject({ ok: true });
    expect(s.undo()).toBe(true);
    expect(s.attachments[id]).toEqual(before);
    expect(s.counts().photos).toBe(2);
    expect(s.redo()).toBe(true);
    expect(s.attachments[id]!.photos).toEqual([b]);
  });

  it('does not touch the map: the history has nothing to undo beyond the attachment', () => {
    const s = newSession();
    const { id, paths } = recordDoor(s, [87]);
    const state = s.state;
    s.removePhoto(id, paths[0]!);
    expect(s.state).toBe(state);
    s.undo(); // only the photo comes back; the door recorded before stays
    expect(s.state).toBe(state);
    expect(s.attachments[id]!.photos).toEqual(paths);
  });

  it('the last photo: `photos` and `photo_meta` leave the attachment, but its other readings stay (no empty photos: [])', () => {
    const s = newSession();
    const { id, paths } = recordDoor(s, [87]);
    expect(s.removePhoto(id, paths[0]!)).toBe(true);
    const left: SurveyAttachment = s.attachments[id]!;
    expect('photos' in left).toBe(false);
    expect('photo_meta' in left).toBe(false);
    expect(left.heading_mag_deg).toBe(12);
  });

  it('the last photo of an attachment that holds nothing else removes the whole attachment; 되돌리기 restores it', () => {
    const s = newSession();
    const [p] = s.addPhotos('node-x', 1, AT, [40]);
    expect(s.attachments['node-x']).toBeDefined();
    expect(s.removePhoto('node-x', p!)).toBe(true);
    expect('node-x' in s.attachments).toBe(false);
    s.undo();
    expect(s.attachments['node-x']!.photos).toEqual([p]);
    expect(s.attachments['node-x']!.photo_meta).toEqual({ [p!]: { heading_deg: 40 } });
  });

  it('an unknown point or path changes nothing (and makes no 되돌리기 step)', () => {
    const s = newSession();
    const { id } = recordDoor(s, [87]);
    const rev = s.getRevision();
    expect(s.removePhoto(id, 'photos/none.jpg')).toBe(false);
    expect(s.removePhoto('nobody', 'photos/none.jpg')).toBe(false);
    expect(s.getRevision()).toBe(rev);
  });

  it('survives a snapshot round trip', () => {
    const s = newSession();
    const { id, paths } = recordDoor(s, [87, 270]);
    s.removePhoto(id, paths[0]!);
    const back = SurveySession.restore({ campus: CAMPUS, base, ids: createIdGen(8) }, JSON.parse(JSON.stringify(s.snapshot())));
    if ('error' in back) throw new Error(back.error);
    expect(back.session.attachments[id]!.photos).toEqual([paths[1]]);
  });
});

describe('photo files follow the list (photoTrash)', () => {
  const file = (name: string) => `${SURVEY_DIR}/photos/${name}`;
  const setup = () => {
    const fs = memoryStore();
    fs.bytes.set(file('a-1.jpg'), new Uint8Array([1]));
    fs.bytes.set(file('a-2.jpg'), new Uint8Array([2]));
    const errors: string[] = [];
    const trash = createPhotoTrash(fs, (e) => errors.push(e.message));
    return { fs, trash, errors };
  };

  it('delete moves the file to photos/deleted; undo moves it back; redo moves it out again', async () => {
    const { fs, trash } = setup();
    trash.track('photos/a-1.jpg');
    await trash.sync(new Set(['photos/a-2.jpg']));
    expect(fs.bytes.has(file('a-1.jpg'))).toBe(false);
    expect(fs.bytes.get(`${PHOTO_TRASH_DIR}/a-1.jpg`)).toEqual(new Uint8Array([1]));
    expect(fs.bytes.has(file('a-2.jpg'))).toBe(true); // untracked files are never moved
    await trash.sync(new Set(['photos/a-1.jpg', 'photos/a-2.jpg']));
    expect(fs.bytes.get(file('a-1.jpg'))).toEqual(new Uint8Array([1]));
    expect(fs.bytes.has(`${PHOTO_TRASH_DIR}/a-1.jpg`)).toBe(false);
    await trash.sync(new Set(['photos/a-2.jpg']));
    expect(fs.bytes.has(`${PHOTO_TRASH_DIR}/a-1.jpg`)).toBe(true);
  });

  it('syncing again with the same list moves nothing', async () => {
    const { fs, trash } = setup();
    trash.track('photos/a-1.jpg');
    await trash.sync(new Set(['photos/a-2.jpg']));
    const moves = fs.log.length;
    await trash.sync(new Set(['photos/a-2.jpg']));
    expect(fs.log.length).toBe(moves);
  });

  it('a missing file is reported, not thrown, and later syncs still work', async () => {
    const { fs, trash, errors } = setup();
    trash.track('photos/ghost.jpg');
    trash.track('photos/a-1.jpg');
    await trash.sync(new Set());
    expect(errors).toHaveLength(1);
    expect(fs.bytes.has(`${PHOTO_TRASH_DIR}/a-1.jpg`)).toBe(true);
  });

  it('starting the app empties the trash and leaves the kept photos and the export alone', async () => {
    const { fs, trash } = setup();
    trash.track('photos/a-1.jpg');
    await trash.sync(new Set(['photos/a-2.jpg']));
    await emptyPhotoTrash(fs);
    expect([...fs.bytes.keys()]).toEqual([file('a-2.jpg')]);
  });
});

describe('export after a photo was deleted', () => {
  it('the zip carries the photos the survey lists and never reads photos/deleted', async () => {
    const { state: base } = await fixture();
    const s = new SurveySession({ campus: CAMPUS, base, ids: createIdGen(9), startedAt: AT });
    const id = Object.keys(base.nodes)[0]!;
    const [p1, p2] = s.addPhotos(id, 2, AT, [10, 20]) as [string, string];
    const fs = memoryStore();
    for (const p of [p1, p2]) fs.bytes.set(`${SURVEY_DIR}/${p}`, new TextEncoder().encode(p));
    const trash = createPhotoTrash(fs);
    trash.track(p1);
    s.removePhoto(id, p1);
    await trash.sync(new Set(Object.values(s.attachments).flatMap((a) => a.photos ?? [])));
    const read: string[] = [];
    const archive = await buildArchive(s.toSurvey('after-delete', AT), async (path) => {
      read.push(path);
      return fs.bytes.get(`${SURVEY_DIR}/${path}`) ?? null;
    });
    expect(read).toEqual([p2]);
    expect(archive.missing).toEqual([]);
    const names = Object.keys(unzipSync(archive.bytes));
    expect(names).toContain(p2);
    expect(names).not.toContain(p1);
    expect(strFromU8(unzipSync(archive.bytes)['survey.json']!)).not.toContain(p1);
  });
});
