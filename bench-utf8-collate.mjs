/**
 * Benchmark: compareUTF8 vs Intl.Collator vs JS < operator
 *
 * Run with: node bench-utf8-collate.mjs
 *
 * compareUTF8 (npm:compare-utf8) compares strings by their UTF-8 byte values,
 * equivalent to PostgreSQL's COLLATE "ucs_basic" / SQLite default collation.
 *
 * If compare-utf8 is installed (npm install), it will be used directly.
 * Otherwise an equivalent TextEncoder-based fallback is used.
 */

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

import {compareUTF8} from 'compare-utf8';

/**
 * Raw JS operator — compares UTF-16 code units. Same as compareUTF8 for BMP
 * characters, differs for surrogate pairs (chars > U+FFFF).
 */
function compareJS(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

const collatorEN = new Intl.Collator('en');
const compareIntl = (a, b) => collatorEN.compare(a, b);

// ---------------------------------------------------------------------------
// Interesting correctness cases — where the methods disagree
// ---------------------------------------------------------------------------

const cases = [
  // 1. Case: uppercase sorts before lowercase in UTF-8, locale groups them
  ['Apple', 'banana'],
  ['Zebra', 'apple'],

  // 2. Accented chars: é (U+00E9=233) > z (122) in UTF-8; locale puts é near e
  ['zoo', 'élan'],
  ['zebra', 'éclair'],

  // 3. German ß (U+00DF=223): UTF-8 puts it after ASCII; de_DE treats as "ss"
  ['strasse', 'straße'],

  // 4. Ligature æ (U+00E6): UTF-8 puts it after z; locale puts it near "ae"
  ['zoo', 'ænema'],

  // 5. Chars outside BMP (surrogate pairs in JS) — emoji and rare CJK
  //    UTF-8 and UTF-16 code unit order can differ here
  ['\uD83D\uDE00', '\uD83D\uDE01'],  // 😀 vs 😁 (same in both, just verifying)
  ['\u{1F600}', '\u{1F30D}'],        // 😀 (U+1F600) vs 🌍 (U+1F30D) — 1F600 > 1F30D

  // 6. Locale ignores punctuation as secondary weight
  ['co-op', 'coop'],
  ['re-sort', 'resort'],

  // 7. Numbers in strings
  ['item10', 'item9'],   // UTF-8: '1' < '9', so item10 < item9

  // 8. Null bytes / control chars
  ['a\u0000b', 'aa'],
];

console.log('=== Correctness: where methods disagree ===\n');
console.log(
  'Pair'.padEnd(35),
  'compareUTF8'.padEnd(14),
  'compareJS'.padEnd(12),
  'Intl.Collator',
);
console.log('-'.repeat(80));

function sign(n) {
  return n < 0 ? '<' : n > 0 ? '>' : '=';
}

for (const [a, b] of cases) {
  const utf8 = sign(compareUTF8(a, b));
  const js   = sign(compareJS(a, b));
  const intl = sign(compareIntl(a, b));
  const diff = utf8 !== intl ? ' <<<' : '';
  const pair = `"${a}" vs "${b}"`;
  console.log(
    pair.padEnd(35),
    utf8.padEnd(14),
    js.padEnd(12),
    intl + diff,
  );
}

// ---------------------------------------------------------------------------
// Performance benchmark
// ---------------------------------------------------------------------------

const ITERATIONS = 200_000;
const STR_LEN    = 40;
const SEED       = 42;

// Simple seeded PRNG (mulberry32)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStrings(n, len, charset, seed) {
  const rand = mulberry32(seed);
  const chars = charset.split('');
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = '';
    for (let j = 0; j < len; j++) {
      s += chars[Math.floor(rand() * chars.length)];
    }
    out.push(s);
  }
  return out;
}

const ASCII_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UNICODE_CHARS = ASCII_CHARS + 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿßœæ';

function bench(label, fn, strings) {
  // Warmup
  for (let i = 0; i < 1000; i++) fn(strings[i % strings.length], strings[(i + 1) % strings.length]);

  const start = performance.now();
  let sink = 0;
  for (let i = 0; i < strings.length - 1; i++) {
    sink += fn(strings[i], strings[i + 1]);
  }
  const elapsed = performance.now() - start;
  // prevent dead-code elimination
  if (sink === Infinity) console.log('noop', sink);
  return elapsed;
}

console.log('\n=== Performance (lower ms = faster) ===\n');

for (const [label, charset] of [
  ['ASCII strings', ASCII_CHARS],
  ['Unicode strings', UNICODE_CHARS],
]) {
  const strings = makeStrings(ITERATIONS, STR_LEN, charset, SEED);
  console.log(`--- ${label} (${ITERATIONS.toLocaleString()} comparisons, length ${STR_LEN}) ---`);

  const results = [
    ['compareUTF8 (compare-utf8)', compareUTF8],
    ['compareJS (< operator)',    compareJS],
    ['Intl.Collator (en)',        compareIntl],
    ['localeCompare',             (a, b) => a.localeCompare(b)],
  ].map(([name, fn]) => ({name, ms: bench(name, fn, strings)}));

  const fastest = Math.min(...results.map(r => r.ms));
  for (const {name, ms} of results) {
    const ratio = (ms / fastest).toFixed(2);
    console.log(`  ${name.padEnd(30)} ${ms.toFixed(2).padStart(8)} ms   (${ratio}x)`);
  }
  console.log();
}

console.log('Node version:', process.version);
