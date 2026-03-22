import {jsonSchema} from '../../shared/src/json-schema.ts';
import * as v from '../../shared/src/valita.ts';
import {mutationIDSchema} from './mutation-id.ts';
import {ErrorKind} from './error-kind.ts';
import {ErrorOrigin} from './error-origin.ts';
import {ErrorReason} from './error-reason.ts';

const basicErrorKindSchema = v.literalUnion(
  ErrorKind.AuthInvalidated,
  ErrorKind.ClientNotFound,
  ErrorKind.InvalidConnectionRequest,
  ErrorKind.InvalidConnectionRequestBaseCookie,
  ErrorKind.InvalidConnectionRequestLastMutationID,
  ErrorKind.InvalidConnectionRequestClientDeleted,
  ErrorKind.InvalidMessage,
  ErrorKind.InvalidPush,
  ErrorKind.MutationRateLimited,
  ErrorKind.MutationFailed,
  ErrorKind.Unauthorized,
  ErrorKind.VersionNotSupported,
  ErrorKind.SchemaVersionNotSupported,
  ErrorKind.Internal,
);

const basicErrorBodySchema = v.strictObject({
  kind: basicErrorKindSchema,
  message: v.string(),
  // this is optional for backwards compatibility
  origin: v.optional(v.literalUnion(ErrorOrigin.Server, ErrorOrigin.ZeroCache)),
});

const backoffErrorKindSchema = v.literalUnion(
  ErrorKind.Rebalance,
  ErrorKind.Rehome,
  ErrorKind.ServerOverloaded,
);

const backoffBodySchema = v.strictObject({
  kind: backoffErrorKindSchema,
  message: v.string(),
  minBackoffMs: v.optional(v.number()),
  maxBackoffMs: v.optional(v.number()),
  // Query parameters to send in the next reconnect. In the event of
  // a conflict, these will be overridden by the parameters used by
  // the client; it is the responsibility of the server to avoid
  // parameter name conflicts.
  //
  // The parameters will only be added to the immediately following
  // reconnect, and not after that.
  reconnectParams: v.optional(v.record(v.string(), v.string())),
  origin: v.optional(v.literal(ErrorOrigin.ZeroCache)),
});

const pushFailedErrorKindSchema = v.literal(ErrorKind.PushFailed);
const transformFailedErrorKindSchema = v.literal(ErrorKind.TransformFailed);

export const errorKindSchema: v.Type<ErrorKind> = v.union([
  basicErrorKindSchema,
  backoffErrorKindSchema,
  pushFailedErrorKindSchema,
  transformFailedErrorKindSchema,
]);

const pushFailedBaseSchema = v.strictObject({
  kind: pushFailedErrorKindSchema,
  details: v.optional(jsonSchema),
  /**
   * The mutationIDs of the mutations that failed to process.
   * This can be a subset of the mutationIDs in the request.
   */
  mutationIDs: v.array(mutationIDSchema),
  message: v.string(),
});

export const pushFailedBodySchema = v.union([
  v.strictObject({
    ...pushFailedBaseSchema.entries,
    origin: v.literal(ErrorOrigin.Server),
    reason: v.literalUnion(
      ErrorReason.Database,
      ErrorReason.Parse,
      ErrorReason.OutOfOrderMutation,
      ErrorReason.UnsupportedPushVersion,
      ErrorReason.Internal,
    ),
  }),
  v.strictObject({
    ...pushFailedBaseSchema.entries,
    origin: v.literal(ErrorOrigin.ZeroCache),
    reason: v.literal(ErrorReason.HTTP),
    status: v.number(),
    bodyPreview: v.optional(v.string()),
  }),
  v.strictObject({
    ...pushFailedBaseSchema.entries,
    origin: v.literal(ErrorOrigin.ZeroCache),
    reason: v.literalUnion(
      ErrorReason.Timeout,
      ErrorReason.Parse,
      ErrorReason.Internal,
    ),
  }),
]);

const transformFailedBaseSchema = v.strictObject({
  kind: transformFailedErrorKindSchema,
  details: v.optional(jsonSchema),
  /**
   * The queryIDs of the queries that failed to transform.
   */
  queryIDs: v.array(v.string()),
  message: v.string(),
});

export const transformFailedBodySchema = v.union([
  v.strictObject({
    ...transformFailedBaseSchema.entries,
    origin: v.literal(ErrorOrigin.Server),
    reason: v.literalUnion(
      ErrorReason.Database,
      ErrorReason.Parse,
      ErrorReason.Internal,
    ),
  }),
  v.strictObject({
    ...transformFailedBaseSchema.entries,
    origin: v.literal(ErrorOrigin.ZeroCache),
    reason: v.literal(ErrorReason.HTTP),
    status: v.number(),
    bodyPreview: v.optional(v.string()),
  }),
  v.strictObject({
    ...transformFailedBaseSchema.entries,
    origin: v.literal(ErrorOrigin.ZeroCache),
    reason: v.literalUnion(
      ErrorReason.Timeout,
      ErrorReason.Parse,
      ErrorReason.Internal,
    ),
  }),
]);

export const errorBodySchema = v.union([
  basicErrorBodySchema,
  backoffBodySchema,
  pushFailedBodySchema,
  transformFailedBodySchema,
]);

export type BackoffBody = v.Infer<typeof backoffBodySchema>;
export type PushFailedBody = v.Infer<typeof pushFailedBodySchema>;
export type TransformFailedBody = v.Infer<typeof transformFailedBodySchema>;
export type ErrorBody = v.Infer<typeof errorBodySchema>;

export const errorMessageSchema: v.Type<ErrorMessage> = v.strictTuple([
  v.literal('error'),
  errorBodySchema,
]);

export type ErrorMessage = ['error', ErrorBody];

/**
 * Represents an error used across zero-client, zero-cache, and zero-server.
 */
export class ProtocolError<
  const T extends ErrorBody = ErrorBody,
> extends Error {
  readonly errorBody: T;

  constructor(errorBody: T, options?: ErrorOptions) {
    super(errorBody.message, options);
    this.name = 'ProtocolError';
    this.errorBody = errorBody;
  }

  get kind(): T['kind'] {
    return this.errorBody.kind;
  }
}

export function isProtocolError(error: unknown): error is ProtocolError {
  return error instanceof ProtocolError;
}
