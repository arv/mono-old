import {jsonObjectSchema} from '../../shared/src/json-schema.ts';
import * as v from '../../shared/src/valita.ts';
import {rowSchema} from './data.ts';
import {primaryKeyValueRecordSchema} from './primary-key.ts';

const putOpSchema = v.strictObject({
  op: v.literal('put'),
  tableName: v.string(),
  value: rowSchema,
});

const updateOpSchema = v.strictObject({
  op: v.literal('update'),
  tableName: v.string(),
  id: primaryKeyValueRecordSchema,
  merge: v.optional(jsonObjectSchema),
  constrain: v.optional(v.array(v.string())),
});

const delOpSchema = v.strictObject({
  op: v.literal('del'),
  tableName: v.string(),
  id: primaryKeyValueRecordSchema,
});

const clearOpSchema = v.strictObject({
  op: v.literal('clear'),
});

const rowPatchOpSchema = v.union([
  putOpSchema,
  updateOpSchema,
  delOpSchema,
  clearOpSchema,
]);

export const rowsPatchSchema = v.array(rowPatchOpSchema);
export type RowPatchOp = v.Infer<typeof rowPatchOpSchema>;
