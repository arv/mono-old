import * as v from '../../shared/src/valita.ts';
import {upQueriesPatchSchema} from './queries-patch.ts';

const changeDesiredQueriesBodySchema = v.strictObject({
  desiredQueriesPatch: upQueriesPatchSchema,
});

export const changeDesiredQueriesMessageSchema = v.strictTuple([
  v.literal('changeDesiredQueries'),
  changeDesiredQueriesBodySchema,
]);

export type ChangeDesiredQueriesBody = v.Infer<
  typeof changeDesiredQueriesBodySchema
>;
export type ChangeDesiredQueriesMessage = v.Infer<
  typeof changeDesiredQueriesMessageSchema
>;
