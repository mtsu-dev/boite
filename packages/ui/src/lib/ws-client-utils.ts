// Owns WebSocket timing, addresses and browser transport helpers.
import { RPC_MAX_FRAME_BYTES, RPC_PATH, withoutTrailingSlashes } from '@boite/contracts';
import type { SocketLike } from './client';

/**
 * 1 s, 2 s, 4 s, 8 s, then 10 s forever, each 20 % either way at random, so
 * the phones of a core that restarts do not all knock at the same instant.
 */
export function defaultBackoff(attempt: number, random: () => number = Math.random): number {
  return Math.round(Math.min(1000 * 2 ** attempt, 10_000) * (0.8 + random() * 0.4));
}

/**
 * The first retry after a socket that was ready goes down: 125 to 250 ms, at
 * random, rather than the 1 s of `defaultBackoff(0)`. A core that restarts, or
 * a link that blinks, is usually back by then, and the spread still keeps the
 * phones of one core apart. The attempt counts like any other: if it fails, the
 * next waits `defaultBackoff(1)`.
 */
export function quickRetry(random: () => number = Math.random): number {
  return Math.round(125 + random() * 125);
}

/**
 * A ready socket lost sooner than this after its hello is a host dropping in a
 * loop: its first retry waits out the backoff, which grows with each such drop
 * in a row, instead of `quickRetry`.
 */
export const STEADY_MS = 10_000;

/**
 * How long one attempt gets for TCP, TLS, the upgrade and the hello together:
 * 10 s, then 20 s, then 30 s. A lossy link that needs longer than 10 s would
 * otherwise be cut off on every attempt and never connect.
 */
export function openDeadline(attempt: number): number {
  return 10_000 * (1 + Math.min(attempt, 2));
}

export function rpcUrl(coreUrl: string): string {
  const url = new URL(coreUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${withoutTrailingSlashes(url.pathname)}${RPC_PATH}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** The websocket address of a path the core answered (`browser.remoteStream`), under the address its RPC socket is at: a relay's route included. */
export function streamUrl(coreUrl: string, path: string): string {
  const url = new URL(coreUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${withoutTrailingSlashes(url.pathname)}${path}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Silence on a remote socket, page in the foreground, before the client asks
 * whether the core is still there. A phone whose NAT mapping expired, or a core
 * host that went to sleep, leaves a socket that never fires close: with the
 * probe's 10 s deadline it shows offline within 22 s of its last frame. The
 * probe is one small `hello` the core answers ahead of its request queue, so
 * asking twice as often as the 25 s this was until 2026-11-15 costs a frame
 * each way.
 */
export const IDLE_PROBE_MS = 12_000;
/**
 * How long a probe waits for any frame at all, the same 10 s a new socket gets
 * to say hello. Frames arrive in order, so a probe's answer queues behind a long
 * answer still downloading; a remote client asks the core to slice every answer
 * (`progress`), and each 64 KiB slice counts as a frame, so a slow link keeps
 * answering while a dead one stays silent. Until 2026-10-22 a call waiting kept
 * the probe away and a link that dropped under an open conversation read as
 * connected for the two minutes of that call's timeout.
 */
export const PROBE_DEADLINE_MS = 10_000;
/**
 * A call on a remote socket to a core that slices its answers
 * (`chunkedAnswers`) that hears no frame at all for this long sends a probe:
 * the click on a conversation of a machine whose link died shows the machine
 * offline within this and the probe's deadline. A socket that answers, or
 * carries any event meanwhile, is not asked. Older cores keep the call's own
 * 120 s timeout.
 */
export const QUIET_CALL_MS = 3_000;
/**
 * The slowest upload a probe still waits for: its `hello` queues behind the
 * bytes this client sent since the last frame came back, past the first 64 KiB,
 * so 2 MiB of pictures give it 62 s more. Answers need no such allowance: they come in 64 KiB
 * slices, so a download faster than about 6.4 KiB/s lands one within the 10 s
 * deadline.
 */
export const UPLOAD_FLOOR_BYTES_PER_S = 32 * 1024;
/** How long `resume()` gives the socket it already has before replacing it. */
export const RESUME_PROBE_MS = 4_000;
/**
 * Away this long, a remote socket is as likely dead as alive: `resume()` opens
 * a new one at once beside the probe of the old, and keeps whichever answers
 * first, so a dead socket costs one handshake rather than the probe's 4 s too.
 */
export const RACE_AFTER_HIDDEN_MS = 8_000;
/** How often a visible page compares its clocks to notice that the system slept. */
export const WAKE_TICK_MS = 1_000;
/** A wall clock that ran this much further than the page's own clock in one tick: the system slept. */
export const WAKE_JUMP_MS = 5_000;

/**
 * Calls `woke(slept)` when the system wakes from a sleep the page stayed
 * visible through, a laptop lid closed on the app: a tick every second while
 * the page is visible compares how far `Date.now()` moved with how far
 * `performance.now()` did, which does not count the sleep. One timer for the
 * whole app, stopped while the page is hidden, where `resume()` on the way back
 * does the same work. Returns the stop.
 */
export function watchWake(woke: (slept: number) => void, tick = WAKE_TICK_MS): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let wall = 0;
  let mono = 0;
  const start = (): void => {
    if (timer !== null || pageHidden()) return;
    wall = Date.now();
    mono = performance.now();
    timer = setInterval(() => {
      const nowWall = Date.now();
      const nowMono = performance.now();
      const jump = (nowWall - wall) - (nowMono - mono);
      wall = nowWall;
      mono = nowMono;
      if (jump > WAKE_JUMP_MS) woke(Math.round(jump));
    }, tick);
  };
  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const visibility = (): void => { if (pageHidden()) stop(); else start(); };
  document.addEventListener('visibilitychange', visibility);
  start();
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    stop();
  };
}

/** The shell and a browser on the core's machine: that socket cannot go half-open. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const name = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return name === '127.0.0.1' || name === 'localhost' || name === '::1';
  } catch {
    return false;
  }
}

export function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** WebSocket close code 1009: the peer refused a frame over its size limit. */
export const MESSAGE_TOO_BIG = 1009;

/** UTF-8 bytes of a frame, encoded only when its length leaves any doubt. */
export function frameBytes(frame: string): number {
  return frame.length * 3 <= RPC_MAX_FRAME_BYTES ? frame.length : new TextEncoder().encode(frame).byteLength;
}

export function megabytes(bytes: number): string {
  return (bytes / 1048576).toFixed(1).replace(/\.0$/, '');
}

export function browserSocket(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike;
}
