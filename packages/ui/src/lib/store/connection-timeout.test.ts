import { expect, test, vi } from 'vitest';
import { PROTOCOL_VERSION, RpcErrorCode } from '@boite/contracts';
import { Store } from '../store.svelte';
import { strings } from '../strings';

// A first handshake allowed longer than the store's own 12 s wait, as on a slow link: the wait gives up first.
vi.mock('../ws-client-utils', async (original) => ({ ...(await original<typeof import('../ws-client-utils')>()), openDeadline: () => 30_000 }));

test('a remembered machine whose handshake outlasts the 12 s wait says so, keeps trying, and connects once its socket answers', async () => {
  vi.useFakeTimers();
  let answering = false;
  const held: (() => void)[] = [];
  const sockets: SlowSocket[] = [];
  class SlowSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event?: { code?: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    closedByClient = false;
    constructor() {
      sockets.push(this);
      setTimeout(() => this.onopen?.(), 10);
    }
    send(raw: string): void {
      const frame = JSON.parse(raw) as { id: number; method: string };
      const answer = (body: Record<string, unknown>) => () => {
        if (!this.closedByClient) this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...body }) });
      };
      if (frame.method === 'hello') {
        // The machine is not up yet: its hello is answered once it is.
        const reply = answer({ result: { core: { protocolVersion: PROTOCOL_VERSION }, principal: 'owner' } });
        if (answering) setTimeout(reply, 5);
        else held.push(reply);
      } else setTimeout(answer({ error: { code: RpcErrorCode.NotFound, message: `${frame.method} is not in this fixture` } }), 1000);
    }
    close(): void {
      this.closedByClient = true;
      this.onclose?.({ code: 1000 });
    }
  }
  vi.stubGlobal('WebSocket', SlowSocket);
  const store = new Store();
  try {
    let returned = false;
    const connecting = store.connectEndpoint({ url: 'https://far.example', token: 'key', paired: true }).then(() => { returned = true; });
    await vi.advanceTimersByTimeAsync(12_100);
    // The caller is not held past the wait, and the screen says the machine did not answer.
    expect(returned).toBe(true);
    expect(store.error).toBe(strings.machines.timeout);
    expect(store.connection).not.toBe('ready');
    // The machine comes up three seconds later: the socket still open answers, and nobody had to reconnect by hand.
    answering = true;
    for (const reply of held.splice(0)) reply();
    // Read before the lists this fixture does not serve answer: the hello alone connects it and clears the message.
    await vi.advanceTimersByTimeAsync(6);
    await connecting;
    expect(store.connection).toBe('ready');
    expect(store.error).toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(store.connection).toBe('ready');
    expect(store.error).not.toBe(strings.machines.timeout);
  } finally {
    store.client?.close();
    store.detach();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
