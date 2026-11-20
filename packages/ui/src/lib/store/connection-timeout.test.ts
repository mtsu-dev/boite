import { expect, test, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { PROTOCOL_VERSION, RpcCloseCode, RpcErrorCode, deviceRevokedInput } from '@boite/contracts';
import type { SocketLike } from '../client';
import { dropDeviceKey, heldDeviceKey } from '../device-key';
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

test('an older tab reconnects with the replacement key after a delayed revocation close', async () => {
  const url = 'https://paired.example';
  const { privateKey, publicKey: key } = generateKeyPairSync('ed25519');
  const publicKey = key.export({ type: 'spki', format: 'pem' }).toString();
  const coreId = createHash('sha256').update(publicKey).digest('hex');
  let revoked: string | null = null;
  const sockets: PairingSocket[] = [];
  class PairingSocket implements SocketLike {
    onopen: SocketLike['onopen'] = null;
    onmessage: SocketLike['onmessage'] = null;
    onclose: SocketLike['onclose'] = null;
    onerror: SocketLike['onerror'] = null;
    helloDeviceId: string | null = null;
    constructor() {
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(raw: string): void {
      const { id, method, params } = JSON.parse(raw);
      if (method === 'hello') this.helloDeviceId = params.device?.id ?? null;
      if (method === 'hello' && revoked !== null && this.helloDeviceId === revoked) {
        const sig = sign(null, Buffer.from(deviceRevokedInput(coreId, params.device.nonce, revoked)), privateKey).toString('base64');
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({
          id, error: { code: RpcErrorCode.Unauthorized, message: 'Device removed', data: { reason: 'device-revoked', publicKey, sig } },
        }) }));
        return;
      }
      const answer = method === 'hello'
        ? { result: { core: { protocolVersion: PROTOCOL_VERSION, coreId }, principal: 'session', ...(params.grant ? { device: 'admitted' } : {}) } }
        : { error: { code: RpcErrorCode.NotFound, message: `${method} is not in this fixture` } };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, ...answer }) }));
    }
    close(): void { this.onclose?.({ code: 1000 }); }
  }
  vi.stubGlobal('WebSocket', PairingSocket);
  const first = new Store();
  const second = new Store();
  try {
    await first.connectEndpoint({ url, token: '', grant: 'original' }, true);
    await second.connectEndpoint({ url, token: '', paired: true, signs: coreId }, true);
    const old = heldDeviceKey()!.id;
    const late = sockets[1]!;
    expect(late.helloDeviceId).toBe(old);
    revoked = old;
    sockets[0]!.onclose?.({ code: RpcCloseCode.DeviceRevoked });
    await vi.waitFor(() => expect(first.pairingRequired).toBe(true), { timeout: 5_000 });
    await first.connectEndpoint({ url, token: '', grant: 'replacement' }, true);
    const replacement = heldDeviceKey()!.id;
    expect(replacement).not.toBe(old);
    late.onclose?.({ code: RpcCloseCode.DeviceRevoked });
    await vi.waitFor(() => {
      expect(second.connection).toBe('ready');
      expect(sockets.at(-1)?.helloDeviceId).toBe(replacement);
    }, { timeout: 5_000 });
    expect(heldDeviceKey()?.id).toBe(replacement);
    expect(second.pairingRequired).toBe(false);
  } finally {
    for (const store of [first, second]) { store.client?.close(); store.detach(); }
    const key = heldDeviceKey();
    if (key !== null) dropDeviceKey(key.id);
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
