// [데이터 내보내기]: the zip the editor imports.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { surveyPhotoPaths, validateSurvey, type Survey } from '@campo/core';
import { buildArchive } from '../src/export/archive.ts';
import { AT, CAMPUS } from './helpers.ts';

const survey: Survey = {
  format: 'campo-survey',
  version: 1,
  id: 'sv-20261114-b-1',
  campus: CAMPUS,
  surveyed_at: AT,
  attachments: {
    n_B_1_main: { recorded_at: AT, photos: ['photos/n_B_1_main-1.jpg', 'photos/n_B_1_main-2.jpg'], heading_mag_deg: 12 },
    n_B_1_hall: { recorded_at: AT, photos: ['photos/n_B_1_hall-3.jpg'] },
    n_B_1_stair: { recorded_at: AT, pressure_hpa: 1012 },
  },
  vertical: [],
};
const bytesOf = (path: string) => new TextEncoder().encode(`jpeg of ${path}`);

describe('buildArchive', () => {
  it('holds survey.json and every listed photo under the paths the survey uses', async () => {
    const archive = await buildArchive(survey, async (path) => bytesOf(path));
    expect(archive.name).toBe('sv-20261114-b-1.zip');
    expect(archive.missing).toEqual([]);
    const files = unzipSync(archive.bytes);
    expect(Object.keys(files).sort()).toEqual(['photos/n_B_1_hall-3.jpg', 'photos/n_B_1_main-1.jpg', 'photos/n_B_1_main-2.jpg', 'survey.json']);
    expect(JSON.parse(strFromU8(files['survey.json']!))).toEqual(survey);
    expect(files['photos/n_B_1_main-2.jpg']).toEqual(bytesOf('photos/n_B_1_main-2.jpg'));
  });

  it('a photo that cannot be read is reported and taken out of the survey, which stays valid', async () => {
    const gone = new Set(['photos/n_B_1_main-1.jpg', 'photos/n_B_1_hall-3.jpg']);
    const archive = await buildArchive(survey, async (path) => (gone.has(path) ? null : bytesOf(path)));
    expect(archive.missing.sort()).toEqual([...gone].sort());
    const files = unzipSync(archive.bytes);
    const inside = JSON.parse(strFromU8(files['survey.json']!)) as Survey;
    expect(inside.attachments['n_B_1_main']).toEqual({ recorded_at: AT, photos: ['photos/n_B_1_main-2.jpg'], heading_mag_deg: 12 });
    expect(inside.attachments['n_B_1_hall']).toEqual({ recorded_at: AT }); // no empty photo list (the schema refuses one)
    expect(validateSurvey(inside)).toEqual({ ok: true, errors: [] });
    expect(surveyPhotoPaths(inside)).toEqual(Object.keys(files).filter((f) => f !== 'survey.json'));
  });
});
