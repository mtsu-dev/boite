import type { HttpServer, ManagedServer } from './registry.ts';
import { STDOUT_LINE_MAX } from '../drivers/lines.ts';

type ManagedHttp = ManagedServer & HttpServer;
const PROTOCOL_HEADERS = ['mcp-protocol-version', 'last-event-id'] as const;
const DEADLINE_MS = 60_000;

/** Only the registered server's configured headers can reach its upstream. */
export function mcpFetch(server: HttpServer, method: string, headers: Headers, signal: AbortSignal, body?: string): Promise<Response> {
  const outgoing = new Headers(server.headers);
  for (const key of PROTOCOL_HEADERS) {
    const val = headers.get(key);
    if (val !== null) outgoing.set(key, val);
  }
  const session = headers.get('mcp-session-id');
  if (session !== null) outgoing.set('mcp-session-id', session);
  outgoing.set('accept', method === 'GET' ? 'text/event-stream' : 'application/json, text/event-stream');
  if (body !== undefined) outgoing.set('content-type', 'application/json');
  return fetch(server.url, { method, headers: outgoing, signal, body, redirect: 'error' });
}

export function redactMcp<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(item => redactMcp(item, redact)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactMcp(item, redact)])) as T;
}

function redactWire(text: string, redact: (text: string) => string): string {
  try { return JSON.stringify(redactMcp(JSON.parse(text) as unknown, redact)); }
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

function redactEvent(event: string, redact: (text: string) => string): string {
  const lines = event.split('\n');
  const value = mcpEventData(event);
  if (value === undefined) return lines.map(redact).join('\n');
  const safe = redactWire(value, redact).split('\n').map(line => `data: ${line}`);
  let emitted = false;
  return lines.flatMap(line => {
    if (!isDataLine(line)) return [redact(line)];
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

export class HttpMcpProxy {
  readonly #abort = new AbortController();
  readonly #sessions = new Map<string, string>();

  constructor(readonly server: ManagedHttp) {}

  async handle(request: Request): Promise<Response> {
    const method = request.method;
    if (!['GET', 'POST', 'DELETE'].includes(method)) return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST, DELETE' } });
    const id = request.headers.get('mcp-session-id');
    const upstreamId = id === null ? undefined : this.#sessions.get(id);
    if (id !== null && upstreamId === undefined) return new Response('unknown or ended MCP session', { status: 404 });
    const headers = new Headers(request.headers);
    if (upstreamId !== undefined) headers.set('mcp-session-id', upstreamId);
    const signal = AbortSignal.any([this.#abort.signal, request.signal, ...(method === 'GET' ? [] : [AbortSignal.timeout(DEADLINE_MS)])]);
    try {
      const body = method === 'POST' ? await readMcpBody(request) : undefined;
      const response = await mcpFetch(this.server, method, headers, signal, body);
      if (method === 'DELETE' && id !== null && response.ok) this.#sessions.delete(id);
      const next = new Headers();
      const nextId = response.headers.get('mcp-session-id');
      if (nextId !== null && response.ok && method === 'POST') {
        const localId = id ?? crypto.randomUUID();
        this.#sessions.set(localId, nextId);
        next.set('mcp-session-id', localId);
      }
      if (!response.ok) {
        await response.body?.cancel();
        return upstreamError(response.status);
      }
      if (response.body === null || method === 'DELETE' || response.status === 202 || response.status === 204) {
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: next });
      }
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream')) {
        next.set('content-type', 'text/event-stream');
        next.set('cache-control', 'no-cache');
        const body = readMcpEvents(response.body).pipeThrough(new TransformStream<string, string>({
          transform: (event, controller) => controller.enqueue(redactEvent(event, this.server.redact) + '\n\n'),
        })).pipeThrough(new TextEncoderStream());
        return new Response(body, { status: response.status, headers: next });
      }
      if (type.includes('application/json')) {
        next.set('content-type', 'application/json');
        return new Response(redactWire(await readMcpBody(response), this.server.redact), { status: response.status, headers: next });
      }
      await response.body.cancel();
      return new Response('The upstream MCP server returned an unsupported content type', { status: 502 });
    } catch {
      return new Response('Could not reach the upstream MCP server', { status: 502 });
    }
  }

  close(endRemote = true): void {
    this.#abort.abort();
    if (endRemote) for (const session of this.#sessions.values()) closeHttpMcp(this.server, new Headers({ 'mcp-session-id': session }));
    this.#sessions.clear();
  }
}

export function closeHttpMcp(server: HttpServer, headers: Headers): void {
  void mcpFetch(server, 'DELETE', headers, AbortSignal.timeout(1000)).then(response => response.body?.cancel()).catch(() => undefined);
}
