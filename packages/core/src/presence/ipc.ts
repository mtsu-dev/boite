/**
 * Discord's local IPC protocol, as every chat app that shows a rich presence
 * speaks it: Discord, its Canary and PTB builds, arRPC (Vesktop, Legcord,
 * Equibop, WebCord) and the bridges that copy a presence to Fluxer. A frame
 * is a little-endian op, a little-endian length and that many bytes of JSON.
 * The app opens with a handshake carrying its application id and the chat app
 * answers READY; then each SET_ACTIVITY is a command with a nonce.
 *
 * The sockets are `discord-ipc-0` to `discord-ipc-9`: named pipes on Windows,
 * Unix sockets in the runtime or temporary directory elsewhere, or inside the
 * sandbox folder of a Flatpak or a Snap. A chat app takes the first free
 * number, so Discord and a bridge for another app sit side by side.
 */
import { markFeature } from '@boite/contracts';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';

markFeature('boite-feature:discord-presence');

export const Op = { Handshake: 0, Frame: 1, Close: 2, Ping: 3, Pong: 4 } as const;

/** One frame. A chat app answers a frame larger than this with nothing useful: it is refused. */
const FRAME_MAX = 64 * 1024;
/** How long a chat app has to answer the handshake. */
const READY_MS = 5_000;

export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Cuts a byte stream into frames; the last bytes of an unfinished frame wait for the next chunk. */
export class FrameReader {
  #pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): { op: number; payload: unknown }[] {
    this.#pending = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);
    const frames: { op: number; payload: unknown }[] = [];
    while (this.#pending.length >= 8) {
      const op = this.#pending.readInt32LE(0);
      const length = this.#pending.readInt32LE(4);
      if (length < 0 || length > FRAME_MAX) throw new Error(`a frame of ${length} bytes, over the ${FRAME_MAX} a presence takes`);
      if (this.#pending.length < 8 + length) break;
      const text = this.#pending.subarray(8, 8 + length).toString('utf8');
      this.#pending = this.#pending.subarray(8 + length);
      frames.push({ op, payload: text.length === 0 ? null : JSON.parse(text) });
    }
    return frames;
  }
}

/**
 * The folders a chat app may put its socket in on Linux and macOS: the
 * runtime directory, the temporary ones, and the sandbox folders of the
 * Flatpak and Snap packages that publish theirs there.
 */
const SANDBOXES = [
  '',
  'app/com.discordapp.Discord',
  'app/com.discordapp.DiscordCanary',
  'app/com.discordapp.DiscordPTB',
  'app/dev.vencord.Vesktop',
  'app/io.github.equicord.equibop',
  'app/app.legcord.Legcord',
  'app/io.github.spacingbat3.webcord',
  'snap.discord',
  'snap.discord-canary',
  '.flatpak/dev.vencord.Vesktop/xdg-run',
];

/** Every socket path to try on this machine, without duplicates, lowest number first. */
export function socketCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const numbers = Array.from({ length: 10 }, (_, n) => n);
  if (platform === 'win32') return numbers.map(n => `\\\\.\\pipe\\discord-ipc-${n}`);
  const bases = [...new Set([env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter((dir): dir is string => typeof dir === 'string' && dir.length > 0))];
  const paths: string[] = [];
  for (const n of numbers) for (const base of bases) for (const box of SANDBOXES) paths.push(join(base, box, `discord-ipc-${n}`));
  return [...new Set(paths)];
}

/** How a status names a socket: the part after the base folder, `discord-ipc-0` or `app/com.discordapp.Discord/discord-ipc-0`. */
export function socketLabel(path: string): string {
  const pipe = path.lastIndexOf('\\');
  if (pipe >= 0) return path.slice(pipe + 1);
  const box = SANDBOXES.filter(Boolean).find(each => path.includes(`/${each}/`));
  return box ? `${box}/${path.slice(path.lastIndexOf('/') + 1)}` : path.slice(path.lastIndexOf('/') + 1);
}

/** Discord's activity, as SET_ACTIVITY takes it. */
export interface DiscordActivity {
  details: string;
  state?: string;
  timestamps?: { start: number };
  assets: { large_image: string; large_text: string };
  buttons?: { label: string; url: string }[];
  type: 0;
}

export interface IpcEvents {
  /** The chat app answered the handshake, with the account it shows. */
  ready(user: string | null): void;
  /** A command was refused: an unknown application, a malformed activity. */
  refused(message: string): void;
  /** The socket closed, by either side. */
  closed(reason: string): void;
}

/** One chat app's socket, from the handshake to its close. */
export class IpcConnection {
  readonly path: string;
  readonly #socket: Socket;
  readonly #events: IpcEvents;
  readonly #reader = new FrameReader();
  #ready = false;
  #closed = false;
  #nonce = 0;
  readonly #readyTimer: ReturnType<typeof setTimeout>;

  private constructor(path: string, socket: Socket, events: IpcEvents) {
    this.path = path;
    this.#socket = socket;
    this.#events = events;
    this.#readyTimer = setTimeout(() => this.close('the chat app did not answer the handshake'), READY_MS);
    this.#readyTimer.unref?.();
  }

  /** Opens `path` and sends the handshake; null when nothing listens there. */
  static open(path: string, applicationId: string, events: IpcEvents): Promise<IpcConnection | null> {
    return new Promise((resolve) => {
      const socket = createConnection(path);
      let connection: IpcConnection | null = null;
      socket.once('connect', () => {
        connection = new IpcConnection(path, socket, events);
        socket.on('data', (chunk: Buffer) => connection!.#receive(chunk));
        socket.write(encodeFrame(Op.Handshake, { v: 1, client_id: applicationId }));
        resolve(connection);
      });
      socket.on('error', (error: Error) => {
        if (connection === null) { socket.destroy(); resolve(null); return; }
        connection.close(error.message);
      });
      socket.on('close', () => connection?.close('the chat app closed the socket'));
    });
  }

  get ready(): boolean { return this.#ready && !this.#closed; }

  /** Sets the activity, or clears it with null. */
  setActivity(activity: DiscordActivity | null): void {
    if (!this.ready) return;
    this.#nonce += 1;
    const args: { pid: number; activity?: DiscordActivity } = { pid: process.pid };
    if (activity !== null) args.activity = activity;
    this.#socket.write(encodeFrame(Op.Frame, { cmd: 'SET_ACTIVITY', args, nonce: `boite-${this.#nonce}` }));
  }

  close(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#readyTimer);
    // `end` lets a last frame, the clear, reach the chat app; a peer that never closes its side is cut a second later.
    this.#socket.end();
    setTimeout(() => this.#socket.destroy(), 1_000).unref?.();
    this.#events.closed(reason);
  }

  #receive(chunk: Buffer): void {
    let frames: { op: number; payload: unknown }[];
    try { frames = this.#reader.push(chunk); }
    catch (error) { this.close(error instanceof Error ? error.message : String(error)); return; }
    for (const { op, payload } of frames) {
      if (this.#closed) return;
      const message = (payload ?? {}) as { cmd?: string; evt?: string | null; data?: { user?: { global_name?: string | null; username?: string }; message?: string; code?: number } | null; message?: string };
      if (op === Op.Ping) { this.#socket.write(encodeFrame(Op.Pong, payload)); continue; }
      if (op === Op.Close) { this.close(message.message ?? message.data?.message ?? 'the chat app closed the connection'); return; }
      if (op !== Op.Frame) continue;
      if (message.evt === 'READY') {
        clearTimeout(this.#readyTimer);
        this.#ready = true;
        const user = message.data?.user;
        this.#events.ready(user?.global_name || user?.username || null);
      } else if (message.evt === 'ERROR') {
        this.#events.refused(message.data?.message ?? `error ${message.data?.code ?? 'without a code'}`);
      }
    }
  }
}
