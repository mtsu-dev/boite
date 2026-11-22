import { RpcErrorCode } from '@boite/contracts';
import type { Core } from '../core.ts';
import { RpcFailure } from '../errors.ts';
import { logMessageOf } from '../log-errors.ts';
import { ServerConnection } from './connection.ts';
import { hello } from './hello.ts';
import { clientField, logRpcTiming } from './connection-log.ts';
import { methodOf } from './frame-queue.ts';

/** The largest liveness hello taken ahead of the queue: the pre-auth limit, far above a real one. */
const PROBE_MAX_CHARS = 64 * 1024;

/**
 * An authenticated client's `hello` is its liveness probe and costs nothing
 * here: it is answered ahead of the connection's queue, since queued behind
 * that client's own slow calls it reads as a dead socket and makes the client
 * drop a working connection. The frame is parsed, since the cheap match alone
 * could take a `method` key inside the params.
 */
export function isLivenessHello(raw: string): boolean {
  if (raw.length > PROBE_MAX_CHARS || methodOf(raw) !== 'hello') return false;
  try {
    const frame = JSON.parse(raw) as { method?: unknown } | null;
    return frame !== null && typeof frame === 'object' && frame.method === 'hello';
  } catch {
    return false;
  }
}

/** Answers a frame the queue refused without running it, under the frame's own id. */
export function refuseFrame(connection: ServerConnection, raw: string, message: string): void {
  let id: number | string = 0;
  try {
    const frame = JSON.parse(raw) as { id?: unknown } | null;
    if (typeof frame?.id === 'number' || typeof frame?.id === 'string') id = frame.id;
  } catch { /* an unreadable frame gets id 0, as its parse error would */ }
  connection.sendResponse({ jsonrpc: '2.0', id, error: { code: RpcErrorCode.Unavailable, message } });
}

/** `signal` aborts when the connection closes before the answer; the hello path has none. */
export async function handleFrame(core: Core, connection: ServerConnection, raw: string, signal?: AbortSignal): Promise<void> {
  let frame: { id?: unknown; method?: unknown; params?: unknown; progress?: unknown };
  try {
    frame = JSON.parse(raw) as { id?: unknown; method?: unknown; params?: unknown; progress?: unknown };
    if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('expected an RPC object');
  } catch {
    connection.sendResponse({
      jsonrpc: '2.0',
      id: 0,
      error: { code: RpcErrorCode.ParseError, message: 'the frame is not JSON' },
    });
    return;
  }

  const id = typeof frame.id === 'number' || typeof frame.id === 'string' ? frame.id : 0;
  const method = typeof frame.method === 'string' ? frame.method : '';

  if (!connection.authenticated) {
    await hello(core, connection, id, method, frame.params);
    return;
  }

  if (method === 'hello') {
    connection.sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        core: core.info(),
        principal: connection.identity.principal,
        ...(connection.identity.threadId === null ? {} : { threadId: connection.identity.threadId }),
      },
    });
    return;
  }

  const startedAt = performance.now();
  try {
    // A synchronous read must leave before the next frame in the pump can
    // change the state and deliver its event ahead of this snapshot.
    const reply = core.router.dispatch(method, frame.params, { connection, ...(signal ? { signal } : {}) });
    const result = reply instanceof Promise ? await reply : reply;
    logRpcTiming(core, connection, method, String(id), performance.now() - startedAt, null);
    // A client that counts what it receives gets a long answer in slices it can count.
    connection.sendResponse({ jsonrpc: '2.0', id, result }, frame.progress === true);
  } catch (error) {
    if (error instanceof RpcFailure) {
      logRpcTiming(core, connection, method, String(id), performance.now() - startedAt, error);
      connection.sendResponse({ jsonrpc: '2.0', id, error: error.toError() });
      return;
    }
    // An unexpected throw is a bug here, not something the user can act on.
    // SQLite sentences, absolute paths and stack fragments used to reach the
    // screen verbatim. The cause stays in the log, the client gets a sentence.
    // Persistent diagnostics bypass core.log here: that event also raises a UI
    // error toast and would replace the deliberately generic RPC failure.
    const causes: string[] = [];
    let cause: unknown = error;
    const seen = new Set<unknown>();
    while (cause !== undefined && cause !== null && !seen.has(cause) && causes.length < 4) {
      seen.add(cause);
      causes.push(logMessageOf(cause));
      cause = cause instanceof Error ? cause.cause : undefined;
    }
    const named = clientField(method, 100, '(none)');
    core.logs.record('error', `${named} failed: ${causes.join('; caused by: ')}`, {
      source: 'rpc', event: 'rpc.failed', requestId: String(id), durationMs: performance.now() - startedAt, data: { method: named, principal: connection.identity.principal },
      ...(connection.identity.threadId === null ? {} : { threadId: connection.identity.threadId }),
    });
    connection.sendResponse({
      jsonrpc: '2.0',
      id,
      error: { code: RpcErrorCode.Internal, message: 'Something went wrong. Try again.' },
    });
  }
}
