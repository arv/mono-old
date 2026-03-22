import * as v from '../../shared/src/valita.ts';

export const pongBodySchema = v.strictObject({});
export const pongMessageSchema = v.strictTuple([v.literal('pong'), pongBodySchema]);

export type PongBody = v.Infer<typeof pongBodySchema>;
export type PongMessage = v.Infer<typeof pongMessageSchema>;
