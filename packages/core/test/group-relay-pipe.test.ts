import { afterEach, expect, jest, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import { PROTOCOL_VERSION } from '@boite/contracts';
import type { Core } from '../src/core.ts';
import { TextSocket } from '../src/ws-client.ts';
import { RelayPipe, UPSTREAM_DEAD_MS, UPSTREAM_PING_MS, type RelayHub, type RelaySocketData } from '../src/group/relay.ts';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const servers: Bun.TCPSocketListener<unknown>[] = [];
afterEach(() => {
  jest.useRealTimers();
  for (const server of servers.splice(0)) server.stop(true);
});

/** A member that answers the upgrade, then says nothing again, pongs included: a path that went silent without closing. */
function silentMember(): { url: string; hello: Promise<void>; pings: () => number; ended: () => boolean } {
  let pings = 0, ended = false;
  const hello = Promise.withResolvers<void>();
  const server = Bun.listen<{ upgraded: boolean }>({
    hostname: '127.0.0.1', port: 0,
    socket: {
      open(socket) { socket.data = { upgraded: false }; },
      data(socket, bytes) {
        if (!socket.data.upgraded) {
          const key = /sec-websocket-key:\s*(\S+)/i.exec(bytes.toString())?.[1] ?? '';
          const accept = createHash('sha1').update(key + GUID).digest('base64');
          socket.data.upgraded = true;
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
          return;
        }
        // Each frame from the relay: a ping is opcode 9.
        for (let at = 0; at < bytes.length;) {
          const opcode = bytes[at]! & 0x0f, length = bytes[at + 1]! & 0x7f;
          if (length > 125) break;
          if (opcode === 9) pings++;
          if (opcode === 1) hello.resolve();
          at += 2 + 4 + length;
        }
      },
      close() { ended = true; },
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, hello: hello.promise, pings: () => pings, ended: () => ended };
}

test('a relay pipe pings a silent upstream every 10 s and closes both halves with a reconnectable code after 25 s', async () => {
  const member = silentMember();
  const core = { group: { reached: () => undefined }, log: () => undefined, info: () => ({ hostname: 'here' }) } as unknown as Core;
  let hubEnded = false;
  const hub = { targets: () => [member.url], ended: () => { hubEnded = true; } } as unknown as RelayHub;
  const closed: { code: number; reason: string; at: number }[] = [];
  const client = {
    send: () => 1, getBufferedAmount: () => 0,
    close: (code: number, reason: string) => void closed.push({ code, reason, at: Date.now() }),
  } as unknown as ServerWebSocket<RelaySocketData>;
  const pipe = new RelayPipe(core, hub, 'f'.repeat(64), null, () => ({ sessionId: null }), { helloTimeoutMs: 60_000, helloMaxBytes: 65_536 });
  const pinged = spyOn(TextSocket.prototype, 'ping');
  // Timers fire only inside `advanceTimersByTime`; the sockets still run, so the test awaits only them.
  jest.useFakeTimers();
  pipe.attach(client);
  pipe.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: { relay: 'key', protocolVersion: PROTOCOL_VERSION } }));
  // The member got the hello: the upstream opened, and nothing came from it since.
  await member.hello;
  const openedAt = Date.now();
  jest.advanceTimersByTime(UPSTREAM_PING_MS - 1);
  expect(pinged).toHaveBeenCalledTimes(0);
  jest.advanceTimersByTime(1);
  expect(pinged).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(UPSTREAM_PING_MS);
  expect(pinged).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(UPSTREAM_DEAD_MS - 2 * UPSTREAM_PING_MS - 1);
  expect(closed).toEqual([]);
  jest.advanceTimersByTime(1);
  console.log(`a silent upstream was hung up ${closed[0] === undefined ? 'never' : `${closed[0].at - openedAt} ms`} after its last frame, fake clock`);
  expect(closed.map(({ code }) => code)).toEqual([1013]);
  expect(closed[0]!.at - openedAt).toBe(UPSTREAM_DEAD_MS);
  expect(hubEnded).toBe(true);
  jest.useRealTimers();
  pinged.mockRestore();
  // Both pings went out on the wire, and the dead half was hung up.
  for (let tries = 0; tries < 100 && !member.ended(); tries++) await Bun.sleep(10);
  expect(member.pings()).toBe(2);
  expect(member.ended()).toBe(true);
});
