// [데이터 내보내기]: the zip the editor imports.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { surveyPhotoPaths, validateSurvey, type Survey } from '@campo/core';
import { ARCHIVE_REPORT, ArchiveCancelled, buildArchive, writeArchive } from '../src/export/archive.ts';
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
    expect(surveyPhotoPaths(inside)).toEqual(Object.keys(files).filter((f) => f.startsWith('photos/')));
    // The editor learns which photos were left out from the report next to survey.json.
    expect(JSON.parse(strFromU8(files[ARCHIVE_REPORT]!))).toEqual({ format: 'campo-export-report/1', missingPhotos: ['photos/n_B_1_main-1.jpg', 'photos/n_B_1_hall-3.jpg'] });
  });

  it('a photo read that throws counts as missing instead of failing the export', async () => {
    const archive = await buildArchive(survey, async (path) => {
      if (path.endsWith('-2.jpg')) throw new Error('EIO');
      return bytesOf(path);
    });
    expect(archive.missing).toEqual(['photos/n_B_1_main-2.jpg']);
    expect(Object.keys(unzipSync(archive.bytes))).toContain('photos/n_B_1_main-1.jpg');
  });

  it('no report file when every photo was read', async () => {
    const archive = await buildArchive(survey, async (path) => bytesOf(path));
    expect(Object.keys(unzipSync(archive.bytes))).not.toContain(ARCHIVE_REPORT);
  });
});

describe('writeArchive with a large walk (QA: 사진 100장 이상에서 메모리 폭주)', () => {
  const N = 120;
  const PHOTO_BYTES = 64 * 1024;
  const big: Survey = {
    ...survey,
    attachments: Object.fromEntries(Array.from({ length: N / 2 }, (_, i) => [`n_${i}`, { recorded_at: AT, photos: [`photos/n_${i}-a.jpg`, `photos/n_${i}-b.jpg`] }])),
  };
  const photo = (path: string) => {
    const b = new Uint8Array(PHOTO_BYTES);
    b.fill(path.length % 251);
    b.set(new TextEncoder().encode(path));
    return b;
  };

  it('reads one photo at a time, streams the zip out as it goes, and reports progress for each photo', async () => {
    let reading = 0;
    let maxReading = 0;
    let reads = 0;
    let written = 0;
    const writtenWhenReading: number[] = [];
    const chunks: Uint8Array[] = [];
    const progress: number[] = [];
    const result = await writeArchive(big, async (path) => {
      reading++;
      maxReading = Math.max(maxReading, reading);
      writtenWhenReading.push(written);
      reads++;
      await new Promise((r) => setTimeout(r, 0));
      reading--;
      return photo(path);
    }, {}, {
      async write(c) {
        written += c.length;
        chunks.push(c);
      },
    }, { onProgress: (done, total) => progress.push(done * 1000 + total), yieldNow: async () => {} });
    expect(result.missing).toEqual([]);
    expect(reads).toBe(N);
    expect(maxReading).toBe(1);
    // Before the last photo is read, nearly all the earlier ones have already left for the sink.
    expect(writtenWhenReading[N - 1]!).toBeGreaterThanOrEqual((N - 2) * PHOTO_BYTES);
    expect(progress).toEqual(Array.from({ length: N }, (_, i) => (i + 1) * 1000 + N));

    const all = new Uint8Array(written);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    const files = unzipSync(all);
    expect(Object.keys(files).filter((f) => f.startsWith('photos/'))).toHaveLength(N);
    expect(files['photos/n_7-b.jpg']).toEqual(photo('photos/n_7-b.jpg'));
    expect(validateSurvey(JSON.parse(strFromU8(files['survey.json']!)))).toEqual({ ok: true, errors: [] });
  });

  it('stops between photos when cancelled, without reading the rest', async () => {
    const signal = { cancelled: false };
    let reads = 0;
    const run = writeArchive(big, async (path) => {
      if (++reads === 10) signal.cancelled = true;
      return photo(path);
    }, {}, { write: async () => {} }, { signal, yieldNow: async () => {} });
    await expect(run).rejects.toBeInstanceOf(ArchiveCancelled);
    expect(reads).toBe(10);
  });

  it('a sink that fails rejects the export (the screen then removes the unfinished file)', async () => {
    const run = writeArchive(big, async (path) => photo(path), {}, { write: async () => { throw new Error('disk full'); } }, { yieldNow: async () => {} });
    await expect(run).rejects.toThrow('disk full');
  });
});
