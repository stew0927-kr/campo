import { schemaCheck, validateReportSchema, type SchemaCheck } from '../json-schema.ts';
import type { Report } from './types.ts';

/**
 * Shape check against data/schema/report.schema.json. Unknown fields are refused at every level, so a report
 * cannot carry a user id, device id, name or contact. Also checks that `status` is the last log entry's `to`.
 */
export function validateReport(value: unknown): SchemaCheck {
  const check = schemaCheck(validateReportSchema, value);
  if (!check.ok) return check;
  const r = value as Report;
  const last = r.status_log[r.status_log.length - 1]!;
  if (last.to !== r.status) return { ok: false, errors: [`/status "${r.status}"이(가) 상태 기록의 마지막(${last.to})과 다릅니다.`] };
  return check;
}

export function isReport(value: unknown): value is Report {
  return validateReport(value).ok;
}
