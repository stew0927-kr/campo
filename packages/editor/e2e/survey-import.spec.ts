// docs/mobile/SPEC-mobile.md 5: 현장 기록 불러오기 reads the zip the survey app exports.
//   the survey's Features come in as one history entry (one 되돌리기 takes them back)
//   its file and photos are kept in the surveys folder (a temporary one here), and shown under 상세 정보
//   a survey that no longer fits the map is refused as a whole, with every conflict listed
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addEdge, addNode, buildSurvey, compose, createHistory, formatSurvey, fromCampus, parseCampus, validateSurvey,
  type EditState, type Survey,
} from '@campo/core';
import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { REPORTS_CAMPUS, SURVEYS_DIR } from './seed.ts';
import { Editor, readSaved } from './support.ts';

const SHOTS = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs', 'mobile', 'screens');
const shot = (page: Page, name: string) => (process.env['CAMPO_E2E_SHOT'] ? page.screenshot({ path: join(SHOTS, name) }) : Promise.resolve(undefined));

const AT = '2026-11-14T10:00:00+09:00';
const SOURCE = 'field-survey-2026-11';
const NEW_POINT: [number, number] = [126.9997, 37.0006];
const PHOTO = 'photos/n_out_sv01-1.png';
/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** What the survey app exports after one 갈림길 기록 next to n_out_0004, with a photo, a heading and a measured height. */
function surveyOf(base: EditState): Survey {
  const walk = createHistory(base);
  walk.perform(compose([
    addNode({ id: 'n_out_sv01', coord: NEW_POINT, props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: SOURCE } }),
    addEdge({ id: 'e_out_sv01', props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'n_out_0004', to: 'n_out_sv01', bidirectional: true, step_free: true, source: SOURCE } }),
  ], '갈림길 기록'));
  return buildSurvey({
    base, current: walk.current(), campus: REPORTS_CAMPUS, id: 'sv-20261114-outdoor-1000', surveyedAt: AT, summary: '현장 조사',
    attachments: { n_out_sv01: { recorded_at: AT, photos: [PHOTO], heading_mag_deg: 87.5, pressure_hpa: 1012.3 } },
    vertical: [{ edge_id: 'e_out_sv01', pressure_start_hpa: 1012.5, pressure_end_hpa: 1012.3, height_m: 1.67, grade_pct: 6.3, method: 'barometer', measured_at: AT }],
  });
}

const zip = (survey: Survey, name: string) => ({
  name, mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'survey.json': strToU8(formatSurvey(survey)), [PHOTO]: new Uint8Array(PNG) })),
});

async function choose(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('group', { name: '편집 작업' }).getByRole('button', { name: '현장 기록 불러오기' }).click();
  await (await chooser).setFiles(file);
}

test('현장 기록 zip을 불러오면 지점·구간이 한 번에 들어오고, 사진과 측정이 상세 정보에 보입니다', async ({ page }) => {
  const base = fromCampus(parseCampus(readSaved(REPORTS_CAMPUS))).state;
  const survey = surveyOf(base);
  expect(validateSurvey(survey)).toEqual({ ok: true, errors: [] });

  const ed = new Editor(page);
  await ed.open(REPORTS_CAMPUS);
  await ed.view(NEW_POINT, 19);
  const undo = page.getByRole('group', { name: '편집 작업' }).getByRole('button', { name: /^되돌리기/ });
  const notes = page.getByRole('region', { name: '현장 기록' });

  // ---- import: the map changes, the file and the photo are kept ----
  await choose(page, zip(survey, 'sv-20261114-outdoor-1000.zip'));
  await expect(page.getByText(/추가 2개, 변경 0개, 삭제 0개를 반영했습니다/)).toBeVisible();
  expect(readFileSync(join(SURVEYS_DIR, survey.id, 'survey.json'), 'utf8')).toBe(formatSurvey(survey));
  expect(readFileSync(join(SURVEYS_DIR, survey.id, PHOTO))).toEqual(PNG);

  // ---- the new point: its photo, heading and pressure ----
  await ed.click(ed.tool('선택'));
  await ed.clickMap(NEW_POINT);
  await expect(page.locator('.props-id')).toHaveText('n_out_sv01');
  await expect(notes).toContainText('바라본 방향 88°');
  await expect(notes).toContainText('기압 1012.3 hPa');
  const photo = notes.getByRole('img', { name: '현장 사진 n_out_sv01-1.png' });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBe(1); // served by the dev server and decoded
  await shot(page, 'editor-survey-import.png');

  // ---- the same file again: nothing changes ----
  await choose(page, zip(survey, 'again.zip'));
  await expect(page.getByText(/이미 지도에 반영된 기록입니다/)).toBeVisible();

  // ---- one 되돌리기 takes the whole survey back ----
  await undo.click();
  await expect(page.locator('.props-id')).toHaveCount(0);
  await expect(notes).toHaveCount(0);
  expect(existsSync(join(SURVEYS_DIR, survey.id, 'survey.json'))).toBe(true); // the record of the walk stays

  // ---- a survey made from older data: refused as a whole, every conflict listed ----
  const stale: Survey = {
    ...survey,
    id: 'sv-20261115-stale',
    changeset: {
      ...survey.changeset!,
      id: 'cs-20261115-stale',
      changes: [
        ...survey.changeset!.changes,
        { op: 'delete', base_rev: 7, id: 'n_out_0005' },
        { op: 'delete', base_rev: 9, id: 'e_out_0004__out_0005' },
        { op: 'delete', base_rev: 9, id: 'e_out_0005__out_0003' },
      ],
    },
  };
  await choose(page, zip(stale, 'stale.zip'));
  const dialog = page.getByRole('dialog', { name: '현장 기록 불러오기' });
  await expect(dialog).toContainText('아무것도 바꾸지 않았습니다');
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(dialog.getByRole('listitem').first()).toContainText('rev_mismatch');
  await shot(page, 'editor-survey-refused.png');
  await dialog.getByRole('button', { name: '확인' }).click();
  expect(existsSync(join(SURVEYS_DIR, stale.id))).toBe(false);
  await ed.clickMap(NEW_POINT);
  await expect(page.locator('.props-id')).toHaveCount(0); // nothing of the refused survey came in
});
