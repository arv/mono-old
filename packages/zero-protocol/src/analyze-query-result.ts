import * as v from '../../shared/src/valita.ts';

import {conditionSchema, orderingSchema} from './ast.ts';
import {rowSchema} from './data.ts';

export const rowCountsByQuerySchema = v.record(v.string(), v.number());
export type RowCountsByQuery = v.Infer<typeof rowCountsByQuerySchema>;

export const rowCountsBySourceSchema = v.record(v.string(), rowCountsByQuerySchema);
export type RowCountsBySource = v.Infer<typeof rowCountsBySourceSchema>;

export const rowsByQuerySchema = v.record(v.string(), v.array(rowSchema));
export type RowsByQuery = v.Infer<typeof rowsByQuerySchema>;

export const rowsBySourceSchema = v.record(v.string(), rowsByQuerySchema);
export type RowsBySource = v.Infer<typeof rowsBySourceSchema>;

// Planner debug event schemas

const costEstimateJSONSchema = v.strictObject({
  startupCost: v.number(),
  scanEst: v.number(),
  cost: v.number(),
  returnedRows: v.number(),
  selectivity: v.number(),
  limit: v.optional(v.number()),
});

const plannerConstraintSchema = v.record(v.string(), v.union([v.unknown(), v.null()]));

const attemptStartEventJSONSchema = v.strictObject({
  type: v.literal('attempt-start'),
  attemptNumber: v.number(),
  totalAttempts: v.number(),
});

const connectionCostsEventJSONSchema = v.strictObject({
  type: v.literal('connection-costs'),
  attemptNumber: v.number(),
  costs: v.array(
    v.strictObject({
      connection: v.string(),
      cost: v.number(),
      costEstimate: costEstimateJSONSchema,
      pinned: v.boolean(),
      constraints: v.record(v.string(), v.union([plannerConstraintSchema, v.null()])),
      constraintCosts: v.record(v.string(), costEstimateJSONSchema),
    }),
  ),
});

const connectionSelectedEventJSONSchema = v.strictObject({
  type: v.literal('connection-selected'),
  attemptNumber: v.number(),
  connection: v.string(),
  cost: v.number(),
  isRoot: v.boolean(),
});

const constraintsPropagatedEventJSONSchema = v.strictObject({
  type: v.literal('constraints-propagated'),
  attemptNumber: v.number(),
  connectionConstraints: v.array(
    v.strictObject({
      connection: v.string(),
      constraints: v.record(v.string(), v.union([plannerConstraintSchema, v.null()])),
      constraintCosts: v.record(v.string(), costEstimateJSONSchema),
    }),
  ),
});

const joinTypeSchema = v.union([
  v.literal('semi'),
  v.literal('flipped'),
  v.literal('unflippable'),
]);

const planCompleteEventJSONSchema = v.strictObject({
  type: v.literal('plan-complete'),
  attemptNumber: v.number(),
  totalCost: v.number(),
  flipPattern: v.number(),
  joinStates: v.array(
    v.strictObject({
      join: v.string(),
      type: joinTypeSchema,
    }),
  ),
});

const planFailedEventJSONSchema = v.strictObject({
  type: v.literal('plan-failed'),
  attemptNumber: v.number(),
  reason: v.string(),
});

const bestPlanSelectedEventJSONSchema = v.strictObject({
  type: v.literal('best-plan-selected'),
  bestAttemptNumber: v.number(),
  totalCost: v.number(),
  flipPattern: v.number(),
  joinStates: v.array(
    v.strictObject({
      join: v.string(),
      type: joinTypeSchema,
    }),
  ),
});

const nodeTypeSchema = v.union([
  v.literal('connection'),
  v.literal('join'),
  v.literal('fan-out'),
  v.literal('fan-in'),
  v.literal('terminus'),
]);

const nodeCostEventJSONSchema = v.strictObject({
  type: v.literal('node-cost'),
  attemptNumber: v.optional(v.number()),
  nodeType: nodeTypeSchema,
  node: v.string(),
  branchPattern: v.array(v.number()),
  downstreamChildSelectivity: v.number(),
  costEstimate: costEstimateJSONSchema,
  filters: v.optional(conditionSchema),
  ordering: v.optional(orderingSchema),
  joinType: v.optional(joinTypeSchema),
});

const nodeConstraintEventJSONSchema = v.strictObject({
  type: v.literal('node-constraint'),
  attemptNumber: v.optional(v.number()),
  nodeType: nodeTypeSchema,
  node: v.string(),
  branchPattern: v.array(v.number()),
  constraint: v.optional(v.union([plannerConstraintSchema, v.null()])),
  from: v.string(),
});

const planDebugEventJSONSchema = v.union([
  attemptStartEventJSONSchema,
  connectionCostsEventJSONSchema,
  connectionSelectedEventJSONSchema,
  constraintsPropagatedEventJSONSchema,
  planCompleteEventJSONSchema,
  planFailedEventJSONSchema,
  bestPlanSelectedEventJSONSchema,
  nodeCostEventJSONSchema,
  nodeConstraintEventJSONSchema,
]);

export type PlanDebugEventJSON = v.Infer<typeof planDebugEventJSONSchema>;

export {
  attemptStartEventJSONSchema,
  connectionSelectedEventJSONSchema,
  planFailedEventJSONSchema,
  bestPlanSelectedEventJSONSchema,
  nodeConstraintEventJSONSchema,
};

export const analyzeQueryResultSchema = v.strictObject({
  warnings: v.array(v.string()),
  syncedRows: v.optional(v.record(v.string(), v.array(rowSchema))),
  syncedRowCount: v.number(),
  start: v.number(),
  /** @deprecated Use start + elapsed instead */
  end: v.number(),
  elapsed: v.optional(v.number()),
  afterPermissions: v.optional(v.string()),
  /** @deprecated Use readRowCountsByQuery */
  vendedRowCounts: v.optional(rowCountsBySourceSchema),
  /** @deprecated Use readRows */
  vendedRows: v.optional(rowsBySourceSchema),
  sqlitePlans: v.optional(v.record(v.string(), v.array(v.string()))),
  readRows: v.optional(rowsBySourceSchema),
  readRowCountsByQuery: v.optional(rowCountsBySourceSchema),
  readRowCount: v.optional(v.number()),
  dbScansByQuery: v.optional(rowCountsBySourceSchema),
  joinPlans: v.optional(v.array(planDebugEventJSONSchema)),
});

export type AnalyzeQueryResult = v.Infer<typeof analyzeQueryResultSchema>;
