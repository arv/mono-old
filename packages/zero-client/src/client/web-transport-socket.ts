/**
 * Client-side WebTransport adapter.
 *
 * Wraps the browser's WebTransport API to present the same interface as a
 * browser WebSocket, allowing the Zero client to use WebTransport
 * transparently when `webTransportPort` is set.
 *
 * ## Protocol differences from WebSocket
 *
 * - Auth is passed as a URL query param (`?auth=<token>`) rather than in the
 *   `Sec-WebSocket-Protocol` header (which doesn't exist in WebTransport).
 * - Messages are newline-delimited JSON strings written to a single
 *   bidirectional stream.
 * - The `initConnectionMessage` is sent as the first application message
 *   on the bidi-stream, not encoded in a header.
 *
 * ## Certificate Validation
 *
 * The server sends `{wtCertInfo: {fingerprint, port}}` as the first
 * server→client message on the stream.  This message is intercepted by
 * `WebTransportSocket` (not forwarded to the application) and the supplied
 * `onCertInfo` callback is invoked so the caller can cache the fingerprint
 * for cert-pinning on subsequent reconnects.
 *
 * On the first (cold-start) connection `certHashBuffer` is omitted and the
 * browser validates the server certificate via normal TLS trust.  For
 * development with self-signed certificates, pass the SHA-256 fingerprint
 * bytes from a previous session as `certHashBuffer`.
 */

/** WebSocket-compatible ready state constants. */
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

type EventName = 'open' | 'message' | 'close' | 'error';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must be `any` to accept typed handlers (MessageEvent<string>, CloseEvent, etc.)
type AnyHandler = (event: any) => void;

/**
 * Performance mark names for measuring WebTransport vs WebSocket latency.
 * Consumers can read these via `performance.getEntriesByName()`.
 */
export const WT_PERF_MARKS = {
  connectStart: 'zero-wt-connect-start',
  transportReady: 'zero-wt-transport-ready',
  bidiStreamOpen: 'zero-wt-bidi-stream-open',
} as const;

export class WebTransportSocket {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  readonly CONNECTING = CONNECTING;
  readonly OPEN = OPEN;
  readonly CLOSING = CLOSING;
  readonly CLOSED = CLOSED;

  #readyState: 0 | 1 | 2 | 3 = CONNECTING;
  #transport: WebTransport | undefined;
  #writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  #abortController: AbortController | undefined;

  readonly #listeners = new Map<EventName, Set<AnyHandler>>();
  readonly #onCertInfo: ((fingerprint: string) => void) | undefined;

  /** The WebTransport URL (mirrors WebSocket.url for compatibility). */
  readonly url: string;
  /** Always empty string — WebTransport has no subprotocol concept. */
  readonly protocol: string = '';

  constructor(
    url: string,
    certHashBuffer?: ArrayBuffer | undefined,
    onCertInfo?: ((fingerprint: string) => void) | undefined,
  ) {
    this.url = url;
    this.#onCertInfo = onCertInfo;
    performance.mark(WT_PERF_MARKS.connectStart);
    void this.#connect(url, certHashBuffer);
  }

  get readyState(): number {
    return this.#readyState;
  }

  /**
   * Send a JSON message over the bidirectional stream.
   * Messages are terminated with a newline character (the server delimiter).
   */
  send(data: string): void {
    if (this.#readyState !== OPEN || !this.#writer) {
      return;
    }
    const encoded = new TextEncoder().encode(data + '\n');
    // Fire-and-forget: backpressure is naturally applied by the QUIC flow
    // control window; if the write queue is full the promise will not resolve
    // until the window opens.
    void this.#writer.write(encoded);
  }

  close(_code?: number, _reason?: string): void {
    if (this.#readyState === CLOSING || this.#readyState === CLOSED) {
      return;
    }
    this.#readyState = CLOSING;
    this.#abortController?.abort();
    this.#transport?.close();
  }

  addEventListener(event: EventName, listener: AnyHandler): void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
  }

  removeEventListener(event: EventName, listener: AnyHandler): void {
    this.#listeners.get(event)?.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Private implementation
  // -------------------------------------------------------------------------

  async #connect(
    url: string,
    certHashBuffer: ArrayBuffer | undefined,
  ): Promise<void> {
    this.#abortController = new AbortController();

    const options: WebTransportOptions = {};
    if (certHashBuffer) {
      options.serverCertificateHashes = [
        {algorithm: 'sha-256', value: certHashBuffer},
      ];
    }

    try {
      this.#transport = new WebTransport(url, options);

      // Track when the transport is ready.
      await this.#transport.ready;
      performance.mark(WT_PERF_MARKS.transportReady);

      // Open a single bidirectional stream.  All Zero messages flow over this
      // stream, mirroring the single-stream semantics of WebSocket.
      const bidi = await this.#transport.createBidirectionalStream();
      performance.mark(WT_PERF_MARKS.bidiStreamOpen);

      this.#writer = bidi.writable.getWriter();
      this.#readyState = OPEN;

      // Notify listeners that the transport is open (WebSocket 'open' event).
      this.#emit('open', {type: 'open'});

      // Start reading incoming messages (server→client).
      void this.#readMessages(bidi.readable);

      // When the transport closes, fire the 'close' event.
      this.#transport.closed
        .then(() => {
          this.#onClosed(1000, 'WebTransport session closed', true);
        })
        .catch(() => {
          this.#onClosed(1006, 'WebTransport session closed abnormally', false);
        });
    } catch (e) {
      if (this.#readyState === CLOSING) {
        // Normal intentional close – do not report as error.
        this.#onClosed(1000, 'closed', true);
        return;
      }
      this.#readyState = CLOSED;
      this.#emit('error', {type: 'error', message: String(e), error: e});
      this.#onClosed(1006, String(e), false);
    }
  }

  async #readMessages(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let certInfoReceived = false;

    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});

        // Split on newlines – each line is one JSON message.
        const lines = buffer.split('\n');
        // Last element may be incomplete; keep it in the buffer.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line) continue;
          // The first server message is the WT-specific cert handshake.
          // Intercept it and notify the caller; do not forward to the app.
          if (!certInfoReceived) {
            certInfoReceived = true;
            try {
              const msg = JSON.parse(line) as {
                wtCertInfo?: {fingerprint: string; port: number} | undefined;
              };
              if (msg.wtCertInfo) {
                this.#onCertInfo?.(msg.wtCertInfo.fingerprint);
                continue;
              }
            } catch {
              // Not JSON or unexpected format — fall through and emit normally.
            }
          }
          this.#emit('message', {type: 'message', data: line});
        }
      }
      // Flush any remaining bytes.
      const flushed = decoder.decode();
      if (flushed) {
        this.#emit('message', {type: 'message', data: flushed});
      }
    } catch (e) {
      if (this.#readyState !== CLOSING && this.#readyState !== CLOSED) {
        this.#emit('error', {type: 'error', message: String(e), error: e});
      }
    } finally {
      reader.releaseLock();
    }
  }

  #onClosed(code: number, reason: string, wasClean: boolean): void {
    if (this.#readyState === CLOSED) return;
    this.#readyState = CLOSED;
    this.#emit('close', {type: 'close', code, reason, wasClean});
  }

  #emit(event: EventName, data: object): void {
    this.#listeners.get(event)?.forEach(handler => handler(data));
  }
}

/**
 * Converts a colon-separated hex fingerprint (e.g. `"AA:BB:CC:..."`) to the
 * `ArrayBuffer` expected by `serverCertificateHashes`.
 */
export function fingerprintToHashBuffer(fingerprint: string): ArrayBuffer {
  const bytes = fingerprint.split(':').map(hex => parseInt(hex, 16));
  return new Uint8Array(bytes).buffer;
}
