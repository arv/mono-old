import type {IssuePathItem} from 'valibot';
import {skipAssertJSONValue} from './config.ts';
import type {ReadonlyJSONObject, ReadonlyJSONValue} from './json.ts';
import {isJSONObject, isJSONValue} from './json.ts';
import * as v from './valita.ts';

const path: (string | number)[] = [];

export const jsonSchema: v.Type<ReadonlyJSONValue> = v.pipe(
  v.unknown(),
  v.rawTransform(({dataset, addIssue, NEVER}) => {
    if (skipAssertJSONValue) {
      return dataset.value as ReadonlyJSONValue;
    }
    const value = dataset.value;
    if (isJSONValue(value, path)) {
      path.length = 0;
      return value as ReadonlyJSONValue;
    }
    const p = path.slice();
    path.length = 0;
    const pathItems = p.map(key => ({key})) as IssuePathItem[];
    addIssue({
      message: `Not a JSON value`,
      ...(pathItems.length > 0
        ? {path: pathItems as [IssuePathItem, ...IssuePathItem[]]}
        : {}),
    });
    return NEVER;
  }),
);

export const jsonObjectSchema: v.Type<ReadonlyJSONObject> = v.pipe(
  v.unknown(),
  v.rawTransform(({dataset, addIssue, NEVER}) => {
    if (skipAssertJSONValue) {
      return dataset.value as ReadonlyJSONObject;
    }
    const value = dataset.value;
    if (isJSONObject(value, path)) {
      path.length = 0;
      return value as ReadonlyJSONObject;
    }
    const p = path.slice();
    path.length = 0;
    const pathItems = p.map(key => ({key})) as IssuePathItem[];
    addIssue({
      message: `Not a JSON object`,
      ...(pathItems.length > 0
        ? {path: pathItems as [IssuePathItem, ...IssuePathItem[]]}
        : {}),
    });
    return NEVER;
  }),
);
