import type {
  BaseIssue,
  BaseSchema,
  InferOutput,
  ObjectEntries,
  OptionalSchema,
  StrictObjectSchema,
} from 'valibot';
import * as v from 'valibot';

export * from 'valibot';

/**
 * Type alias for a valibot schema with a known output type.
 * Equivalent to the old @badrap/valita `Type<T>`.
 */
export type Type<T> = BaseSchema<unknown, T, BaseIssue<unknown>>;

/**
 * Type alias for an optional valibot schema.
 * Equivalent to the old @badrap/valita `Optional<T>`.
 */
export type Optional<T> = OptionalSchema<
  BaseSchema<unknown, T, BaseIssue<unknown>>,
  undefined
>;

/**
 * Type alias for inferring the output type of a schema.
 * Equivalent to the old @badrap/valita `Infer<T>`.
 */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
export type Infer<T extends Type<any>> = InferOutput<T>;

/**
 * 'strip' allows unknown properties and removes unknown properties.
 * 'strict' errors if there are unknown properties.
 * 'passthrough' allows unknown properties.
 */
export type ParseOptionsMode = 'passthrough' | 'strict' | 'strip';

type Key = string | number;

function displayList<T>(
  word: string,
  items: T[],
  toStr: (x: T) => string = x => String(x),
): string {
  if (items.length === 1) {
    return toStr(items[0]);
  }
  const suffix = `${toStr(items[items.length - 2])} ${word} ${toStr(items[items.length - 1])}`;
  if (items.length === 2) {
    return suffix;
  }
  return `${items.slice(0, -2).map(toStr).join(', ')}, ${suffix}`;
}

/**
 * Normalize valibot's capitalized type names to lowercase for consistency
 * with the old @badrap/valita error message format.
 */
function norm(s: string): string {
  if (s === 'Array') return 'array';
  if (s === 'Object') return 'object';
  return s;
}

/**
 * Map a valibot literal or type schema to its base type name,
 * used for combining union error messages like "Expected number or string".
 */
function baseTypeName(issue: {type: string; expected: string}): string {
  if (issue.type === 'literal') {
    const e = issue.expected;
    if (e.startsWith('"')) return 'string';
    if (e === 'true' || e === 'false') return 'boolean';
    return 'number';
  }
  return norm(issue.expected);
}

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function getMessage(issue: any, value: unknown, mode?: ParseOptionsMode): string {
  const path: Key[] = issue.path?.map((item: {key: Key}) => item.key) ?? [];
  const atPath = path.length > 0 ? ` at ${path.join('.')}` : '';
  const type: string = issue.type;
  const expected = norm(issue.expected as string);
  const received = norm(issue.received as string);

  // Extra key in object/tuple (expected === 'never')
  if (issue.expected === 'never') {
    const key = path[path.length - 1];
    const parentPath = path.slice(0, -1);
    const atParent =
      parentPath.length > 0 ? ` at ${parentPath.join('.')}` : '';
    return `Unexpected property ${key}${atParent}`;
  }

  // Missing required key in strict object: expected is a quoted key name like '"x"'
  if (
    (type === 'strict_object' ||
      type === 'object' ||
      type === 'loose_object') &&
    issue.received === 'undefined' &&
    (issue.expected as string).startsWith('"')
  ) {
    // Check if the object schema is receiving a non-object (e.g. an array).
    const parentPathItem = issue.path?.[issue.path.length - 1];
    if (parentPathItem?.input !== undefined && Array.isArray(parentPathItem.input)) {
      const parentPath = path.slice(0, -1);
      const atParent =
        parentPath.length > 0 ? ` at ${parentPath.join('.')}` : '';
      return `Expected object${atParent}. Got array`;
    }
    const key = path[path.length - 1];
    const parentPath = path.slice(0, -1);
    const atParent =
      parentPath.length > 0 ? ` at ${parentPath.join('.')}` : '';
    return `Missing property ${key}${atParent}`;
  }

  // Union - needs schema to try each option
  if (type === 'union') {
    return formatUnionFallback(value, issue, mode);
  }

  // Literal mismatch - no period before "Got" (matches old valita format)
  if (type === 'literal') {
    return `Expected literal value ${expected}${atPath} Got ${received}`;
  }

  // Picklist (used in literalUnion)
  if (type === 'picklist') {
    const exp =
      expected.startsWith('(') && expected.endsWith(')')
        ? expected.slice(1, -1)
        : expected;
    return `Expected literal value ${exp}${atPath} Got ${received}`;
  }

  // Standard type mismatch
  return `Expected ${expected}${atPath}. Got ${received}`;
}

/**
 * Format a union error by trying each schema option separately (like @badrap/valita did).
 * This finds the variant that got "closest" to matching (deepest error path) and
 * reports that variant's error.
 */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function formatUnionWithOptions(value: unknown, options: any[], mode?: ParseOptionsMode): string {
  type Failure = {issue: any; depth: number; schema: any};
  const failures: Failure[] = [];

  for (const opt of options) {
    // If this option is itself a union, recurse
    if (opt.type === 'union') {
      const r = v.safeParse(opt, value);
      if (!r.success) {
        // Create a synthetic failure with depth computed from the best sub-option
        const msg = formatUnionWithOptions(value, opt.options, mode);
        // We need a depth for comparison - try to find the deepest sub-option failure
        let maxSubDepth = 0;
        for (const subOpt of opt.options) {
          const sr = v.safeParse(subOpt, value);
          if (!sr.success) {
            maxSubDepth = Math.max(maxSubDepth, sr.issues[0].path?.length ?? 0);
          }
        }
        failures.push({issue: {_synthetic: true, _msg: msg}, depth: maxSubDepth, schema: opt});
      }
      continue;
    }

    const r = v.safeParse(opt, value);
    if (!r.success) {
      const firstIssue = r.issues[0];
      failures.push({issue: firstIssue, depth: firstIssue.path?.length ?? 0, schema: opt});
    }
  }

  if (!failures.length) {
    try {
      return `Invalid union value: ${JSON.stringify(value)}`;
    } catch {
      return `Invalid union value`;
    }
  }

  // Sort by descending depth
  failures.sort((a, b) => b.depth - a.depth);

  // If there's a single deepest failure (or if it's unique), use it
  if (failures.length === 1 || failures[0].depth > failures[1].depth) {
    const {issue} = failures[0];
    if (issue._synthetic) {
      return issue._msg as string;
    }
    return getMessage(issue, value, mode);
  }

  // Tie at depth 0: combine expected types
  if (failures[0].depth === 0) {
    // Skip synthetic issues for this
    const realFailures = failures.filter(f => !f.issue._synthetic);
    if (!realFailures.length) {
      try {
        return `Invalid union value: ${JSON.stringify(value)}`;
      } catch {
        return `Invalid union value`;
      }
    }

    const allLiterals = realFailures.every(f => f.issue.type === 'literal');
    if (allLiterals) {
      const exp = displayList('or', realFailures.map(f => norm(f.issue.expected)));
      return `Expected literal value ${exp} Got ${norm(realFailures[0].issue.received)}`;
    }

    const seen = new Set<string>();
    const types: string[] = [];
    for (const {issue} of realFailures) {
      const t = baseTypeName(issue);
      if (!seen.has(t)) {
        seen.add(t);
        types.push(t);
      }
    }
    return `Expected ${displayList('or', types)}. Got ${norm(realFailures[0].issue.received)}`;
  }

  // Tie at non-zero depth: fall back
  try {
    return `Invalid union value: ${JSON.stringify(value)}`;
  } catch {
    return `Invalid union value`;
  }
}

/**
 * Fallback union formatter when we don't have direct schema access.
 * Uses valibot's flattened sub-issues.
 */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function formatUnionFallback(value: unknown, unionIssue: any, mode?: ParseOptionsMode): string {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const subIssues: any[] = unionIssue.issues ?? [];

  const unionPath: Key[] =
    unionIssue.path?.map((p: {key: Key}) => p.key) ?? [];
  const atUnionPath =
    unionPath.length > 0 ? ` at ${unionPath.join('.')}` : '';

  if (!subIssues.length) {
    if (unionPath.length > 0) {
      return `Invalid union value${atUnionPath}`;
    }
    try {
      return `Invalid union value: ${JSON.stringify(value)}`;
    } catch {
      return `Invalid union value`;
    }
  }

  const maxDepth = Math.max(
    ...subIssues.map((i: {path?: unknown[]}) => i.path?.length ?? 0),
  );

  if (maxDepth === 0) {
    const allLiterals = subIssues.every(
      (i: {type: string}) => i.type === 'literal',
    );
    if (allLiterals) {
      const exp = displayList(
        'or',
        subIssues.map((i: {expected: string}) => norm(i.expected)),
      );
      return `Expected literal value ${exp}${atUnionPath} Got ${norm(subIssues[0].received)}`;
    }

    const seen = new Set<string>();
    const types: string[] = [];
    for (const i of subIssues) {
      const t = baseTypeName(i);
      if (!seen.has(t)) {
        seen.add(t);
        types.push(t);
      }
    }
    return `Expected ${displayList('or', types)}${atUnionPath}. Got ${norm(subIssues[0].received)}`;
  }

  // Find single deepest sub-issue
  let deepest = subIssues[0];
  for (const i of subIssues.slice(1)) {
    if ((i.path?.length ?? 0) > (deepest.path?.length ?? 0)) {
      deepest = i;
    }
  }

  const deepestCount = subIssues.filter(
    (i: {path?: unknown[]}) => (i.path?.length ?? 0) === maxDepth,
  ).length;
  if (deepestCount > 1) {
    if (unionPath.length > 0) {
      return `Invalid union value${atUnionPath}`;
    }
    try {
      return `Invalid union value: ${JSON.stringify(value)}`;
    } catch {
      return `Invalid union value`;
    }
  }

  return getMessage(deepest, value, mode);
}

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function applyMode(schema: any, mode: ParseOptionsMode): any {
  if (mode === 'strict') {
    return schema;
  }
  switch (schema.type) {
    case 'strict_object':
    case 'object':
    case 'loose_object': {
      const entries: ObjectEntries = Object.fromEntries(
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        Object.entries(schema.entries).map(([k, val]) => [
          k,
          applyMode(val, mode),
        ]),
      ) as ObjectEntries;
      return mode === 'passthrough'
        ? v.looseObject(entries)
        : v.object(entries);
    }
    case 'optional':
      return v.optional(applyMode(schema.wrapped, mode));
    case 'nullable':
      return v.nullable(applyMode(schema.wrapped, mode));
    case 'union':
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      return v.union(schema.options.map((o: any) => applyMode(o, mode)));
    case 'array':
      return v.array(applyMode(schema.item, mode));
    default:
      return schema;
  }
}

type Result<T> = {ok: true; value: T} | {ok: false; error: string};

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function getErrorMessage(issue: any, value: unknown, schema: any, mode?: ParseOptionsMode): string {
  if (issue.type === 'union' && !issue.path?.length && schema?.type === 'union') {
    // Top-level union: use schema options for better error messages
    return formatUnionWithOptions(value, schema.options, mode);
  }
  // For nested union errors, fall back to the flattened issue approach
  return getMessage(issue, value, mode);
}

export function parse<T>(
  value: unknown,
  schema: Type<T>,
  mode?: ParseOptionsMode,
): T {
  const res = test(value, schema, mode);
  if (!res.ok) {
    throw new TypeError(res.error);
  }
  return res.value;
}

export function is<T>(
  value: unknown,
  schema: Type<T>,
  mode?: ParseOptionsMode,
): value is T {
  return test(value, schema, mode).ok;
}

export function assert<T>(
  value: unknown,
  schema: Type<T>,
  mode?: ParseOptionsMode,
): asserts value is T {
  parse(value, schema, mode);
}

export function test<T>(
  value: unknown,
  schema: Type<T>,
  mode?: ParseOptionsMode,
): Result<T> {
  const effectiveSchema =
    mode !== undefined && mode !== 'strict'
      ? applyMode(schema, mode)
      : schema;
  const result = v.safeParse(effectiveSchema, value);
  if (!result.success) {
    return {
      ok: false,
      error: getErrorMessage(result.issues[0], value, schema, mode),
    };
  }
  return {ok: true, value: result.output};
}

/**
 * Similar to {@link test} but works for Optional schemas.
 * This is for advanced usage. Prefer {@link test} unless you really need
 * to operate directly on an Optional field.
 */
export function testOptional<T>(
  value: unknown,
  schema: Type<T> | Optional<T>,
  mode?: ParseOptionsMode,
): Result<T | undefined> {
  const effectiveSchema =
    mode !== undefined && mode !== 'strict'
      ? applyMode(schema, mode)
      : schema;
  const result = v.safeParse(effectiveSchema, value);
  if (!result.success) {
    return {
      ok: false,
      error: getErrorMessage(result.issues[0], value, schema, mode),
    };
  }
  return {ok: true, value: result.output as T | undefined};
}

/**
 * Shallowly marks the schema as readonly.
 */
export function readonly<T extends Type<unknown>>(
  t: T,
): Type<Readonly<InferOutput<T>>> {
  return t as Type<Readonly<InferOutput<T>>>;
}

export function readonlyObject<T extends ObjectEntries>(
  t: T,
): StrictObjectSchema<T, undefined> {
  return v.strictObject(t);
}

export function readonlyArray<T extends Type<unknown>>(
  t: T,
): Type<ReadonlyArray<InferOutput<T>>> {
  return v.array(t) as unknown as Type<ReadonlyArray<InferOutput<T>>>;
}

export function readonlyRecord<T extends Type<unknown>>(
  t: T,
): Type<Readonly<Record<string, InferOutput<T>>>> {
  return v.record(v.string(), t) as unknown as Type<
    Readonly<Record<string, InferOutput<T>>>
  >;
}

export function instanceOfAbstractType<T = unknown>(
  obj: unknown,
): obj is Type<T> | Optional<T> {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'kind' in obj &&
    (obj as {kind: unknown}).kind === 'schema'
  );
}

type ObjectShape = Record<string, Type<unknown> | Optional<unknown>>;

/**
 * Similar to `ObjectType.partial()` except it recurses into nested objects.
 */
export function deepPartial<T extends ObjectShape>(
  s: StrictObjectSchema<T, undefined>,
): StrictObjectSchema<
  {[K in keyof T]: OptionalSchema<T[K], undefined>},
  undefined
> {
  const shape: ObjectEntries = {};
  for (const [key, type] of Object.entries(s.entries)) {
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    if ((type as any).type === 'strict_object') {
      shape[key] = v.optional(
        deepPartial(type as StrictObjectSchema<ObjectShape, undefined>),
      );
    } else {
      shape[key] = v.optional(type as Type<unknown>);
    }
  }
  return v.strictObject(shape) as unknown as StrictObjectSchema<
    {[K in keyof T]: OptionalSchema<T[K], undefined>},
    undefined
  >;
}

type Literal = string | number | bigint | boolean;
type LiteralSchemas<T extends Literal[]> = {
  [K in keyof T]: v.LiteralSchema<T[K], undefined>;
};

export function literalUnion<T extends [Literal, ...Literal[]]>(
  ...literals: T
): v.UnionSchema<LiteralSchemas<T>, undefined> {
  return v.union(
    literals.map(l => v.literal(l)) as unknown as [
      Type<T[number]>,
      ...Type<T[number]>[],
    ],
  ) as unknown as v.UnionSchema<LiteralSchemas<T>, undefined>;
}
