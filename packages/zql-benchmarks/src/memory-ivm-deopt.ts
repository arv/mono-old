/**
 * Standalone in-memory ZQL IVM benchmark for V8 deopt tracing.
 * Does NOT require postgres or SQLite - uses MemorySource only.
 *
 * Build:
 *   node_modules/.bin/esbuild packages/zql-benchmarks/src/memory-ivm-deopt.ts \
 *     --bundle --platform=node --format=esm \
 *     --outfile=/tmp/zql-deopt-bench.mjs \
 *     --define:TESTING=true --define:__DEV__=false
 *
 * Run with deopt tracing:
 *   node --trace-deopt /tmp/zql-deopt-bench.mjs 2>/tmp/deopt.log
 *   grep '\[deopt' /tmp/deopt.log | grep -v node_modules | sort | uniq -c | sort -rn
 */
// oxlint-disable no-console
import {createSilentLogContext} from '../../shared/src/logging-test-utils.ts';
import {testLogConfig} from '../../otel/src/test-log-config.ts';
import {consume} from '../../zql/src/ivm/stream.ts';
import {compareValues} from '../../zql/src/ivm/data.ts';
import {createSource} from '../../zql/src/ivm/test/source-factory.ts';
import {Catch} from '../../zql/src/ivm/catch.ts';
import {Filter} from '../../zql/src/ivm/filter.ts';
import {Join} from '../../zql/src/ivm/join.ts';
import {buildFilterPipeline} from '../../zql/src/ivm/filter-operators.ts';
import type {BuilderDelegate} from '../../zql/src/builder/builder.ts';
import type {Row} from '../../zero-protocol/src/data.ts';

const lc = createSilentLogContext();
const noopDelegate = {addEdge() {}} as unknown as BuilderDelegate;

// ---- Schema definitions ----
const issueColumns = {
  id: {type: 'string'} as const,
  title: {type: 'string'} as const,
  closed: {type: 'boolean'} as const,
  ownerId: {type: 'string', optional: true} as const,
  createdAt: {type: 'number'} as const,
};

const userColumns = {
  id: {type: 'string'} as const,
  name: {type: 'string'} as const,
};

// ---- Seed helpers ----
function makeIssueRow(i: number): Row {
  return {
    id: `issue-${i}`,
    title: `Issue ${i}`,
    closed: i % 3 === 0,
    ownerId: i % 5 === 0 ? null : `user-${i % 20}`,
    createdAt: 1_000_000 + i,
  };
}

function makeUserRow(i: number): Row {
  return {id: `user-${i}`, name: `User ${i}`};
}

// ---- Benchmark timer ----
function time(label: string, fn: () => void, iterations = 1000): void {
  for (let i = 0; i < 10; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const end = performance.now();
  const ms = end - start;
  console.log(
    `  ${label}: ${(ms / iterations).toFixed(4)}ms/iter (${ms.toFixed(1)}ms total)`,
  );
}

// ---- Benchmark 1: compareValues (hot path, deopt risk from polymorphism) ----
function benchCompareValues(): void {
  const strs = ['apple', 'banana', 'cherry', 'date', 'elderberry'];
  const nums = [1, 2, 3, 4, 5];

  time('compareValues(string, string)', () => {
    for (let i = 0; i < strs.length; i++) {
      for (let j = 0; j < strs.length; j++) {
        compareValues(strs[i], strs[j]);
      }
    }
  });

  time('compareValues(number, number)', () => {
    for (let i = 0; i < nums.length; i++) {
      for (let j = 0; j < nums.length; j++) {
        compareValues(nums[i], nums[j]);
      }
    }
  });

  // Call with mixed types through same call site — classic deopt trigger
  time(
    'compareValues(mixed: string/number/bool/null)',
    () => {
      compareValues('a', 'b');
      compareValues(1, 2);
      compareValues(true, false);
      compareValues(null, null);
    },
    10000,
  );
}

// ---- Benchmark 2: MemorySource full scan ----
function benchSourceFetch(issueCount: number): void {
  const src = createSource(lc, testLogConfig, 'issue', issueColumns, ['id']);
  for (let i = 0; i < issueCount; i++) {
    consume(src.push({type: 'add', row: makeIssueRow(i)}));
  }

  const conn = src.connect([
    ['createdAt', 'asc'],
    ['id', 'asc'],
  ]);
  const out = new Catch(conn);

  time(`MemorySource full scan (${issueCount} rows)`, () => {
    out.fetch();
  });
}

// ---- Benchmark 3: MemorySource push (add/remove cycle) ----
function benchSourcePush(existingCount: number): void {
  const src = createSource(lc, testLogConfig, 'issue', issueColumns, ['id']);
  for (let i = 0; i < existingCount; i++) {
    consume(src.push({type: 'add', row: makeIssueRow(i)}));
  }
  const conn = src.connect([
    ['createdAt', 'asc'],
    ['id', 'asc'],
  ]);
  new Catch(conn); // connect output so pushes flow

  let idx = existingCount;
  time(`MemorySource push add/remove (over ${existingCount} rows)`, () => {
    const row = makeIssueRow(idx++);
    consume(src.push({type: 'add', row}));
    consume(src.push({type: 'remove', row}));
  });
}

// ---- Benchmark 4: MemorySource push edit ----
function benchSourcePushEdit(existingCount: number): void {
  const src = createSource(lc, testLogConfig, 'issue', issueColumns, ['id']);
  const rows: Row[] = [];
  for (let i = 0; i < existingCount; i++) {
    const row = makeIssueRow(i);
    rows.push(row);
    consume(src.push({type: 'add', row}));
  }
  const conn = src.connect([
    ['createdAt', 'asc'],
    ['id', 'asc'],
  ]);
  new Catch(conn);

  let idx = 0;
  time(
    `MemorySource push edit (${existingCount} rows)`,
    () => {
      const oldRow = rows[idx % rows.length];
      idx++;
      const newRow = {...oldRow, title: `Updated ${idx}`};
      consume(src.push({type: 'edit', oldRow, row: newRow}));
      consume(src.push({type: 'edit', oldRow: newRow, row: oldRow}));
    },
    500,
  );
}

// ---- Benchmark 5: Filter fetch ----
function benchFilterFetch(issueCount: number): void {
  const src = createSource(lc, testLogConfig, 'issue', issueColumns, ['id']);
  for (let i = 0; i < issueCount; i++) {
    consume(src.push({type: 'add', row: makeIssueRow(i)}));
  }
  const conn = src.connect([
    ['createdAt', 'asc'],
    ['id', 'asc'],
  ]);
  const filtered = buildFilterPipeline(
    conn,
    noopDelegate,
    input => new Filter(input, row => row['closed'] === false),
  );
  const out = new Catch(filtered);

  time(`Filter fetch open issues (${issueCount} total)`, () => {
    out.fetch();
  });
}

// ---- Benchmark 6: Filter push ----
function benchFilterPush(existingCount: number): void {
  const src = createSource(lc, testLogConfig, 'issue', issueColumns, ['id']);
  for (let i = 0; i < existingCount; i++) {
    consume(src.push({type: 'add', row: makeIssueRow(i)}));
  }
  const conn = src.connect([
    ['createdAt', 'asc'],
    ['id', 'asc'],
  ]);
  const filtered = buildFilterPipeline(
    conn,
    noopDelegate,
    input => new Filter(input, row => row['closed'] === false),
  );
  new Catch(filtered);

  let idx = existingCount;
  time('Filter push: add open issue (passes filter)', () => {
    const row = makeIssueRow(idx++);
    (row as Record<string, unknown>)['closed'] = false;
    consume(src.push({type: 'add', row}));
    consume(src.push({type: 'remove', row}));
  });

  time('Filter push: add closed issue (filtered out)', () => {
    const row = makeIssueRow(idx++);
    (row as Record<string, unknown>)['closed'] = true;
    consume(src.push({type: 'add', row}));
    consume(src.push({type: 'remove', row}));
  });
}

// ---- Benchmark 7: Join fetch ----
function benchJoinFetch(issueCount: number, userCount: number): void {
  const issueSrc = createSource(lc, testLogConfig, 'issue', issueColumns, [
    'id',
  ]);
  const userSrc = createSource(lc, testLogConfig, 'user', userColumns, ['id']);

  for (let i = 0; i < userCount; i++) {
    consume(userSrc.push({type: 'add', row: makeUserRow(i)}));
  }
  for (let i = 0; i < issueCount; i++) {
    consume(issueSrc.push({type: 'add', row: makeIssueRow(i)}));
  }

  const issueConn = issueSrc.connect([
    ['createdAt', 'asc'],
    ['id', 'asc'],
  ]);
  const userConn = userSrc.connect([['id', 'asc']]);

  const join = new Join({
    parent: issueConn,
    child: userConn,
    parentKey: ['ownerId'],
    childKey: ['id'],
    relationshipName: 'owner',
    hidden: false,
    system: 'client',
  });

  const out = new Catch(join);

  time(
    `Join fetch (${issueCount} issues → ${userCount} users)`,
    () => {
      out.fetch();
    },
    100,
  );
}

// ---- Benchmark 8: Join push ----
function benchJoinPush(issueCount: number, userCount: number): void {
  const issueSrc = createSource(lc, testLogConfig, 'issue', issueColumns, [
    'id',
  ]);
  const userSrc = createSource(lc, testLogConfig, 'user', userColumns, ['id']);

  for (let i = 0; i < userCount; i++) {
    consume(userSrc.push({type: 'add', row: makeUserRow(i)}));
  }
  const issueRows: Row[] = [];
  for (let i = 0; i < issueCount; i++) {
    const row = makeIssueRow(i);
    issueRows.push(row);
    consume(issueSrc.push({type: 'add', row}));
  }

  const issueConn = issueSrc.connect([
    ['createdAt', 'asc'],
    ['id', 'asc'],
  ]);
  const userConn = userSrc.connect([['id', 'asc']]);

  const join = new Join({
    parent: issueConn,
    child: userConn,
    parentKey: ['ownerId'],
    childKey: ['id'],
    relationshipName: 'owner',
    hidden: false,
    system: 'client',
  });

  new Catch(join);
  // Initial hydration
  join.fetch({});

  let idx = issueCount;
  time('Join push: add issue with owner', () => {
    const row = makeIssueRow(idx++);
    consume(issueSrc.push({type: 'add', row}));
    consume(issueSrc.push({type: 'remove', row}));
  });

  time(
    'Join push: edit issue title (non-key field)',
    () => {
      const oldRow = issueRows[idx % issueRows.length];
      idx++;
      const newRow = {...oldRow, title: `Updated ${idx}`};
      consume(issueSrc.push({type: 'edit', oldRow, row: newRow}));
      consume(issueSrc.push({type: 'edit', oldRow: newRow, row: oldRow}));
    },
    500,
  );
}

// ---- Main ----
function main() {
  console.log('=== ZQL IVM In-Memory Deopt Benchmark ===\n');

  const ISSUE_COUNT = 1000;
  const USER_COUNT = 20;

  console.log('--- compareValues (polymorphic deopt risk) ---');
  benchCompareValues();

  console.log('\n--- MemorySource fetch ---');
  benchSourceFetch(ISSUE_COUNT);

  console.log('\n--- MemorySource push ---');
  benchSourcePush(ISSUE_COUNT);
  benchSourcePushEdit(ISSUE_COUNT);

  console.log('\n--- Filter ---');
  benchFilterFetch(ISSUE_COUNT);
  benchFilterPush(ISSUE_COUNT);

  console.log('\n--- Join ---');
  benchJoinFetch(ISSUE_COUNT, USER_COUNT);
  benchJoinPush(ISSUE_COUNT, USER_COUNT);

  console.log('\n=== Done ===');
}

main();
