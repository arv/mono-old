import type {LogContext} from '@rocicorp/logger';
import {readFile} from 'node:fs/promises';
import type {NormalizedZeroConfig} from '../../config/normalize.ts';
import {handleHeapzRequest} from '../../services/heapz.ts';
import {HttpService, type Options} from '../../services/http-service.ts';
import {handleStatzRequest} from '../../services/statz.ts';
import type {IncomingMessageSubset} from '../../types/http.ts';
import type {Worker} from '../../types/processes.ts';
import {
  installWebSocketHandoff,
  type HandoffSpec,
} from '../../types/websocket-handoff.ts';
import type {WtCertInfo} from '../../workers/web-transport-server.ts';

export class ZeroDispatcher extends HttpService {
  readonly id = 'zero-dispatcher';
  readonly #getWorker: () => Promise<Worker>;

  constructor(
    config: NormalizedZeroConfig,
    lc: LogContext,
    opts: Options,
    getWorker: () => Promise<Worker>,
  ) {
    const wtCertFile = config.webTransportPort
      ? (config.webTransportCertFile ?? '/tmp/zero-wt-cert.json')
      : undefined;

    super(`zero-dispatcher`, lc, opts, fastify => {
      fastify.get('/statz', (req, res) =>
        handleStatzRequest(lc, config, req, res),
      );
      fastify.get('/heapz', (req, res) =>
        handleHeapzRequest(lc, config, req, res),
      );
      if (wtCertFile) {
        // Serve the WebTransport certificate fingerprint so clients can
        // construct a `serverCertificateHashes` option when connecting.
        fastify.get('/wt-cert', async (_req, res) => {
          try {
            const json = await readFile(wtCertFile, 'utf8');
            const info = JSON.parse(json) as WtCertInfo;
            return res
              .header('content-type', 'application/json')
              .header('cache-control', 'no-store')
              .send(info);
          } catch (e) {
            lc.warn?.('Failed to read wt-cert file', e);
            return res
              .status(503)
              .send({error: 'WebTransport cert not yet available'});
          }
        });
      }
      installWebSocketHandoff(lc, this.#handoff, fastify.server);
    });
    this.#getWorker = getWorker;
  }

  readonly #handoff = (
    _req: IncomingMessageSubset,
    dispatch: (h: HandoffSpec<string>) => void,
    onError: (error: unknown) => void,
  ) => {
    void this.#getWorker().then(
      sender => dispatch({payload: 'unused', sender}),
      onError,
    );
  };
}
