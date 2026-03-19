// oxlint-disable no-console
import {test} from 'vitest';
import {testLogConfig} from '../../otel/src/test-log-config.ts';
import {createSilentLogContext} from '../../shared/src/logging-test-utils.ts';
import {computeZqlSpecs} from '../../zero-cache/src/db/lite-tables.ts';
import type {LiteAndZqlSpec} from '../../zero-cache/src/db/specs.ts';
import type {AST, Condition} from '../../zero-protocol/src/ast.ts';
import {type Format} from '../../zql/src/ivm/default-format.ts';
import {newQueryImpl} from '../../zql/src/query/query-impl.ts';
import {asQueryInternals} from '../../zql/src/query/query-internals.ts';
import type {AnyQuery} from '../../zql/src/query/query.ts';
import {Database} from '../../zqlite/src/db.ts';
import {newQueryDelegate} from '../../zqlite/src/test/source-factory.ts';
import {builder, schema} from './schema.ts';

const dbPath = process.env.ZBUGS_REPLICA_PATH;

// Helper to set flip to false in all correlated subquery conditions
function setFlipToFalse(condition: Condition): Condition {
  if (condition.type === 'correlatedSubquery') {
    return {
      ...condition,
      flip: false,
      related: {
        ...condition.related,
        subquery: setFlipToFalseInAST(condition.related.subquery),
      },
    };
  } else if (condition.type === 'and' || condition.type === 'or') {
    return {
      ...condition,
      conditions: condition.conditions.map(setFlipToFalse),
    };
  }
  return condition;
}

function setFlipToFalseInAST(ast: AST): AST {
  return {
    ...ast,
    where: ast.where ? setFlipToFalse(ast.where) : undefined,
    related: ast.related?.map(r => ({
      ...r,
      subquery: setFlipToFalseInAST(r.subquery),
    })),
  };
}

function createQuery(
  tableName: string,
  queryAST: AST,
  format: Format,
): AnyQuery {
  return newQueryImpl(
    schema,
    tableName as keyof typeof schema.tables & string,
    queryAST,
    format,
    'test',
  );
}

test.skipIf(!dbPath)(
  'full issue scan + join',
  {tags: ['bench']},
  async () => {
    const db = new Database(createSilentLogContext(), dbPath!);
    const lc = createSilentLogContext();

    db.exec('ANALYZE;');

    const tableSpecs = new Map<string, LiteAndZqlSpec>();
    computeZqlSpecs(createSilentLogContext(), db, tableSpecs);

    const delegate = newQueryDelegate(lc, testLogConfig, db, schema);

    const query = builder.issue.related('creator').related('assignee');
    const unplannedAST = asQueryInternals(query).ast;
    const format = asQueryInternals(query).format;

    const tableName = unplannedAST.table;
    const unplannedQuery = createQuery(tableName, unplannedAST, format);

    db.exec('BEGIN');
    const start = performance.now();
    await delegate.run(unplannedQuery as AnyQuery);
    const end = performance.now();
    console.log('duration ', end - start);
    db.exec('ROLLBACK');
  },
);
