import {beforeAll, test} from 'vitest';
import {createSilentLogContext} from '../../shared/src/logging-test-utils.ts';
import {must} from '../../shared/src/must.ts';
import {benchSummary} from '../../shared/src/bench.ts';
import {computeZqlSpecs} from '../../zero-cache/src/db/lite-tables.ts';
import type {LiteAndZqlSpec} from '../../zero-cache/src/db/specs.ts';
import {mapAST} from '../../zero-protocol/src/ast.ts';
import {clientToServer} from '../../zero-schema/src/name-mapper.ts';
import {getChinook} from '../../zql-integration-tests/src/chinook/get-deps.ts';
import {schema} from '../../zql-integration-tests/src/chinook/schema.ts';
import {bootstrap} from '../../zql-integration-tests/src/helpers/runner.ts';
import {planQuery} from '../../zql/src/planner/planner-builder.ts';
import {completeOrdering} from '../../zql/src/query/complete-ordering.ts';
import {asQueryInternals} from '../../zql/src/query/query-internals.ts';
import type {Query} from '../../zql/src/query/query.ts';
import {createSQLiteCostModel} from '../../zqlite/src/sqlite-cost-model.ts';
import type {TableSchema} from '../../zero-types/src/schema.ts';

let setup: Awaited<ReturnType<typeof bootstrap<typeof schema>>>;
let costModel: ReturnType<typeof createSQLiteCostModel>;
let tables: {[key: string]: TableSchema};
let clientToServerMapper: ReturnType<typeof clientToServer>;

beforeAll(async () => {
  const pgContent = await getChinook();

  setup = await bootstrap({
    suiteName: 'planner_cost_bench',
    zqlSchema: schema,
    pgContent,
  });

  setup.dbs.sqlite.exec('ANALYZE;');

  tables = schema.tables;

  const tableSpecs = new Map<string, LiteAndZqlSpec>();
  computeZqlSpecs(createSilentLogContext(), setup.dbs.sqlite, tableSpecs);

  costModel = createSQLiteCostModel(setup.dbs.sqlite, tableSpecs);
  clientToServerMapper = clientToServer(schema.tables);
});

// Returns a fn that times only the planQuery call; AST prep is done upfront.
function makePlanFn<TTable extends keyof typeof schema.tables & string>(
  query: Query<TTable, typeof schema>,
) {
  return () => {
    const unplannedAST = asQueryInternals(query).ast;
    const completeOrderAst = completeOrdering(
      unplannedAST,
      tableName =>
        must(tables[tableName], `Table ${tableName} not found`).primaryKey,
    );
    const mappedAST = mapAST(completeOrderAst, clientToServerMapper);
    planQuery(mappedAST, costModel);
  };
}

test('planner cost', {tags: ['bench']}, async () => {
  const {queries} = setup;
  await benchSummary('planner cost', {
    '1 exists: track.exists(album)': makePlanFn(
      queries.track.whereExists('album'),
    ),
    '2 exists (AND): track.exists(album).exists(genre)': makePlanFn(
      queries.track.whereExists('album').whereExists('genre'),
    ),
    '3 exists (AND)': makePlanFn(
      queries.track
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType'),
    ),
    '3 exists (OR)': makePlanFn(
      queries.track.where(({or, exists}) =>
        or(
          exists('album', q => q.where('title', 'Big Ones')),
          exists('genre', q => q.where('name', 'Rock')),
          exists('mediaType', q => q.where('name', 'MPEG audio file')),
        ),
      ),
    ),
    '5 exists (AND)': makePlanFn(
      queries.track
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType')
        .whereExists('invoiceLines')
        .whereExists('playlistTrackJunction'),
    ),
    '5 exists (OR)': makePlanFn(
      queries.track.where(({or, exists}) =>
        or(
          exists('album', q => q.where('title', 'Big Ones')),
          exists('genre', q => q.where('name', 'Rock')),
          exists('mediaType', q => q.where('name', 'MPEG audio file')),
          exists('album', q => q.where('title', 'Big Ones 2')),
          exists('genre', q => q.where('name', 'Pop')),
        ),
      ),
    ),
    'Nested 2 levels: track > album > artist': makePlanFn(
      queries.track.whereExists('album', q => q.whereExists('artist')),
    ),
    'Nested 4 levels: playlist > tracks > album > artist': makePlanFn(
      queries.playlist.whereExists('tracks', q =>
        q.whereExists('album', q2 => q2.whereExists('artist')),
      ),
    ),
    'Nested with filters: track > album > artist (filtered)': makePlanFn(
      queries.track.whereExists('album', q =>
        q
          .where('title', 'Big Ones')
          .whereExists('artist', q2 => q2.where('name', 'Aerosmith')),
      ),
    ),
    '10 exists (AND)': makePlanFn(
      queries.track
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType')
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType')
        .whereExists('album')
        .whereExists('genre')
        .whereExists('playlistTrackJunction')
        .whereExists('invoiceLines'),
    ),
    '10 exists (OR)': makePlanFn(
      queries.track.where(({or, exists}) =>
        or(
          exists('album', q => q.where('id', 1)),
          exists('album', q => q.where('id', 2)),
          exists('album', q => q.where('id', 3)),
          exists('album', q => q.where('id', 4)),
          exists('album', q => q.where('id', 5)),
          exists('genre', q => q.where('id', 1)),
          exists('genre', q => q.where('id', 2)),
          exists('genre', q => q.where('id', 3)),
          exists('mediaType', q => q.where('id', 1)),
          exists('mediaType', q => q.where('id', 2)),
        ),
      ),
    ),
    '12 exists (AND)': makePlanFn(
      queries.track
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType')
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType')
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType')
        .whereExists('album')
        .whereExists('genre')
        .whereExists('mediaType'),
    ),
    '12 exists (OR)': makePlanFn(
      queries.track.where(({or, exists}) =>
        or(
          exists('album', q => q.where('id', 1)),
          exists('album', q => q.where('id', 2)),
          exists('album', q => q.where('id', 3)),
          exists('album', q => q.where('id', 4)),
          exists('album', q => q.where('id', 5)),
          exists('genre', q => q.where('id', 1)),
          exists('genre', q => q.where('id', 2)),
          exists('genre', q => q.where('id', 3)),
          exists('genre', q => q.where('id', 4)),
          exists('genre', q => q.where('id', 5)),
          exists('mediaType', q => q.where('id', 1)),
          exists('mediaType', q => q.where('id', 2)),
        ),
      ),
    ),
    '12 level nesting': makePlanFn(
      queries.track.whereExists('playlists', q =>
        q.whereExists('tracks', q2 =>
          q2.whereExists('album', q3 =>
            q3.whereExists('artist', q4 =>
              q4.whereExists('albums', q5 =>
                q5.whereExists('tracks', q6 =>
                  q6.whereExists('genre', q7 =>
                    q7.whereExists('tracks', q8 =>
                      q8.whereExists('mediaType', q9 =>
                        q9.whereExists('tracks', q => q.whereExists('album')),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  });
});
