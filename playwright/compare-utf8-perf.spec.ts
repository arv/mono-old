/**
 * Browser performance benchmark: compareUTF8 vs Intl.Collator vs JS < operator
 *
 * Runs entirely inside Chromium (and Firefox/WebKit if available) so results
 * reflect real browser JIT behaviour — relevant because ZQL runs in the browser.
 *
 * Run with:
 *   playwright test --project=chromium          # from mono root
 *   playwright test --project=firefox           # needs Firefox installed
 *   playwright test --project=webkit            # needs WebKit installed
 */

import {expect, test} from 'playwright/test';

// ---------------------------------------------------------------------------
// Inline compareUTF8 source (verbatim from npm:compare-utf8)
// Inlined so no bundler is needed; keep in sync with the package.
// ---------------------------------------------------------------------------
const compareUTF8Source = `
function compareArrays(a, aLength, b, bLength) {
  const length = Math.min(aLength, bLength);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return aLength - bLength;
}
function utf16LengthForCodePoint(cp) { return cp > 0xffff ? 2 : 1; }
const aBytes = [0,0,0,0];
const bBytes = [0,0,0,0];
function utf8Bytes(cp, bytes) {
  if (cp < 0x80) { bytes[0] = cp; return 1; }
  let count, offset;
  if      (cp <= 0x07ff)   { count = 1; offset = 0xc0; }
  else if (cp <= 0xffff)   { count = 2; offset = 0xe0; }
  else if (cp <= 0x10ffff) { count = 3; offset = 0xf0; }
  else throw new Error('Invalid code point');
  bytes[0] = (cp >> (6 * count)) + offset;
  let i = 1;
  for (; count > 0; count--) { bytes[i++] = 0x80 | ((cp >> (6 * (count-1))) & 0x3f); }
  return i;
}
function compareUTF8(a, b) {
  const aLen = a.length, bLen = b.length;
  const len = Math.min(aLen, bLen);
  for (let i = 0; i < len; ) {
    const aCP = a.codePointAt(i);
    const bCP = b.codePointAt(i);
    if (aCP !== bCP) {
      if (aCP < 0x80 && bCP < 0x80) return aCP - bCP;
      return compareArrays(aBytes, utf8Bytes(aCP, aBytes), bBytes, utf8Bytes(bCP, bBytes));
    }
    i += utf16LengthForCodePoint(aCP);
  }
  return aLen - bLen;
}
`;

// ---------------------------------------------------------------------------
// Correctness cases — pairs where sort order differs between methods
// ---------------------------------------------------------------------------
const CORRECTNESS_CASES: [string, string, string][] = [
  // [label, a, b]
  ['uppercase before lowercase (UTF-8 groups by case; locale groups by letter)', 'Zebra', 'apple'],
  ['accented char é sorts after ASCII in UTF-8, near e in locale', 'zoo', 'élan'],
  ['accented char é (2)', 'zebra', 'éclair'],
  ['ligature æ sorts after z in UTF-8, near ae in locale', 'zoo', 'ænema'],
  ['null byte treated as low byte in UTF-8, ignored as secondary weight in locale', 'a\u0000b', 'aa'],
];

// ---------------------------------------------------------------------------
// Performance benchmark parameters
// ---------------------------------------------------------------------------
const ITERATIONS = 200_000;
const STR_LEN = 40;
const SEED = 42;

const ASCII_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UNICODE_CHARS =
  ASCII_CHARS + 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿßœæ';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('compareUTF8 vs Intl.Collator — correctness', () => {
  for (const [label, a, b] of CORRECTNESS_CASES) {
    test(label, async ({page}) => {
      await page.goto('about:blank');

      const result = await page.evaluate(
        ([src, a, b]) => {
          // eslint-disable-next-line no-new-func
          const fn = new Function(src + '\nreturn {compareUTF8};');
          const {compareUTF8} = fn() as {compareUTF8: (a: string, b: string) => number};
          const collator = new Intl.Collator('en');
          const sign = (n: number) => (n < 0 ? '<' : n > 0 ? '>' : '=');
          return {
            utf8: sign(compareUTF8(a, b)),
            js: sign(a === b ? 0 : a < b ? -1 : 1),
            intl: sign(collator.compare(a, b)),
          };
        },
        [compareUTF8Source, a, b] as [string, string, string],
      );

      // The interesting assertion: UTF-8 and Intl.Collator must disagree
      // (that's the whole point of this test group).
      expect(
        result.utf8,
        `compareUTF8("${a}", "${b}") should differ from Intl — got same result "${result.utf8}". ` +
          `This case may no longer be a useful example.`,
      ).not.toBe(result.intl);

      console.log(
        `  "${a}" vs "${b}": compareUTF8=${result.utf8}  JS=${result.js}  Intl=${result.intl}`,
      );
    });
  }
});

test.describe('compareUTF8 vs Intl.Collator — performance', () => {
  for (const [charset, label] of [
    [ASCII_CHARS, 'ASCII strings'],
    [UNICODE_CHARS, 'Unicode strings'],
  ] as [string, string][]) {
    test(label, async ({page}) => {
      await page.goto('about:blank');

      const results = await page.evaluate(
        ([src, charset, iterations, strLen, seed]) => {
          // Seeded PRNG (mulberry32)
          let s = seed as number;
          const rand = () => {
            s = (s + 0x6d2b79f5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };

          const chars = (charset as string).split('');
          const strings: string[] = [];
          for (let i = 0; i < (iterations as number); i++) {
            let str = '';
            for (let j = 0; j < (strLen as number); j++) {
              str += chars[Math.floor(rand() * chars.length)];
            }
            strings.push(str);
          }

          // eslint-disable-next-line no-new-func
          const fn = new Function(src + '\nreturn {compareUTF8};');
          const {compareUTF8} = fn() as {compareUTF8: (a: string, b: string) => number};
          const collatorEN = new Intl.Collator('en');

          const methods: [string, (a: string, b: string) => number][] = [
            ['compareUTF8', compareUTF8],
            ['JS < operator', (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1)],
            ['Intl.Collator (en)', (a: string, b: string) => collatorEN.compare(a, b)],
            ['localeCompare', (a: string, b: string) => a.localeCompare(b)],
          ];

          const bench = (fn: (a: string, b: string) => number) => {
            // warmup
            for (let i = 0; i < 500; i++) fn(strings[i], strings[i + 1]);
            let sink = 0;
            const t0 = performance.now();
            for (let i = 0; i < strings.length - 1; i++) {
              sink += fn(strings[i], strings[i + 1]);
            }
            const ms = performance.now() - t0;
            if (sink === Infinity) console.log(sink); // prevent DCE
            return ms;
          };

          const timings = methods.map(([name, fn]) => ({name, ms: bench(fn)}));
          const fastest = Math.min(...timings.map(t => t.ms));
          return timings.map(({name, ms}) => ({
            name,
            ms: Math.round(ms * 100) / 100,
            ratio: Math.round((ms / fastest) * 100) / 100,
          }));
        },
        [compareUTF8Source, charset, ITERATIONS, STR_LEN, SEED] as [
          string,
          string,
          number,
          number,
          number,
        ],
      );

      console.log(
        `\n  ${label} (${ITERATIONS.toLocaleString()} comparisons, length ${STR_LEN}):`,
      );
      for (const {name, ms, ratio} of results) {
        console.log(`    ${name.padEnd(22)} ${String(ms).padStart(8)}ms   (${ratio}x)`);
      }

      // compareUTF8 should be slower than the JS < operator (it does more work).
      // If this ever fails it means either the JS engine got very smart about
      // optimising it or the implementation changed.
      const utf8 = results.find(r => r.name === 'compareUTF8')!;
      const js = results.find(r => r.name === 'JS < operator')!;
      expect(utf8.ms).toBeGreaterThan(js.ms);
    });
  }
});
