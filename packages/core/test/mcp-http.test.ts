import { expect, spyOn, test } from 'bun:test';
import { HttpMcpProxy, mcpFetch } from '../src/mcp/http.ts';
import { managedStdioLaunch } from '../src/mcp/stdio.ts';
import { waitFor } from './harness.ts';
import { thrown } from './settle.ts';

function upstream(url: string) {
  return { id: 'fixture', url, headers: { Authorization: 'fixture-credential' }, hasSecretHeaders: true, redact: (value: string) => value };
}

test('a previously saved plain remote HTTP entry cannot send its credentials', async () => {
  const fetch = spyOn(globalThis, 'fetch');
  try {
    for (const url of ['http://example.test/mcp', 'https://']) {
      expect(await thrown(mcpFetch(upstream(url), 'POST', new Headers(), new AbortController().signal))).toThrow('HTTPS');
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});

test('HTTP sessions retain the negotiated protocol and expire after a remote 404', async () => {
  const seen: { method: string; protocol: string | null }[] = [];
  const protocol = '2025-11-25';
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'DELETE') {
      seen.push({ method: 'DELETE', protocol: request.headers.get('mcp-protocol-version') });
      return new Response(null, { status: 204 });
    }
    const { method } = await request.json() as { method: string };
    seen.push({ method, protocol: request.headers.get('mcp-protocol-version') });
    if (method === 'initialize') return Response.json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: protocol } }, {
      headers: { 'mcp-session-id': 'remote-session' },
    });
    return new Response(null, { status: 404 });
  } });
  const proxy = new HttpMcpProxy(upstream(server.url.href));
  const post = (method: string, session?: string) => proxy.handle(new Request('http://localhost/mcp', {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }), headers: session ? { 'mcp-session-id': session } : {},
  }));
  try {
    const first = await post('initialize');
    const id = first.headers.get('mcp-session-id')!;
    expect(id).toBeTruthy();
    await first.text();
    expect((await post('ping', id)).status).toBe(404);
    expect((await post('ping', id)).status).toBe(404);
    expect(seen).toEqual([{ method: 'initialize', protocol: null }, { method: 'ping', protocol }]);
    await (await post('initialize')).text();
    proxy.close();
    await waitFor(() => seen.length === 4);
    expect(seen.at(-1)).toEqual({ method: 'DELETE', protocol });
  } finally { proxy.close(); await server.stop(true); }
});

test('POST event streams can run past the idle limit with activity and end when silent', async () => {
  const encoder = new TextEncoder();
  let silentCancelled = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const silent = new URL(request.url).pathname === '/silent';
    let timer: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': start\n\n'));
        if (silent) return;
        let count = 0;
        timer = setInterval(() => {
          controller.enqueue(encoder.encode(': progress\n\n'));
          if (++count === 5) {
            clearInterval(timer);
            controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'));
            controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":2,"result":{}}'));
            controller.close();
          }
        }, 75);
      },
      cancel() {
        clearInterval(timer);
        if (silent) silentCancelled = true;
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const active = new HttpMcpProxy(upstream(server.url.href), 250);
  const silent = new HttpMcpProxy(upstream(new URL('/silent', server.url).href), 250);
  const request = () => new Request('http://localhost/mcp', { method: 'POST', body: '{}' });
  try {
    const content = await (await active.handle(request())).text();
    expect(content).toContain('"id":1,"result":{}');
    expect(content).not.toContain('"id":2');
    expect(await thrown((await silent.handle(request())).text())).toThrow();
    await waitFor(() => silentCancelled);
  } finally { active.close(); silent.close(); await server.stop(true); }
});

test('POST stalled before upstream headers returns 504 instead of 502', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new Promise<Response>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  } });
  const proxy = new HttpMcpProxy(upstream(server.url.href), 120);
  try {
    const response = await proxy.handle(new Request('http://localhost/mcp', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(504);
    expect(await response.text()).toContain('timed out');
  } finally { proxy.close(); await server.stop(true); }
});

test('managed stdio inherits platform paths and proxy settings but excludes arbitrary core credentials', () => {
  const key = 'MCP_TEST_CORE_API_TOKEN';
  const previous = { HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY, NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY };
  process.env[key] = 'test-only';
  process.env.HTTPS_PROXY = 'http://proxy.internal:8080';
  process.env.NO_PROXY = 'localhost,127.0.0.1';
  process.env.NPM_CONFIG_REGISTRY = 'https://registry.internal';
  try {
    const { env } = managedStdioLaunch({ command: process.execPath, args: [], env: { SERVER_TOKEN: 'configured' } });
    expect(Object.keys(env).some(name => name.toUpperCase() === 'PATH')).toBe(true);
    expect(Object.keys(env).some(name => /^BOITE_/i.test(name))).toBe(false);
    expect(env[key]).toBeUndefined();
    expect(env.HTTPS_PROXY).toBe('http://proxy.internal:8080');
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1');
    expect(env.NPM_CONFIG_REGISTRY).toBe('https://registry.internal');
    expect(env.SERVER_TOKEN).toBe('configured');
  } finally {
    delete process.env[key];
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
