// Ajv set-up shared by the changeset, report and survey schemas (data/schema/*.schema.json).
// validate.ts keeps its own instance for campo.schema.json.
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import campoSchema from '../../../data/schema/campo.schema.json' with { type: 'json' };
import changesetSchema from '../../../data/schema/changeset.schema.json' with { type: 'json' };
import reportSchema from '../../../data/schema/report.schema.json' with { type: 'json' };
import surveySchema from '../../../data/schema/survey.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
ajv.addSchema(campoSchema);
ajv.addSchema(changesetSchema);
ajv.addSchema(reportSchema);
ajv.addSchema(surveySchema);

function compiled<T>(id: string): ValidateFunction<T> {
  const fn = ajv.getSchema<T>(id);
  if (!fn) throw new Error(`schema ${id} is not registered`);
  return fn as ValidateFunction<T>; // no $async in these schemas, so validation is synchronous
}

export const CHANGESET_SCHEMA_ID = changesetSchema.$id;
export const REPORT_SCHEMA_ID = reportSchema.$id;
export const SURVEY_SCHEMA_ID = surveySchema.$id;

export const validateChangesetSchema = compiled<unknown>(CHANGESET_SCHEMA_ID);
export const validateReportSchema = compiled<unknown>(REPORT_SCHEMA_ID);
export const validateSurveySchema = compiled<unknown>(SURVEY_SCHEMA_ID);

export interface SchemaCheck {
  ok: boolean;
  /** Korean, one line per problem. Empty when ok. */
  errors: string[];
}

export function schemaCheck(fn: ValidateFunction<unknown>, value: unknown): SchemaCheck {
  if (fn(value)) return { ok: true, errors: [] };
  return { ok: false, errors: describeSchemaErrors(fn.errors) };
}

/** "<path> <message>" per Ajv error, without the if/then wrappers ("must match then schema"). */
export function describeSchemaErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) return ['스키마에 맞지 않습니다.'];
  const useful = errors.filter((e) => e.keyword !== 'if');
  return [
    ...new Set(
      useful.map((e) => {
        const extra = e.keyword === 'additionalProperties' ? ` (${String((e.params as { additionalProperty?: unknown }).additionalProperty)})` : '';
        return `${e.instancePath || '/'} ${e.message ?? ''}${extra}`.trim();
      }),
    ),
  ];
}
