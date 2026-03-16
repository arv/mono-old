import type {Upstream} from '../../../zero-protocol/src/up.ts';

export function send(ws: {send(data: string): void}, data: Upstream) {
  ws.send(JSON.stringify(data));
}
