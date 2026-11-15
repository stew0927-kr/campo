// [데이터 내보내기]: survey.json and the photos it lists as one zip, the file the editor's 현장 기록 불러오기 reads.
// With barometer measurements the zip also carries the elevation store (Δh, σ, Δt between measured points; never an
// absolute pressure) and the height variables waiting for a recompute (storage/elevationRepo.ts archiveFiles).
import { SURVEY_FILE, formatSurvey, surveyPhotoPaths, type Survey } from '@campo/core';
import { strToU8, zipSync } from 'fflate';

export interface Archive {
  /** "<survey id>.zip" */
  name: string;
  bytes: Uint8Array;
  /** Photos the survey lists that could not be read. They are taken out of the survey inside the zip. */
  missing: string[];
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

/**
 * Zip the survey with its photos. `readPhoto` gets a path as written in the survey ("photos/…") and returns the bytes,
 * or null when the file is gone. JPEGs are stored without compressing them again.
 */
export async function buildArchive(
  survey: Survey,
  readPhoto: (path: string) => Promise<Uint8Array | null>,
  /** Further text files by name (the elevation store). */
  extra: Readonly<Record<string, string>> = {},
): Promise<Archive> {
  const paths = surveyPhotoPaths(survey);
  const read = await Promise.all(paths.map(readPhoto));
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const missing: string[] = [];
  paths.forEach((path, i) => {
    const bytes = read[i];
    if (bytes) files[path] = [bytes, { level: 0 }];
    else missing.push(path);
  });
  const text = formatSurvey(withoutPhotos(survey, new Set(missing)));
  const texts = Object.fromEntries(Object.entries(extra).map(([name, t]) => [name, strToU8(t)]));
  return { name: `${survey.id}.zip`, bytes: zipSync({ [SURVEY_FILE]: strToU8(text), ...texts, ...files }), missing };
}
