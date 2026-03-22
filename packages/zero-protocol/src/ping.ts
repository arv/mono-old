import * as v from '../../shared/src/valita.ts';

export const pingBodySchema = v.strictObject({});
export const pingMessageSchema = v.strictTuple([
  v.literal('ping'),
  pingBodySchema,
]);

export type PingBody = v.Infer<typeof pingBodySchema>;
export type PingMessage = v.Infer<typeof pingMessageSchema>;
