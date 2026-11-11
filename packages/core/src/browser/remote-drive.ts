// Validates remote viewers and owns their captures, saved frames and page input.
import { randomBytes } from 'node:crypto';
import {
  BROWSER_STREAM_ROUTE, BrowserStreamClose, remoteBrowserInputError, remoteFrameOptionsError, remoteStreamOptionsError, REMOTE_PICKER_MAX, REMOTE_SELECTION_MAX, REMOTE_URL_MAX, REMOTE_WATCH_MS,
  type AgentBrowserStatus, type RemoteBrowserFrame, type RemoteBrowserPicker, type RemoteBrowserSelection, type RemoteBrowserStream, type RemoteBrowserUnchanged, type RemoteStreamMessage, type RpcParams, type ThreadId,
} from '@boite/contracts';
import type { Connection } from '../router.ts';
import { refused } from '../errors.ts';
import { captureFrame, ViewerStream, type PageInfo, type StreamOptions } from './frames.ts';
import { RENDER_SCALE } from './chromium.ts';
import { DEFAULT_MAX_WIDTH, DEFAULT_QUALITY, MAX_SOCKET_BUFFER_BYTES, PushStream, StreamWire, type Picture, type PushOptions } from './push-stream.ts';
import { chooseScript, EDITABLE_SCRIPT, KEY_CODES, PAGE_INFO_SCRIPT, pickerScript, selectionScript } from './scripts.ts';
import { press } from './automation.ts';
import type { Tab } from './types.ts';

const FRAME_REUSE_MS = 150;
const FRAME_LIFE_MS = 5000;
/** A viewer holding the newest frame waits this long for the page to draw something new. */
const UNCHANGED_WAIT_MS = 1000;
/** A viewer with no frame of the tab waits this long, twice, for the screencast's first picture. */
const FIRST_FRAME_WAIT_MS = 3000;
/** A tab's screencast stops when no viewer has asked for this long. */
const STREAM_IDLE_MS = 3000;
/** A stream's path opens its socket within this long, once. */
const TICKET_LIFE_MS = 30_000;
/** Viewers of every kind this core shows a browser to at once. */
const VIEWERS_MAX = 32;

interface Saved { frame: RemoteBrowserFrame; page: PageInfo; seq: number }
interface Viewer { requestedAt: number; tabId: string; options: StreamOptions; frames: Saved[] }
interface StreamEntry { tabId: string; options: StreamOptions; stream: ViewerStream; asking: number; idle?: ReturnType<typeof setTimeout> }

/** The socket a viewer's stream is pushed on, as the server gives it. */
export interface StreamPeer {
  text(json: string): void;
  /** One binary message, never deflated. */
  binary(bytes: Uint8Array): void;
  /** Bytes sent that the viewer has not taken yet. */
  buffered(): number;
  close(code: number, reason: string): void;
  /** Hangs up without a close handshake: a viewer too slow to read one. */
  drop(): void;
}
/** What the server tells a stream of its socket. */
export interface StreamHandle { message(text: string): void; closed(): void }

interface Ticket { key: string; connection: Connection; threadId: ThreadId; tabId: string; options: PushOptions; expires: number }
/** A viewer whose frames are pushed. Its last `frames` entry is the page its pictures show now: input may name it for as long as the stream lasts. */
interface PushViewer { key: string; connection: Connection; threadId: ThreadId; tab: Tab; stream: PushStream; wire: StreamWire; peer: StreamPeer; frames: Saved[]; closed: boolean }

const streamKey = (tabId: string, options: StreamOptions) => `${tabId}:${options.maxWidth ?? 0}:${options.quality}`;

interface RemoteDriveContext {
  require(threadId: ThreadId): { archived: boolean };
  status(params: { threadId: ThreadId }): AgentBrowserStatus;
  tabOf(threadId: ThreadId, tabId?: string): Tab;
  evaluate(tab: Tab, expression: string, timeoutMs?: number): Promise<unknown>;
  send(tab: Tab, method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** `strict`: a size change or a read of the page's size, which no capture may overlap. */
  screen<T>(tab: Tab, run: () => Promise<T>, strict?: boolean): Promise<T>;
  /** Runs `run` on the tab's page awake (`sleep.ts`). */
  use<T>(tab: Tab, run: () => Promise<T>): Promise<T>;
}

export class RemoteDrive {
  #viewers = new Map<string, Viewer>();
  /**
   * Per tab of the core's own browser and per size and quality its viewers
   * asked, the screencast they are shown (`ViewerStream`), and when it stops:
   * a phone on a slow link is never sent the desktop's wider, heavier frames.
   */
  #streams = new Map<string, StreamEntry>();
  /** Per client and conversation, the tab whose own page it shows and when it last said so (`browser.remoteWatch`). */
  #shown = new Map<string, { tabId: string; at: number }>();
  /** Stream paths answered and not opened yet, by ticket. */
  #tickets = new Map<string, Ticket>();
  /** Per client and conversation, the stream its frames are pushed on (`push-stream.ts`). */
  #pushes = new Map<string, PushViewer>();
  /** Per client and conversation, the left button its viewer holds down on a tab, and where it last was. */
  #held = new Map<string, { threadId: ThreadId; tabId: string; point: { x: number; y: number } }>();
  /** Per client and conversation, a press still on its way, and whether its viewer left meanwhile. */
  #pressing = new Map<string, { left: boolean }>();
  #context: RemoteDriveContext;

  constructor(context: RemoteDriveContext) {
    this.#context = context;
  }

  dropTab(id: string): void {
    for (const viewer of this.#viewers.values()) viewer.frames = viewer.frames.filter(saved => saved.frame.tabId !== id);
    for (const [key, entry] of this.#streams) if (entry.tabId === id) this.#stopStream(key);
    for (const viewer of [...this.#pushes.values()]) if (viewer.tab.id === id) this.#endPush(viewer, BrowserStreamClose.TabGone, 'tab closed');
    for (const [ticket, entry] of this.#tickets) if (entry.tabId === id) this.#tickets.delete(ticket);
    for (const [key, shown] of this.#shown) if (shown.tabId === id) this.#shown.delete(key);
    for (const [key, held] of this.#held) if (held.tabId === id) this.#held.delete(key);
  }

  /** The tab moved to another document, size or color scheme: no viewer is shown what it was before. */
  stale(tab: Tab): void {
    tab.frame = null;
    for (const entry of this.#streams.values()) if (entry.tabId === tab.id) entry.stream.forget();
    for (const viewer of this.#pushes.values()) if (viewer.tab.id === tab.id) viewer.stream.refresh();
  }

  /** The tab's renderer died with its screencasts: the next frame starts a new one on the page loaded again. */
  restart(tab: Tab): void {
    tab.frame = null;
    for (const [key, entry] of this.#streams) if (entry.tabId === tab.id) this.#stopStream(key);
    for (const viewer of [...this.#pushes.values()]) if (viewer.tab.id === tab.id) this.#endPush(viewer, BrowserStreamClose.Reconnect, 'reconnect');
  }

  #stopStream(key: string): void {
    const entry = this.#streams.get(key);
    if (!entry) return;
    this.#streams.delete(key);
    clearTimeout(entry.idle);
    entry.stream.close();
  }

  /** Whether a viewer is shown the tab now: a screencast of it runs, or a viewer asked within the screencast's idle time. */
  watching(tabId: string): boolean {
    for (const entry of this.#streams.values()) if (entry.tabId === tabId) return true;
    for (const viewer of this.#pushes.values()) if (viewer.tab.id === tabId) return true;
    for (const viewer of this.#viewers.values()) if (viewer.tabId === tabId && Date.now() - viewer.requestedAt < STREAM_IDLE_MS) return true;
    for (const shown of this.#shown.values()) if (shown.tabId === tabId && Date.now() - shown.at < REMOTE_WATCH_MS) return true;
    return false;
  }

  /** A client shows the tab's own page: it is woken now and stays awake while the client keeps saying so. */
  async remoteWatch({ threadId, tabId }: RpcParams<'browser.remoteWatch'>, connection: Connection): Promise<{ ok: true }> {
    this.#viewer(threadId, connection);
    const tab = this.#context.tabOf(threadId, tabId);
    const key = `${connection.id}:${threadId}`;
    for (const [id, shown] of this.#shown) if (Date.now() - shown.at >= REMOTE_WATCH_MS) this.#shown.delete(id);
    if (this.#shown.size >= 32 && !this.#shown.has(key)) throw refused('too many remote browser viewers');
    this.#shown.set(key, { tabId: tab.id, at: Date.now() });
    await this.#context.use(tab, async () => {});
    return { ok: true };
  }

  /** Whether a viewer that asked within `withinMs` is shown this screencast. */
  #watched(key: string, withinMs = Infinity): boolean {
    for (const viewer of this.#viewers.values()) if (streamKey(viewer.tabId, viewer.options) === key && Date.now() - viewer.requestedAt < withinMs) return true;
    return false;
  }

  /** Stops the screencast once no viewer has asked for `STREAM_IDLE_MS` and none waits. */
  #idle(key: string): void {
    const entry = this.#streams.get(key);
    if (!entry) return;
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      if (entry.asking > 0 || this.#watched(key, STREAM_IDLE_MS)) this.#idle(key); else this.#stopStream(key);
    }, STREAM_IDLE_MS);
    (entry.idle as { unref?: () => void }).unref?.();
  }

  #viewer(threadId: ThreadId, connection: Connection): void {
    if (this.#context.require(threadId).archived || !connection.subscriptions.has(threadId)) throw refused('subscribe to the active conversation before watching its browser');
  }

  remoteStatus({ threadId }: RpcParams<'browser.remoteStatus'>, connection: Connection): AgentBrowserStatus {
    this.#viewer(threadId, connection);
    return this.#context.status({ threadId });
  }

  #capture(tab: Tab, maxWidth: number | undefined, quality: number): Promise<{ frame: RemoteBrowserFrame; page: PageInfo }> {
    return this.#context.screen(tab, () => captureFrame(tab.id, { evaluate: (script, ms) => this.#context.evaluate(tab, script, ms), send: (method, params, ms) => tab.engine.cdp.send(method, params ?? {}, tab.sessionId, ms) }, maxWidth, quality));
  }

  async remoteFrame({ threadId, tabId, maxWidth, quality, after }: RpcParams<'browser.remoteFrame'>, connection: Connection): Promise<RemoteBrowserFrame | RemoteBrowserUnchanged> {
    this.#viewer(threadId, connection);
    const options = { ...(maxWidth === undefined ? {} : { maxWidth }), ...(quality === undefined ? {} : { quality }), ...(after === undefined ? {} : { after }) };
    const problem = remoteFrameOptionsError(options);
    if (problem) throw refused(problem);
    const key = `${connection.id}:${threadId}`, previous = this.#viewers.get(key);
    if (previous && Date.now() - previous.requestedAt < 120) throw refused('wait before requesting another browser frame');
    for (const [id, value] of this.#viewers) if (Date.now() - value.requestedAt > 10_000) this.#viewers.delete(id);
    if (this.#viewers.size + this.#pushes.size >= VIEWERS_MAX && !previous) throw refused('too many remote browser viewers');
    const tab = this.#context.tabOf(threadId, tabId);
    const viewer: Viewer = { requestedAt: Date.now(), tabId: tab.id, options: { maxWidth, quality: quality ?? 55 }, frames: previous?.frames ?? [] };
    this.#viewers.set(key, viewer);
    // The desktop app's webviews have one DevTools session each, the agent's: no second one to stream on.
    return this.#context.use(tab, () => tab.engine.hosted ? this.#captured(tab, viewer, maxWidth, quality) : this.#streamed(tab, viewer, after));
  }

  /** A capture of a tab the desktop app hosts, shared by the viewers that ask within `FRAME_REUSE_MS`. */
  async #captured(tab: Tab, viewer: Viewer, maxWidth: number | undefined, quality: number | undefined): Promise<RemoteBrowserFrame> {
    const wanted = `${maxWidth ?? 0}:${quality ?? 55}`;
    if (!tab.frame || tab.frame.key !== wanted || Date.now() - tab.frame.at > FRAME_REUSE_MS) {
      const promise = this.#capture(tab, maxWidth, quality ?? 55);
      tab.frame = { at: Date.now(), key: wanted, promise };
      // A capture queued behind another is as fresh as the moment it ends, not when it was asked.
      promise.then(() => { if (tab.frame?.promise === promise) tab.frame.at = Date.now(); }, () => { if (tab.frame?.promise === promise) tab.frame = null; });
    }
    const captured = await tab.frame.promise;
    // Each viewer gets its own frame id: input names the frame it was aimed at.
    const frame = { ...captured.frame, id: crypto.randomUUID(), at: Date.now() };
    this.#keep(viewer, { frame: { ...frame, base64: '' }, page: captured.page, seq: -1 });
    return frame;
  }

  /** The page a viewer's input names: the one its stream shows now, or a frame it was sent within `FRAME_LIFE_MS`. */
  #saved(key: string, frameId: string): Saved | undefined {
    const push = this.#pushes.get(key), current = push?.frames.at(-1);
    return push?.frames.find(entry => entry.frame.id === frameId && (entry === current || Date.now() - entry.frame.at < FRAME_LIFE_MS))
      ?? this.#viewers.get(key)?.frames.find(entry => entry.frame.id === frameId && Date.now() - entry.frame.at < FRAME_LIFE_MS);
  }

  /**
   * The path of a stream of the tab's frames for this client, or `pull` for a
   * tab the desktop app hosts: its webview has one DevTools session, the
   * agent's, and no second one to stream on.
   */
  remoteStream({ threadId, tabId, maxWidth, quality }: RpcParams<'browser.remoteStream'>, connection: Connection): RemoteBrowserStream {
    this.#viewer(threadId, connection);
    const problem = remoteStreamOptionsError({ ...(maxWidth === undefined ? {} : { maxWidth }), ...(quality === undefined ? {} : { quality }) });
    if (problem) throw refused(problem);
    const tab = this.#context.tabOf(threadId, tabId);
    if (tab.engine.hosted) return { pull: true };
    const key = `${connection.id}:${threadId}`;
    for (const [ticket, entry] of this.#tickets) if (entry.expires <= Date.now() || entry.key === key) this.#tickets.delete(ticket);
    for (const [id, value] of this.#viewers) if (Date.now() - value.requestedAt > 10_000) this.#viewers.delete(id);
    if (this.#viewers.size + this.#pushes.size + this.#tickets.size >= VIEWERS_MAX && !this.#pushes.has(key)) throw refused('too many remote browser viewers');
    const ticket = randomBytes(24).toString('base64url');
    this.#tickets.set(ticket, { key, connection, threadId, tabId: tab.id, options: { maxWidth: maxWidth ?? DEFAULT_MAX_WIDTH, quality: quality ?? DEFAULT_QUALITY }, expires: Date.now() + TICKET_LIFE_MS });
    return { path: `${BROWSER_STREAM_ROUTE}/${ticket}` };
  }

  /** Whether `ticket` opens a stream now: the server upgrades no socket for another. */
  streamOffered(ticket: string): boolean {
    const entry = this.#tickets.get(ticket);
    return entry !== undefined && entry.expires > Date.now();
  }

  /**
   * The socket a ticket opened: its viewer is pushed the tab's frames until
   * the socket, its RPC connection, its subscription or the tab ends. Null,
   * with the socket closed, for a ticket that opens nothing (any more).
   */
  openStream(ticket: string, peer: StreamPeer): StreamHandle | null {
    const entry = this.#tickets.get(ticket);
    this.#tickets.delete(ticket);
    if (!entry || entry.expires <= Date.now()) { peer.close(BrowserStreamClose.Refused, 'unknown stream'); return null; }
    let tab: Tab;
    try { this.#viewer(entry.threadId, entry.connection); } catch { peer.close(BrowserStreamClose.Refused, 'not subscribed'); return null; }
    try { tab = this.#context.tabOf(entry.threadId, entry.tabId); } catch { peer.close(BrowserStreamClose.TabGone, 'tab closed'); return null; }
    const previous = this.#pushes.get(entry.key);
    if (previous) this.#endPush(previous, 1000, 'replaced');
    const stream = new PushStream(tab.engine.cdp, tab.targetId, entry.options, run => this.#context.screen(tab, run));
    const viewer: PushViewer = {
      key: entry.key, connection: entry.connection, threadId: entry.threadId, tab, stream, peer, frames: [], closed: false,
      wire: new StreamWire(picture => { void this.#deliver(viewer, picture); }),
    };
    this.#pushes.set(entry.key, viewer);
    stream.attach(picture => viewer.wire.offer(picture));
    // The tab is woken for its first picture, and `watching` keeps it awake from here.
    this.#context.use(tab, () => stream.start()).catch(() => this.#endPush(viewer, BrowserStreamClose.Reconnect, 'reconnect'));
    return {
      message: text => {
        const message = ((): { type?: unknown; maxWidth?: unknown } | null => { try { return JSON.parse(text) as { type?: unknown } | null; } catch { return null; } })();
        if (viewer.closed || typeof message !== 'object' || message === null) return;
        if (message.type === 'ack') viewer.wire.acked();
        else if (message.type === 'size' && typeof message.maxWidth === 'number' && remoteStreamOptionsError({ maxWidth: message.maxWidth }) === null) stream.resize(message.maxWidth);
      },
      closed: () => this.#endPush(viewer, 1000, 'viewer gone'),
    };
  }

  /**
   * One picture on its way to a viewer, after the page it shows: a `page`
   * message first whenever that page is not the one the last picture showed,
   * so the viewer's input always names what it sees.
   */
  async #deliver(viewer: PushViewer, picture: Picture): Promise<void> {
    if (viewer.closed) return;
    try { this.#viewer(viewer.threadId, viewer.connection); } catch { this.#endPush(viewer, BrowserStreamClose.Refused, 'not subscribed'); return; }
    const page = await this.#context.evaluate(viewer.tab, PAGE_INFO_SCRIPT, 5000).catch(() => null) as PageInfo | null;
    if (viewer.closed) return;
    try { this.#viewer(viewer.threadId, viewer.connection); } catch { this.#endPush(viewer, BrowserStreamClose.Refused, 'not subscribed'); return; }
    // Between two documents the page answers nothing yet: this picture is dropped, and a still follows.
    if (!page) { viewer.wire.acked(); viewer.stream.refresh(); return; }
    const title = String(page.title ?? '').slice(0, 200), url = String(page.href ?? '').slice(0, REMOTE_URL_MAX);
    const current = viewer.frames.at(-1);
    try {
      if (!current || current.page.width !== page.width || current.page.height !== page.height || current.page.href !== page.href || current.page.origin !== page.origin || current.frame.title !== title) {
        // Input aimed at the page before stays valid for as long as a frame's would.
        if (current) current.frame.at = Date.now();
        const frame: RemoteBrowserFrame = { id: crypto.randomUUID(), tabId: viewer.tab.id, title, width: page.width, height: page.height, base64: '', at: Date.now(), url };
        viewer.frames = [...viewer.frames, { frame, page, seq: -1 }].slice(-8);
        const { base64: _picture, ...shown } = frame;
        viewer.peer.text(JSON.stringify({ type: 'page', page: shown } satisfies RemoteStreamMessage));
      }
      // A viewer that reads slower than it is sent is disconnected, not buffered for.
      if (viewer.peer.buffered() + picture.jpeg.byteLength + 14 > MAX_SOCKET_BUFFER_BYTES) { viewer.peer.drop(); this.#endPush(viewer, BrowserStreamClose.Slow, 'slow viewer'); return; }
      viewer.peer.binary(picture.jpeg);
    } catch {
      this.#endPush(viewer, 1011, 'the connection dropped');
    }
  }

  #endPush(viewer: PushViewer, code: number, reason: string): void {
    if (viewer.closed) return;
    viewer.closed = true;
    if (this.#pushes.get(viewer.key) === viewer) this.#pushes.delete(viewer.key);
    viewer.wire.close();
    viewer.stream.close();
    try { viewer.peer.close(code, reason); } catch { /* already gone */ }
  }

  #keep(viewer: Viewer, saved: Saved): void {
    viewer.frames.push(saved);
    viewer.frames = viewer.frames.filter(entry => Date.now() - entry.frame.at < FRAME_LIFE_MS).slice(-8);
  }

  /** A frame of the tab's screencast newer than the one the viewer holds, or `unchanged` when the page drew nothing new. */
  async #streamed(tab: Tab, viewer: Viewer, after: string | undefined): Promise<RemoteBrowserFrame | RemoteBrowserUnchanged> {
    const key = streamKey(tab.id, viewer.options);
    let entry = this.#streams.get(key);
    if (!entry) {
      const stream = new ViewerStream(tab.engine.cdp, tab.targetId, async () => await this.#context.evaluate(tab, PAGE_INFO_SCRIPT, 5000) as PageInfo | null);
      this.#streams.set(key, entry = { tabId: tab.id, options: viewer.options, stream, asking: 0 });
    }
    const { stream, options } = entry, started = Date.now();
    // A screencast that could not start is not kept: the next request starts another.
    const configure = (force = false) => stream.configure(options, force).catch(error => {
      if (this.#streams.get(key) === entry) this.#stopStream(key);
      throw error;
    });
    entry.asking++;
    try {
      await configure();
      const held = after === undefined ? undefined : viewer.frames.find(saved => saved.frame.id === after && saved.frame.tabId === tab.id && saved.seq >= 0);
      let next = await stream.next(held?.seq ?? -1, held ? UNCHANGED_WAIT_MS : FIRST_FRAME_WAIT_MS);
      if (stream.closed) throw refused('that browser tab is closed');
      if (!next && held) {
        // Input aimed at the frame it still shows stays valid.
        held.frame.at = Date.now();
        return { unchanged: true, id: held.frame.id, tabId: tab.id, at: Date.now(), waitedMs: Date.now() - started };
      }
      if (!next) {
        // A screencast that drew nothing yet sends its first picture when started again.
        await configure(true);
        next = await stream.next(-1, FIRST_FRAME_WAIT_MS);
      }
      if (stream.closed) throw refused('that browser tab is closed');
      const page = next ? await stream.info(next) : null;
      // Looked at, even unusable: Chrome draws the next one.
      if (next) stream.take();
      // Between two documents the page answers nothing yet.
      if (!next || !page) throw refused('the page is loading; ask for the next frame');
      const frame: RemoteBrowserFrame = {
        id: crypto.randomUUID(), tabId: tab.id, title: String(page.title ?? '').slice(0, 200), width: page.width, height: page.height,
        base64: next.data, at: Date.now(), url: String(page.href ?? '').slice(0, REMOTE_URL_MAX), waitedMs: Date.now() - started,
      };
      this.#keep(viewer, { frame: { ...frame, base64: '' }, page, seq: next.seq });
      return frame;
    } finally {
      entry.asking--;
      this.#idle(key);
    }
  }

  async remoteInput({ threadId, frameId, input }: RpcParams<'browser.remoteInput'>, connection: Connection): Promise<{ ok: true; picker?: RemoteBrowserPicker }> {
    this.#viewer(threadId, connection);
    const problem = remoteBrowserInputError(input);
    if (problem) throw refused(problem);
    const key = `${connection.id}:${threadId}`, held = this.#held.get(key);
    const saved = this.#saved(key, frameId);
    if (!saved) {
      // A release ends only this viewer's own drag: it still goes out once the frames the viewer
      // could aim at expired, so a link that stalled mid-drag never leaves the page's button down.
      if (input.kind === 'pointer' && input.action === 'up' && held) { this.#held.delete(key); await this.#release(held); return { ok: true }; }
      throw refused('refresh the live browser before interacting');
    }
    const tab = this.#context.tabOf(threadId, saved.frame.tabId);
    // The button is held on another tab, the one the viewer showed before: it is let go there,
    // and a release that this ends has nothing left to do on the new tab.
    if (input.kind === 'pointer' && held && held.tabId !== tab.id) {
      this.#held.delete(key);
      await this.#release(held);
      if (input.action === 'up') return { ok: true };
    }
    const pressing = input.kind === 'pointer' && input.action === 'down' ? { left: false } : null;
    if (pressing) this.#pressing.set(key, pressing);
    let result: Awaited<ReturnType<RemoteDrive['remoteInput']>>;
    try { result = await this.#context.use(tab, () => this.#input(tab, saved, input)); }
    finally { if (pressing && this.#pressing.get(key) === pressing) this.#pressing.delete(key); }
    if (input.kind === 'pointer') {
      const point = { x: Math.min(saved.page.width - 1, input.x * saved.page.width), y: Math.min(saved.page.height - 1, input.y * saved.page.height) };
      // The viewer left before its press landed: nobody will let go of it.
      if (pressing?.left) await this.#release({ threadId, tabId: tab.id, point });
      else if (input.action === 'up') this.#held.delete(key);
      else if (input.action === 'down' || (input.buttons && held?.tabId === tab.id)) this.#held.set(key, { threadId, tabId: tab.id, point });
    }
    return result;
  }

  /** Lets go of a button a viewer left held, where it was last seen. A tab already gone has nothing to let go. */
  async #release(held: { threadId: ThreadId; tabId: string; point: { x: number; y: number } }): Promise<void> {
    let tab: Tab;
    try { tab = this.#context.tabOf(held.threadId, held.tabId); } catch { return; }
    await this.#context.use(tab, () => this.#pointer(tab, 'up', held.point, 0));
    tab.frame = null;
  }

  async #input(tab: Tab, saved: Saved, input: RpcParams<'browser.remoteInput'>['input']): Promise<{ ok: true; picker?: RemoteBrowserPicker }> {
    const changed = () => refused('the page changed; wait for a fresh frame before interacting');
    const retire = () => {
      this.stale(tab);
      for (const viewer of this.#viewers.values()) viewer.frames = viewer.frames.filter(entry => entry.frame.tabId !== tab.id);
      // A pushed viewer's next picture names a new page: nothing aimed at the old one lands on the new.
      for (const viewer of this.#pushes.values()) if (viewer.tab.id === tab.id) viewer.frames = [];
    };
    switch (input.kind) {
      case 'navigate': retire(); await this.#context.send(tab, 'Page.navigate', { url: input.url }); return { ok: true };
      case 'reload': retire(); await this.#context.send(tab, 'Page.reload'); return { ok: true };
      case 'history': {
        retire();
        const history = await this.#context.send(tab, 'Page.getNavigationHistory') as { currentIndex: number; entries: Array<{ id: number }> };
        const entry = history.entries[history.currentIndex + (input.direction === 'back' ? -1 : 1)];
        if (entry) await this.#context.send(tab, 'Page.navigateToHistoryEntry', { entryId: entry.id });
        return { ok: true };
      }
      case 'viewport':
        retire(); await this.#context.screen(tab, () => this.#context.send(tab, 'Emulation.setDeviceMetricsOverride', { width: input.width, height: input.height, deviceScaleFactor: RENDER_SCALE, mobile: false }), true);
        tab.preset = null; this.stale(tab); return { ok: true };
      case 'reset-viewport': retire(); await this.#context.screen(tab, () => this.#context.send(tab, 'Emulation.clearDeviceMetricsOverride'), true); tab.preset = null; this.stale(tab); return { ok: true };
      default: break;
    }
    // The size the viewer aimed at is known without the page: a tap on another one is refused before a read of it.
    if ((input.kind === 'tap' || input.kind === 'drag' || input.kind === 'choose' || input.kind === 'pointer') && (input.width !== saved.frame.width || input.height !== saved.frame.height)) throw refused('the browser viewport changed; refresh before tapping');
    // A mouse moving or let go goes out at once, on the page of the frame it was aimed at:
    // a read of the page before each would space the path and leave the button held between two.
    if (input.kind === 'pointer' && input.action !== 'down') {
      await this.#pointer(tab, input.action, { x: Math.min(saved.page.width - 1, input.x * saved.page.width), y: Math.min(saved.page.height - 1, input.y * saved.page.height) }, input.buttons ?? 0);
      tab.frame = null;
      return { ok: true };
    }
    // Read in turn with captures: a scaled one in flight resizes the page for its shot.
    const page = await this.#context.screen(tab, () => this.#context.evaluate(tab, PAGE_INFO_SCRIPT, 5000), true) as PageInfo;
    const same = page.width === saved.page.width && page.height === saved.page.height && page.href === saved.page.href && page.origin === saved.page.origin;
    if (!same) throw changed();
    const at = (x: number, y: number) => ({ x: Math.min(page.width - 1, x * page.width), y: Math.min(page.height - 1, y * page.height) });
    switch (input.kind) {
      case 'tap': {
        const point = at(input.x, input.y);
        // A plain tap on a <select> focuses it and answers its options: Chrome's own list would open on this machine, in no frame.
        const picker = (input.count ?? 1) === 1 && !input.shift ? await this.#context.evaluate(tab, pickerScript(point.x, point.y, REMOTE_PICKER_MAX), 5000) as RemoteBrowserPicker | null : null;
        if (picker) { await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }); tab.frame = null; return { ok: true, picker }; }
        await this.#click(tab, point, input.count ?? 1, input.shift === true); break;
      }
      case 'choose': {
        const point = at(input.x, input.y);
        if (!await this.#context.evaluate(tab, chooseScript(point.x, point.y, input.index, input.label), 5000)) throw refused('that option cannot be chosen: the list changed or the option is disabled');
        break;
      }
      case 'drag': await this.#drag(tab, at(input.from.x, input.from.y), at(input.to.x, input.to.y)); break;
      case 'pointer': await this.#pointer(tab, input.action, at(input.x, input.y), 1); break;
      case 'press': for (const key of input.keys) await press(tab.page, key); break;
      case 'select-all':
        // The editing command is named: headless, no browser menu turns Control+A into it.
        await this.#context.send(tab, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
        await this.#context.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        break;
      case 'text':
        if (!await this.#context.evaluate(tab, EDITABLE_SCRIPT, 5000)) throw refused('tap a text field in the page first');
        await this.#context.send(tab, 'Input.insertText', { text: input.text }); break;
      case 'key': await this.#key(tab, input.key); break;
      case 'scroll': {
        // The wheel lands where the finger started, so an inner scrolling panel moves instead of the page.
        const point = input.at ? at(input.at.x, input.at.y) : { x: page.width / 2, y: page.height / 2 };
        await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: input.x, deltaY: input.y });
        // Pictures are sent smaller only while a viewer scrolls (`push-stream.ts`).
        for (const viewer of this.#pushes.values()) if (viewer.tab.id === tab.id) viewer.stream.scrolledAt = Date.now();
        break;
      }
    }
    tab.frame = null;
    return { ok: true };
  }

  /** What a viewer's copy takes: the selection of the tab its frame showed. */
  async remoteSelection({ threadId, frameId }: RpcParams<'browser.remoteSelection'>, connection: Connection): Promise<RemoteBrowserSelection> {
    this.#viewer(threadId, connection);
    const saved = this.#saved(`${connection.id}:${threadId}`, frameId);
    if (!saved) throw refused('refresh the live browser before copying');
    const tab = this.#context.tabOf(threadId, saved.frame.tabId);
    const text = String(await this.#context.use(tab, () => this.#context.evaluate(tab, selectionScript(REMOTE_SELECTION_MAX), 5000)) ?? '');
    return { text: text.slice(0, REMOTE_SELECTION_MAX), truncated: text.length > REMOTE_SELECTION_MAX };
  }

  async #key(tab: Tab, key: keyof typeof KEY_CODES): Promise<void> {
    const keyCode = KEY_CODES[key];
    await this.#context.send(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await this.#context.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode });
  }

  /** `count` is the click's rank in a double or triple click; Shift extends the selection to the point. */
  async #click(tab: Tab, point: { x: number; y: number }, count = 1, shift = false): Promise<void> {
    const modifiers = shift ? 8 : 0;
    await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, modifiers });
    await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: count, modifiers });
    await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: count, modifiers });
  }

  /** The button held from one point to the other, through a few steps so the page sees a drag and not a jump. */
  async #drag(tab: Tab, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 4; step++) {
      await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 4, y: from.y + (to.y - from.y) * step / 4, button: 'left', buttons: 1 });
    }
    await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', clickCount: 1 });
  }

  /** The viewer's own mouse, one event as it happened: `buttons` 1 while the left button is held. */
  async #pointer(tab: Tab, action: 'move' | 'down' | 'up', point: { x: number; y: number }, buttons: 0 | 1): Promise<void> {
    if (action === 'move') {
      await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: buttons ? 'left' : 'none', buttons });
      return;
    }
    if (action === 'down') await this.#context.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0 });
    await this.#context.send(tab, 'Input.dispatchMouseEvent', {
      type: action === 'down' ? 'mousePressed' : 'mouseReleased', ...point, button: 'left', buttons: action === 'down' ? 1 : 0, clickCount: 1,
    });
  }

  disconnect(connectionId: string): void {
    for (const id of this.#viewers.keys()) if (id.startsWith(`${connectionId}:`)) this.#viewers.delete(id);
    for (const [ticket, entry] of this.#tickets) if (entry.connection.id === connectionId) this.#tickets.delete(ticket);
    for (const viewer of [...this.#pushes.values()]) if (viewer.connection.id === connectionId) this.#endPush(viewer, 1000, 'viewer gone');
    // A viewer gone mid-drag lets go of the page.
    for (const [id, held] of this.#held) if (id.startsWith(`${connectionId}:`)) { this.#held.delete(id); void this.#release(held).catch(() => {}); }
    for (const [id, pressing] of this.#pressing) if (id.startsWith(`${connectionId}:`)) pressing.left = true;
    // A screencast nobody else watches stops now, not at its idle timer.
    for (const [key, entry] of this.#streams) if (!entry.asking && !this.#watched(key)) this.#stopStream(key);
  }

  close(): void {
    for (const key of [...this.#streams.keys()]) this.#stopStream(key);
    this.#tickets.clear();
    for (const viewer of [...this.#pushes.values()]) this.#endPush(viewer, 1001, 'core stopping');
  }
}
