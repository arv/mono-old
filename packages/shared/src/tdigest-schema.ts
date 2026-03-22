import * as v from './valita.ts';

/**
 * Valita schema for TDigest JSON representation.
 * Matches the structure returned by TDigest.toJSON().
 */
export const tdigestSchema = v.tupleWithRest([v.number()], v.number());

export type TDigestJSON = v.Infer<typeof tdigestSchema>;
