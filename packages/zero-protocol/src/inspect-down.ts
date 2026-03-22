import {jsonSchema} from '../../shared/src/json-schema.ts';
import {tdigestSchema} from '../../shared/src/tdigest-schema.ts';
import * as v from '../../shared/src/valita.ts';
import {analyzeQueryResultSchema} from './analyze-query-result.ts';
import {astSchema} from './ast.ts';

const serverMetricsSchema = v.strictObject({
  'query-materialization-server': tdigestSchema,
  'query-update-server': tdigestSchema,
});

export type ServerMetrics = v.Infer<typeof serverMetricsSchema>;

const inspectQueryRowSchema = v.strictObject({
  clientID: v.string(),
  queryID: v.string(),
  // This is the server return AST for custom queries
  // TODO: Return server generated AST
  ast: v.nullable(astSchema),
  // not null for custom queries
  name: v.nullable(v.string()),
  // not null for custom queries
  args: v.nullable(v.readonlyArray(jsonSchema)),
  got: v.boolean(),
  deleted: v.boolean(),
  ttl: v.number(),
  inactivatedAt: v.nullable(v.number()),
  rowCount: v.number(),
  metrics: v.optional(v.nullable(serverMetricsSchema)),
});

export type InspectQueryRow = v.Infer<typeof inspectQueryRowSchema>;

const inspectBaseDownSchema = v.strictObject({
  id: v.string(),
});

export const inspectQueriesDownSchema = v.strictObject({
  ...inspectBaseDownSchema.entries,
  op: v.literal('queries'),
  value: v.array(inspectQueryRowSchema),
});

export type InspectQueriesDown = v.Infer<typeof inspectQueriesDownSchema>;

export const inspectMetricsDownSchema = v.strictObject({
  ...inspectBaseDownSchema.entries,
  op: v.literal('metrics'),
  value: serverMetricsSchema,
});

export type InspectMetricsDown = v.Infer<typeof inspectMetricsDownSchema>;

export const inspectVersionDownSchema = v.strictObject({
  ...inspectBaseDownSchema.entries,
  op: v.literal('version'),
  value: v.string(),
});

export const inspectAuthenticatedDownSchema = v.strictObject({
  ...inspectBaseDownSchema.entries,
  op: v.literal('authenticated'),
  value: v.boolean(),
});

export type InspectAuthenticatedDown = v.Infer<
  typeof inspectAuthenticatedDownSchema
>;

export const inspectAnalyzeQueryDownSchema = v.strictObject({
  ...inspectBaseDownSchema.entries,
  op: v.literal('analyze-query'),
  value: analyzeQueryResultSchema,
});

export type InspectAnalyzeQueryDown = v.Infer<
  typeof inspectAnalyzeQueryDownSchema
>;

export const inspectErrorDownSchema = v.strictObject({
  ...inspectBaseDownSchema.entries,
  op: v.literal('error'),
  value: v.string(),
});

export type InspectErrorDown = v.Infer<typeof inspectErrorDownSchema>;

export const inspectDownBodySchema = v.union([
  inspectQueriesDownSchema,
  inspectMetricsDownSchema,
  inspectVersionDownSchema,
  inspectAuthenticatedDownSchema,
  inspectAnalyzeQueryDownSchema,
  inspectErrorDownSchema,
]);

export const inspectDownMessageSchema = v.strictTuple([
  v.literal('inspect'),
  inspectDownBodySchema,
]);

export type InspectDownMessage = v.Infer<typeof inspectDownMessageSchema>;

export type InspectDownBody = v.Infer<typeof inspectDownBodySchema>;
