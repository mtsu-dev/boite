/*
 * Whether DevTools' runtime domain runs on a tab. While it does, Chromium
 * describes every console argument for the client, and the page can see it
 * happen: an error it logs formats its stack through the page's own
 * `Error.prepareStackTrace`. Sites and captchas test exactly that, score the
 * browser as automated and refuse the sign-in. The runtime is on only while
 * the tab shows a page of this machine or a private network, the agent's own
 * work, whose console and exceptions the diagnostics keep. Any other page runs
 * without it, and its frames are reached through an isolated world
 * (`page-frames.ts`), which needs no runtime.
 */
import type { Cdp } from './cdp.ts';

/** Names a private network uses, which no public site can be reached under. */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

function privateV4(host: string): boolean {
  const parts = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!parts) return false;
  const [a, b] = [Number(parts[1]), Number(parts[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** Whether a page at `url` is one whose console the diagnostics read: a file, or a server of this machine or a private network. */
export function readsConsole(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'file:') return true;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || PRIVATE_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
  if (host.includes(':')) return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  return privateV4(host);
}

/** Every document request of the tab waits for the core, which turns the runtime off first when the document is public. */
const DOCUMENT_REQUESTS = { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] };

export interface PageRuntime {
  /** The runtime is on: the page's console and exceptions are reported. */
  readonly on: boolean;
  /** The session they arrive on while it is. */
  readonly session: string | undefined;
  /**
   * The tab shows `url`: the runtime is on for it when its console is read,
   * off otherwise. `held` is a document request waiting for it, let go once
   * the runtime is off.
   */
  follow(url: string, held?: string): Promise<void>;
  /** The address read once the tab is attached, followed only if the tab has not moved since: that answer may be older than a navigation already seen. */
  adopt(url: string): Promise<void>;
}

/**
 * The runtime of the tab whose session is `tab`. On a target of the core's
 * own browser, `target`, it runs on a session of its own, which the core
 * leaves to turn it off: the browser answers that alone, while
 * `Runtime.disable` gets no answer as long as a document request is held. The desktop app's webviews (`target` null)
 * keep it on the tab's session whatever the page, since the shell reads their
 * console itself.
 */
export function pageRuntime(cdp: Cdp, tab: string, target: string | null): PageRuntime {
  if (target === null) {
    const enabled = cdp.send('Runtime.enable', {}, tab).then(() => {}, () => {});
    return { on: true, session: tab, follow: () => enabled, adopt: () => enabled };
  }
  const release = (held?: string) => held === undefined ? Promise.resolve() : cdp.send('Fetch.continueRequest', { requestId: held }, tab).then(() => {}, () => {});
  // Held from the tab's first request, so none slips past a runtime turning on.
  const fetching = cdp.send('Fetch.enable', DOCUMENT_REQUESTS, tab).then(() => {}, () => {});
  /** The session the runtime runs on, while the tab wants it; `left` once the tab no longer does. */
  interface Turn { session?: string; left: boolean; attached: Promise<void> }
  let turn: Turn | null = null, moved = false;
  /** Every session the tab is still leaving. */
  let leavingAll: Promise<void> = Promise.resolve();
  return {
    get on() { return turn !== null; },
    get session() { return turn?.session; },
    adopt(url) { return moved ? Promise.resolve() : this.follow(url); },
    async follow(url, held) {
      moved = true;
      await fetching;
      if (readsConsole(url)) {
        if (turn) return release(held);
        const mine: Turn = turn = { left: false, attached: Promise.resolve() };
        mine.attached = cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target, flatten: true })
          .then(attached => { mine.session = attached.sessionId; }, () => {});
        await mine.attached;
        await release(held);
        // What the page logged before arrives now too. A document leaving meanwhile waits for
        // this answer no longer: leaving the session ends it.
        if (mine.session && !mine.left) await cdp.send('Runtime.enable', {}, mine.session).catch(() => {});
        return;
      }
      const leaving = turn;
      turn = null;
      if (leaving) {
        leaving.left = true;
        const left = leaving.attached.then(() => leaving.session === undefined ? undefined
          : cdp.send('Target.detachFromTarget', { sessionId: leaving.session }).then(() => {}, () => {}));
        // A public request that comes while it leaves waits for it too.
        leavingAll = Promise.all([leavingAll, left]).then(() => {});
      }
      await leavingAll;
      await release(held);
    },
  };
}

/**
 * Keeps `runtime` on the tab's top document, `topFrame`. A public document of
 * that frame is held at its request until the runtime is off: a page served
 * from the cache commits within milliseconds of its request, and a page of
 * this machine can leave at once, while its runtime still turns on. The runtime turns on only once a document of this machine
 * committed, so a request that becomes a download leaves the page as it was.
 * `on` subscribes to an event of the tab's session.
 */
export function followPage(runtime: PageRuntime, cdp: Cdp, tab: string, topFrame: string, on: (method: string, listener: (params: Record<string, unknown>) => void) => void): void {
  on('Fetch.requestPaused', params => {
    const url = String((params.request as { url: string }).url), held = String(params.requestId);
    if (params.frameId === topFrame && !readsConsole(url)) void runtime.follow(url, held);
    else void cdp.send('Fetch.continueRequest', { requestId: held }, tab).catch(() => {});
  });
  on('Page.frameNavigated', params => {
    const frame = params.frame as { parentId?: string; url: string };
    if (!frame.parentId) void runtime.follow(frame.url);
  });
}
