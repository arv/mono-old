import {describe, test} from 'vitest';
import {
  jsonArrayTestData,
  jsonObjectTestData,
  randomString,
} from '../../shared/src/test-data.ts';
import {bench} from './bench.ts';
import {getSizeOfValue} from './size-of-value.ts';

describe('getSizeOfValue performance', () => {
  // Core primitive types - essential benchmarks
  describe('primitives', () => {
    test('string (100 chars)', {tags: ['bench']}, async () => {
      await bench('string (100 chars)', () => {
        getSizeOfValue(randomString(100));
      });
    });

    test('integer', {tags: ['bench']}, async () => {
      await bench('integer', () => {
        getSizeOfValue(42);
      });
    });

    test('boolean', {tags: ['bench']}, async () => {
      await bench('boolean', () => {
        getSizeOfValue(true);
      });
    });

    test('null', {tags: ['bench']}, async () => {
      await bench('null', () => {
        getSizeOfValue(null);
      });
    });
  });

  // Essential array tests
  describe('arrays', () => {
    const smallArray = Array.from({length: 10}, (_, i) => `item${i}`);
    const largeArray = Array.from({length: 100}, (_, i) => `item${i}`);

    test('small array (10 items)', {tags: ['bench']}, async () => {
      await bench('small array (10 items)', () => {
        getSizeOfValue(smallArray);
      });
    });

    test('large array (100 items)', {tags: ['bench']}, async () => {
      await bench('large array (100 items)', () => {
        getSizeOfValue(largeArray);
      });
    });
  });

  // Essential object tests - focus on replicache-style data
  describe('objects', () => {
    const testDataSmall = jsonObjectTestData(256);
    const testDataLarge = jsonObjectTestData(1024);

    test('structured object (256B)', {tags: ['bench']}, async () => {
      await bench('structured object (256B)', () => {
        getSizeOfValue(testDataSmall);
      });
    });

    test('structured object (1KB)', {tags: ['bench']}, async () => {
      await bench('structured object (1KB)', () => {
        getSizeOfValue(testDataLarge);
      });
    });

    // One complex nested structure
    const nestedObject = {
      data: randomString(50),
      nested: {
        values: [1, 2, 3],
        info: {str: 'test', num: 42},
      },
    };

    test('nested object', {tags: ['bench']}, async () => {
      await bench('nested object', () => {
        getSizeOfValue(nestedObject);
      });
    });
  });

  // Essential dataset tests - focus on realistic sizes
  describe('datasets', () => {
    const smallDataset = jsonArrayTestData(10, 256);
    const largeDataset = jsonArrayTestData(100, 512);

    test('small dataset (10x256B)', {tags: ['bench']}, async () => {
      await bench('small dataset (10x256B)', () => {
        getSizeOfValue(smallDataset);
      });
    });

    test('large dataset (100x512B)', {tags: ['bench']}, async () => {
      await bench('large dataset (100x512B)', () => {
        getSizeOfValue(largeDataset);
      });
    });
  });
});
