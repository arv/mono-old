/* oxlint-disable no-console */
// Convert mitata JSON output (without samples) to Bencher Metric Format (BMF)
//
// CPU normalization:
//   Set BENCH_CPU_REF_GHZ to a reference CPU frequency (e.g. 3.5).
//   The converter will scale throughput values so results from a faster or
//   slower machine compare fairly against the historical baseline:
//
//     normalizedThroughput = rawThroughput * (measuredGHz / refGHz)
//
//   Example: a 4 GHz machine measures 10,000 ops/sec. With REF_GHZ=3.5:
//     normalized = 10000 * (4.0 / 3.5) = 11,428 — so a 3.5 GHz machine
//     would need to match 10,000 ops/sec to be considered equivalent.
//
//   The measured GHz comes from mitata's built-in calibration noop, which
//   reflects actual execution speed more accurately than os.cpus()[0].speed.

// BMF - Bencher Metric Format
type BMFMetric = {
  [key: string]: {
    throughput: {
      value: number;
      lower_value?: number;
      upper_value?: number;
    };
  };
};

type MitataStats = {
  min: number;
  max: number;
  avg: number;
  p50?: number;
  p75?: number;
  p99?: number;
};

// Mitata JSON output format (with samples: false, debug: false)
interface MitataBenchmark {
  name?: string;
  alias?: string;
  stats?: MitataStats;
  runs?: Array<{
    stats: MitataStats;
  }>;
}

interface MitataContext {
  cpu?: {
    /** Measured CPU frequency in GHz (1 / noop_avg_ns from calibration) */
    freq?: number;
  };
}

interface MitataJsonOutput {
  benchmarks: MitataBenchmark[];
  context?: MitataContext;
}

function getStats(benchmark: MitataBenchmark): MitataStats | undefined {
  return benchmark.stats ?? benchmark.runs?.[0]?.stats;
}

function convertMitataJsonToBMF(
  allBenchmarks: MitataBenchmark[],
  allContexts: MitataContext[],
): BMFMetric {
  const bmf: BMFMetric = {};

  // Compute average measured CPU GHz across all run() calls in this suite.
  // mitata measures this via a calibration noop at the start of each run().
  const measuredGHz =
    allContexts.length > 0
      ? allContexts.reduce((sum, ctx) => sum + (ctx.cpu?.freq ?? 0), 0) /
        allContexts.length
      : 0;

  const refGHz = parseFloat(process.env.BENCH_CPU_REF_GHZ ?? '0');
  const scaleFactor = refGHz > 0 && measuredGHz > 0 ? measuredGHz / refGHz : 1;

  if (refGHz > 0 && measuredGHz > 0) {
    console.error(
      `[cpu] measured=${measuredGHz.toFixed(2)}GHz ref=${refGHz.toFixed(2)}GHz scale=${scaleFactor.toFixed(3)}`,
    );
  }

  for (const benchmark of allBenchmarks) {
    const name = benchmark.alias || benchmark.name;
    if (!name) continue;

    const stats = getStats(benchmark);
    if (!stats) continue;

    // Convert from nanoseconds to operations per second.
    // Note: min latency → max throughput, max latency → min throughput.
    bmf[name] = {
      throughput: {
        value: (1e9 / stats.avg) * scaleFactor,
        lower_value: (1e9 / stats.max) * scaleFactor,
        upper_value: (1e9 / stats.min) * scaleFactor,
      },
    };
  }

  return bmf;
}

async function main() {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf-8');

    if (process.env.DEBUG_MITATA_CONVERTER) {
      console.error(`[DEBUG] Raw input (${content.length} bytes):`);
      console.error(content.substring(0, 500));
      if (content.length > 500) {
        console.error('... (truncated)');
      }
    }

    // Mitata outputs one JSON object per run() call, one per line.
    const lines = content.split('\n');
    const allBenchmarks: MitataBenchmark[] = [];
    const allContexts: MitataContext[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('{') && line.includes('"benchmarks"')) {
        try {
          const parsed = JSON.parse(line) as MitataJsonOutput;
          if (parsed.benchmarks) {
            allBenchmarks.push(...parsed.benchmarks);
          }
          if (parsed.context) {
            allContexts.push(parsed.context);
          }
        } catch (e) {
          if (process.env.DEBUG_MITATA_CONVERTER) {
            console.error(`[DEBUG] Failed to parse line ${i}: ${e}`);
          }
        }
      }
    }

    if (process.env.DEBUG_MITATA_CONVERTER) {
      console.error(`[DEBUG] Found ${allBenchmarks.length} benchmarks`);
    }

    if (allBenchmarks.length === 0) {
      throw new Error('No valid mitata benchmark data found in input');
    }

    const bmfOutput = convertMitataJsonToBMF(allBenchmarks, allContexts);
    process.stdout.write(JSON.stringify(bmfOutput, null, 2));
  } catch (error) {
    console.error('Error converting mitata JSON to BMF:', error);
    process.exit(1);
  }
}

void main();
