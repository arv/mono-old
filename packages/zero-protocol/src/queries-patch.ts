import {jsonSchema} from '../../shared/src/json-schema.ts';
import * as v from '../../shared/src/valita.ts';
import {astSchema} from './ast.ts';

export const putOpSchema = v.strictObject({
  op: v.literal('put'),
  hash: v.string(),
  ttl: v.optional(v.number()),
});

export const upPutOpSchema = v.strictObject({
  ...putOpSchema.entries,
  // All fields are optional in this transitional period.
  // - ast is filled in for client queries
  // - name and args are filled in for custom queries
  ast: v.optional(astSchema),
  name: v.optional(v.string()),
  args: v.optional(v.readonly(v.array(jsonSchema))),
});

const delOpSchema = v.strictObject({
  op: v.literal('del'),
  hash: v.string(),
});

const clearOpSchema = v.strictObject({
  op: v.literal('clear'),
});

const patchOpSchema = v.union([putOpSchema, delOpSchema, clearOpSchema]);
const upPatchOpSchema = v.union([upPutOpSchema, delOpSchema, clearOpSchema]);

export const queriesPatchSchema = v.array(patchOpSchema);
export const upQueriesPatchSchema = v.array(upPatchOpSchema);

export type QueriesPutOp = v.Infer<typeof putOpSchema>;
export type QueriesDelOp = v.Infer<typeof delOpSchema>;
export type QueriesClearOp = v.Infer<typeof clearOpSchema>;
export type QueriesPatchOp = v.Infer<typeof patchOpSchema>;
export type UpQueriesPatchOp = v.Infer<typeof upPatchOpSchema>;
export type QueriesPatch = v.Infer<typeof queriesPatchSchema>;
export type UpQueriesPatch = v.Infer<typeof upQueriesPatchSchema>;
