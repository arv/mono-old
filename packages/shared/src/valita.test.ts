import {expect, expectTypeOf, test} from 'vitest';
import {assert} from './asserts.ts';
import * as v from './valita.ts';
import {parse} from './valita.ts';

const t = <T>(s: v.Type<T>, val: unknown, message?: string) => {
  const r1 = v.test(val, s);
  const r2 = v.testOptional(val, s);
  let ex;
  try {
    const parsed = parse(val, s);
    expect(parsed).toStrictEqual(val);

    expect(r1.ok).toBe(true);
    expect(r1.ok && r1.value).toStrictEqual(val);

    expect(r2.ok).toBe(true);
    expect(r2.ok && r2.value).toStrictEqual(val);
  } catch (err) {
    ex = err;
  }

  if (message !== undefined) {
    assert(ex instanceof TypeError);
    expect(ex.message).toBe(message);

    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.error).toBe(message);

    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.error).toBe(message);
  } else {
    expect(ex).toBe(undefined);
  }
};

test('basic', () => {
  {
    const s = v.string();
    t(s, 'ok');
    t(s, 42, 'Expected string. Got 42');
    t(s, true, 'Expected string. Got true');
    t(s, false, 'Expected string. Got false');
    t(s, null, 'Expected string. Got null');
    t(s, undefined, 'Expected string. Got undefined');
    t(s, {}, 'Expected string. Got object');
  }

  {
    const s = v.boolean();
    t(s, true);
    t(s, false);
    t(s, 'hi', 'Expected boolean. Got "hi"');
    t(s, 42, 'Expected boolean. Got 42');
    t(s, null, 'Expected boolean. Got null');
    t(s, undefined, 'Expected boolean. Got undefined');
    t(s, {}, 'Expected boolean. Got object');
  }

  {
    const s = v.number();
    t(s, 42);
    t(s, 'hi', 'Expected number. Got "hi"');
    t(s, true, 'Expected number. Got true');
    t(s, false, 'Expected number. Got false');
    t(s, null, 'Expected number. Got null');
    t(s, undefined, 'Expected number. Got undefined');
    t(s, {}, 'Expected number. Got object');
  }

  t(v.array(v.number()), [1, 2, 3]);
  t(v.array(v.number()), []);

  for (const s of [v.array(v.number()), v.strictTuple([v.number()])]) {
    t(s, 42, 'Expected array. Got 42');
    t(s, 'hi', 'Expected array. Got "hi"');
    t(s, true, 'Expected array. Got true');
    t(s, false, 'Expected array. Got false');
    t(s, null, 'Expected array. Got null');
    t(s, undefined, 'Expected array. Got undefined');
    t(s, {}, 'Expected array. Got object');
  }

  t(v.strictTuple([]), []);
  t(v.strictTuple([]), [42], 'Unexpected property 0');
  t(v.strictTuple([v.number()]), [], 'Expected number at 0. Got undefined');

  {
    const s = v.record(v.string(), v.number());
    t(s, {});
    t(s, {x: 42});
    t(s, 42, 'Expected object. Got 42');
    t(s, 'hi', 'Expected object. Got "hi"');
    t(s, true, 'Expected object. Got true');
    t(s, false, 'Expected object. Got false');
    t(s, null, 'Expected object. Got null');
    t(s, undefined, 'Expected object. Got undefined');
  }

  {
    const s = v.strictObject({x: v.number()});
    t(s, {x: 42});
    t(s, 42, 'Expected object. Got 42');
    t(s, 'hi', 'Expected object. Got "hi"');
    t(s, true, 'Expected object. Got true');
    t(s, false, 'Expected object. Got false');
    t(s, null, 'Expected object. Got null');
    t(s, undefined, 'Expected object. Got undefined');
  }

  t(v.array(v.number()), ['hi'], 'Expected number at 0. Got "hi"');
  t(v.array(v.number()), [1, 2, 'hi'], 'Expected number at 2. Got "hi"');

  t(v.strictTuple([v.number()]), ['hi'], 'Expected number at 0. Got "hi"');

  t(v.record(v.string(), v.number()), {x: 'hi'}, 'Expected number at x. Got "hi"');
  t(v.strictObject({x: v.number()}), {x: 'hi'}, 'Expected number at x. Got "hi"');

  {
    const s = v.strictObject({
      x: v.strictObject({
        y: v.strictObject({
          z: v.number(),
        }),
      }),
    });

    t(s, {x: {y: {z: 1}}});

    // Missing
    t(s, {}, 'Missing property x');
    t(s, {x: {}}, 'Missing property y at x');
    t(s, {x: {y: {}}}, 'Missing property z at x.y');

    // Wrong type
    t(s, {x: undefined}, 'Expected object at x. Got undefined');
    t(s, {x: {y: null}}, 'Expected object at x.y. Got null');
    t(s, {x: {y: {z: 'hi'}}}, 'Expected number at x.y.z. Got "hi"');

    // Extra properties
    t(s, {x: {y: {z: 1, a: 2}}}, 'Unexpected property a at x.y');
    // Note: valibot only reports the first extra key
    t(s, {x: {y: {z: 1, a: 2, b: 3}}}, 'Unexpected property a at x.y');
  }

  {
    const s = v.strictObject({
      x: v.strictObject({
        y: v.number(),
        z: v.number(),
      }),
    });
    t(s, {x: {y: 1, z: 2}});
    t(s, {x: {y: 1}}, 'Missing property z at x');
    t(s, {x: {}}, 'Missing property y at x');
  }

  {
    const s = v.union([v.number()]);
    t(s, 42);
    t(s, true, 'Expected number. Got true');
  }

  {
    const s = v.union([v.number(), v.string()]);
    t(s, 42);
    t(s, 'hi');
    t(s, true, 'Expected number or string. Got true');
  }

  {
    const s = v.union([v.number(), v.string(), v.boolean()]);
    t(s, 42);
    t(s, 'hi');
    t(s, true);
    t(s, null, 'Expected number, string or boolean. Got null');
  }

  {
    const s = v.union([v.number(), v.literal('x'), v.boolean()]);
    t(s, 42);
    t(s, 'x');
    t(s, true);
    t(s, null, 'Expected number, string or boolean. Got null');
  }

  {
    const s = v.union([v.literal(1), v.literal('yes'), v.literal(true)]);
    t(s, 1);
    t(s, 'yes');
    t(s, true);
    t(s, 0, 'Expected literal value 1, "yes" or true Got 0');
    t(s, null, 'Expected literal value 1, "yes" or true Got null');
  }
  {
    const s = v.union([v.literal(1), v.literal('yes'), v.boolean()]);
    t(s, 1);
    t(s, 'yes');
    t(s, true);
    t(s, 0, 'Expected number, string or boolean. Got 0');
    t(s, null, 'Expected number, string or boolean. Got null');
  }

  {
    const s = v.strictObject({
      x: v.optional(v.number()),
    });

    t(s, {});
    t(s, {x: undefined});
    t(s, {x: 42});
    t(s, {x: null}, 'Expected number at x. Got null');
    t(s, {x: 'hi'}, 'Expected number at x. Got "hi"');
  }

  {
    const s = v.union([
      v.strictTuple([v.literal(1), v.number()]),
      v.strictTuple([v.literal('b'), v.string()]),
      v.strictTuple([v.literal(true), v.boolean()]),
    ]);
    t(s, [1, 1]);
    t(s, ['b', 'b']);
    t(s, [true, true]);
    t(s, ['d', true], 'Invalid union value: ["d",true]');
    t(s, [1, '1'], 'Invalid union value: [1,"1"]');
    t(s, {}, 'Expected array. Got object');
    t(s, 'a', 'Expected array. Got "a"');

    const s2 = v.strictObject({
      x: s,
    });
    t(s2, {x: []}, 'Invalid union value at x');
  }
});

test('union error message', () => {
  const type = v.union([
    v.strictTuple([v.literal('a'), v.strictObject({a: v.string()})]),
    v.strictTuple([v.literal('b'), v.strictObject({b: v.number()})]),
    v.strictTuple([v.literal('c'), v.strictObject({c: v.boolean()})]),
  ]);
  // Test once with the union itself, then with union(union) and union(union(union))
  // to verify recursion.
  for (const s of [type, v.union([type]), v.union([v.union([type])])]) {
    t(s, ['a', {a: 'payload'}]);
    t(s, ['b', {b: 123}]);
    t(s, ['c', {c: true}]);
    t(s, ['a', {b: 'not the right field'}], 'Missing property a at 1');
    t(
      s,
      ['b', {b: 'not a number'}],
      'Expected number at 1.b. Got "not a number"',
    );
    t(s, ['c', {c: 1}], 'Expected boolean at 1.c. Got 1');
  }
});

test('testOptional', () => {
  const s = v.optional(v.number());

  expect(v.testOptional(123, s)).toEqual({ok: true, value: 123});
  expect(v.testOptional(undefined, s)).toEqual({ok: true, value: undefined});

  expect(v.testOptional('123', s)).toEqual({
    error: 'Expected number. Got "123"',
    ok: false,
  });
  expect(v.testOptional(null, s)).toEqual({
    error: 'Expected number. Got null',
    ok: false,
  });
});

test('array instead of object error message', () => {
  const s = v.strictObject({
    x: v.number(),
  });

  expect(v.test({x: 1}, s)).toEqual({ok: true, value: {x: 1}});
  expect(v.testOptional({x: 1}, s)).toEqual({ok: true, value: {x: 1}});

  expect(v.test([], s)).toEqual({
    error: 'Expected object. Got array',
    ok: false,
  });
  expect(v.testOptional([], s)).toEqual({
    error: 'Expected object. Got array',
    ok: false,
  });
});

test('instanceOfAbstractType', () => {
  const num = v.number();
  const optional = v.optional(num);

  expect(v.instanceOfAbstractType(num)).toBe(true);
  expect(v.instanceOfAbstractType(optional)).toBe(true);

  expect(v.instanceOfAbstractType({})).toBe(false);
  expect(v.instanceOfAbstractType('foo')).toBe(false);
  expect(v.instanceOfAbstractType(null)).toBe(false);
  expect(v.instanceOfAbstractType(undefined)).toBe(false);
});

test('deepPartial', () => {
  const s = v.deepPartial(
    v.strictObject({
      a: v.strictObject({
        b: v.string(),
      }),
    }),
  );

  expect(v.parse({}, s)).toEqual({});
  expect(v.parse({a: {}}, s)).toEqual({a: {}});
});

test('literalUnion', () => {
  const s = v.literalUnion('a', 'b', 1, true, 42n);
  expectTypeOf(s).toEqualTypeOf<v.Type<'a' | 'b' | 1 | true | 42n>>();

  expect(v.parse('a', s)).toBe('a');
  expect(v.parse('b', s)).toBe('b');
  expect(v.parse(1, s)).toBe(1);
  expect(v.parse(true, s)).toBe(true);
  expect(v.parse(42n, s)).toBe(42n);
  expect(() => v.parse('c', s)).toThrow(
    new TypeError(`Expected literal value "a", "b", 1, true or 42 Got "c"`),
  );
});
