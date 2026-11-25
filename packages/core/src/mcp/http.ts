import { mcpHttpAllowsSecretHeaders } from '@boite/contracts';
import type { HttpServer, ManagedServer } from './registry.ts';
import { STDOUT_LINE_MAX } from '../drivers/lines.ts';

type ManagedHttp = ManagedServer & HttpServer;
const PROTOCOL_HEADERS = ['mcp-protocol-version', 'last-event-id'] as const;
const IDLE_MS = 60_000;
const SESSION_ID = 'mcp-session-id';
const PROTOCOL_VERSION = 'mcp-protocol-version';

/** Only the registered server's configured headers can reach its upstream. */
export function mcpFetch(server: HttpServer, method: string, headers: Headers, signal: AbortSignal, body?: string): Promise<Response> {
  if (server.hasSecretHeaders && !mcpHttpAllowsSecretHeaders(server.url)) {
    return Promise.reject(new Error('The MCP URL must use HTTPS or loopback HTTP when sending secret headers'));
  }
  const outgoing = new Headers(server.headers);
  for (const key of PROTOCOL_HEADERS) {
    const val = headers.get(key);
    if (val !== null) outgoing.set(key, val);
  }
  const session = headers.get(SESSION_ID);
  if (session !== null) outgoing.set(SESSION_ID, session);
  outgoing.set('accept', method === 'GET' ? 'text/event-stream' : 'application/json, text/event-stream');
  if (body !== undefined) outgoing.set('content-type', 'application/json');
  return fetch(server.url, { method, headers: outgoing, signal, body, redirect: 'error' });
}

const MCP_PROTOCOL_KEYS = new Set([
  'jsonrpc', 'id', 'method', 'params', 'result', 'error', 'code', 'message', 'data',
  'protocolVersion', 'capabilities', 'serverInfo', 'instructions',
  'tools', 'resources', 'resourceTemplates', 'prompts', 'nextCursor',
  'name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations',
  'uri', 'uriTemplate', 'mimeType', 'arguments', 'required',
  'content', 'structuredContent', 'isError', 'type', 'text', 'blob', 'resource',
  'properties', 'items', 'additionalProperties', 'enum', 'default', '$schema',
  'version', 'listChanged', 'subscribe', 'logging', 'completions', 'experimental',
  'ok', 'latencyMs', 'serverName',
]);

export function redactMcp<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(item => redactMcp(item, redact)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    MCP_PROTOCOL_KEYS.has(key) ? key : redact(key),
    redactMcp(item, redact),
  ])) as T;
}

export function redactMcpMessage<T>(message: T, redact: (text: string) => string): T {
  if (Array.isArray(message)) return message.map(item => redactMcpMessage(item, redact)) as T;
  if (message === null || typeof message !== 'object') return redactMcp(message, redact);
  return Object.fromEntries(Object.entries(message).map(([key, value]) => [
    key, key === 'jsonrpc' || key === 'id' || key === 'method' ? value : redactMcp(value, redact),
  ])) as T;
}

function redactWire(text: string, redact: (text: string) => string, observe?: (message: unknown) => void): string {
  try {
    const message: unknown = JSON.parse(text);
    observe?.(message);
    return JSON.stringify(redactMcpMessage(message, redact));
  }
  catch { return redact(text); }
}

export async function readMcpBody(message: Request | Response): Promise<string> {
  if (message.body === null) return '';
  const reader = message.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > STDOUT_LINE_MAX) throw new Error('The MCP message exceeded 16 MiB');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

function isDataLine(line: string): boolean { return line === 'data' || line.startsWith('data:'); }

export function mcpEventData(event: string): string | undefined {
  const data = event.split('\n').filter(isDataLine);
  if (data.length === 0) return undefined;
  return data.map(line => line.slice(5).replace(/^ /, '')).join('\n');
}

function redactEvent(event: string, redact: (text: string) => string, observe?: (message: unknown) => void): string {
  const lines = event.split('\n');
  const value = mcpEventData(event);
  const control = (line: string): string => {
    const colon = line.indexOf(':');
    if (colon === -1) return line;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1);
    if (field === 'retry' || (field === 'event' && value.trim() === 'message')) return line;
    return field + ':' + redact(value);
  };
  if (value === undefined) return lines.map(control).join('\n');
  const safe = redactWire(value, redact, observe).split('\n').map(line => `data: ${line}`);
  let emitted = false;
  return lines.flatMap(line => {
    if (!isDataLine(line)) return [control(line)];
    if (emitted) return [];
    emitted = true;
    return safe;
  }).join('\n');
}

export function readMcpEvents(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  let rest = '';
  let trailingCr = false;
  const emit = (chunk: string, controller: TransformStreamDefaultController<string>): void => {
    rest += chunk.replace(/\r\n?/g, '\n');
    let boundary: number;
    while ((boundary = rest.indexOf('\n\n')) !== -1) {
      if (boundary > STDOUT_LINE_MAX) throw new Error('MCP event exceeded 16 MiB');
      controller.enqueue(rest.slice(0, boundary));
      rest = rest.slice(boundary + 2);
    }
    if (rest.length > STDOUT_LINE_MAX) throw new Error('MCP event exceeded 16 MiB');
  };
  return body.pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>).pipeThrough(new TransformStream<string, string>({
    transform(chunk, controller) {
      if (chunk.length === 0) return;
      const text = trailingCr && chunk.startsWith('\n') ? chunk.slice(1) : chunk;
      trailingCr = chunk.endsWith('\r');
      emit(text, controller);
    },
  }));
}

function upstreamError(status: number): Response {
  return new Response(`The upstream MCP server returned HTTP ${status}`, { status });
}

class IdleTimeout {
  readonly #controller = new AbortController();
  #timer?: ReturnType<typeof setTimeout>;
  get signal(): AbortSignal { return this.#controller.signal; }

  constructor(readonly ms: number) { this.touch(); }

  touch(): void {
    this.stop();
    this.#timer = setTimeout(() => this.#controller.abort(), this.ms);
    this.#timer.unref();
  }

  stop(): void { clearTimeout(this.#timer); }

  watch(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    return new ReadableStream({
      pull: async controller => {
        try {
          const chunk = await reader.read();
          if (chunk.done) { this.stop(); controller.close(); }
          else { this.touch(); controller.enqueue(chunk.value); }
        } catch (error) { this.stop(); controller.error(error); }
      },
      cancel: reason => { this.stop(); return reader.cancel(reason); },
    });
  }
}

interface HttpSession { upstreamId: string; protocol: string | null; abort: AbortController }

function initializedProtocol(message: unknown): string | undefined {
  const protocol = (message as { result?: { protocolVersion?: unknown } } | null)?.result?.protocolVersion;
  return typeof protocol === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(protocol) ? protocol : undefined;
}

export class HttpMcpProxy {
  readonly #abort = new AbortController();
  readonly #sessions = new Map<string, HttpSession>();

  constructor(readonly server: ManagedHttp, readonly idleMs = IDLE_MS) {}

  async handle(request: Request): Promise<Response> {
    const method = request.method;
    if (!['GET', 'POST', 'DELETE'].includes(method)) return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST, DELETE' } });
    const id = request.headers.get(SESSION_ID);
    const session = id === null ? undefined : this.#sessions.get(id);
    if (id !== null && session === undefined) return new Response('unknown or ended MCP session', { status: 404 });
    const headers = new Headers(request.headers);
    if (session !== undefined) {
      headers.set(SESSION_ID, session.upstreamId);
      const requested = headers.get(PROTOCOL_VERSION);
      session.protocol ??= requested;
      if (requested === null && session.protocol !== null) headers.set(PROTOCOL_VERSION, session.protocol);
    }
    const idle = method === 'GET' ? undefined : new IdleTimeout(this.idleMs);
    const signal = AbortSignal.any([this.#abort.signal, request.signal, ...(session ? [session.abort.signal] : []), ...(idle ? [idle.signal] : [])]);
    let streaming = false;
    try {
      const body = method === 'POST' ? await readMcpBody(request) : undefined;
      const response = await mcpFetch(this.server, method, headers, signal, body);
      idle?.touch();
      if (id !== null && session !== undefined && (response.status === 404 || method === 'DELETE' && response.ok)) {
        this.#sessions.delete(id);
        session.abort.abort();
      }
      const next = new Headers();
      const nextId = response.headers.get(SESSION_ID);
      let observe: ((message: unknown) => void) | undefined;
      if (nextId !== null && response.ok && method === 'POST' && !signal.aborted) {
        const localId = id ?? crypto.randomUUID();
        const opened = session ?? { upstreamId: nextId, protocol: response.headers.get(PROTOCOL_VERSION), abort: new AbortController() };
        opened.upstreamId = nextId;
        this.#sessions.set(localId, opened);
        next.set(SESSION_ID, localId);
        if (session === undefined) observe = message => { opened.protocol = initializedProtocol(message) ?? opened.protocol; };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return upstreamError(response.status);
      }
      if (response.body === null || method === 'DELETE' || response.status === 202 || response.status === 204) {
        await response.body?.cancel().catch(() => undefined);
        return new Response(null, { status: response.status, headers: next });
      }
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream')) {
        next.set('content-type', 'text/event-stream');
        next.set('cache-control', 'no-cache');
        const stream = readMcpEvents(idle?.watch(response.body) ?? response.body).pipeThrough(new TransformStream<string, string>({
          transform: (event, controller) => controller.enqueue(redactEvent(event, this.server.redact, observe) + '\n\n'),
        })).pipeThrough(new TextEncoderStream());
        const outgoing = new Response(stream, { status: response.status, headers: next });
        streaming = true;
        return outgoing;
      }
      if (type.includes('application/json')) {
        next.set('content-type', 'application/json');
        return new Response(redactWire(await readMcpBody(response), this.server.redact, observe), { status: response.status, headers: next });
      }
      await response.body.cancel();
      return new Response('The upstream MCP server returned an unsupported content type', { status: 502 });
    } catch {
      return new Response('Could not reach the upstream MCP server', { status: 502 });
    } finally { if (!streaming) idle?.stop(); }
  }

  close(endRemote = true): void {
    this.#abort.abort();
    if (endRemote) for (const { upstreamId, protocol } of this.#sessions.values()) {
      const headers = new Headers({ [SESSION_ID]: upstreamId });
      if (protocol !== null) headers.set(PROTOCOL_VERSION, protocol);
      closeHttpMcp(this.server, headers);
    }
    this.#sessions.clear();
  }
}

export function closeHttpMcp(server: HttpServer, headers: Headers): void {
  void mcpFetch(server, 'DELETE', headers, AbortSignal.timeout(1000)).then(response => response.body?.cancel()).catch(() => undefined);
}
