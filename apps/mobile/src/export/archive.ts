// [데이터 내보내기]: survey.json and the photos it lists as one zip, the file the editor's 현장 기록 불러오기 reads.
// With barometer measurements the zip also carries the elevation store (Δh, σ, Δt between measured points; never an
// absolute pressure) and the height variables waiting for a recompute (storage/elevationRepo.ts archiveFiles).
//
// A walk can hold hundreds of photos. They are read one at a time and streamed into the zip (fflate's Zip with stored
// entries: JPEGs are not compressed again, so no worker and no long synchronous pass), and the zip's bytes go to the
// sink as they come — on the phone straight into the shared file — so the memory needed is about one photo, not all of
// them at once. Between photos the JS thread is given back, so the screen keeps drawing the progress.
import { SURVEY_FILE, formatSurvey, surveyPhotoPaths, type Survey } from '@campo/core';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';

/**
 * A small report inside the zip (next to survey.json) when photos the survey listed could not be read on the phone.
 * They are taken out of survey.json (which then stays valid), and the editor reads this file to warn about them.
 */
export const ARCHIVE_REPORT = 'export_report.json';

export interface Archive {
  /** "<survey id>.zip" */
  name: string;
  bytes: Uint8Array;
  /** Photos the survey lists that could not be read. They are taken out of the survey inside the zip. */
  missing: string[];
}

export interface ArchiveOptions {
  /** After each photo: how many of the photos have been put in (or found missing) so far. */
  onProgress?: (done: number, total: number) => void;
  /** Set `cancelled` to stop between two photos; the promise then rejects with ArchiveCancelled. */
  signal?: { cancelled: boolean };
  /** Give the JS thread back between photos (tests pass a no-op). Default: a zero timeout. */
  yieldNow?: () => Promise<void>;
}

export class ArchiveCancelled extends Error {
  constructor() {
    super('내보내기를 멈췄습니다.');
    this.name = 'ArchiveCancelled';
  }
}

/** Where the zip's bytes go, in order. */
export interface ArchiveSink {
  write(chunk: Uint8Array): Promise<void>;
}

function withoutPhotos(survey: Survey, gone: ReadonlySet<string>): Survey {
  if (gone.size === 0) return survey;
  const attachments = Object.fromEntries(Object.entries(survey.attachments).map(([id, a]) => {
    const { photos, ...rest } = a;
    const kept = (photos ?? []).filter((p) => !gone.has(p));
    return [id, kept.length > 0 ? { ...rest, photos: kept } : rest];
  }));
  return { ...survey, attachments };
}

const zeroTimeout = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Stream the zip of the survey with its photos into `sink`. `readPhoto` gets a path as written in the survey
 * ("photos/…") and returns the bytes, or null when the file is gone; a read that throws counts as gone too, so one bad
 * file does not stop the export. Photos are read one after another, never all at once.
 */
export async function writeArchive(
  survey: Survey,
  readPhoto: (path: string) => Promise<Uint8Array | null>,
  extra: Readonly<Record<string, string>>,
  sink: ArchiveSink,
  opts: ArchiveOptions = {},
): Promise<{ name: string; missing: string[] }> {
  const yieldNow = opts.yieldNow ?? zeroTimeout;
  const queue: Uint8Array[] = [];
  let failure: Error | null = null;
  let ended = false;
  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err;
    else queue.push(chunk);
    if (final) ended = true;
  });
  const drain = async (): Promise<void> => {
    while (queue.length > 0) await sink.write(queue.shift()!);
    if (failure) throw failure;
  };
  const addStored = (path: string, bytes: Uint8Array): void => {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    entry.push(bytes, true);
  };
  const addText = (path: string, text: string): void => {
    const entry = new ZipDeflate(path, { level: 6 });
    zip.add(entry);
    entry.push(strToU8(text), true);
  };

  try {
    const paths = surveyPhotoPaths(survey);
    const missing: string[] = [];
    for (let i = 0; i < paths.length; i++) {
      if (opts.signal?.cancelled) throw new ArchiveCancelled();
      const path = paths[i]!;
      let bytes: Uint8Array | null;
      try {
        bytes = await readPhoto(path);
      } catch {
        bytes = null;
      }
      if (bytes) addStored(path, bytes);
      else missing.push(path);
      bytes = null; // let it go before the next one is read
      await drain();
      opts.onProgress?.(i + 1, paths.length);
      await yieldNow();
    }
    if (opts.signal?.cancelled) throw new ArchiveCancelled();
    for (const [name, text] of Object.entries(extra)) addText(name, text);
    if (missing.length > 0) addText(ARCHIVE_REPORT, `${JSON.stringify({ format: 'campo-export-report/1', missingPhotos: missing }, null, 2)}\n`);
    addText(SURVEY_FILE, formatSurvey(withoutPhotos(survey, new Set(missing))));
    zip.end();
    await drain();
    if (!ended) throw new Error('zip 파일을 끝까지 쓰지 못했습니다.');
    return { name: `${survey.id}.zip`, missing };
  } catch (err) {
    zip.terminate();
    throw err;
  }
}

/** The whole zip in memory (tests, small walks). The phone streams it into a file with writeArchive instead. */
export async function buildArchive(
  survey: Survey,
  readPhoto: (path: string) => Promise<Uint8Array | null>,
  /** Further text files by name (the elevation store). */
  extra: Readonly<Record<string, string>> = {},
  opts: ArchiveOptions = {},
): Promise<Archive> {
  const chunks: Uint8Array[] = [];
  const { name, missing } = await writeArchive(survey, readPhoto, extra, { write: async (c) => void chunks.push(c) }, { yieldNow: async () => {}, ...opts });
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { name, bytes, missing };
}
