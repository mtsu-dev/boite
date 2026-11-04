import type {
  CoreInfo,
  PROTOCOL_VERSION as CORE_PROTOCOL_VERSION,
  Principal,
  RPC_PATH as CORE_RPC_PATH,
  RpcEventName,
  RpcEvents,
  RpcMethodName,
  RpcMethods,
} from '@boite/contracts';
import { TextSocket } from './socket.ts';

/*
 * The plugin's side of the core's JSON-RPC 2.0 socket. Types come from
 * `@boite/contracts`, values do not: a bundled plugin carries this file and
 * the socket, nothing of the contracts' code. The two constants below are
 * typed as the contracts' own, so a protocol change fails the SDK's typecheck.
 */

export const PROTOCOL_VERSION: typeof CORE_PROTOCOL_VERSION = 2;
export const RPC_PATH: typeof CORE_RPC_PATH = '/rpc';
export const SDK_VERSION = '0.1.0';

export type RpcParams<M extends RpcMethodName> = RpcMethods[M]['params'];
export type RpcResult<M extends RpcMethodName> = RpcMethods[M]['result'];

export interface ConnectOptions {
  /** The core's base URL. Default: `BOITE_CORE_URL`. */
  url?: string;
  /** The plugin's token. Default: `BOITE_TOKEN`. */
  token?: string;
  /** Sent in the `hello` as the client's version. Default: the SDK's version. */
  version?: string;
  /** How long opening the socket and the `hello` may take. Default 5 seconds. */
  timeoutMs?: number;
  /** How long a call waits for its answer. Default 2 minutes. */
  requestTimeoutMs?: number;
  /** Where the defaults are read. Default: `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface PluginClient {
  /** What the core said about itself in its `hello` answer. */
  readonly core: CoreInfo;
  /** `plugin` for a schema 2 plugin's token, `owner` for a schema 1 desktop app's. */
  readonly principal: Principal;
  call<M extends RpcMethodName>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  /** Listens to an event the plugin's permissions let it hear. Returns the function that stops listening. */
  on<E extends RpcEventName>(event: E, handler: (payload: RpcEvents[E]) => void): () => void;
  /** Resolves once the socket is closed, by either side. */
  readonly closed: Promise<{ code: number; reason: string }>;
  close(): void;
}

/** An error the core answered: its message, its JSON-RPC code and its data. */
export class RpcError extends Error {
  constructor(message: string, readonly code: number, readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The socket URL of a core base URL: `http://127.0.0.1:3773` becomes `ws://127.0.0.1:3773/rpc`. */
export function socketUrl(base: string): string {
  let url = base.trim().replace(/^http/, 'ws');
  while (url.endsWith('/')) url = url.slice(0, -1);
  return url.endsWith(RPC_PATH) ? url : url + RPC_PATH;
}

/**
 * Opens the core's socket with the plugin's token and says hello. Inside a
 * plugin's process the core sets `BOITE_CORE_URL` and `BOITE_TOKEN`; outside
 * one, pass `url` and `token`.
 */
export async function connect(options: ConnectOptions = {}): Promise<PluginClient> {
  const env = options.env ?? process.env;
  const base = options.url ?? env.BOITE_CORE_URL;
  const token = options.token ?? env.BOITE_TOKEN;
  if (!base) throw new Error('BOITE_CORE_URL is not set: Boite sets it in a plugin\'s processes; pass `url` to connect from elsewhere');
  if (!token) throw new Error('BOITE_TOKEN is not set: Boite sets it in a plugin\'s processes; pass `token` to connect from elsewhere');
  const timeoutMs = options.timeoutMs ?? 5000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;

  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let nextId = 1;
  let onClosed!: (event: { code: number; reason: string }) => void;
  const closed = new Promise<{ code: number; reason: string }>(resolve => { onClosed = resolve; });

  const socket = await TextSocket.connect(socketUrl(base), timeoutMs, {
    message(text) {
      let frame: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
      try { frame = JSON.parse(text) as typeof frame; } catch { return; }
      if (frame === null || typeof frame !== 'object') return;
      if (typeof frame.id === 'number') {
        const waiter = pending.get(frame.id);
        if (waiter === undefined) return;
        pending.delete(frame.id);
        clearTimeout(waiter.timer);
        if (frame.error !== undefined) {
          const { code, message, data } = frame.error;
          waiter.reject(new RpcError(typeof message === 'string' ? message : `${waiter.method} failed`, typeof code === 'number' ? code : 0, data));
        } else {
          waiter.resolve(frame.result);
        }
        return;
      }
      if (typeof frame.method !== 'string') return;
      for (const handler of listeners.get(frame.method) ?? []) handler(frame.params);
    },
    close(code, reason) {
      const error = new Error(`the core closed the socket (${code}${reason ? `: ${reason}` : ''})`);
      for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
      pending.clear();
      onClosed({ code, reason });
    },
  });

  const send = (method: string, params: unknown, waitMs: number): Promise<unknown> => new Promise((resolve, reject) => {
    if (!socket.open) { reject(new Error('the client is closed')); return; }
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timed out waiting for ${method}`)); }, waitMs);
    pending.set(id, { method, resolve, reject, timer });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });

  let hello: { core: CoreInfo; principal: Principal };
  try {
    hello = await send('hello', {
      token,
      protocolVersion: PROTOCOL_VERSION,
      client: { name: 'plugin', version: options.version ?? SDK_VERSION },
    }, timeoutMs) as typeof hello;
  } catch (error) {
    socket.close();
    throw error;
  }
  if (hello.core.protocolVersion !== PROTOCOL_VERSION) {
    socket.close();
    throw new Error(`the core speaks protocol ${String(hello.core.protocolVersion)}, this SDK ${PROTOCOL_VERSION}`);
  }

  return {
    core: hello.core,
    principal: hello.principal,
    closed,
    call: <M extends RpcMethodName>(method: M, params: RpcParams<M>) => send(method, params, requestTimeoutMs) as Promise<RpcResult<M>>,
    on<E extends RpcEventName>(event: E, handler: (payload: RpcEvents[E]) => void): () => void {
      let set = listeners.get(event);
      if (set === undefined) { set = new Set(); listeners.set(event, set); }
      const wrapped = (payload: unknown): void => handler(payload as RpcEvents[E]);
      set.add(wrapped);
      return () => { set.delete(wrapped); };
    },
    close: () => socket.close(),
  };
}
