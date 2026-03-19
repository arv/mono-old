import {beforeAll, test} from 'vitest';
import {benchSummary} from '../../shared/src/bench.ts';
import {getChinook} from '../../zql-integration-tests/src/chinook/get-deps.ts';
import {schema} from '../../zql-integration-tests/src/chinook/schema.ts';
import {
  bootstrap,
  type Delegates,
} from '../../zql-integration-tests/src/helpers/runner.ts';
import type {Query} from '../../zql/src/query/query.ts';

type Queries = {
  [K in keyof typeof schema.tables & string]: Query<K, typeof schema>;
};

let queries: Queries;
let delegates: Delegates;

beforeAll(async () => {
  const pgContent = await getChinook();
  ({queries, delegates} = await bootstrap({
    suiteName: 'chinook_bench_exists',
    zqlSchema: schema,
    pgContent,
  }));
});

// Demonstration of how to compare two different query styles
test('tracks with artist name', {tags: ['bench']}, async () => {
  await benchSummary('tracks with artist name', {
    'flipped': async () => {
      await delegates.sqlite.run(
        queries.artist
          .where('name', 'AC/DC')
          .related('albums', a => a.related('tracks')),
      );
    },
    'not flipped': async () => {
      await delegates.sqlite.run(
        queries.track.whereExists('album', a =>
          a.whereExists('artist', ar => ar.where('name', 'AC/DC')),
        ),
      );
    },
  });
});
