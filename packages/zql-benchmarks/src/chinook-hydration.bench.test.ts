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
    suiteName: 'chinook_bench_hydrate',
    zqlSchema: schema,
    pgContent,
  }));
});

const benchSpecs = [
  {
    name: '(table scan) select * from album',
    createQuery: (q: Queries) => q.album,
  },
  {
    name: '(pk lookup) select * from track where id = 3163',
    createQuery: (q: Queries) => q.track.where('id', 3163),
  },
  {
    name: '(secondary index lookup) select * from track where album_id = 248',
    createQuery: (q: Queries) => q.track.where('albumId', 248),
  },
  {
    name: 'scan with one depth related',
    createQuery: (q: Queries) => q.album.related('artist'),
  },
  {
    name: 'all playlists',
    createQuery: (q: Queries) =>
      q.playlist.related('tracks', t =>
        t
          .related('mediaType')
          .related('genre')
          .related('album', a => a.related('artist')),
      ),
  },
  {
    name: 'OR with empty branch and limit',
    createQuery: (q: Queries) =>
      q.track
        .where(({or, cmp}) =>
          or(cmp('milliseconds', -1), cmp('mediaTypeId', 1)),
        )
        .limit(5),
  },
  {
    name: 'OR with empty branch and limit with exists',
    createQuery: (q: Queries) =>
      q.track
        .where(({or, cmp, exists}) =>
          or(
            cmp('milliseconds', -1),
            exists('mediaType', q => q.where('id', 1)),
          ),
        )
        .limit(5),
  },
];

test.for(benchSpecs)(
  '%s',
  async ({name, createQuery}) => {
    const q = createQuery(queries);
    await benchSummary(name, {
      zql: async () => {
        await delegates.memory.run(q);
      },
      zqlite: async () => {
        await delegates.sqlite.run(q);
      },
      zpg: async () => {
        await delegates.pg.run(q);
      },
    });
  },
  {tags: ['bench']},
);
