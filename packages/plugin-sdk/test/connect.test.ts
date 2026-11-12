import { afterEach, describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION as CORE_PROTOCOL_VERSION, RPC_PATH as CORE_RPC_PATH } from '@boite/contracts';
import { connect, dispatch, PROTOCOL_VERSION, RPC_PATH, RpcError, socketUrl } from '../src/index.ts';

type Frame = { jsonrpc: string; id?: number; method: string; params?: unknown };

/** A core that answers `hello`, `threads.list` and refuses the rest, as the real one refuses a method the plugin lacks. */
function fakeCore(options: { protocolVersion?: number; bigTitle?: number; eventBeforeList?: boolean } = {}) {
  const frames: Frame[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, srv) {
      if (new URL(request.url).pathname !== RPC_PATH) return new Response('not found', { status: 404 });
      return srv.upgrade(request) ? undefined : new Response('upgrade failed', { status: 400 });
    },
    websocket: {
      perMessageDeflate: true,
      message(ws, raw) {
        const frame = JSON.parse(String(raw)) as Frame;
        frames.push(frame);
        const answer = (body: object) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...body }));
        if (frame.method === 'hello') {
          const token = (frame.params as { token?: string }).token;
          if (token !== 'tok') { answer({ error: { code: -32001, message: 'unknown token' } }); ws.close(4001, 'unauthorized'); return; }
          answer({ result: { core: { version: 'test', protocolVersion: options.protocolVersion ?? 2 }, principal: 'plugin' } });
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'thread.created', params: { id: 'thr_new' } }));
          return;
        }
        if (frame.method === 'plugins.settings.get') {
          // As the core sends it: another plugin's change first (only an owner token hears those), then this one's.
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'plugin.settings.changed', params: { id: 'other', values: { tone: 'loud' } } }));
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'plugin.settings.changed', params: { id: 'standup', values: { tone: 'short' } } }));
          answer({ result: { tone: 'short' } });
          return;
        }
        if (frame.method === 'threads.list') {
          if (options.eventBeforeList) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'thread.created', params: { id: 'thr_event' } }));
          answer({ result: [{ id: 'thr_1', title: 'x'.repeat(options.bigTitle ?? 1) }] });
          return;
        }
        answer({ error: { code: -32010, message: `${frame.method} needs the plugin permission threads.write; the plugin declared threads.read`, data: { method: frame.method } } });
      },
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, frames, stop: () => server.stop(true) };
}

let core: ReturnType<typeof fakeCore> | null = null;
/** The message a promise rejects with; no promise matcher, which `bun test` resolves a tick late. */
const failure = (promise: Promise<unknown>) => promise.then(() => 'resolved', (error: unknown) => String((error as Error).message));
afterEach(() => { core?.stop(); core = null; });

describe('connect', () => {
  test('the constants are the contracts\' own', () => {
    expect(PROTOCOL_VERSION).toBe(CORE_PROTOCOL_VERSION);
    expect(RPC_PATH).toBe(CORE_RPC_PATH);
    expect(socketUrl('http://127.0.0.1:3773/')).toBe('ws://127.0.0.1:3773/rpc');
    expect(socketUrl('https://boite.example/rpc')).toBe('wss://boite.example/rpc');
  });

  test('says hello as a plugin with the env token, then calls and hears events', async () => {
    core = fakeCore();
    const heard: unknown[] = [];
    const client = await connect({ env: { BOITE_CORE_URL: core.url, BOITE_TOKEN: 'tok' }, version: '1.2.3' });
    client.on('thread.created', payload => heard.push(payload));
    expect(client.principal).toBe('plugin');
    expect(core.frames[0]).toEqual({
      jsonrpc: '2.0', id: 1, method: 'hello',
      params: { token: 'tok', protocolVersion: 2, client: { name: 'plugin', version: '1.2.3' } },
    });
    const threads = await client.call('threads.list', {});
    expect(threads.map(thread => thread.id)).toEqual(['thr_1']);
    expect(core.frames[1]).toEqual({ jsonrpc: '2.0', id: 2, method: 'threads.list', params: {} });
    client.close();
    await client.closed;
  });

  test('reads a large answer split over many frames and reads', async () => {
    core = fakeCore({ bigTitle: 300_000 });
    const client = await connect({ url: core.url, token: 'tok' });
    const [thread] = await client.call('threads.list', {});
    expect(thread!.title.length).toBe(300_000);
    client.close();
  });

  test('a refused call rejects with the core\'s message and code', async () => {
    core = fakeCore();
    const client = await connect({ url: core.url, token: 'tok' });
    const error = await client.call('turns.stop', { threadId: 'thr_1' } as never).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toBe('turns.stop needs the plugin permission threads.write; the plugin declared threads.read');
    expect((error as RpcError).code).toBe(-32010);
    client.close();
  });

  test('a wrong token rejects the hello with the core\'s message', async () => {
    core = fakeCore();
    expect(await failure(connect({ url: core.url, token: 'bad' }))).toContain('unknown token');
  });

  test('a handler that throws skips no other handler and leaves the socket working', async () => {
    core = fakeCore({ eventBeforeList: true });
    const client = await connect({ url: core.url, token: 'tok' });
    const heard: unknown[] = [];
    const logged: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => { logged.push(args[0]); };
    try {
      client.on('thread.created', () => { throw new Error('handler bug'); });
      client.on('thread.created', payload => heard.push(payload));
      await client.call('threads.list', {});
      expect(heard).toEqual([{ id: 'thr_event' }]);
      expect(logged).toEqual(['boite plugin: a thread.created handler threw:']);
      expect((await client.call('threads.list', {})).length).toBe(1);
    } finally {
      console.error = error;
      client.close();
    }
  });

  test('settings() reads the plugin\'s own id and onSettingsChanged hears only its own changes', async () => {
    core = fakeCore();
    const client = await connect({ env: { BOITE_CORE_URL: core.url, BOITE_TOKEN: 'tok', BOITE_PLUGIN_ID: 'standup' } });
    const heard: unknown[] = [];
    const stop = client.onSettingsChanged(values => heard.push(values));
    expect(await client.settings()).toEqual({ tone: 'short' });
    expect(core.frames[1]).toEqual({ jsonrpc: '2.0', id: 2, method: 'plugins.settings.get', params: { id: 'standup' } });
    expect(heard).toEqual([{ tone: 'short' }]);
    stop();
    await client.settings();
    expect(heard).toHaveLength(1);
    client.close();
  });

  test('settings() outside a plugin\'s process says which id is missing', async () => {
    core = fakeCore();
    const client = await connect({ url: core.url, token: 'tok', env: {} });
    expect(await failure(client.settings())).toContain('BOITE_PLUGIN_ID is not set');
    client.close();
  });

  test('another protocol version is refused by name', async () => {
    core = fakeCore({ protocolVersion: 3 });
    expect(await failure(connect({ url: core.url, token: 'tok' }))).toContain('the core speaks protocol 3, this SDK 2');
  });

  test('ctx.connect opens one client and dispatch closes it', async () => {
    core = fakeCore();
    let closed: Promise<{ code: number; reason: string }> | undefined;
    const code = await dispatch({
      list: async (_args, ctx) => {
        const client = await ctx.connect();
        expect(await ctx.connect()).toBe(client);
        closed = client.closed;
        return (await client.call('threads.list', {})).length;
      },
    }, { argv: ['list'], env: { BOITE_CORE_URL: core.url, BOITE_TOKEN: 'tok' } });
    expect(code).toBe(1);
    expect(await closed).toEqual({ code: 1000, reason: '' });
    expect(core.frames.filter(frame => frame.method === 'hello')).toHaveLength(1);
  });
});
