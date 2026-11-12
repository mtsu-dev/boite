/*
 * The frames a viewer is pushed, on a websocket of its own. The method, its
 * constants and its loop are T3 Code's server browser
 * (https://github.com/pingdotgg/t3code, MIT License, `ServerBrowser.ts` and
 * `ServerBrowserStream.ts`): a screencast on a DevTools session of the
 * viewer's own, whose acknowledgements are spaced so Chromium draws some twenty
 * pictures a second; smaller, lighter pictures while the viewer scrolls; a
 * full still once the page rests; and one picture on the wire at a time, with
 * only the newest waiting behind it.
 */
import type { StreamCdp } from './frames.ts';
import { jpegWidth, shrunkJpeg } from './shrink.ts';

/** Chromium is acknowledged a picture no sooner than this after it came. It keeps two unacknowledged, so it draws some twenty pictures a second. */
export const SCREENCAST_ACK_PACE_MS = 100;
/** A page that sent nothing for this long is at rest: it is shown a still, and scrolling is over. */
export const SCREENCAST_SETTLE_MS = 200;
/** This many pictures within the window, while the viewer scrolls, is motion. */
export const SCREENCAST_MOTION_FRAMES = 4;
export const SCREENCAST_MOTION_WINDOW_MS = 300;
/** The JPEG quality of the half-size pictures sent in motion, at most. */
export const SCREENCAST_MOTION_QUALITY = 50;
/** Pictures and messages that may wait for a viewer's socket; a picture past it is dropped, and acknowledged. */
export const VIEWER_OUTPUT_LIMIT = 64;
/** The JPEG quality of a page at rest when the viewer names none. */
export const DEFAULT_QUALITY = 70;
/** The widest and tallest picture when the viewer names no width. */
export const DEFAULT_MAX_WIDTH = 1280;
export const MAX_HEIGHT = 4320;
/** A viewer whose socket holds more than this unsent is disconnected. */
export const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;
/** After a change of document or size, the still that shows it is taken this long after the last one. */
const REFRESH_MS = 300;

/** One JPEG for a viewer. `ack` lets Chromium draw the next: called once the viewer has it, or when it is dropped. */
export interface Picture { jpeg: Uint8Array; ack(): void }

export interface PushOptions { maxWidth: number; quality: number }

/** Runs a capture in the tab's turn (`takeTurn`), so it never overlaps a size change. */
type Capture = <T>(run: () => Promise<T>) => Promise<T>;

const sleepUntil = (at: number) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, Math.max(0, at - Date.now()));
  (timer as { unref?: () => void }).unref?.();
});

/** One viewer's screencast of one tab: T3 Code's `attachViewer`. */
export class PushStream {
  #session: string | null = null;
  #off: (() => void) | null = null;
  // Chromium may drop the final frame during a burst; a still is sent when it settles.
  #framesInFlight = 0;
  #mayHaveDropped = false;
  #motion = false;
  #recentFrames: number[] = [];
  #params: Promise<void> = Promise.resolve();
  #scale = 1;
  #settle?: ReturnType<typeof setTimeout>;
  #refresh?: ReturnType<typeof setTimeout>;
  #started = false;
  #output: Picture[] = [];
  #take: ((picture: Picture) => void) | null = null;
  #options: PushOptions;
  /** When the viewer last scrolled the page: only then are pictures sent smaller. */
  scrolledAt = 0;
  closed = false;

  constructor(private cdp: StreamCdp, private targetId: string, options: PushOptions, private capture: Capture) {
    this.#options = { ...options };
  }

  /** Attaches the session and starts the screencast; a page at rest draws nothing for it, so a still comes first. */
  async start(): Promise<void> {
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: this.targetId, flatten: true });
    if (this.closed) { void this.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {}); return; }
    this.#session = sessionId;
    this.#off = this.cdp.on('Page.screencastFrame', (params, session) => { if (session === sessionId) this.#frame(params); });
    await this.#startScreencast(1);
    if (!this.#started) await this.still();
  }

  /** Where the pictures go; those that waited go first. */
  attach(take: (picture: Picture) => void): void {
    this.#take = take;
    for (const picture of this.#output.splice(0)) take(picture);
  }

  #push(picture: Picture): void {
    if (this.closed) return;
    if (this.#take) { this.#take(picture); return; }
    // Dropped frames must still release Chromium.
    if (this.#output.length >= VIEWER_OUTPUT_LIMIT) { picture.ack(); return; }
    this.#output.push(picture);
  }

  #startScreencast(scale: number): Promise<void> {
    this.#scale = scale;
    this.#params = this.#params.then(async () => {
      const session = this.#session;
      if (this.closed || !session) return;
      const { maxWidth, quality } = this.#options;
      await this.cdp.send('Page.stopScreencast', {}, session).catch(() => {});
      await this.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: this.#scale < 1 ? Math.min(quality, SCREENCAST_MOTION_QUALITY) : quality,
        maxWidth: Math.max(1, Math.round(maxWidth * this.#scale)),
        maxHeight: Math.max(1, Math.round(MAX_HEIGHT * this.#scale)),
      }, session).catch(() => {});
    });
    return this.#params;
  }

  #frame(frame: Record<string, unknown>): void {
    const session = this.#session;
    if (this.closed || !session || typeof frame.data !== 'string') return;
    this.#started = true;
    if (this.#framesInFlight > 0) this.#mayHaveDropped = true;
    this.#framesInFlight += 1;
    const arrivedAt = Date.now();
    this.#recentFrames.push(arrivedAt);
    while (this.#recentFrames[0]! < arrivedAt - SCREENCAST_MOTION_WINDOW_MS) this.#recentFrames.shift();
    if (!this.#motion && this.#recentFrames.length >= SCREENCAST_MOTION_FRAMES && arrivedAt - this.scrolledAt < SCREENCAST_MOTION_WINDOW_MS) {
      this.#motion = true;
      void this.#startScreencast(0.5);
    } else if (this.#motion && arrivedAt - this.scrolledAt > SCREENCAST_SETTLE_MS) {
      this.#motion = false;
      this.#recentFrames.length = 0;
      void this.#startScreencast(1);
    }
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => {
      this.#settle = undefined;
      if (!this.#motion && !this.#mayHaveDropped) return;
      this.#mayHaveDropped = false;
      if (this.#motion) {
        this.#motion = false;
        this.#recentFrames.length = 0;
        void this.#startScreencast(1);
      }
      void this.still();
    }, SCREENCAST_SETTLE_MS);
    (this.#settle as { unref?: () => void }).unref?.();
    let acked = false;
    this.#push({
      jpeg: Buffer.from(frame.data, 'base64'),
      ack: () => {
        if (acked) return;
        acked = true;
        void sleepUntil(arrivedAt + SCREENCAST_ACK_PACE_MS).then(() => {
          this.#framesInFlight -= 1;
          return this.cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }, session).catch(() => {});
        });
      },
    });
  }

  /**
   * The page as it is, whole and at the quality of rest, no wider than the
   * viewer shows it. Never a clip scale: Chromium mirrors the top-left of the
   * page into a `backdrop-filter` in any capture it shrinks. The page shrinks
   * a wider picture itself (`shrink.ts`), and the picture goes as it was taken
   * when the page cannot.
   */
  async still(): Promise<void> {
    const session = this.#session;
    if (this.closed || !session) return;
    const { maxWidth, quality } = this.#options;
    const shot = await this.capture(() => this.cdp.send<{ data?: string }>('Page.captureScreenshot', { format: 'jpeg', quality }, session, 10_000)).catch(() => null);
    if (typeof shot?.data !== 'string') return;
    let jpeg: Uint8Array = Buffer.from(shot.data, 'base64');
    if ((jpegWidth(jpeg) ?? 0) > maxWidth) {
      const shrunk = await shrunkJpeg((method, params) => this.cdp.send(method, params, session, 10_000), shot.data, maxWidth, quality).catch(() => null);
      if (this.closed) return;
      if (shrunk) jpeg = Buffer.from(shrunk, 'base64');
    }
    this.#push({ jpeg, ack: () => {} });
  }

  /** The page moved to another document or size, which a screencast may not draw: a still follows once it stops changing. */
  refresh(): void {
    if (this.closed) return;
    clearTimeout(this.#refresh);
    this.#refresh = setTimeout(() => { this.#refresh = undefined; void this.still(); }, REFRESH_MS);
    (this.#refresh as { unref?: () => void }).unref?.();
  }

  /** The viewer shows the page at another width: the screencast starts again at it. */
  resize(maxWidth: number): void {
    if (this.closed || maxWidth === this.#options.maxWidth) return;
    this.#options.maxWidth = maxWidth;
    void this.#startScreencast(this.#scale);
    this.refresh();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.#settle); clearTimeout(this.#refresh);
    this.#off?.(); this.#off = null;
    this.#output = []; this.#take = null;
    void this.#params.then(async () => {
      const session = this.#session;
      if (!session) return;
      await this.cdp.send('Page.stopScreencast', {}, session).catch(() => {});
      await this.cdp.send('Target.detachFromTarget', { sessionId: session }).catch(() => {});
    });
  }
}

/**
 * What goes on a viewer's socket: one picture on the wire, and only the
 * newest waiting behind it, so nothing queues behind stale images on a slow
 * link. Chromium's acknowledgement of each picture waits for the viewer's.
 */
export class StreamWire {
  #inFlight: (() => void) | null = null;
  #pending: Picture | null = null;

  constructor(private write: (picture: Picture) => void) {}

  offer(picture: Picture): void {
    if (this.#inFlight === null) { this.#send(picture); return; }
    const superseded = this.#pending;
    this.#pending = picture;
    // Never sent, but Chromium still waits for its ack.
    superseded?.ack();
  }

  /** The viewer has the picture on the wire, or it was not sent after all: Chromium may draw, and the one waiting goes. */
  acked(): void {
    const ack = this.#inFlight, next = this.#pending;
    this.#inFlight = null;
    this.#pending = null;
    ack?.();
    if (next) this.#send(next);
  }

  #send(picture: Picture): void {
    this.#inFlight = picture.ack;
    this.write(picture);
  }

  close(): void {
    this.#inFlight?.(); this.#pending?.ack();
    this.#inFlight = null; this.#pending = null;
  }
}
