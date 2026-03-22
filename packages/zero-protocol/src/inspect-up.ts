import {jsonSchema} from '../../shared/src/json-schema.ts';
import * as v from '../../shared/src/valita.ts';
import {astSchema} from './ast.ts';

const inspectUpBase = v.strictObject({
  id: v.string(),
});

const inspectQueriesUpBodySchema = v.strictObject({
  ...inspectUpBase.entries,
  op: v.literal('queries'),
  clientID: v.optional(v.string()),
});

export type InspectQueriesUpBody = v.Infer<typeof inspectQueriesUpBodySchema>;

const inspectMetricsUpSchema = v.strictObject({
  ...inspectUpBase.entries,
  op: v.literal('metrics'),
});

export type InspectMetricsUpBody = v.Infer<typeof inspectMetricsUpSchema>;

const inspectVersionUpSchema = v.strictObject({
  ...inspectUpBase.entries,
  op: v.literal('version'),
});

export type InspectVersionUpBody = v.Infer<typeof inspectVersionUpSchema>;

export const inspectAuthenticateUpSchema = v.strictObject({
  ...inspectUpBase.entries,
  op: v.literal('authenticate'),
  value: v.string(),
});

export type InspectAuthenticateUpBody = v.Infer<
  typeof inspectAuthenticateUpSchema
>;

const analyzeQueryOptionsSchema = v.strictObject({
  vendedRows: v.optional(v.boolean()),
  syncedRows: v.optional(v.boolean()),
  joinPlans: v.optional(v.boolean()),
});

export type AnalyzeQueryOptions = v.Infer<typeof analyzeQueryOptionsSchema>;

export const inspectAnalyzeQueryUpSchema = v.strictObject({
  ...inspectUpBase.entries,
  op: v.literal('analyze-query'),
  /** @deprecated Use {@linkcode ast} instead */
  value: v.optional(astSchema),
  options: v.optional(analyzeQueryOptionsSchema),
  ast: v.optional(astSchema),
  name: v.optional(v.string()),
  args: v.optional(v.readonlyArray(jsonSchema)),
});

export type InspectAnalyzeQueryUpBody = v.Infer<
  typeof inspectAnalyzeQueryUpSchema
>;

const inspectUpBodySchema = v.union([
  inspectQueriesUpBodySchema,
  inspectMetricsUpSchema,
  inspectVersionUpSchema,
  inspectAuthenticateUpSchema,
  inspectAnalyzeQueryUpSchema,
]);

export const inspectUpMessageSchema = v.strictTuple([
  v.literal('inspect'),
  inspectUpBodySchema,
]);

export type InspectUpMessage = v.Infer<typeof inspectUpMessageSchema>;

export type InspectUpBody = v.Infer<typeof inspectUpBodySchema>;
