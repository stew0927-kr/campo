// Edit state -> survey file. The map changes are the same Feature-level diff the editor's changesets use.
import { changesetId, historyToChangeset } from '../changeset/diff.ts';
import { findFeature, type EditState } from '../edit/state.ts';
import { SURVEY_FORMAT, SURVEY_VERSION, type Survey, type SurveyAttachment, type VerticalMeasurement } from './types.ts';

/** `source` of Features made or confirmed on site (SPEC 4.1): "field-survey-2026-11" from "2026-11-14…". */
export function surveySource(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!m) throw new Error(`surveySource: "${isoDate}" does not start with yyyy-mm`);
  return `field-survey-${m[1]}-${m[2]}`;
}

/** "sv-{yyyymmdd}-{slug}", with the slug cleaned the way changesetId does. */
export function surveyId(day: string, slug: string): string {
  return `sv${changesetId(day, slug).slice(2)}`;
}

export interface BuildSurveyInput {
  /** The campus as loaded into the app. */
  base: EditState;
  /** After the edits made on site. */
  current: EditState;
  campus: string;
  /** "sv-{yyyymmdd}-{slug}" (surveyId). */
  id: string;
  /** ISO 8601 date-time with a time zone. */
  surveyedAt: string;
  attachments: Readonly<Record<string, SurveyAttachment>>;
  vertical: readonly VerticalMeasurement[];
  /** Korean, one line, for the changeset. */
  summary: string;
}

/**
 * The survey file of `current` against `base`. Attachments and measurements whose Feature is no longer in `current`
 * (it was undone) are dropped, so the file never points at something the editor cannot find after importing.
 */
export function buildSurvey(input: BuildSurveyInput): Survey {
  const { base, current, campus, id } = input;
  if (!id.startsWith('sv-')) throw new Error(`buildSurvey: "${id}" is not sv-{yyyymmdd}-{slug}`);
  const changeset = historyToChangeset(base, current, { id: `cs${id.slice(2)}`, campus, source: 'editor', summary: input.summary });
  const attachments: Record<string, SurveyAttachment> = {};
  for (const featureId of Object.keys(input.attachments).sort()) {
    if (findFeature(current, featureId)) attachments[featureId] = input.attachments[featureId]!;
  }
  return {
    format: SURVEY_FORMAT,
    version: SURVEY_VERSION,
    id,
    campus,
    surveyed_at: input.surveyedAt,
    ...(changeset.changes.length > 0 ? { changeset } : {}),
    attachments,
    vertical: input.vertical.filter((v) => v.edge_id in current.edges),
  };
}

/** Survey file text: two-space indent, LF, trailing newline. */
export function formatSurvey(survey: Survey): string {
  return `${JSON.stringify(survey, null, 2)}\n`;
}

/** Photo paths of a survey ("photos/…"), in attachment order, each once. The exporter zips these and the importer looks for these. */
export function surveyPhotoPaths(survey: Survey): string[] {
  return [...new Set(Object.values(survey.attachments).flatMap((a) => a.photos ?? []))];
}

/** Ids the attachments and measurements point at that `state` (with the changeset applied) does not have. */
export function surveyDanglingIds(state: EditState, survey: Survey): string[] {
  const ids = [...Object.keys(survey.attachments), ...survey.vertical.map((v) => v.edge_id)];
  return [...new Set(ids.filter((id) => !findFeature(state, id)))].sort();
}
