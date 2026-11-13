import { schemaCheck, validateSurveySchema, type SchemaCheck } from '../json-schema.ts';
import type { Survey } from './types.ts';

/**
 * Shape check against data/schema/survey.schema.json (the changeset against changeset.schema.json), then that the
 * changeset is for the survey's campus.
 */
export function validateSurvey(value: unknown): SchemaCheck {
  const check = schemaCheck(validateSurveySchema, value);
  if (!check.ok) return check;
  const s = value as Survey;
  if (s.changeset && s.changeset.campus !== s.campus) {
    return { ok: false, errors: [`/changeset/campus "${s.changeset.campus}"이(가) 현장 기록의 캠퍼스(${s.campus})와 다릅니다.`] };
  }
  return check;
}

export function isSurvey(value: unknown): value is Survey {
  return validateSurvey(value).ok;
}
