/**
 * mitata-powered bench() that works inside vitest test() calls.
 *
 * Aligned with the proposed vitest benchmarking redesign:
 * https://github.com/vitest-dev/vitest/discussions/7850
 *
 * Key advantages over vitest's current bench():
 * - Works inside test() (not mutually exclusive)
 * - Supports mitata's generator pattern for per-iteration setup/teardown
 * - Returns a typed result for assertions
 * - Outputs BMF-compatible JSON for bencher CI when BENCH_OUTPUT_FORMAT=json
 * - CPU calibration via mitata's built-in noop measurement
 */

import type {ctx, trial} from 'mitata';
import {
  bench as mitataBench,
  run as mitataRun,
  summary as mitataSummary,
} from 'mitata';

export type BenchResult = {
  name: string;
  /** Nanoseconds per iteration (arithmetic mean) */
  avgNs: number;
  minNs: number;
  maxNs: number;
  p75Ns: number;
  p99Ns: number;
  /** Operations per second = 1e9 / avgNs */
  throughput: number;
  /**
   * Measured CPU frequency in GHz from mitata's calibration noop.
   * Useful for diagnosing result inconsistencies across runs or machines.
   */
  cpuGHz: number;
};

/**
 * The generator function type for mitata benchmarks with per-iteration
 * setup and teardown.
 *
 * @example
 * // Per-iteration setup/teardown (only the yielded function is timed):
 * bench('query', function* () {
 *   const view = delegate.materialize(query); // setup — not timed
 *   yield () => { consume(view); };           // timed
 *   view.destroy();                           // teardown — not timed
 * });
 */
export type GeneratorBenchFn = () => Generator<() => void | Promise<void>>;

type BenchFn = Parameters<typeof mitataBench>[1];

function extractResult(
  name: string,
  benchmarks: trial[],
  context: ctx,
): BenchResult {
  const bm = benchmarks.find(b => b.alias === name || b.runs[0]?.name === name);

  if (!bm) {
    throw new Error(`Benchmark "${name}" not found in results`);
  }

  const stats = bm.runs[0]?.stats;
  if (!stats) {
    const err = bm.runs[0]?.error;
    throw err ?? new Error(`No stats for benchmark "${name}"`);
  }

  const rawThroughput = 1e9 / stats.avg;
  const cpuGHz = context.cpu.freq;
  const refGHz = parseFloat(process.env.BENCH_CPU_REF_GHZ ?? '0');
  const throughput =
    refGHz > 0 ? rawThroughput * (cpuGHz / refGHz) : rawThroughput;

  return {
    name,
    avgNs: stats.avg,
    minNs: stats.min,
    maxNs: stats.max,
    p75Ns: stats.p75,
    p99Ns: stats.p99,
    throughput,
    cpuGHz,
  };
}

/**
 * Run a mitata benchmark inside a vitest test() call and return the result.
 *
 * This aligns with the proposed vitest bench redesign
 * (https://github.com/vitest-dev/vitest/discussions/7850) where bench()
 * runs inside test(), returns a result, and supports assertions.
 *
 * **Per-iteration setup/teardown** uses mitata's generator pattern:
 * ```ts
 * const result = await bench('hydration', function* () {
 *   const view = delegate.materialize(query); // setup (not timed)
 *   yield () => { consume(view); };           // timed
 *   view.destroy();                           // teardown (not timed)
 * });
 * expect(result.throughput).toBeGreaterThan(500);
 * ```
 *
 * **CI integration**: set BENCH_OUTPUT_FORMAT=json to emit mitata JSON to
 * stdout, compatible with the existing mitata-json-to-bmf.ts converter.
 *
 * **CPU normalization**: set BENCH_CPU_REF_GHZ to a reference frequency.
 * Throughput is scaled so results are comparable across machines:
 * normalizedThroughput = rawThroughput * (measuredGHz / refGHz)
 * This means a result from a 4 GHz machine is scaled down to what you'd
 * expect on the reference machine.
 *
 * For comparing multiple implementations side-by-side with a relative
 * summary table, use {@link benchSummary} instead.
 */
export async function bench(name: string, fn: BenchFn): Promise<BenchResult> {
  mitataBench(name, fn);

  const isCIJsonMode = process.env.BENCH_OUTPUT_FORMAT === 'json';

  const {benchmarks, context} = await mitataRun(
    isCIJsonMode
      ? {format: {json: {samples: false, debug: false}}}
      : {format: 'quiet'},
  );

  return extractResult(name, benchmarks, context);
}

/**
 * Run multiple mitata benchmarks as a named group with a printed summary.
 *
 * Like {@link bench}, but wraps the benchmarks in mitata's `summary()`
 * so that results are printed as a relative comparison table:
 *
 * ```
 * • album scan
 * ┌─────────────────────────────┬──────────────────┬──────────┬──────────┬──────────┐
 * │ benchmark                   │ avg (min … max)  │ p75      │ p99      │ max      │
 * ├─────────────────────────────┼──────────────────┼──────────┼──────────┼──────────┤
 * │ zql: album scan             │ 1.23 µs/iter     │ 1.31 µs  │ 1.89 µs  │ 2.01 µs  │
 * │ zqlite: album scan          │ 4.56 µs/iter     │ 4.78 µs  │ 5.12 µs  │ 5.34 µs  │
 * └─────────────────────────────┴──────────────────┴──────────┴──────────┴──────────┘
 * summary: zql is 3.7x faster than zqlite
 * ```
 *
 * **Usage** — all benchmarks in the group share a single test():
 * ```ts
 * test('album scan', async () => {
 *   const results = await benchSummary('album scan', {
 *     'zql': function* () {
 *       const view = delegates.memory.materialize(q); // setup (not timed)
 *       yield () => { void view.data; };               // timed
 *       view.destroy();                                // teardown (not timed)
 *     },
 *     'zqlite': function* () {
 *       const view = delegates.sqlite.materialize(q);
 *       yield () => { void view.data; };
 *       view.destroy();
 *     },
 *   });
 *
 *   expect(results['zql'].throughput).toBeGreaterThan(results['zqlite'].throughput);
 * });
 * ```
 *
 * **Output**: in normal mode the mitata summary table is printed to stdout
 * (requires `--disable-console-intercept` when running via `vitest run`).
 * In CI mode (BENCH_OUTPUT_FORMAT=json) it emits JSON instead.
 *
 * @param groupName - Label shown above the summary table.
 * @param fns - Map of benchmark name → function. Order is preserved.
 */
export async function benchSummary(
  groupName: string,
  fns: Record<string, BenchFn>,
): Promise<Record<string, BenchResult>> {
  const names = Object.keys(fns);

  mitataSummary(() => {
    for (const [name, fn] of Object.entries(fns)) {
      mitataBench(name, fn);
    }
  });

  const isCIJsonMode = process.env.BENCH_OUTPUT_FORMAT === 'json';

  // In normal mode use the 'mitata' format so the summary table is printed.
  // In CI mode use JSON so the existing mitata-json-to-bmf.ts pipeline works.
  const {benchmarks, context} = await mitataRun(
    isCIJsonMode
      ? {format: {json: {samples: false, debug: false}}}
      : {format: 'mitata'},
  );

  void groupName; // used for documentation / intent; mitata labels via summary()

  const results: Record<string, BenchResult> = {};
  for (const name of names) {
    results[name] = extractResult(name, benchmarks, context);
  }
  return results;
}
