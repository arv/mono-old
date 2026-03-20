/* oxlint-disable no-console */
// Convert mitata JSON output (without samples) to Bencher Metric Format (BMF)

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
  p50?: number | undefined;
  p75?: number | undefined;
  p99?: number | undefined;
};

// Mitata JSON output format (with samples: false, debug: false)
type MitataBenchmark = {
  name?: string | undefined;
  alias?: string | undefined;
  stats?: MitataStats | undefined;
  runs?:
    | Array<{
        stats: MitataStats;
      }>
    | undefined;
};

type MitataJsonOutput = {
  benchmarks: MitataBenchmark[];
};

function getStats(benchmark: MitataBenchmark): MitataStats | undefined {
  return benchmark.stats ?? benchmark.runs?.[0]?.stats;
}

function convertMitataJsonToBMF(allBenchmarks: MitataBenchmark[]): BMFMetric {
  const bmf: BMFMetric = {};

  for (const benchmark of allBenchmarks) {
    const name = benchmark.alias || benchmark.name;
    if (!name) continue;

    const stats = getStats(benchmark);
    if (!stats) continue;

    // Convert from nanoseconds to operations per second.
    // Note: min latency → max throughput, max latency → min throughput.
    bmf[name] = {
      throughput: {
        value: 1e9 / stats.avg,
        lower_value: 1e9 / stats.max,
        upper_value: 1e9 / stats.min,
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('{') && line.includes('"benchmarks"')) {
        try {
          const parsed = JSON.parse(line) as MitataJsonOutput;
          if (parsed.benchmarks) {
            allBenchmarks.push(...parsed.benchmarks);
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

    const bmfOutput = convertMitataJsonToBMF(allBenchmarks);
    process.stdout.write(JSON.stringify(bmfOutput, null, 2));
  } catch (error) {
    console.error('Error converting mitata JSON to BMF:', error);
    process.exit(1);
  }
}

void main();
