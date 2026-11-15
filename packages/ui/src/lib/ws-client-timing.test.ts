import { expect, test, vi } from 'vitest';
import { PROTOCOL_VERSION, type CoreInfo } from '@boite/contracts';
import { WsClient, type SocketLike } from './client';

/**
 * Reconnection timings on a fake clock, printed for the performance page:
 * the time from `resume()` back to ready after 30 s away on a dead socket, from
 * a ready socket's close to the first retry, and from the last frame of a link
 * that died silently to the client saying so. A handshake takes 100 ms: the
 * socket opens after 50 ms and the hello is answered 50 ms later.
 */
const CORE: CoreInfo = {
  version: '2.0.0', protocolVersion: PROTOCOL_VERSION, os: 'linux', channel: 'stable', pid: 1, startedAt: 0,
  endpoint: { host: 'core.test', port: 443 }, dataDir: '/data', trace: { os: 'linux', mode: 'events', note: 'exact' },
  features: { chunkedAnswers: true }
};

class CoreSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: SocketLike['onclose'] = null;
  onerror: (() => void) | null = null;
  /** A dead link: nothing it sends is answered. */
  dead = false;

  constructor() {
    setTimeout(() => this.onopen?.(), 50);
  }

  send(data: string): void {
    const { id, method } = JSON.parse(data) as { id: number; method: string };
    if (method !== 'hello' || this.dead) return;
    setTimeout(() => { if (!this.dead) this.onmessage?.({ data: JSON.stringify({ id, result: { core: CORE, principal: 'session' } }) }); }, 50);
  }

  close(): void {
    this.dead = true;
    const close = this.onclose;
    this.onclose = null;
    close?.({});
  }
}

function harness(): { client: WsClient; sockets: CoreSocket[]; made: number[]; ready: number[] } {
  const sockets: CoreSocket[] = [];
  const made: number[] = [];
  const ready: number[] = [];
  const client = new WsClient({
    url: 'https://core.test', token: 'secret',
    socketFactory: () => { const socket = new CoreSocket(); sockets.push(socket); made.push(Date.now()); return socket; }
  });
  client.onState((state) => { if (state === 'ready') ready.push(Date.now()); });
  return { client, sockets, made, ready };
}

test('reconnection timings on a fake clock', async () => {
  vi.useFakeTimers({ now: 0 });
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  try {
    // Back after 30 s hidden, the socket dead without a close.
    const away = harness();
    void away.client.connect();
    await vi.advanceTimersByTimeAsync(100);
    const old = away.sockets[0]!;
    old.dead = true;
    // Hidden, the page probes nothing: `resume()` asks on the way back.
    visibility.mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(30_000);
    visibility.mockReturnValue('visible');
    const resumedAt = Date.now();
    const answered = away.client.resume(30_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await answered;
    const resumeToReady = away.ready.at(-1)! - resumedAt;
    away.client.close();

    // A ready socket closes after a minute of use: when does the next one start?
    const loss = harness();
    void loss.client.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    // Kept alive: the probes are answered meanwhile.
    const lostAt = Date.now();
    loss.sockets.at(-1)!.close();
    await vi.advanceTimersByTimeAsync(5_000);
    const lossToRetry = loss.made.at(-1)! - lostAt;
    loss.client.close();

    // The link dies silently with the page in front: when does the client stop saying connected?
    const silent = harness();
    const states: [string, number][] = [];
    silent.client.onState((state) => states.push([state, Date.now()]));
    void silent.client.connect();
    await vi.advanceTimersByTimeAsync(100);
    silent.sockets[0]!.dead = true;
    const lastFrame = Date.now();
    await vi.advanceTimersByTimeAsync(60_000);
    const silenceToOffline = states.find(([state, at]) => state === 'connecting' && at > lastFrame)![1] - lastFrame;
    silent.client.close();

    console.log(`resume after 30 s hidden, dead socket -> ready: ${resumeToReady} ms`);
    console.log(`ready socket closed -> first retry: ${lossToRetry} ms`);
    console.log(`silent link, last frame -> offline: ${silenceToOffline} ms`);
    expect(resumeToReady).toBe(100);
    expect(lossToRetry).toBe(188);
    expect(silenceToOffline).toBe(22_000);
  } finally {
    random.mockRestore();
    visibility.mockRestore();
    vi.useRealTimers();
  }
});
