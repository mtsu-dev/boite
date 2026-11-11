/*
 * A viewer's browser frames, on a socket of their own (`browser.remoteStream`).
 * The ticket in the path is what opens it, once: a client that authenticated
 * on its RPC socket was given it there. Same origins as that socket.
 */
import type { ServerWebSocket } from 'bun';
import { BROWSER_STREAM_ROUTE, BROWSER_STREAM_TICKET } from '@boite/contracts';
import type { Core } from '../core.ts';
import type { StreamHandle } from '../browser/remote-drive.ts';
import { clientField } from './connection-log.ts';

/** What a viewer's browser stream socket carries on this machine's server. */
export interface StreamSocketData { stream: { ticket: string; handle: StreamHandle | null } }

/** Nothing for another path, the refusal, or what the upgraded socket carries. */
export function browserStreamRequest(core: Core, url: URL, request: Request, allowedOrigin: (origin: string | null) => boolean): StreamSocketData | Response | undefined {
  if (!url.pathname.startsWith(`${BROWSER_STREAM_ROUTE}/`)) return undefined;
  const ticket = url.pathname.slice(BROWSER_STREAM_ROUTE.length + 1);
  if (core.stopping) return new Response('core stopping', { status: 503 });
  const origin = request.headers.get('origin');
  if (!allowedOrigin(origin)) {
    core.log('warn', `refused a browser stream from origin ${origin === null ? '(none)' : clientField(origin, 100)}`, { source: 'connections', event: 'connection.origin-refused' });
    return new Response('forbidden origin', { status: 403 });
  }
  if (!BROWSER_STREAM_TICKET.test(ticket) || !core.browser.streamOffered(ticket)) return new Response('not found', { status: 404 });
  return { stream: { ticket, handle: null } };
}

export function browserStreamOpened(core: Core, socket: ServerWebSocket<StreamSocketData>): void {
  // JPEGs are already compressed: each is sent as it is, whatever the socket negotiated.
  socket.data.stream.handle = core.browser.openStream(socket.data.stream.ticket, {
    text: json => { socket.send(json, false); },
    binary: bytes => { socket.sendBinary(bytes, false); },
    buffered: () => socket.getBufferedAmount(),
    close: (code, reason) => socket.close(code, reason),
    drop: () => socket.terminate(),
  });
}

/** An acknowledgement or a width: a few bytes of JSON, and nothing else is read. */
export function browserStreamMessage(data: StreamSocketData, raw: string | Buffer): void {
  if (raw.length <= 256) data.stream.handle?.message(typeof raw === 'string' ? raw : raw.toString());
}
