import {resolver} from '@rocicorp/resolver';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {bench} from '../../../shared/src/bench.ts';
import {createBuilder} from '../../../zql/src/query/create-builder.ts';
import type {Row} from '../../../zql/src/query/query.ts';
import {getInternalReplicacheImplForTesting, Zero} from './zero.ts';

const user = {
  name: 'user',
  columns: {
    a: {type: 'number'},
    b: {type: 'number'},
    c: {type: 'number'},
    d: {type: 'number'},
    e: {type: 'number'},
    f: {type: 'number'},
    g: {type: 'number'},
    h: {type: 'number'},
    i: {type: 'number'},
    j: {type: 'number'},
  },
  primaryKey: ['a'],
} as const;
const schema = {
  version: 0,
  tables: {
    user,
  },
  relationships: {},
  enableLegacyMutators: true,
} as const;
type UserRow = Row<typeof user>;

const N = 1_000;

describe('zero benchmarks', () => {
  let z: Zero<typeof schema>;
  let zql: ReturnType<typeof createBuilder<typeof schema>>;

  beforeAll(async () => {
    const userID = 'test-user-id-' + Math.random();
    z = new Zero({
      schema,
      cacheURL: null,
      userID,
      kvStore: 'idb',
    });
    zql = createBuilder(schema);

    await z.mutateBatch(async m => {
      for (let i = 0; i < N; i++) {
        await m.user.insert({
          a: i,
          b: i,
          c: i,
          d: i,
          e: i,
          f: i,
          g: i,
          h: i,
          i,
          j: i,
        });
      }
    });
    await getInternalReplicacheImplForTesting(z).persist();
  });

  afterAll(() => z?.close());

  describe('basics', () => {
    test(
      `All ${N} rows x 10 columns (numbers)`,
      {tags: ['bench']},
      async () => {
        await bench(`All ${N} rows x 10 columns (numbers)`, async () => {
          const {promise, resolve} = resolver<readonly UserRow[]>();
          const m = z.materialize(zql.user);
          m.addListener(data => {
            if (data.length === N) {
              resolve(data as readonly UserRow[]);
            }
          });
          const rows = await promise;
          expect(rows.reduce((sum, row) => sum + row.a, 0)).toBe(
            ((N - 1) / 2) * N,
          );
          m.destroy();
        });
      },
    );
  });

  describe('pk compare', () => {
    test(`pk = N`, {tags: ['bench']}, async () => {
      await bench(`pk = N`, async () => {
        const {promise, resolve} = resolver<readonly UserRow[]>();
        const value = N - 1;
        const m = z.materialize(zql.user.where('a', value));
        m.addListener(data => {
          if (data.length === 1) {
            resolve(data as readonly UserRow[]);
          }
        });
        const rows = await promise;
        expect(rows[0].a).toBe(value);
        m.destroy();
      });
    });
  });

  describe('with filter', () => {
    test(`Lower rows ${N / 2} x 10 columns (numbers)`, {tags: ['bench']}, async () => {
      await bench(`Lower rows ${N / 2} x 10 columns (numbers)`, async () => {
        const {promise, resolve} = resolver<readonly UserRow[]>();
        const m = z.materialize(zql.user.where('a', '<', N / 2));
        m.addListener(data => {
          if (data.length === N / 2) {
            resolve(data as readonly UserRow[]);
          }
        });
        const rows = await promise;
        expect(rows.reduce((sum, row) => sum + row.a, 0)).toBe(
          (((N / 2 - 1) / 2) * N) / 2,
        );
        m.destroy();
      });
    });
  });
});
