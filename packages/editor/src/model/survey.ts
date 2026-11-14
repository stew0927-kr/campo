// 현장 기록 불러오기 (docs/mobile/SPEC-mobile.md 5): the zip the survey app exports becomes one Plan. The map changes are
// the survey's changeset run through core's applyChangeset (one history entry); photos and readings are only shown, never
// written into the map data.
//
// The magnet (surveySnap.ts): what was walked along a way the map already has is not drawn a second time. Point by point,
// a surveyed point within reach of an existing way of its floor (or of the outdoors) belongs to that way; a surveyed
// stretch that follows existing ways all along is left out, and its photos and height reading are shown on the way it
// follows. A stretch with no way in reach comes in as surveyed, and where it meets an existing way its end is put onto it.
import {
  SURVEY_FILE, SURVEY_PHOTOS_DIR, applyChangeset, checkChangeset, featuresById, sameFeature, surveyDanglingIds, surveyPhotoPaths, validateSurvey,
  type Changeset, type EditContext, type EditState, type Survey, type SurveyAttachment, type VerticalMeasurement,
} from '@campo/core';
import { strFromU8, unzipSync } from 'fflate';
import type { Plan } from './plan.ts';
import { joinStep, snapChangeset, snappedOnto } from './surveySnap.ts';

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

/** survey.json text as a checked Survey. */
function parseSurvey(text: string): Survey | SurveyRefusal {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse('현장 기록 파일이 JSON이 아닙니다.');
  }
  const check = validateSurvey(value);
  return check.ok ? (value as Survey) : refuse('현장 기록 형식이 맞지 않습니다.', check.errors);
}

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
  const survey = parseSurvey(text);
  if ('error' in survey) return survey;

  const photos: Record<string, Uint8Array> = {};
  const missingPhotos: string[] = [];
  for (const path of surveyPhotoPaths(survey)) {
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
 * then nothing is applied (SPEC-v0.2 7.2: all or nothing). What follows an existing way is left out (see the top of this
 * file); the rest is one Plan: the changeset, then each end that meets an existing way is put onto it.
 */
export function planSurveyImport(state: EditState, campusId: string, survey: Survey, ctx?: EditContext): SurveyImport | SurveyRefusal {
  if (survey.campus !== campusId) return refuse(`이 현장 기록은 다른 캠퍼스(${survey.campus})의 것입니다. 지금 연 캠퍼스는 ${campusId}입니다.`);
  const extras = `사진 ${surveyPhotoPaths(survey).length}장, 높이 측정 ${survey.vertical.length}건은 상세 정보 탭에서 볼 수 있습니다.`;
  const whole = survey.changeset;
  if (!whole) return { plan: null, lines: ['이 기록은 지도를 바꾸지 않습니다.', extras] };

  const rest = remainingChanges(state, whole);
  const snap = rest ? snapChangeset(state, rest) : null;
  const cs = snap?.changeset ?? null;
  const followed = snap && snap.droppedEdges.length + snap.droppedNodes.length > 0
    ? [`기존 길을 따라 걸은 구간 ${snap.droppedEdges.length}개와 지점 ${snap.droppedNodes.length}개는 새로 만들지 않았습니다. 그 사진과 측정은 기존 길의 상세 정보에 보입니다.`]
    : [];
  if (!cs || !snap) return { plan: null, lines: [followed.length > 0 ? '새로 반영할 변경이 없습니다.' : '이미 지도에 반영된 기록입니다.', ...followed, extras] };
  const check = checkChangeset(state, cs);
  if (!check.ok) {
    const reasons = [...check.problems.map((p) => p.message), ...check.conflicts.map((c) => `[${c.code}] ${c.message}`)];
    return refuse('현장 기록을 적용할 수 없어 아무것도 바꾸지 않았습니다. 조사한 뒤에 같은 곳을 편집기에서 고쳤는지 확인해 주세요.', reasons);
  }
  const count = (op: string) => cs.changes.filter((c) => c.op === op).length;
  const left = new Set([...snap.droppedEdges, ...snap.droppedNodes]);
  const dangling = surveyDanglingIds(applyChangeset(cs).apply(state), survey).filter((id) => !left.has(id));
  const joins = ctx ? snap.joins : [];
  return {
    plan: {
      annotation: `현장 기록 불러오기(${survey.id})`,
      steps: [() => applyChangeset(cs), ...joins.map((nodeId) => joinStep(nodeId, snap.createdEdgeIds, ctx!))],
    },
    lines: [
      ...(rest!.changes.length < whole.changes.length ? [`이미 반영된 ${whole.changes.length - rest!.changes.length}개는 건너뛰었습니다.`] : []),
      `추가 ${count('create')}개, 변경 ${count('modify')}개, 삭제 ${count('delete')}개를 반영했습니다. 저장(Ctrl+S)하면 캠퍼스 파일에 기록됩니다.`,
      ...followed,
      ...(joins.length > 0 ? [`새 길의 끝 ${joins.length}곳을 기존 길 위에 이었습니다.`] : []),
      extras,
      ...(dangling.length > 0 ? [`지도에 없는 Feature를 가리키는 첨부가 ${dangling.length}개 있습니다: ${dangling.join(', ')}`] : []),
    ],
  };
}

/**
 * The changes of `cs` the map does not have yet, or null when it has them all. The survey app always exports a walk
 * against the campus it was built with, so a later export of the same walk repeats what an earlier import brought in.
 * A Feature the walk made that is on the map already was brought in by that earlier import, also when the import put it
 * onto an existing way (its coordinate is then not the surveyed one).
 */
function remainingChanges(state: EditState, cs: Changeset): Changeset | null {
  const now = featuresById(state);
  const changes = cs.changes.filter((c) => {
    if (c.op === 'delete') return now.has(c.id);
    const have = now.get(c.feature.id);
    if (c.op === 'create') return !have;
    return !have || !sameFeature(have, c.feature);
  });
  return changes.length > 0 ? { ...cs, changes } : null;
}

/** Surveys of this campus from the files the dev server keeps. A file that cannot be read is left out (its notes are simply not shown). */
export function loadSurveys(files: readonly { id: string; text: string }[], campusId: string): Survey[] {
  return files.flatMap((file) => {
    const survey = parseSurvey(file.text);
    return 'error' in survey || survey.campus !== campusId ? [] : [survey];
  });
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
  /** The surveyed Feature the record was made at, when it was left out of the map because it follows this way. */
  recordedAt?: string;
}

/**
 * Photos and readings of `featureId` across the imported surveys, oldest survey first. With `state`, the records of
 * surveyed Features that were left out of the map (they follow an existing way) are shown on the way they follow.
 */
export function surveyNotes(surveys: readonly Survey[], featureId: string, state?: EditState): SurveyNote[] {
  return [...surveys]
    .sort((a, b) => (a.surveyed_at < b.surveyed_at ? -1 : 1))
    .flatMap((s) => {
      const head = { surveyId: s.id, surveyedAt: s.surveyed_at };
      const notes: SurveyNote[] = [];
      const attachment = s.attachments[featureId];
      const vertical = s.vertical.find((v) => v.edge_id === featureId);
      if (attachment || vertical) notes.push({ ...head, ...(attachment ? { attachment } : {}), ...(vertical ? { vertical } : {}) });
      if (state && featureId in state.edges) {
        for (const moved of snappedOnto(state, s, featureId)) notes.push({ ...head, ...moved });
      }
      return notes;
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
