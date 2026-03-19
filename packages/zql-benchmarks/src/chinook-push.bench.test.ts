import {beforeAll, test} from 'vitest';
import {benchSummary} from '../../shared/src/bench.ts';
import type {JSONValue} from '../../shared/src/json.ts';
import {must} from '../../shared/src/must.ts';
import type {Row} from '../../zero-protocol/src/data.ts';
import {getChinook} from '../../zql-integration-tests/src/chinook/get-deps.ts';
import {schema} from '../../zql-integration-tests/src/chinook/schema.ts';
import {
  bootstrap,
  lc,
  testLogConfig,
} from '../../zql-integration-tests/src/helpers/runner.ts';
import {consume} from '../../zql/src/ivm/stream.ts';
import {QueryDelegateImpl as TestMemoryQueryDelegate} from '../../zql/src/query/test/query-delegate.ts';
import type {PullRow, Query} from '../../zql/src/query/query.ts';
import type {SourceChange} from '../../zql/src/ivm/source.ts';
import type {NameMapper} from '../../zero-schema/src/name-mapper.ts';
import {Database} from '../../zqlite/src/db.ts';
import {newQueryDelegate} from '../../zqlite/src/test/source-factory.ts';

let setup: Awaited<ReturnType<typeof bootstrap<typeof schema>>>;

beforeAll(async () => {
  const pgContent = await getChinook();
  setup = await bootstrap({
    suiteName: 'chinook_bench_push',
    zqlSchema: schema,
    pgContent,
  });
});

function defaultTrack(id: number): PullRow<'track', typeof schema> {
  return {
    id,
    name: `Track ${id}`,
    albumId: 248,
    mediaTypeId: 1,
    genreId: 1,
    composer: 'Composer',
    milliseconds: 1000,
    bytes: 1000,
    unitPrice: 1.99,
  };
}

function mapRow(row: Row, table: string, mapper: NameMapper): Row {
  const newRow: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    newRow[mapper.columnName(table, column)] = value;
  }
  return newRow as Row;
}

function mapChange(
  change: SourceChange,
  table: string,
  mapper: NameMapper,
): SourceChange {
  switch (change.type) {
    case 'add':
      return {...change, row: mapRow(change.row, table, mapper)};
    case 'edit':
      return {
        ...change,
        oldRow: mapRow(change.oldRow, table, mapper),
        row: mapRow(change.row, table, mapper),
      };
    case 'remove':
      return {...change, row: mapRow(change.row, table, mapper)};
  }
}

function makeEdit(rawData: ReadonlyMap<string, readonly Row[]>) {
  const currentValues = new Map<string, Row>();
  return (table: string, index: number, column: string, value: JSONValue) => {
    const key = `${table}-${index}`;
    const dataset = rawData.get(table);
    if (!dataset) {
      throw new Error(`No dataset for table ${table}`);
    }
    const row = currentValues.get(key) ?? dataset[index];
    if (!row) {
      throw new Error(
        `No row for table ${table} at index ${index} ds length ${dataset.length}`,
      );
    }
    const newRow = {
      ...row,
      [column]: value,
    };
    currentValues.set(key, newRow);
    return {
      type: 'edit',
      oldRow: row,
      row: newRow,
    } as const;
  };
}

type PushGenerator = (
  iteration: number,
) => [source: string, change: SourceChange][];

type BenchSpec = {
  name: string;
  createQuery: (
    q: typeof setup.queries,
  ) => Query<string, typeof schema>;
  generatePush: PushGenerator;
};

const benchSpecs: BenchSpec[] = [
  {
    name: 'push into unlimited query',
    createQuery: q => q.track,
    generatePush: i => [
      [
        'track',
        {
          type: 'add',
          row: defaultTrack(i + 10_000),
        },
      ],
    ],
  },
  {
    name: 'push into limited query, outside the bound',
    createQuery: q => q.track.limit(100),
    generatePush: i => [
      [
        'track',
        {
          type: 'add',
          row: defaultTrack(i + 10_000),
        },
      ],
    ],
  },
  {
    name: 'push into limited query, inside the bound',
    createQuery: q => q.track.limit(100),
    generatePush: i => [
      [
        'track',
        {
          type: 'add',
          row: defaultTrack(-1 * i),
        },
      ],
    ],
  },
  {
    name: 'edit for limited query, outside the bound',
    createQuery: q => q.track.limit(100),
    get generatePush() {
      // lazily created so rawData is populated from beforeAll
      const edit = () => makeEdit(setup.dbs.raw);
      let editFn: ReturnType<typeof makeEdit> | undefined;
      return (i: number) => {
        if (!editFn) editFn = edit();
        const change = editFn(
          'track',
          // prettier-ignore
          (i % ((must(setup.dbs.raw.get('track')).length - 100))) + 100,
          'name',
          Math.floor(Math.random() * 10_000) + '',
        );
        return [['track', change]] as [string, SourceChange][];
      };
    },
  },
  {
    name: 'edit for limited query, inside the bound',
    createQuery: q => q.track.limit(100),
    get generatePush() {
      let editFn: ReturnType<typeof makeEdit> | undefined;
      return (i: number) => {
        if (!editFn) editFn = makeEdit(setup.dbs.raw);
        return [
          [
            'track',
            editFn(
              'track',
              i % 100,
              'name',
              Math.floor(Math.random() * 10_000) + '',
            ),
          ],
        ] as [string, SourceChange][];
      };
    },
  },
];

test.for(benchSpecs)(
  '%s',
  async ({name, createQuery, generatePush}) => {
    const {dbs, delegates} = setup;

    // Fork delegates so each bench spec starts from a clean state.
    const forkedMemory = new TestMemoryQueryDelegate({
      sources: Object.fromEntries(
        Object.entries(dbs.memory).map(([key, source]) => [
          key,
          source.fork(),
        ]),
      ),
    });
    const forkedSqlite = newQueryDelegate(
      lc,
      testLogConfig,
      (() => {
        const db = new Database(lc, dbs.sqliteFile);
        db.exec('BEGIN CONCURRENT');
        return db;
      })(),
      schema,
    );

    const q = createQuery(setup.queries);
    const mapper = delegates.mapper;

    let zqlIteration = 0;
    let zqliteIteration = 0;

    await benchSummary(name, {
      zql: function* () {
        const view = forkedMemory.materialize(q);
        yield () => {
          const changes = generatePush(zqlIteration++);
          for (const [source, change] of changes) {
            consume(must(forkedMemory.getSource(source)).push(change));
          }
        };
        view.destroy();
      },
      zqlite: function* () {
        const view = forkedSqlite.materialize(q);
        yield () => {
          const changes = generatePush(zqliteIteration++).map(
            ([source, change]) => [
              source,
              mapChange(change, source, mapper),
            ] as const,
          );
          for (const [source, change] of changes) {
            consume(
              must(
                forkedSqlite.getSource(mapper.tableName(source)),
              ).push(change),
            );
          }
        };
        view.destroy();
      },
    });
  },
  {tags: ['bench']},
);
