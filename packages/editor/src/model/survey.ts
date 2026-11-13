// 현장 기록 불러오기 (docs/mobile/SPEC-mobile.md 5): the zip the survey app exports becomes one Plan. The map changes are
// the survey's changeset run through core's applyChangeset (one history entry); photos and readings are only shown, never
// written into the map data.
import {
  SURVEY_FILE, SURVEY_PHOTOS_DIR, applyChangeset, checkChangeset, surveyDanglingIds, validateSurvey,
  type EditState, type Survey, type SurveyAttachment, type VerticalMeasurement,
} from '@campo/core';
import { strFromU8, unzipSync } from 'fflate';
import type { Plan } from './plan.ts';

export interface SurveyFile {
  survey: Survey;
  /** survey.json exactly as it was in the file (it is stored as is, so importing the same file again is a no-op). */
  text: string;
  /** Photos found in the zip, by file name (without "photos/"). */
  photos: Record<string, Uint8Array>;
  /** Photo paths the survey lists that the file does not hold. */
  missingPhotos: string[];
}

const PHOTO_PREFIX = `${SURVEY_PHOTOS_DIR}/`;
const isZip = (bytes: Uint8Array): boolean => bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

/** Why a survey file cannot be imported: one sentence, and every single reason when there are several. */
export interface SurveyRefusal {
  error: string;
  reasons: string[];
}

const refuse = (error: string, reasons: string[] = []): SurveyRefusal => ({ error, reasons });

/** Read an exported survey: the zip (survey.json + photos/), or a bare survey.json. Nothing outside those paths is unpacked. */
export function readSurveyFile(bytes: Uint8Array): SurveyFile | SurveyRefusal {
  let text: string;
  let entries: Record<string, Uint8Array> = {};
  try {
    if (isZip(bytes)) {
      entries = unzipSync(bytes, { filter: (f) => f.name === SURVEY_FILE || f.name.startsWith(PHOTO_PREFIX) });
      const inner = entries[SURVEY_FILE];
      if (!inner) return refuse(`zip 안에 ${SURVEY_FILE}이 없습니다. 현장 조사 앱에서 내보낸 파일인지 확인해 주세요.`);
      text = strFromU8(inner);
    } else {
      text = strFromU8(bytes);
    }
  } catch (err) {
    return refuse(`파일을 열 수 없습니다. ${(err as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse('현장 기록 파일이 JSON이 아닙니다.');
  }
  const check = validateSurvey(value);
  if (!check.ok) return refuse('현장 기록 형식이 맞지 않습니다.', check.errors);
  const survey = value as Survey;

  const photos: Record<string, Uint8Array> = {};
  const missingPhotos: string[] = [];
  for (const path of new Set(Object.values(survey.attachments).flatMap((a) => a.photos ?? []))) {
    const found = entries[path];
    if (found) photos[path.slice(PHOTO_PREFIX.length)] = found;
    else missingPhotos.push(path);
  }
  return { survey, text, photos, missingPhotos };
}

export interface SurveyImport {
  /** null when the map does not change: a survey of photos and readings only, or one that was imported before. */
  plan: Plan | null;
  /** What the import does, one sentence per line (Korean). */
  lines: string[];
}

/**
 * The import of `survey` into `state`. Every problem and conflict of its changeset is collected into the error, and
 * then nothing is applied (SPEC-v0.2 7.2: all or nothing).
 */
export function planSurveyImport(state: EditState, campusId: string, survey: Survey): SurveyImport | SurveyRefusal {
  if (survey.campus !== campusId) return refuse(`이 현장 기록은 다른 캠퍼스(${survey.campus})의 것입니다. 지금 연 캠퍼스는 ${campusId}입니다.`);
  const photoCount = Object.values(survey.attachments).reduce((n, a) => n + (a.photos?.length ?? 0), 0);
  const extras = `사진 ${photoCount}장, 높이 측정 ${survey.vertical.length}건은 상세 정보 탭에서 볼 수 있습니다.`;
  const cs = survey.changeset;
  if (!cs) return { plan: null, lines: ['이 기록은 지도를 바꾸지 않습니다.', extras] };

  const check = checkChangeset(state, cs);
  if (check.alreadyApplied) return { plan: null, lines: ['이미 지도에 반영된 기록입니다.', extras] };
  if (!check.ok) {
    const reasons = [...check.problems.map((p) => p.message), ...check.conflicts.map((c) => `[${c.code}] ${c.message}`)];
    return refuse('현장 기록을 적용할 수 없어 아무것도 바꾸지 않았습니다. 조사한 뒤에 같은 곳을 편집기에서 고쳤는지 확인해 주세요.', reasons);
  }
  const count = (op: string) => cs.changes.filter((c) => c.op === op).length;
  const dangling = surveyDanglingIds(applyChangeset(cs).apply(state), survey);
  return {
    plan: { annotation: `현장 기록 불러오기(${survey.id})`, steps: [() => applyChangeset(cs)] },
    lines: [
      `추가 ${count('create')}개, 변경 ${count('modify')}개, 삭제 ${count('delete')}개를 반영했습니다. 저장(Ctrl+S)하면 캠퍼스 파일에 기록됩니다.`,
      extras,
      ...(dangling.length > 0 ? [`지도에 없는 Feature를 가리키는 첨부가 ${dangling.length}개 있습니다: ${dangling.join(', ')}`] : []),
    ],
  };
}

/** Surveys of this campus from the files the dev server keeps; unreadable ones are skipped and named. */
export function loadSurveys(files: readonly { id: string; text: string }[], campusId: string): { surveys: Survey[]; unreadable: string[] } {
  const surveys: Survey[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    let value: unknown;
    try {
      value = JSON.parse(file.text);
    } catch {
      unreadable.push(file.id);
      continue;
    }
    if (!validateSurvey(value).ok) unreadable.push(file.id);
    else if ((value as Survey).campus === campusId) surveys.push(value as Survey);
  }
  return { surveys, unreadable };
}

/** `survey` added to the list, replacing an earlier copy with the same id. */
export function withSurvey(surveys: readonly Survey[], survey: Survey): Survey[] {
  return [...surveys.filter((s) => s.id !== survey.id), survey];
}

/** What one survey recorded about one Feature. */
export interface SurveyNote {
  surveyId: string;
  surveyedAt: string;
  attachment?: SurveyAttachment;
  /** Edges only. */
  vertical?: VerticalMeasurement;
}

/** Photos and readings of `featureId` across the imported surveys, oldest survey first. */
export function surveyNotes(surveys: readonly Survey[], featureId: string): SurveyNote[] {
  return [...surveys]
    .sort((a, b) => (a.surveyed_at < b.surveyed_at ? -1 : 1))
    .flatMap((s) => {
      const attachment = s.attachments[featureId];
      const vertical = s.vertical.find((v) => v.edge_id === featureId);
      if (!attachment && !vertical) return [];
      return [{ surveyId: s.id, surveyedAt: s.surveyed_at, ...(attachment ? { attachment } : {}), ...(vertical ? { vertical } : {}) }];
    });
}

/** Where the dev server serves a survey photo ("photos/x.jpg" as written in the survey). */
export function photoUrl(surveyId: string, path: string): string {
  return `/api/surveys/${encodeURIComponent(surveyId)}/photos/${encodeURIComponent(path.slice(PHOTO_PREFIX.length))}`;
}

/** Bytes as base64, in pieces small enough for String.fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
