import {unreachable} from '../../../shared/src/asserts.ts';
import type {Row} from '../../../zero-protocol/src/data.ts';
import type {AddChange, Change, EditChange, RemoveChange} from './change.ts';
import {maybeSplitAndPushEditChange} from './maybe-split-and-push-edit-change.ts';
import type {InputBase, Output} from './operator.ts';
import type {Stream} from './stream.ts';

export function* filterPush(
  change: Change,
  output: Output,
  pusher: InputBase,
  predicate?: (row: Row) => boolean,
): Stream<'yield'> {
  if (!predicate) {
    yield* output.push(change, pusher);
    return;
  }
  switch (change.type) {
    case 'add':
    case 'remove':
      if (predicate(change.node.row)) {
        yield* output.push(change, pusher);
      }
      break;
    case 'child':
      if (predicate(change.node.row)) {
        yield* output.push(change, pusher);
      }
      break;
    case 'edit':
      yield* maybeSplitAndPushEditChange(change, predicate, output, pusher);
      break;
    default:
      unreachable(change);
  }
}

/**
 * Specialized version of {@linkcode filterPush} for add/remove changes only.
 * Keeping add/remove separate from edit means this call site only ever sees
 * the two-property `{type, node}` shape, letting V8 compile a monomorphic IC
 * instead of a polymorphic/megamorphic one across the three Change shapes.
 */
export function* filterPushAddOrRemove(
  change: AddChange | RemoveChange,
  output: Output,
  pusher: InputBase,
  predicate: ((row: Row) => boolean) | undefined,
): Stream<'yield'> {
  if (!predicate || predicate(change.node.row)) {
    yield* output.push(change, pusher);
  }
}

/**
 * Specialized version of {@linkcode filterPush} for edit changes only.
 * Keeping edit separate from add/remove means this call site only ever sees
 * the three-property `{type, node, oldNode}` shape, keeping the IC monomorphic.
 */
export function* filterPushEdit(
  change: EditChange,
  output: Output,
  pusher: InputBase,
  predicate: ((row: Row) => boolean) | undefined,
): Stream<'yield'> {
  if (!predicate) {
    yield* output.push(change, pusher);
    return;
  }
  yield* maybeSplitAndPushEditChange(change, predicate, output, pusher);
}
