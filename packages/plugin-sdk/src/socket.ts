/*
 * A small WebSocket client for text messages, on `node:net` and `node:tls`.
 * Not the runtime's own `WebSocket`: Bun's client has closed sound, long-lived
 * streams from the core with 1002 or 1011 (packages/core/src/ws-client.ts,
 * which the core and its CLI use for the same reason). A plugin's service
 * holds its socket for hours, so it reads the frames itself.
 *
 * RFC 6455, text only, no extension offered: server frames are unmasked and
 * carry no reserved bit, fragmented messages are joined, pings are answered
 * and a close is echoed.
 */

import { createHash, randomBytes } from 'node:crypto';
import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Past this a message is taken as a broken stream. The core caps a frame well below it. */
const MAX_MESSAGE_BYTES = 64 << 20;
/** The upgrade answer's head. A sound one is a few hundred bytes. */
const MAX_HEAD_BYTES = 16 << 10;

export interface SocketEvents {
  message(text: string): void;
  close(code: number, reason: string): void;
}

export class TextSocket {
  #socket: Socket;
  #open = true;
  #closed = false;
  #buffer: Buffer = Buffer.alloc(0);
  #parts: Buffer[] = [];
  #partBytes = 0;
  #fragmented = false;
  #decoder = new TextDecoder('utf-8', { fatal: true });
  #events: SocketEvents;

  private constructor(socket: Socket, rest: Buffer, events: SocketEvents) {
    this.#socket = socket;
    this.#events = events;
    socket.on('data', (chunk: Buffer) => this.#read(chunk));
    socket.on('close', () => this.#ended(1006, 'the connection closed'));
    socket.on('error', (error: Error) => this.#ended(1006, error.message));
    if (rest.length > 0) queueMicrotask(() => this.#read(rest));
  }

  get open(): boolean { return this.#open; }

  send(text: string): void {
    if (!this.#open) throw new Error('the socket is closed');
    this.#socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
  }

  close(code = 1000): void {
    if (!this.#open) return;
    this.#open = false;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    this.#socket.write(encodeFrame(0x8, payload));
    // The server answers the close and hangs up; one that does not is cut after a second.
    setTimeout(() => this.#socket.destroy(), 1000).unref?.();
  }

  /** `flush`: a close frame was just written, so end the socket once it is sent instead of discarding it. */
  #ended(code: number, reason: string, flush = false): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#open = false;
    if (flush) {
      this.#socket.end();
      setTimeout(() => this.#socket.destroy(), 1000).unref?.();
    } else {
      this.#socket.destroy();
    }
    this.#events.close(code, reason);
  }

  #fail(reason: string, code = 1002): void {
    if (this.#open) {
      this.#open = false;
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code);
      this.#socket.write(encodeFrame(0x8, payload));
    }
    this.#ended(code, reason, true);
  }

  #read(chunk: Buffer): void {
    if (this.#closed) return;
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const frame = parseFrame(this.#buffer);
      if (frame === null) return;
      if ('error' in frame) { this.#fail(frame.error); return; }
      this.#buffer = this.#buffer.subarray(frame.size);
      this.#frame(frame.fin, frame.opcode, frame.payload);
      if (this.#closed) return;
    }
  }

  #frame(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case 0x0:
      case 0x1: {
        if ((opcode === 0x0) !== this.#fragmented) { this.#fail(`opcode ${opcode} out of sequence`); return; }
        this.#partBytes += payload.length;
        if (this.#partBytes > MAX_MESSAGE_BYTES) { this.#fail(`a message over ${MAX_MESSAGE_BYTES} B`, 1009); return; }
        this.#parts.push(Buffer.from(payload));
        this.#fragmented = !fin;
        if (!fin) return;
        const whole = Buffer.concat(this.#parts);
        this.#parts = [];
        this.#partBytes = 0;
        let text: string;
        try { text = this.#decoder.decode(whole); } catch { this.#fail('a text message that is not UTF-8', 1007); return; }
        this.#events.message(text);
        return;
      }
      case 0x8: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        if (this.#open) {
          this.#open = false;
          this.#socket.write(encodeFrame(0x8, payload.subarray(0, 2)));
        }
        this.#ended(code, payload.subarray(2).toString('utf8'), true);
        return;
      }
      case 0x9:
        if (this.#open) this.#socket.write(encodeFrame(0xa, payload));
        return;
      case 0xa:
        return;
      default:
        this.#fail(`opcode ${opcode}`);
    }
  }

  /** Opens `url` (ws:// or wss://) and resolves once the server accepted the upgrade. */
  static connect(url: string, timeoutMs: number, events: SocketEvents): Promise<TextSocket> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return Promise.reject(new Error(`not a WebSocket URL: ${url}`));
    }
    if (target.protocol !== 'ws:' && target.protocol !== 'wss:') {
      return Promise.reject(new Error(`a WebSocket URL starts with ws:// or wss://, got ${target.protocol}`));
    }
    const secure = target.protocol === 'wss:';
    const port = Number(target.port || (secure ? 443 : 80));
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    const key = randomBytes(16).toString('base64');
    const expected = createHash('sha1').update(key + GUID).digest('base64');
    return new Promise<TextSocket>((resolve, reject) => {
      const socket = secure ? tlsConnect({ host, port, servername: host }) : tcpConnect({ host, port });
      let head = Buffer.alloc(0);
      let settled = false;
      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail(`timed out opening ${target.host}`), timeoutMs);
      socket.once(secure ? 'secureConnect' : 'connect', () => {
        socket.write([
          `GET ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${target.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '', '',
        ].join('\r\n'));
      });
      socket.on('error', (error: Error) => fail(`could not reach ${target.host}: ${error.message}`));
      socket.on('close', () => fail(`${target.host} closed the connection before the upgrade`));
      const onData = (chunk: Buffer): void => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf('\r\n\r\n');
        if (end < 0) {
          if (head.length > MAX_HEAD_BYTES) fail('the upgrade answer is too long');
          return;
        }
        const lines = head.subarray(0, end).toString('latin1').split('\r\n');
        const status = lines[0] ?? '';
        if (!/^HTTP\/1\.1 101\b/.test(status)) { fail(`the core refused the upgrade: ${status}`); return; }
        const accept = lines.find(line => /^sec-websocket-accept:/i.test(line))?.split(':')[1]?.trim();
        if (accept !== expected) { fail('the upgrade answer carries a wrong Sec-WebSocket-Accept'); return; }
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('data', onData);
        socket.removeAllListeners('error');
        socket.removeAllListeners('close');
        resolve(new TextSocket(socket, head.subarray(end + 4), events));
      };
      socket.on('data', onData);
    });
  }
}

type Parsed = { fin: boolean; opcode: number; payload: Buffer; size: number } | { error: string } | null;

/** One server frame at the start of `bytes`, null while it is incomplete. */
export function parseFrame(bytes: Buffer): Parsed {
  if (bytes.length < 2) return null;
  const first = bytes[0]!, second = bytes[1]!;
  if ((first & 0x70) !== 0) return { error: 'reserved bits set with no extension negotiated' };
  if ((second & 0x80) !== 0) return { error: 'the server masked a frame' };
  const fin = (first & 0x80) !== 0, opcode = first & 0x0f;
  let length = second & 0x7f, header = 2;
  if (length === 126) {
    if (bytes.length < 4) return null;
    length = bytes.readUInt16BE(2);
    header = 4;
  } else if (length === 127) {
    if (bytes.length < 10) return null;
    const big = bytes.readBigUInt64BE(2);
    if (big > BigInt(MAX_MESSAGE_BYTES)) return { error: `a ${big} B frame` };
    length = Number(big);
    header = 10;
  }
  if (opcode >= 8 && (!fin || length > 125)) return { error: `a fragmented or ${length} B control frame` };
  if (bytes.length < header + length) return null;
  return { fin, opcode, payload: bytes.subarray(header, header + length), size: header + length };
}

/** One client frame, masked as RFC 6455 requires of a client. */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const header = n < 126 ? 2 : n < 65_536 ? 4 : 10;
  const out = Buffer.alloc(header + 4 + n);
  out[0] = 0x80 | opcode;
  if (n < 126) out[1] = 0x80 | n;
  else if (n < 65_536) { out[1] = 0x80 | 126; out.writeUInt16BE(n, 2); }
  else { out[1] = 0x80 | 127; out.writeBigUInt64BE(BigInt(n), 2); }
  const mask = randomBytes(4);
  mask.copy(out, header);
  for (let i = 0; i < n; i++) out[header + 4 + i] = payload[i]! ^ mask[i & 3]!;
  return out;
}
