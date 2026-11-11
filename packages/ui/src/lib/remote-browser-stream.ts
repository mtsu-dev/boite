/*
 * The viewer's side of a pushed browser: frames arrive as JPEGs on a socket
 * of their own and are painted on a canvas. The method is T3 Code's
 * (https://github.com/pingdotgg/t3code, MIT License, `serverBrowserStream.ts`):
 * each frame is acknowledged as it arrives, so the core sends the next one at
 * the pace the link carries; one frame is decoded at a time and only the
 * newest waits, so a slow device skips frames instead of falling behind.
 */
import type { RemoteStreamMessage, RemoteStreamPage, RemoteStreamReply } from '@boite/contracts';
import type { Client, FrameSocket } from './client';
import { errorText } from './errors';

export interface FramePainter {
  /** The canvas frames are painted on; the last frame is drawn again on a new one. */
  attach(canvas: HTMLCanvasElement | undefined): void;
  paint(jpeg: Blob): void;
  /** Forgets the frame shown: the next canvas starts empty. */
  clear(): void;
  close(): void;
}

type Drawn = ImageBitmap | HTMLImageElement;

/** Safari before 15 has no `createImageBitmap` for a blob: an image element decodes it there. */
async function decode(jpeg: Blob): Promise<Drawn> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(jpeg);
  const url = URL.createObjectURL(jpeg), image = new Image();
  try {
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

export function framePainter(): FramePainter {
  let canvas: HTMLCanvasElement | undefined, shown: Drawn | null = null, waiting: Blob | null = null, decoding = false, closed = false, epoch = 0;
  const release = (drawn: Drawn | null) => { if (drawn && 'close' in drawn) drawn.close(); };
  const draw = () => {
    if (!canvas || !shown) return;
    const width = 'naturalWidth' in shown ? shown.naturalWidth : shown.width, height = 'naturalHeight' in shown ? shown.naturalHeight : shown.height;
    // Assigning a canvas its size clears it: only when the frame's size changes, as between a scroll's small frames and the still after.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.getContext('2d')?.drawImage(shown, 0, 0);
  };
  const run = async () => {
    decoding = true;
    while (waiting && !closed) {
      const next = waiting, from = epoch;
      waiting = null;
      const drawn = await decode(next).catch(() => null);
      if (closed || from !== epoch) { release(drawn); continue; }
      if (!drawn) continue;
      release(shown);
      shown = drawn;
      draw();
    }
    decoding = false;
  };
  return {
    attach(next) { canvas = next; draw(); },
    paint(jpeg) { waiting = jpeg; if (!decoding && !closed) void run(); },
    clear() { epoch++; waiting = null; release(shown); shown = null; },
    close() { closed = true; waiting = null; release(shown); shown = null; canvas = undefined; },
  };
}

/** The bytes of a base64 JPEG, as a frame asked for with `browser.remoteFrame` carries it. */
export function jpegBlob(base64: string): Blob {
  const text = atob(base64), bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return new Blob([bytes], { type: 'image/jpeg' });
}

/** The wait before opening the stream again after `failures` in a row. */
export const streamBackoff = (failures: number): number => Math.min(500 * 2 ** failures, 10_000);

export interface FrameStreamOptions {
  client: Client;
  threadId: string;
  tabId?: string;
  /** The widest frame the view can show now, in device pixels. */
  maxWidth(): number | undefined;
  /** The page the frames that follow show. */
  page(page: RemoteStreamPage): void;
  frame(jpeg: Blob): void;
  /** The socket closed: the page shown is no longer known to be the page. */
  lost(): void;
  failed(reason: string): void;
  /** The core has no stream for this tab (one the desktop app hosts): its frames are asked for instead. */
  pull(): void;
}

export interface FrameStream {
  /** The view changed size: the core is told the width it shows now. */
  resized(): void;
  /** True while the socket is open and has shown a page. */
  readonly live: boolean;
  stop(): void;
}

/** Asks the core for a stream of the tab's frames and keeps it open until stopped. */
export function frameStream(options: FrameStreamOptions): FrameStream {
  const { client, threadId, tabId } = options;
  let stopped = false, socket: FrameSocket | null = null, failures = 0, live = false, sentWidth: number | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined, sizing: ReturnType<typeof setTimeout> | undefined;
  const again = () => { if (!stopped) { clearTimeout(retry); retry = setTimeout(() => void open(), streamBackoff(failures++)); } };
  const reply = (message: RemoteStreamReply) => socket?.send(JSON.stringify(message));
  async function open(): Promise<void> {
    if (stopped) return;
    try {
      const maxWidth = options.maxWidth();
      const answer = await client.call('browser.remoteStream', { threadId, ...(tabId ? { tabId } : {}), ...(maxWidth ? { maxWidth } : {}) });
      if (stopped) return;
      if ('pull' in answer) { stopped = true; options.pull(); return; }
      sentWidth = maxWidth;
      const opened = socket = client.frames!(answer.path);
      opened.onmessage = (data) => {
        if (stopped || socket !== opened) return;
        if (typeof data === 'string') {
          let message: RemoteStreamMessage | null = null;
          try { message = JSON.parse(data) as RemoteStreamMessage; } catch { /* not a message */ }
          if (message?.type === 'page') { live = true; options.page(message.page); }
          return;
        }
        // Acknowledged on arrival: the core sends the next frame once this one crossed the link, whatever the painter does with it.
        reply({ type: 'ack' });
        failures = 0;
        if (live) options.frame(new Blob([data], { type: 'image/jpeg' }));
      };
      opened.onclose = () => {
        if (stopped || socket !== opened) return;
        socket = null; live = false;
        options.lost();
        again();
      };
    } catch (cause) {
      if (stopped) return;
      options.failed(errorText(cause));
      again();
    }
  }
  void open();
  return {
    get live() { return live && socket !== null; },
    resized() {
      clearTimeout(sizing);
      sizing = setTimeout(() => {
        const maxWidth = options.maxWidth();
        if (stopped || !socket || !maxWidth || maxWidth === sentWidth) return;
        sentWidth = maxWidth;
        reply({ type: 'size', maxWidth });
      }, 200);
    },
    stop() {
      stopped = true; live = false;
      clearTimeout(retry); clearTimeout(sizing);
      socket?.close(); socket = null;
    },
  };
}
