/**
 * Example of the new bench() pattern: benchmarks inside vitest tests.
 *
 * Compared to the module-level runBenchmarks() approach:
 *
 *   OLD (module-level, runBenchmarks()):
 *   - bench() and test() are separate (vitest bench vs vitest test)
 *   - No per-iteration teardown for hydration benchmarks
 *   - No assertions on results
 *   - Requires a dummy `test('no-op', ...)` to satisfy vitest
 *
 *   NEW (inside test(), bench() from shared):
 *   - Full vitest lifecycle: beforeAll/afterAll for shared setup
 *   - Per-iteration teardown via mitata's generator pattern
 *   - Typed results → can assert on throughput
 *   - Works with existing mitata-json-to-bmf.ts CI pipeline unchanged
 *   - Aligns with proposed vitest redesign:
 *     https://github.com/vitest-dev/vitest/discussions/7850
 */

import {beforeAll, expect, test} from 'vitest';
import {bench, benchSummary} from '../../shared/src/bench.ts';
import {getChinook} from '../../zql-integration-tests/src/chinook/get-deps.ts';
import {schema} from '../../zql-integration-tests/src/chinook/schema.ts';
import {
  bootstrap,
  type Delegates,
} from '../../zql-integration-tests/src/helpers/runner.ts';
import type {AnyQuery} from '../../zql/src/query/query.ts';

let delegates: Delegates;
let albumQuery: AnyQuery;
let playlistWithRelationsQuery: AnyQuery;

// Setup runs once for the whole file — shared across all bench tests.
beforeAll(async () => {
  const pgContent = await getChinook();
  const result = await bootstrap({
    suiteName: 'chinook_bench_hydrate_new',
    zqlSchema: schema,
    pgContent,
  });
  delegates = result.delegates;

  // Use the queries created by bootstrap (typed to the schema)
  albumQuery = result.queries.album;
  playlistWithRelationsQuery = result.queries.playlist.related('tracks', t =>
    t
      .related('mediaType')
      .related('genre')
      .related('album', a => a.related('artist')),
  );
});

// --- Hydration benchmarks ---
//
// The generator function pattern provides per-iteration setup/teardown:
//   - code before yield: runs before each timed iteration (not timed)
//   - yield () => {...}: the timed section
//   - code after yield: runs after each timed iteration (not timed)
//
// This ensures view.destroy() cleans up between samples so state from
// one iteration doesn't affect the next. Contrast with the old pattern
// in benchHydration() which used a plain async fn with no teardown.

// Use bench() when you have a single implementation to time.
test('zql: all playlists (single)', async () => {
  const result = await bench('zql: all playlists', function* () {
    const view = delegates.memory.materialize(playlistWithRelationsQuery); // setup, not timed
    yield () => {
      void view.data; // timed
    };
    view.destroy(); // teardown, not timed
  });

  // With BENCH_CPU_REF_GHZ set, result.throughput is already normalized
  // to the reference CPU frequency for cross-machine comparability.
  expect(result.throughput).toBeGreaterThan(0);
});

// Use benchSummary() when comparing multiple implementations.
// mitata prints a relative comparison table to stdout, e.g.:
//
//   • album scan
//   benchmark            avg (min … max)   p75        p99
//   ─────────────────────────────────────────────────────
//   zql: album scan      1.23 µs/iter      1.31 µs    1.89 µs
//   zqlite: album scan   4.56 µs/iter      4.78 µs    5.12 µs
//   summary
//   zql is 3.7x faster than zqlite
//
// Requires --disable-console-intercept when running via `vitest run`.
test('album scan (summary)', async () => {
  const results = await benchSummary('album scan', {
    'zql: album scan': function* () {
      const view = delegates.memory.materialize(albumQuery); // setup, not timed
      yield () => {
        void view.data; // timed
      };
      view.destroy(); // teardown, not timed
    },
    'zqlite: album scan': function* () {
      const view = delegates.sqlite.materialize(albumQuery); // setup, not timed
      yield () => {
        void view.data; // timed
      };
      view.destroy(); // teardown, not timed
    },
  });

  expect(results['zql: album scan'].throughput).toBeGreaterThan(0);
  expect(results['zqlite: album scan'].throughput).toBeGreaterThan(0);
});
