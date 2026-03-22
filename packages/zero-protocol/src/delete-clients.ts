import * as v from '../../shared/src/valita.ts';

export const deleteClientsBodySchema = v.union([
  v.readonlyObject({
    clientIDs: v.optional(v.readonlyArray(v.string())),
    clientGroupIDs: v.optional(v.readonlyArray(v.string())),
  }),
]);

export const deleteClientsMessageSchema = v.strictTuple([
  v.literal('deleteClients'),
  deleteClientsBodySchema,
]);

export type DeleteClientsBody = v.Infer<typeof deleteClientsBodySchema>;
export type DeleteClientsMessage = v.Infer<typeof deleteClientsMessageSchema>;
