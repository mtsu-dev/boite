/**
 * A TCP path as a bad network makes it, between a test's guest and its host:
 * a handshake that takes time (a TLS setup through a relay), latency each way,
 * a path that goes silent without closing (a sleeping laptop, a NAT that forgot
 * the flow) and a path that is cut. Bytes are forwarded as they come, in order.
 */
import type { Socket, TCPSocketListener } from 'bun';

export interface BadNetwork {
  /** The origin to give the guest instead of the host's. */
  readonly url: string;
  /** Connections accepted since the start, and those open now. */
  opened(): number;
  open(): number;
  /** How long a new connection waits before it reaches the host. */
  connectMs: number;
  /** How long each chunk waits, each way. */
  latencyMs: number;
  /** While on, nothing crosses and nothing closes. */
  silent: boolean;
  /** Refuses new connections while on, as a host that is down. */
  down: boolean;
  /** The connections open now go silent for good, without closing; new ones pass: a path that died under a link. */
  freeze(): void;
  /** Closes every open connection. */
  cut(): void;
  stop(): void;
}

interface Side { peer: Socket<Side> | null; waiting: Uint8Array[]; last: number; frozen: boolean }

export function badNetwork(target: string, options: { connectMs?: number; latencyMs?: number } = {}): BadNetwork {
  const upstream = new URL(target);
  const sockets = new Set<Socket<Side>>();
  let opened = 0;
  const network: BadNetwork = {
    url: '',
    opened: () => opened,
    open: () => sockets.size / 2,
    connectMs: options.connectMs ?? 0,
    latencyMs: options.latencyMs ?? 0,
    silent: false,
    down: false,
    freeze() { for (const socket of sockets) socket.data.frozen = true; },
    cut() { for (const socket of [...sockets]) socket.end(); },
    stop() { this.cut(); listener.stop(true); },
  };
  /** Forwards `bytes` to the other end after the latency, never before a chunk that came earlier. */
  const forward = (from: Socket<Side>, bytes: Uint8Array): void => {
    if (network.silent || from.data.frozen) return;
    const copy = bytes.slice();
    const side = from.data;
    if (side.peer === null) { side.waiting.push(copy); return; }
    const at = Math.max(Date.now() + network.latencyMs, side.last);
    side.last = at;
    const peer = side.peer;
    const send = () => { if (!network.silent && !side.frozen && sockets.has(peer)) peer.write(copy); };
    if (at <= Date.now()) send(); else setTimeout(send, at - Date.now());
  };
  const handlers = {
    data(socket: Socket<Side>, bytes: Uint8Array) { forward(socket, bytes); },
    close(socket: Socket<Side>) { sockets.delete(socket); socket.data.peer?.end(); },
    error(socket: Socket<Side>) { sockets.delete(socket); socket.data.peer?.end(); },
  };
  const listener: TCPSocketListener<Side> = Bun.listen<Side>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      ...handlers,
      open(client) {
        client.data = { peer: null, waiting: [], last: 0, frozen: false };
        if (network.down) { client.end(); return; }
        opened += 1;
        sockets.add(client);
        setTimeout(() => {
          if (!sockets.has(client)) return;
          void Bun.connect<Side>({
            hostname: upstream.hostname,
            port: Number(upstream.port),
            socket: {
              ...handlers,
              open(host) {
                host.data = { peer: client, waiting: [], last: 0, frozen: client.data.frozen };
                sockets.add(host);
                client.data.peer = host;
                for (const bytes of client.data.waiting.splice(0)) forward(client, bytes);
              },
            },
          }).catch(() => client.end());
        }, network.connectMs);
      },
    },
  });
  (network as { url: string }).url = `http://127.0.0.1:${listener.port}`;
  return network;
}
