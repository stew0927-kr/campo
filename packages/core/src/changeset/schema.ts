import { schemaCheck, validateChangesetSchema, type SchemaCheck } from '../json-schema.ts';
import type { Changeset } from './types.ts';

/** Shape check against data/schema/changeset.schema.json (the Features against campo.schema.json). */
export function validateChangeset(value: unknown): SchemaCheck {
  return schemaCheck(validateChangesetSchema, value);
}

export function isChangeset(value: unknown): value is Changeset {
  return validateChangesetSchema(value);
}
