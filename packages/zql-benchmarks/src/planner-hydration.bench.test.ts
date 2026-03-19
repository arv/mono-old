import {beforeAll, test} from 'vitest';
import {createSilentLogContext} from '../../shared/src/logging-test-utils.ts';
import {must} from '../../shared/src/must.ts';
import {benchSummary} from '../../shared/src/bench.ts';
import {computeZqlSpecs} from '../../zero-cache/src/db/lite-tables.ts';
import type {LiteAndZqlSpec} from '../../zero-cache/src/db/specs.ts';
import type {AST} from '../../zero-protocol/src/ast.ts';
import {mapAST} from '../../zero-protocol/src/ast.ts';
import {
  clientToServer,
  serverToClient,
} from '../../zero-schema/src/name-mapper.ts';
import type {TableSchema} from '../../zero-types/src/schema.ts';
import {getChinook} from '../../zql-integration-tests/src/chinook/get-deps.ts';
import {schema} from '../../zql-integration-tests/src/chinook/schema.ts';
import {bootstrap} from '../../zql-integration-tests/src/helpers/runner.ts';
import {defaultFormat} from '../../zql/src/ivm/default-format.ts';
import {planQuery} from '../../zql/src/planner/planner-builder.ts';
import {completeOrdering} from '../../zql/src/query/complete-ordering.ts';
import {newQueryImpl} from '../../zql/src/query/query-impl.ts';
import {asQueryInternals} from '../../zql/src/query/query-internals.ts';
import type {AnyQuery} from '../../zql/src/query/query.ts';
import {createSQLiteCostModel} from '../../zqlite/src/sqlite-cost-model.ts';

let setup: Awaited<ReturnType<typeof bootstrap<typeof schema>>>;
let costModel: ReturnType<typeof createSQLiteCostModel>;
let tables: {[key: string]: TableSchema};
let clientToServerMapper: ReturnType<typeof clientToServer>;
let serverToClientMapper: ReturnType<typeof serverToClient>;

beforeAll(async () => {
  const pgContent = await getChinook();

  setup = await bootstrap({
    suiteName: 'planner_hydration_bench',
    zqlSchema: schema,
    pgContent,
  });

  setup.dbs.sqlite.exec('ANALYZE;');

  tables = schema.tables;

  const tableSpecs = new Map<string, LiteAndZqlSpec>();
  computeZqlSpecs(createSilentLogContext(), setup.dbs.sqlite, tableSpecs);

  costModel = createSQLiteCostModel(setup.dbs.sqlite, tableSpecs);
  clientToServerMapper = clientToServer(schema.tables);
  serverToClientMapper = serverToClient(schema.tables);
});

function createQuery(tableName: string, queryAST: AST): AnyQuery {
  return newQueryImpl(
    schema,
    tableName as keyof typeof schema.tables & string,
    queryAST,
    defaultFormat,
    'test',
  );
}

// Returns {unplanned, planned} bench fns for a query, with AST prep done upfront.
function makePlanBenchFns(query: AnyQuery) {
  const unplannedAST = asQueryInternals(query).ast;
  const completeOrderAst = completeOrdering(
    unplannedAST,
    tableName =>
      must(tables[tableName], `Table ${tableName} not found`).primaryKey,
  );
  const mappedAST = mapAST(completeOrderAst, clientToServerMapper);
  const plannedServerAST = planQuery(mappedAST, costModel);
  const plannedClientAST = mapAST(plannedServerAST, serverToClientMapper);

  const tableName = unplannedAST.table;
  const unplannedQuery = createQuery(tableName, unplannedAST);
  const plannedQuery = createQuery(tableName, plannedClientAST);

  const delegate = setup.delegates.sqlite;

  return {
    unplanned: async () => {
      await delegate.run(unplannedQuery);
    },
    planned: async () => {
      await delegate.run(plannedQuery);
    },
  };
}

const queryCases = [
  {
    name: 'track.exists(album) where title="Big Ones"',
    createQuery: () =>
      setup.queries.track.whereExists('album', q => q.where('title', 'Big Ones')),
  },
  {
    name: 'track.exists(album).exists(genre)',
    createQuery: () =>
      setup.queries.track.whereExists('album').whereExists('genre'),
  },
  {
    name: 'track.exists(album).exists(genre) with filters',
    createQuery: () =>
      setup.queries.track
        .whereExists('album', q => q.where('title', 'Big Ones'))
        .whereExists('genre', q => q.where('name', 'Rock')),
  },
  {
    name: 'playlist.exists(tracks)',
    createQuery: () => setup.queries.playlist.whereExists('tracks'),
  },
  {
    name: 'track.exists(playlists)',
    createQuery: () => setup.queries.track.whereExists('playlists'),
  },
  {
    name: 'track.exists(album) OR exists(genre)',
    createQuery: () =>
      setup.queries.track.where(({or, exists}) =>
        or(
          exists('album', q => q.where('title', 'Big Ones')),
          exists('genre', q => q.where('name', 'Rock')),
        ),
      ),
  },
];

test.for(queryCases)(
  '%s',
  async ({name, createQuery}) => {
    const fns = makePlanBenchFns(createQuery());
    await benchSummary(name, {
      unplanned: fns.unplanned,
      planned: fns.planned,
    });
  },
  {tags: ['bench']},
);
