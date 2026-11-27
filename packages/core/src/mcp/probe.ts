import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpProbeResult, McpServer } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf } from '../errors.ts';
import { LineSplitter, STDOUT_LINE_MAX } from '../drivers/lines.ts';
import { closeHttpMcp, mcpEventData, mcpFetch, readMcpBody, readMcpEvents, redactMcp } from './http.ts';
import type { HttpServer, ManagedServer } from './registry.ts';
import type { StdioServer } from './lazy.ts';
import { managedStdioLaunch } from './stdio.ts';

const PROBE_TIMEOUT_MS = 12_000;
const PROTOCOL_VERSION = '2025-11-25';
const STDERR_TAIL = 2_000;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resultOf(value: unknown, id: number): Record<string, unknown> | undefined {
  const response = object(value);
  if (response.id !== id) return undefined;
  if (response.error !== undefined) {
    const error = object(response.error);
    throw new Error(typeof error.message === 'string' ? error.message : 'The MCP server rejected the request');
  }
  if (response.result === undefined) throw new Error('The MCP server returned no result');
  return object(response.result);
}

type Send = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Probed = Omit<McpProbeResult, 'ok' | 'latencyMs' | 'error'>;

async function handshake(send: Send): Promise<Probed> {
  const init = await send('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Boite', version: '1' } });
  if (typeof init.protocolVersion !== 'string') throw new Error('The MCP server returned no protocol version');
  await send('notifications/initialized');
  const { tools } = await send('tools/list', {});
  if (!Array.isArray(tools)) throw new Error('The MCP server returned no tool list');
  const info = object(init.serverInfo);
  return {
    ...(typeof info.name === 'string' ? { serverName: info.name } : {}),
    ...(typeof info.version === 'string' ? { serverVersion: info.version } : {}),
    tools: tools.slice(0, 250).flatMap(item => {
      const tool = object(item);
      return typeof tool.name === 'string' ? [{ name: tool.name, ...(typeof tool.description === 'string' ? { description: tool.description } : {}) }] : [];
    }),
  };
}

async function probeStdio(core: Core, server: StdioServer, cwd: string, signal: AbortSignal): Promise<Probed> {
  signal.throwIfAborted();
  const { command, args, env } = managedStdioLaunch(server);
  const child = core.procs.spawnChild('mcp-probe:' + crypto.randomUUID(), command, args, {
    cwd, env, agentRoot: false,
  });
  let id = 0;
  let stderr = '';
  let pending: { id: number; resolve: (data: Record<string, unknown>) => void; reject: (reason: unknown) => void } | undefined;
  let fault: Error | undefined;
  const fail = (error: Error): void => { fault ??= error; pending?.reject(error); };
  const abort = (): void => fail(signal.reason);
  const lines = new LineSplitter(line => {
    const request = pending;
    if (!request) return;
    let message: unknown;
    try { message = JSON.parse(line); } catch { return; }
    try {
      const result = resultOf(message, request.id);
      if (result !== undefined) request.resolve(result);
    } catch (error) { request.reject(error); }
  }, { maxLine: STDOUT_LINE_MAX, onOverflow: () => fail(new Error('The MCP server wrote an oversized response')) });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => lines.feed(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_TAIL); });
  child.once('error', (error: Error) => fail(error));
  child.once('exit', () => {
    const detail = stderr.trim().slice(-500);
    fail(new Error(detail ? `The MCP server process exited before answering: ${detail}` : 'The MCP server process exited before answering'));
  });
  child.stdin.on('error', (error: Error) => fail(error));
  signal.addEventListener('abort', abort, { once: true });

  try {
    return await handshake((method, params) => {
      if (fault) return Promise.reject(fault);
      if (method === 'notifications/initialized') {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
        return Promise.resolve({});
      }
      return new Promise((resolve, reject) => {
        pending = { id: ++id, resolve, reject };
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    });
  } finally {
    signal.removeEventListener('abort', abort);
    child.stdin.end();
    await core.procs.stopChild(child);
  }
}

async function httpResult(response: Response, id: number): Promise<Record<string, unknown>> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    const result = resultOf(JSON.parse(await readMcpBody(response)), id);
    if (result !== undefined) return result;
  } else if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
    const reader = readMcpEvents(response.body).getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const data = mcpEventData(next.value);
        if (!data) continue;
        const result = resultOf(JSON.parse(data), id);
        if (result !== undefined) return result;
      }
    } finally { await reader.cancel().catch(() => undefined); }
  } else await response.body?.cancel();
  throw new Error('The MCP server returned no JSON-RPC answer');
}

async function probeHttp(server: HttpServer, signal: AbortSignal, revoked: AbortSignal): Promise<Probed> {
  const headers = new Headers();
  let id = 0;
  try {
    return await handshake(async (method, params) => {
      signal.throwIfAborted();
      const requestId = method.startsWith('notifications/') ? undefined : ++id;
      const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
      const response = await mcpFetch(server, 'POST', headers, signal, body);
      if (!response.ok || requestId === undefined) await response.body?.cancel();
      if (!response.ok) throw new Error(`The MCP server returned HTTP ${response.status}`);
      if (requestId === undefined) return {};
      const session = response.headers.get('mcp-session-id');
      if (session !== null) headers.set('mcp-session-id', session);
      const result = await httpResult(response, requestId);
      if (method === 'initialize' && typeof result.protocolVersion === 'string') headers.set('mcp-protocol-version', result.protocolVersion);
      return result;
    });
  } finally {
    if (!revoked.aborted && headers.has('mcp-session-id')) closeHttpMcp(server, headers);
  }
}

export async function probeMcp(core: Core, definition: McpServer, revoked: AbortSignal, caller?: AbortSignal): Promise<McpProbeResult> {
  const started = performance.now();
  const deadline = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const signal = AbortSignal.any(caller ? [revoked, deadline, caller] : [revoked, deadline]);
  let server: ManagedServer | undefined;
  let scratch: string | undefined;
  try {
    signal.throwIfAborted();
    server = core.mcp.runtime(definition);
    const scoped = definition.projectIds.map(id => core.journal.getProject(id)?.path).find(path => path !== undefined);
    const cwd = 'url' in server ? '' : scoped ?? (scratch = mkdtempSync(join(tmpdir(), 'boite-mcp-probe-')));
    const details = await ('url' in server ? probeHttp(server, signal, revoked) : probeStdio(core, server, cwd, signal));
    signal.throwIfAborted();
    return { ...redactMcp(details, server.redact), ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    const reason = revoked.aborted ? messageOf(revoked.reason)
      : deadline.aborted ? 'The MCP server did not answer before the test deadline' : messageOf(error);
    return { ok: false, error: (server?.redact(reason) ?? reason).slice(0, 700), tools: [], latencyMs: Math.round(performance.now() - started) };
  } finally {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  }
}
