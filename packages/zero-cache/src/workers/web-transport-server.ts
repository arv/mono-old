/**
 * WebTransport server for Zero's sync protocol.
 *
 * This is a proof-of-concept implementation that explores using WebTransport
 * (HTTP/3 + QUIC) as an alternative to WebSocket (HTTP/1.1 + TCP) for the
 * Zero sync connection.
 *
 * ## Architecture
 *
 * The WebTransportServer runs alongside the existing WebSocket server within
 * the syncer worker process.  When `webTransportPort` is configured, each
 * syncer worker starts its own Http3Server on the configured port and
 * directly accepts WebTransport sessions without the worker-handoff mechanism
 * used by WebSocket.
 *
 * ## PoC Limitations
 *
 * - Only tested / recommended with `ZERO_NUM_SYNC_WORKERS=1`.  With multiple
 *   workers each worker would need its own port, requiring additional client-
 *   side routing logic.
 * - Authentication is passed as a URL query param (`?auth=<token>`) rather
 *   than in a `Sec-WebSocket-Protocol` header.
 * - The `initConnectionMessage` is sent as the first message on the
 *   bidirectional stream rather than being encoded in a header.
 * - Self-signed TLS certificates are used; browsers require
 *   `serverCertificateHashes` to be set.  The cert fingerprint is delivered
 *   as the first server→client message on the WT stream so clients can pin
 *   it on subsequent reconnects (same mechanism as `initConnection`).
 *
 * ## Performance Hypothesis
 *
 * WebTransport / QUIC provides:
 * - Lower connection latency (0-RTT or 1-RTT vs 1-RTT for WebSocket + TLS)
 * - No TCP head-of-line blocking for multiplexed queries
 * - Connection migration (no reconnects on network change)
 * - Better performance on lossy networks
 *
 * The PoC measures connection establishment time and first-poke latency via
 * the existing timestamp instrumentation in the connection lifecycle.
 */
import type {LogContext} from '@rocicorp/logger';
import {createHash} from 'node:crypto';
import {Http3Server} from '@fails-components/webtransport';
import type {WebTransportSession} from '@fails-components/webtransport';
import {generate as generateCert} from 'selfsigned';
import {parsePath} from '../server/worker-dispatcher.ts';
import {getConnectParamsFromWebTransportUrl} from './connect-params.ts';
import type {ConnectParams} from './connect-params.ts';
import {createWebTransportTransport} from './transport.ts';

/** Certificate info sent to the client as the first WT stream message. */
export type WtCertInfo = {
  /** Colon-separated hex SHA-256 fingerprint, e.g. "AA:BB:CC:..." */
  fingerprint: string;
  /** Port the WebTransport server is listening on. */
  port: number;
};

export type WebTransportConnectionHandler = (
  params: ConnectParams,
  transport: ReturnType<typeof createWebTransportTransport>,
) => Promise<void>;

export class WebTransportServer {
  readonly #lc: LogContext;
  readonly #server: Http3Server;
  readonly #certInfo: WtCertInfo;

  constructor(
    lc: LogContext,
    certInfo: WtCertInfo,
    cert: string,
    privKey: string,
  ) {
    this.#lc = lc.withContext('component', 'web-transport-server');
    this.#certInfo = certInfo;

    this.#server = new Http3Server({
      port: certInfo.port,
      host: '0.0.0.0',
      secret: 'zero-wt-poc',
      cert,
      privKey,
    });
  }

  get certInfo(): WtCertInfo {
    return this.#certInfo;
  }

  /**
   * Start the server and route incoming sessions to `handler`.
   */
  start(handler: WebTransportConnectionHandler): void {
    this.#server.startServer();
    this.#lc.info?.(
      `WebTransport server listening on port ${this.#certInfo.port}`,
      {fingerprint: this.#certInfo.fingerprint},
    );
    void this.#acceptSessions(handler);
  }

  stop(): void {
    this.#server.stopServer();
  }

  async #acceptSessions(handler: WebTransportConnectionHandler): Promise<void> {
    // The path pattern mirrors the WebSocket path:
    // /<base>/sync/v<version>/connect
    // We subscribe to a wildcard path and parse the version ourselves.
    let sessionStream: ReadableStream<WebTransportSession>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stream/web vs DOM ReadableStream
      sessionStream = this.#server.sessionStream(
        '/',
      ) as unknown as ReadableStream<WebTransportSession>;
    } catch (e) {
      this.#lc.error?.('Failed to get WebTransport session stream', e);
      return;
    }

    const reader = sessionStream.getReader();
    while (true) {
      let result: ReadableStreamReadResult<WebTransportSession>;
      try {
        result = await reader.read();
      } catch (e) {
        this.#lc.error?.('Error reading WebTransport session stream', e);
        break;
      }
      if (result.done) {
        break;
      }
      const session = result.value;
      if (session) {
        void this.#handleSession(session, handler);
      }
    }
  }

  async #handleSession(
    session: WebTransportSession,
    handler: WebTransportConnectionHandler,
  ): Promise<void> {
    const lc = this.#lc;

    // Accept the first (and only) bidirectional stream on the session.
    // The Zero client opens exactly one bidi-stream per connection.
    let bidiStream: {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stream/web vs DOM types
      const incomingStreams = (
        session as unknown as {
          incomingBidirectionalStreams: ReadableStream<{
            readable: ReadableStream<Uint8Array>;
            writable: WritableStream<Uint8Array>;
          }>;
        }
      ).incomingBidirectionalStreams;

      const reader = incomingStreams.getReader();
      const result = await reader.read();
      reader.releaseLock();
      if (result.done || !result.value) {
        lc.warn?.('WebTransport session closed before bidi-stream received');
        return;
      }
      bidiStream = result.value;
    } catch (e) {
      lc.error?.('Error accepting WebTransport bidi-stream', e);
      return;
    }

    // The session URL is available on the session object provided by @fails-components.
    // Fall back gracefully if not available (older versions).
    const rawUrl: string =
      (session as unknown as {url?: string}).url ?? '/sync/connect';
    const url = new URL(rawUrl, `https://localhost:${this.#certInfo.port}`);

    const path = parsePath(url);
    if (!path || path.worker !== 'sync' || path.action !== 'connect') {
      lc.warn?.('WebTransport session with unexpected path', rawUrl);
      session.close({closeCode: 400, reason: 'invalid path'});
      return;
    }

    const version = Number(path.version);
    if (Number.isNaN(version)) {
      lc.warn?.('WebTransport session with invalid protocol version', rawUrl);
      session.close({closeCode: 400, reason: 'invalid version'});
      return;
    }

    const {params, error} = getConnectParamsFromWebTransportUrl(version, url);
    if (error !== null) {
      lc.warn?.('WebTransport connect params error', error);
      session.close({closeCode: 400, reason: error});
      return;
    }

    lc.debug?.(
      'accepted WebTransport session',
      params.clientGroupID,
      params.clientID,
    );

    // Send cert info as the first server→client message so the client can pin
    // the certificate on subsequent reconnects.  This mirrors the pattern of
    // `initConnection` being the first client→server message on the stream.
    try {
      const encoder = new TextEncoder();
      const writer = bidiStream.writable.getWriter();
      await writer.write(
        encoder.encode(JSON.stringify({wtCertInfo: this.#certInfo}) + '\n'),
      );
      writer.releaseLock();
    } catch (e) {
      lc.error?.('Failed to send wtCertInfo handshake', e);
      session.close({closeCode: 500, reason: 'handshake failed'});
      return;
    }

    const transport = createWebTransportTransport(session, bidiStream);
    await handler(params, transport);
  }
}

/**
 * Generates a self-signed certificate suitable for WebTransport development.
 *
 * The certificate is valid for 13 days (< 14 day limit for
 * `serverCertificateHashes`). For production, use a proper CA-signed
 * certificate.
 */
export async function generateWebTransportCertForPort(
  port: number,
): Promise<{cert: string; privKey: string; certInfo: WtCertInfo}> {
  const attrs = [
    {name: 'commonName', value: 'zero-wt-dev'},
    {name: 'organizationName', value: 'Zero WebTransport PoC'},
  ];
  const pems = await generateCert(attrs, {
    notAfterDate: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000),
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          {type: 2, value: 'localhost'},
          {type: 7, ip: '127.0.0.1'},
        ],
      },
    ],
  });

  const cert: string = pems.cert;
  const privKey: string = pems.private;

  // Recompute fingerprint from DER to ensure SHA-256.
  // (selfsigned uses sha1 for its built-in fingerprint field by default.)
  const pemBody = cert
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');
  const derBuffer = Buffer.from(pemBody, 'base64');
  const fingerprintHex = createHash('sha256').update(derBuffer).digest('hex');
  const sha256Fingerprint = (fingerprintHex.match(/.{2}/g) ?? [])
    .join(':')
    .toUpperCase();

  const certInfo: WtCertInfo = {fingerprint: sha256Fingerprint, port};

  return {cert, privKey, certInfo};
}
