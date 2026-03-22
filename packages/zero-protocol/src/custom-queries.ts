import {jsonSchema} from '../../shared/src/json-schema.ts';
import * as v from '../../shared/src/valita.ts';
import {astSchema} from './ast.ts';
import {transformFailedBodySchema} from './error.ts';

export const transformRequestBodySchema = v.array(
  v.strictObject({
    id: v.string(),
    name: v.string(),
    args: v.readonly(v.array(jsonSchema)),
  }),
);
export type TransformRequestBody = v.Infer<typeof transformRequestBodySchema>;

export const transformedQuerySchema = v.strictObject({
  id: v.string(),
  name: v.string(),
  ast: astSchema,
});

export const appErroredQuerySchema = v.strictObject({
  error: v.literal('app'),
  id: v.string(),
  name: v.string(),
  // optional for backwards compatibility
  message: v.optional(v.string()),
  details: v.optional(jsonSchema),
});
export const parseErroredQuerySchema = v.strictObject({
  error: v.literal('parse'),
  id: v.string(),
  name: v.string(),
  message: v.string(),
  details: v.optional(jsonSchema),
});
export const erroredQuerySchema = v.union([
  appErroredQuerySchema,
  parseErroredQuerySchema,
]);
export type ErroredQuery = v.Infer<typeof erroredQuerySchema>;

export const transformResponseBodySchema = v.array(
  v.union([transformedQuerySchema, erroredQuerySchema]),
);
export type TransformResponseBody = v.Infer<typeof transformResponseBodySchema>;

export const transformRequestMessageSchema = v.strictTuple([
  v.literal('transform'),
  transformRequestBodySchema,
]);
export type TransformRequestMessage = v.Infer<
  typeof transformRequestMessageSchema
>;
export const transformErrorMessageSchema = v.strictTuple([
  v.literal('transformError'),
  v.array(erroredQuerySchema),
]);
export type TransformErrorMessage = v.Infer<typeof transformErrorMessageSchema>;

const transformFailedMessageSchema = v.strictTuple([
  v.literal('transformFailed'),
  transformFailedBodySchema,
]);
const transformOkMessageSchema = v.strictTuple([
  v.literal('transformed'),
  transformResponseBodySchema,
]);

export const transformResponseMessageSchema = v.union([
  transformOkMessageSchema,
  transformFailedMessageSchema,
]);
export type TransformResponseMessage = v.Infer<
  typeof transformResponseMessageSchema
>;
