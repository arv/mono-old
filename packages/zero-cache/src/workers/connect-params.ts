import type {IncomingHttpHeaders} from 'node:http2';
import {must} from '../../../shared/src/must.ts';
import {
  decodeSecProtocols,
  type InitConnectionMessage,
} from '../../../zero-protocol/src/connect.ts';
import {URLParams} from '../types/url-params.ts';

export {type InitConnectionMessage};

export type ConnectParams = {
  readonly protocolVersion: number;
  readonly clientID: string;
  readonly clientGroupID: string;
  readonly profileID: string | null;
  readonly baseCookie: string | null;
  readonly timestamp: number;
  readonly lmID: number;
  readonly wsID: string;
  readonly debugPerf: boolean;
  readonly auth: string | undefined;
  readonly userID: string;
  readonly initConnectionMsg: InitConnectionMessage | undefined;
  readonly httpCookie: string | undefined;
  readonly origin: string | undefined;
};

export function getConnectParams(
  protocolVersion: number,
  url: URL,
  headers: IncomingHttpHeaders,
):
  | {
      params: ConnectParams;
      error: null;
    }
  | {
      params: null;
      error: string;
    } {
  const params = new URLParams(url);

  try {
    const clientID = params.get('clientID', true);
    const clientGroupID = params.get('clientGroupID', true);
    const profileID = params.get('profileID', false);
    const baseCookie = params.get('baseCookie', false);
    const timestamp = params.getInteger('ts', true);
    const lmID = params.getInteger('lmid', true);
    const wsID = params.get('wsid', false) ?? '';
    const userID = params.get('userID', false) ?? '';
    const debugPerf = params.getBoolean('debugPerf');
    const {initConnectionMessage, authToken} = decodeSecProtocols(
      must(headers['sec-websocket-protocol']),
    );

    return {
      params: {
        protocolVersion,
        clientID,
        clientGroupID,
        profileID,
        baseCookie,
        timestamp,
        lmID,
        wsID,
        debugPerf,
        initConnectionMsg: initConnectionMessage,
        auth: authToken,
        userID,
        httpCookie: headers.cookie,
        origin: headers.origin,
      },
      error: null,
    };
  } catch (e) {
    return {
      params: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Parses connection parameters from a WebTransport request URL.
 *
 * Unlike the WebSocket variant, auth is passed as a URL query param (`auth`)
 * rather than in the `Sec-WebSocket-Protocol` header (which doesn't exist in
 * WebTransport).  The `initConnectionMessage` is sent as the first message on
 * the bidirectional stream instead of being encoded in a header.
 */
export function getConnectParamsFromWebTransportUrl(
  protocolVersion: number,
  url: URL,
):
  | {
      params: ConnectParams;
      error: null;
    }
  | {
      params: null;
      error: string;
    } {
  const params = new URLParams(url);

  try {
    const clientID = params.get('clientID', true);
    const clientGroupID = params.get('clientGroupID', true);
    const profileID = params.get('profileID', false);
    const baseCookie = params.get('baseCookie', false);
    const timestamp = params.getInteger('ts', true);
    const lmID = params.getInteger('lmid', true);
    const wsID = params.get('wsid', false) ?? '';
    const userID = params.get('userID', false) ?? '';
    const debugPerf = params.getBoolean('debugPerf');
    // Auth token is passed as a URL param for WebTransport (no custom headers).
    const auth = params.get('auth', false) ?? undefined;

    return {
      params: {
        protocolVersion,
        clientID,
        clientGroupID,
        profileID,
        baseCookie,
        timestamp,
        lmID,
        wsID,
        debugPerf,
        // initConnectionMsg is sent as the first message on the bidi-stream.
        initConnectionMsg: undefined,
        auth,
        userID,
        httpCookie: undefined,
        origin: undefined,
      },
      error: null,
    };
  } catch (e) {
    return {
      params: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
