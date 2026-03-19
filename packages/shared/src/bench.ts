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

// mitata ships as pure .mjs with no type declarations — declare what we use.
declare module 'mitata' {
  type BenchFn =
    | (() => void)
    | (() => Promise<void>)
    | (() => Generator<() => void | Promise<void>>)
    | (() => AsyncGenerator<() => void | Promise<void>>);

  type Stats = {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p75: number;
    p99: number;
    p999: number;
    samples: number[];
  };

  type BenchmarkRun = {
    name: string;
    args: Record<string, unknown>;
    stats?: Stats | undefined;
    error?: Error | undefined;
  };

  type Benchmark = {
    alias: string;
    kind: string;
    group: number;
    baseline: boolean;
    runs: BenchmarkRun[];
  };

  type RunContext = {
    now: number;
    arch: string | null;
    version: string | null;
    runtime: string | null;
    cpu: {
      /** CPU model name */
      name: string | null;
      /**
       * Measured CPU frequency in GHz, derived from a calibration noop:
       * freq = 1 / noop_avg_ns. More stable than os.cpus()[0].speed
       * since it reflects actual execution speed rather than nominal speed.
       */
      freq: number;
    };
  };

  type RunResult = {
    layout: Array<{name: string | null; types: string[]}>;
    context: RunContext;
    benchmarks: Benchmark[];
  };

  type RunOptions = {
    throw?: boolean | undefined;
    filter?: RegExp | undefined;
    colors?: boolean | undefined;
    format?:
      | 'mitata'
      | 'quiet'
      | 'json'
      | 'markdown'
      | {json: {samples?: boolean | undefined; debug?: boolean | undefined}}
      | undefined;
  };

  export function bench(name: string, fn: BenchFn): unknown;
  export function run(opts?: RunOptions): Promise<RunResult>;
  export function summary(fn: () => void): void;
  export function group(name: string | (() => void), fn?: () => void): void;
}

import {bench as mitataBench, run as mitataRun} from 'mitata';

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
 */
export async function bench(
  name: string,
  fn: Parameters<typeof mitataBench>[1],
): Promise<BenchResult> {
  mitataBench(name, fn);

  const isCIJsonMode = process.env.BENCH_OUTPUT_FORMAT === 'json';

  const {benchmarks, context} = await mitataRun(
    isCIJsonMode
      ? {format: {json: {samples: false, debug: false}}}
      : {format: 'quiet'},
  );

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
