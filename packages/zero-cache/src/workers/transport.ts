import {Readable} from 'node:stream';
import WebSocket, {createWebSocketStream} from 'ws';
import type {CloseEvent, ErrorEvent} from 'ws';

export type TransportCloseEvent = {
  code?: number | undefined;
  reason?: string | undefined;
  wasClean?: boolean | undefined;
};

export type TransportErrorEvent = {
  message: string;
  error: unknown;
};

/**
 * Abstraction over WebSocket and WebTransport bidirectional streams.
 *
 * Both ws.WebSocket (server-side) and WebTransport bidi-streams can be adapted
 * to this interface, allowing Connection to be transport-agnostic.
 */
export type Transport = {
  /** A Node.js readable stream of newline-delimited JSON message strings. */
  readonly messages: NodeJS.ReadableStream;

  /**
   * Send a JSON-serializable message.
   * For WebSocket: sends as a text frame.
   * For WebTransport: writes bytes to the bidi-stream.
   */
  send(data: string, cb?: (err?: Error | null) => void): void;

  /** Close the connection. */
  close(): void;

  /** True when the transport is open and accepting data. */
  readonly isOpen: boolean;

  onClose(handler: (e: TransportCloseEvent) => void): void;
  offClose(handler: (e: TransportCloseEvent) => void): void;

  onError(handler: (e: TransportErrorEvent) => void): void;
  offError(handler: (e: TransportErrorEvent) => void): void;
};

/**
 * Wraps a ws.WebSocket into a Transport.
 *
 * For the close/error events, the wrapper translates ws event shapes to the
 * generic TransportCloseEvent / TransportErrorEvent shapes.  We track wrapper
 * functions so that offClose/offError can remove the exact listener that was
 * added.
 */
export function createWebSocketTransport(ws: WebSocket): Transport {
  const closeWrappers = new WeakMap<
    (e: TransportCloseEvent) => void,
    (e: CloseEvent) => void
  >();
  const errorWrappers = new WeakMap<
    (e: TransportErrorEvent) => void,
    (e: ErrorEvent) => void
  >();

  return {
    messages: createWebSocketStream(ws),

    send(data, cb) {
      ws.send(data, cb ?? undefined);
    },

    close() {
      ws.close();
    },

    get isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },

    onClose(handler) {
      const wrapper = (e: CloseEvent) =>
        handler({code: e.code, reason: String(e.reason), wasClean: e.wasClean});
      closeWrappers.set(handler, wrapper);
      ws.addEventListener('close', wrapper);
    },

    offClose(handler) {
      const wrapper = closeWrappers.get(handler);
      if (wrapper) {
        ws.removeEventListener('close', wrapper);
        closeWrappers.delete(handler);
      }
    },

    onError(handler) {
      const wrapper = (e: ErrorEvent) =>
        handler({message: e.message, error: e.error});
      errorWrappers.set(handler, wrapper);
      ws.addEventListener('error', wrapper);
    },

    offError(handler) {
      const wrapper = errorWrappers.get(handler);
      if (wrapper) {
        ws.removeEventListener('error', wrapper);
        errorWrappers.delete(handler);
      }
    },
  };
}

/**
 * Creates a Transport from a WebTransport bidirectional stream
 * (Web Streams API, as provided by @fails-components/webtransport on the server).
 *
 * Messages are newline-delimited JSON strings.
 */
export function createWebTransportTransport(
  session: {closed: Promise<void>},
  bidiStream: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  },
): Transport {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const writer = bidiStream.writable.getWriter();

  // Convert WebTransport's Web Streams ReadableStream into a Node.js Readable
  // that emits individual newline-delimited JSON messages.
  const messages = Readable.from(readLines(bidiStream.readable, decoder));

  const closeHandlers = new Set<(e: TransportCloseEvent) => void>();
  const errorHandlers = new Set<(e: TransportErrorEvent) => void>();

  let open = true;

  session.closed
    .then(() => {
      open = false;
      const event: TransportCloseEvent = {
        code: 1000,
        reason: 'WebTransport session closed',
        wasClean: true,
      };
      closeHandlers.forEach(h => h(event));
    })
    .catch((err: unknown) => {
      open = false;
      const event: TransportCloseEvent = {
        code: 1006,
        reason: 'WebTransport session closed abnormally',
        wasClean: false,
      };
      closeHandlers.forEach(h => h(event));
      const errEvent: TransportErrorEvent = {
        message: err instanceof Error ? err.message : String(err),
        error: err,
      };
      errorHandlers.forEach(h => h(errEvent));
    });

  return {
    messages,

    send(data, cb) {
      if (!open) {
        cb?.(new Error('WebTransport session is closed'));
        return;
      }
      writer
        .write(encoder.encode(data + '\n'))
        .then(() => cb?.(), cb ?? undefined);
    },

    close() {
      open = false;
      writer.close().catch(() => {});
    },

    get isOpen() {
      return open;
    },

    onClose(handler) {
      closeHandlers.add(handler);
    },

    offClose(handler) {
      closeHandlers.delete(handler);
    },

    onError(handler) {
      errorHandlers.add(handler);
    },

    offError(handler) {
      errorHandlers.delete(handler);
    },
  };
}

/**
 * Reads newline-delimited lines from a WebTransport ReadableStream<Uint8Array>.
 */
async function* readLines(
  readable: ReadableStream<Uint8Array>,
  decoder: TextDecoder,
): AsyncGenerator<string> {
  const reader = readable.getReader();
  let buffer = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      // Last element may be incomplete – keep it in the buffer.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line) {
          yield line;
        }
      }
    }
    // Flush any remaining bytes.
    const flushed = decoder.decode();
    if (flushed) {
      yield flushed;
    }
  } finally {
    reader.releaseLock();
  }
}
