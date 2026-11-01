/*
 * `boite window read`, `point`, `wait-click` and `unpoint`: an agent guides
 * the person at the machine instead of acting for them. It reads the controls
 * of a window as a few lines of text, draws a click-through box with a label
 * over the one to press, and waits for the person's click there. The OS half
 * is `ProcessPlatform.windowGuide`, loaded by the first call. The box is the
 * desktop app's to draw: the core sends it `windows.pointer` events with where
 * the control is, and refuses when no desktop app of this machine is open.
 *
 * Reading a window's controls is consented like a capture of it (`read` on the
 * card); a box drawn over a rectangle of a window reads nothing and asks
 * nothing. Excluded apps, minimized windows and a turn a contact wrote into
 * are refused as `DesktopWindows` refuses them. The box never focuses the
 * window and sends it nothing: the person clicks the control under it. Control
 * names never go to the log. See docs/windows.md.
 */
import {
  WINDOW_POINT_LABEL_MAX,
  WINDOW_POINT_PAD,
  WINDOW_POINT_SECONDS,
  WINDOW_READ_LIMIT,
  windowCropError,
  type RpcParams,
  type RpcResult,
  type ThreadSummary,
  type WindowControl,
  type WindowCrop,
  type WindowPointer,
  type WindowTarget,
  type WindowWaitEnd,
} from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import type { NativeWindow, ScreenRect, TrackedControl, WindowGuide } from '../platform/types.ts';
import type { Connection } from '../router.ts';
import { cropRect } from './image.ts';

/** How many controls a read asks the OS for before `filter` and `limit` keep some. */
const READ_SCAN = 2_000;
const FILTER_MAX = 100;
/** How long a box stays after a wait on it ends without a click, at least. */
const WAIT_GRACE_MS = 30_000;
/**
 * How long a followed control of a Chromium or Electron window stays put
 * before its box shows again. Those apps report where a control is in bursts
 * while it scrolls (measured in Discord on 2026-11-01: 4 positions for 12
 * wheel notches in 0.9 s, up to 356 ms apart, the last ~200 ms after the
 * scroll), so a box drawn on each answer would trail the control. The box
 * hides on the first move instead, which comes within ~20 ms, and shows where
 * the control settled. Other apps answer with the control's place at each
 * step, and their box follows every one.
 */
const SETTLE_MS = 450;
/**
 * Chromium and Electron apps (Discord, Slack, VS Code) build their controls
 * only while their window is in front: covered by another, Discord answered no
 * control at all (2026-11-01). Reading or pointing in one brings it to the
 * front through the desktop app, which draws a frame around it saying why.
 */
const CHROMIUM_CLASS = /^Chrome_WidgetWin_/;
/** How long a read waits for the desktop app to bring such a window to the front. */
const FRONT_WAIT_MS = 1_500;
/** How long that frame stays once no box shows in the window, for the agent's next step. */
const FRAME_IDLE_MS = 15_000;
/** How often the frame follows its window. */
const FRAME_FOLLOW_MS = 100;
/** How often a box whose control the app dropped looks for it again, in milliseconds. */
const RETRACK_MS = 1_000;

export interface WindowGuidesOptions {
  /** How often a box follows its window and its control. */
  followMs?: number;
  /** How often a wait reads the mouse: a click holds the button down for 50 ms or more. */
  mouseMs?: number;
  /** How long a followed control must stay put in its window before its box shows again. */
  settleMs?: number;
  /** How long the frame around a Chromium window stays once no box shows in it. */
  frameIdleMs?: number;
}

/** What `DesktopWindows` lends the guide: its conversation and window checks. */
export interface WindowGuideHost {
  activeThread(threadId: string, connection?: Connection): ThreadSummary;
  grantedWindow(thread: ThreadSummary, target: WindowTarget, kind: 'read' | null, connection?: Connection): Promise<NativeWindow>;
}

/** The controls a conversation last read, numbered from 1, with the window they belong to. */
interface Snapshot {
  window: NativeWindow;
  controls: WindowControl[];
}

/** The box a conversation shows: where it is in its window, and who waits for a click in it. */
interface Shown {
  pointer: WindowPointer;
  window: NativeWindow;
  /** The id of its `windows.pointer` events. */
  boxId: string;
  /** On the screen now; null while the window is minimized. */
  screen: ScreenRect | null;
  follow: ReturnType<typeof setInterval>;
  expiry: ReturnType<typeof setTimeout>;
  /**
   * The control, held live, for a box pointed at one: the box follows it as
   * the window scrolls. Null for a rectangle, or while the app dropped it.
   */
  tracked: TrackedControl | null;
  /** The control the box shows, when it was named by id or by name. */
  control: WindowControl | null;
  /** Where the followed control last was in its window, and since when: the box shows once it stays put. */
  seen?: { rect: ScreenRect | null; since: number };
  /** Set once the app dropped the control: the box hides until it is found again. */
  lost?: { nextAt: number; looking: boolean };
  waiters: Set<(end: BoxEnd) => void>;
  /** The agent hears how the box ended as a message, when no wait took the click. */
  notify: boolean;
  /** Reads the mouse while a wait or `notify` needs the click. */
  clicks: ReturnType<typeof setInterval> | null;
}

type BoxEnd = WindowWaitEnd | 'clicked';

/** The frame around a Chromium window a conversation guides in. */
interface Frame {
  window: NativeWindow;
  boxId: string;
  rect: ScreenRect | null;
  follow: ReturnType<typeof setInterval>;
  /** Takes the frame away once no box has shown in the window for `FRAME_IDLE_MS`. */
  idle: ReturnType<typeof setTimeout> | null;
}

const sameRect = (a: ScreenRect | null, b: ScreenRect | null) =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
/** A control scrolled under the window's edge is out of view, whatever its app says. */
const centerInside = (rect: ScreenRect, frame: ScreenRect) => {
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  return x >= frame.left && x < frame.left + frame.width && y >= frame.top && y < frame.top + frame.height;
};
const controlLine = (control: WindowControl) => `  #${control.id} ${control.type} "${control.name}"`;

export class WindowGuides {
  readonly #core: Core;
  readonly #host: WindowGuideHost;
  readonly #loader: () => Promise<WindowGuide | { unavailable: string }>;
  readonly #followMs: number;
  readonly #mouseMs: number;
  readonly #settleMs: number;
  readonly #frameIdleMs: number;
  #backend?: Promise<WindowGuide | { unavailable: string }>;
  readonly #snapshots = new Map<string, Snapshot>();
  readonly #shown = new Map<string, Shown>();
  readonly #frames = new Map<string, Frame>();

  constructor(core: Core, host: WindowGuideHost, loader: () => Promise<WindowGuide | { unavailable: string }>, options: WindowGuidesOptions = {}) {
    this.#core = core;
    this.#host = host;
    this.#loader = loader;
    this.#followMs = options.followMs ?? 33;
    this.#mouseMs = options.mouseMs ?? 25;
    this.#settleMs = options.settleMs ?? SETTLE_MS;
    this.#frameIdleMs = options.frameIdleMs ?? FRAME_IDLE_MS;
  }

  async read({ threadId, target, filter, limit, any }: RpcParams<'windows.read'>, connection?: Connection): Promise<RpcResult<'windows.read'>> {
    const thread = this.#host.activeThread(threadId, connection);
    if (any !== undefined && typeof any !== 'boolean') throw invalidParams('any must be true or false', { field: 'any' });
    if (filter !== undefined && (typeof filter !== 'string' || filter.trim() === '' || filter.length > FILTER_MAX || /\p{Cc}/u.test(filter))) {
      throw invalidParams(`filter must be 1 to ${FILTER_MAX} characters with no control characters`, { field: 'filter' });
    }
    const max = limit ?? WINDOW_READ_LIMIT.default;
    if (!Number.isInteger(max) || max < 1 || max > WINDOW_READ_LIMIT.max) throw invalidParams(`limit must be a whole number from 1 to ${WINDOW_READ_LIMIT.max}`, { field: 'limit' });
    const guide = await this.#load();
    const window = await this.#host.grantedWindow(thread, target, 'read', connection);
    await this.#front(thread.id, guide, window);
    const snapshot = await this.#read(thread, guide, window, any === true);
    if (!this.#shown.has(thread.id)) this.#frameLater(thread.id);
    const wanted = filter?.trim().toLowerCase();
    const matching = wanted === undefined ? snapshot.controls : snapshot.controls.filter(control => control.name.toLowerCase().includes(wanted));
    return { windowId: window.id, process: window.process, controls: matching.slice(0, max), total: matching.length };
  }

  async point(params: RpcParams<'windows.point'>, connection?: Connection): Promise<RpcResult<'windows.point'>> {
    const thread = this.#host.activeThread(params.threadId, connection);
    const { control: id, target, name, at } = params;
    const given = [id, name, at].filter(value => value !== undefined).length;
    if (given !== 1) throw invalidParams('point needs exactly one of control, name or at', { field: 'control' });
    const label = params.label ?? '';
    if (typeof label !== 'string' || label.length > WINDOW_POINT_LABEL_MAX || /\p{Cc}/u.test(label)) {
      throw invalidParams(`label must be at most ${WINDOW_POINT_LABEL_MAX} characters with no control characters`, { field: 'label' });
    }
    const seconds = this.#seconds(params.seconds, 'seconds');
    const shape = params.shape ?? 'box';
    if (shape !== 'box' && shape !== 'round') throw invalidParams('shape must be box or round', { field: 'shape' });
    const pad = params.pad ?? WINDOW_POINT_PAD.default;
    if (typeof pad !== 'number' || !Number.isInteger(pad) || pad < 0 || pad > WINDOW_POINT_PAD.max) {
      throw invalidParams(`pad must be a whole number of pixels from 0 to ${WINDOW_POINT_PAD.max}`, { field: 'pad' });
    }
    const look = { shape, pad };
    const notify = params.notify ?? false;
    if (typeof notify !== 'boolean') throw invalidParams('notify must be true or false', { field: 'notify' });
    if (params.any !== undefined && typeof params.any !== 'boolean') throw invalidParams('any must be true or false', { field: 'any' });

    // Every check that needs no OS comes first: a machine without the guide refuses the same bad call the same way.
    let window: NativeWindow;
    let box: { x: number; y: number; width: number; height: number };
    let control: WindowControl | undefined;
    if (id !== undefined) {
      if (target !== undefined) throw invalidParams('a control id already names its window: drop the target', { field: 'target' });
      if (!Number.isInteger(id) || id < 1) throw invalidParams('control must be an id such as 3 from `boite window read`', { field: 'control' });
      const snapshot = this.#snapshots.get(thread.id);
      if (!snapshot) throw refused('nothing was read in this conversation yet: run `boite window read` first', { field: 'control' });
      control = snapshot.controls.find(candidate => candidate.id === id);
      if (!control) throw refused(`#${id} is not among the ${snapshot.controls.length} controls of the last read: read the window again`, { field: 'control' });
      window = await this.#host.grantedWindow(thread, { id: snapshot.window.id }, null, connection);
      if (window.pid !== snapshot.window.pid || window.path !== snapshot.window.path) {
        throw refused(`window ${snapshot.window.id} of ${snapshot.window.process} is gone: read again`, { windowId: snapshot.window.id, code: 'gone' });
      }
      box = control;
      await this.#front(thread.id, await this.#load(), window);
    } else if (name !== undefined) {
      if (target === undefined) throw invalidParams('point by name needs the window\'s target', { field: 'target' });
      if (typeof name !== 'string' || name.trim() === '' || name.length > 260 || /\p{Cc}/u.test(name)) {
        throw invalidParams('name must be 1 to 260 characters with no control characters', { field: 'name' });
      }
      const guide = await this.#load();
      window = await this.#host.grantedWindow(thread, target, 'read', connection);
      await this.#front(thread.id, guide, window);
      const snapshot = await this.#read(thread, guide, window, params.any === true);
      control = this.#named(snapshot, name.trim());
      box = control;
    } else {
      if (target === undefined) throw invalidParams('point at a rectangle needs the window\'s target', { field: 'target' });
      const problem = windowCropError(at);
      if (problem) throw invalidParams(problem.replace(/^crop/, 'at').replace(/a crop/, 'a rectangle'), { field: 'at' });
      window = await this.#host.grantedWindow(thread, target, null, connection);
      box = this.#rectangle(window, at!);
    }

    const guide = await this.#load();
    const frame = guide.frame(window.id);
    if (frame === null) throw refused(`window ${window.id} of ${window.process} is gone`, { windowId: window.id, code: 'gone' });
    const screen = { left: frame.rect.left + box.x, top: frame.rect.top + box.y, width: box.width, height: box.height };
    // Without a label, a control's box says its name.
    const shownLabel = label === '' && control ? control.name.slice(0, WINDOW_POINT_LABEL_MAX) : label;
    // The previous box goes first, so the desktop app hands its window to the new one.
    this.#remove(thread.id, 'cleared');
    const boxId = newId('box_');
    if (this.#core.subscribers.pointer({ id: boxId, rect: frame.minimized ? null : screen, label: shownLabel, look }) === 0) {
      throw refused('the box is drawn by the Boite desktop app of this computer, and none is open: ask the user to open Boite', { code: 'no-app' });
    }
    const pointer: WindowPointer = {
      windowId: window.id, process: window.process, label: shownLabel,
      x: box.x, y: box.y, width: box.width, height: box.height, expiresAt: Date.now() + seconds * 1000, look,
      ...(control ? { control: { type: control.type, name: control.name } } : {}),
      ...(frame.above ? { behind: true as const } : {}),
      ...(notify ? { notify: true as const } : {}),
    };
    let tracked: TrackedControl | null = null;
    if (control) {
      try { tracked = await guide.track(window.id, { type: control.type, name: control.name, automationId: control.automationId ?? '', rect: screen }); }
      catch { /* not followed: the box keeps its place in the window */ }
    }
    const shown: Shown = {
      pointer, window, boxId, screen: frame.minimized ? null : screen, waiters: new Set(), tracked, control: control ?? null, notify, clicks: null,
      // Settled already where it was read: the box shows at once.
      ...(tracked && !frame.minimized ? { seen: { rect: { left: box.x, top: box.y, width: box.width, height: box.height }, since: 0 } } : {}),
      follow: setInterval(() => this.#follow(thread.id, shown, guide), this.#followMs),
      expiry: setTimeout(() => this.#remove(thread.id, 'timeout', shown), seconds * 1000),
    };
    shown.follow.unref?.();
    shown.expiry.unref?.();
    this.#shown.set(thread.id, shown);
    if (notify) this.#watchClicks(thread.id, shown, guide);
    const framed = this.#frames.get(thread.id);
    if (framed?.idle) { clearTimeout(framed.idle); framed.idle = null; }
    this.#core.logs.info(`Pointed at a ${control?.type ?? 'rectangle'} of window ${window.id} of ${window.process}`, { source: 'windows', event: 'window.point', threadId: thread.id, data: { windowId: window.id, process: window.process, width: box.width, height: box.height } });
    return { pointer: { ...pointer } };
  }

  async waitClick({ threadId, timeoutSeconds }: RpcParams<'windows.waitClick'>, connection?: Connection): Promise<RpcResult<'windows.waitClick'>> {
    const thread = this.#host.activeThread(threadId, connection);
    const seconds = this.#seconds(timeoutSeconds, 'timeoutSeconds');
    const shown = this.#shown.get(thread.id);
    if (!shown) throw refused('nothing is pointed at in this conversation: run `boite window point` first', { threadId });
    const guide = await this.#load();
    // The box outlives the wait, even when it was drawn for less, so a wait that times out can be followed by another.
    const until = Date.now() + seconds * 1000 + WAIT_GRACE_MS;
    if (until > shown.pointer.expiresAt) {
      clearTimeout(shown.expiry);
      shown.pointer.expiresAt = until;
      shown.expiry = setTimeout(() => this.#remove(thread.id, 'timeout', shown), until - Date.now());
      shown.expiry.unref?.();
    }
    const end = await new Promise<BoxEnd>(resolve => {
      const timer = setTimeout(() => finish('timeout'), seconds * 1000);
      const finish = (reason: BoxEnd) => {
        clearTimeout(timer);
        shown.waiters.delete(finish);
        if (shown.waiters.size === 0 && !shown.notify && shown.clicks) { clearInterval(shown.clicks); shown.clicks = null; }
        resolve(reason);
      };
      shown.waiters.add(finish);
      this.#watchClicks(thread.id, shown, guide);
    });
    return end === 'clicked' ? { clicked: true, pointer: { ...shown.pointer } } : { clicked: false, reason: end };
  }

  /** Reads the mouse until a press inside the box ends it; a button already held when it starts is not that click. */
  #watchClicks(threadId: string, shown: Shown, guide: WindowGuide): void {
    if (shown.clicks) return;
    let held = true;
    shown.clicks = setInterval(() => {
      let mouse: { pressed: boolean; x: number; y: number };
      try { mouse = guide.mouse(); } catch { return; }
      const at = shown.screen;
      if (mouse.pressed && !held && at !== null && mouse.x >= at.left && mouse.x < at.left + at.width && mouse.y >= at.top && mouse.y < at.top + at.height) {
        this.#core.logs.info(`The person clicked the box over window ${shown.window.id} of ${shown.window.process}`, { source: 'windows', event: 'window.click', threadId, data: { windowId: shown.window.id, process: shown.window.process } });
        this.#remove(threadId, 'clicked', shown);
        return;
      }
      held = mouse.pressed;
    }, this.#mouseMs);
    shown.clicks.unref?.();
  }

  /** Without a wait to take it, how the box ended reaches the agent as a message, as an answer to `boite ask` does. */
  #tell(threadId: string, shown: Shown, why: BoxEnd): void {
    const { pointer } = shown;
    const what = pointer.control ? `${pointer.control.type} "${pointer.control.name}"` : `the ${pointer.width}x${pointer.height} rectangle at ${pointer.x},${pointer.y}`;
    const where = `${what} in window ${pointer.windowId} (${pointer.process})`;
    const text = why === 'clicked' ? `Boite: the user clicked the box on ${where}; the box is gone.`
      : why === 'timeout' ? `Boite: the box on ${where} timed out without a click.`
      : `Boite: the window under the box on ${where} closed before a click.`;
    try { this.#core.threads.deferred.deliverAnswer(threadId, text); }
    catch (error) { this.#core.logs.warn(`The end of a box could not reach its conversation: ${messageOf(error)}`, { source: 'windows', event: 'window.notify', threadId }); }
  }

  unpoint({ threadId }: RpcParams<'windows.unpoint'>, connection?: Connection): RpcResult<'windows.unpoint'> {
    this.#host.activeThread(threadId, connection);
    return { cleared: this.#remove(threadId, 'cleared') };
  }

  /** An archived or deleted conversation's box and last read. */
  release(threadId: string): void {
    this.#remove(threadId, 'cleared');
    this.#hideFrame(threadId);
    this.#snapshots.delete(threadId);
  }

  stop(): void {
    for (const threadId of [...this.#shown.keys()]) this.#remove(threadId, 'cleared');
    for (const threadId of [...this.#frames.keys()]) this.#hideFrame(threadId);
    this.#snapshots.clear();
  }

  async #load(): Promise<WindowGuide> {
    this.#backend ??= this.#loader().catch(error => ({ unavailable: `the on-screen guide failed to load: ${messageOf(error)}` }));
    const backend = await this.#backend;
    if ('unavailable' in backend) throw refused(backend.unavailable);
    return backend;
  }

  /** Reads the window's controls in its own pixels and keeps them as the conversation's last read. */
  async #read(thread: ThreadSummary, guide: WindowGuide, window: NativeWindow, any: boolean): Promise<Snapshot> {
    const frame = guide.frame(window.id);
    if (frame === null) throw refused(`window ${window.id} of ${window.process} is gone`, { windowId: window.id, code: 'gone' });
    let found: Awaited<ReturnType<WindowGuide['controls']>>;
    try {
      found = await guide.controls(window.id, READ_SCAN, any);
    } catch (error) {
      throw refused(`reading the controls of ${window.process} failed: ${messageOf(error)}`, { windowId: window.id });
    }
    const { left, top, width, height } = frame.rect;
    const controls: WindowControl[] = [];
    for (const control of found.controls) {
      // A control scrolled out of the window can still say it is on screen.
      const x = control.rect.left - left, y = control.rect.top - top;
      if (x + control.rect.width <= 0 || y + control.rect.height <= 0 || x >= width || y >= height) continue;
      controls.push({
        id: controls.length + 1, type: control.type, name: control.name,
        ...(control.automationId ? { automationId: control.automationId } : {}),
        x, y, width: control.rect.width, height: control.rect.height,
      });
    }
    const snapshot = { window, controls };
    this.#snapshots.set(thread.id, snapshot);
    this.#core.logs.info(`Read ${controls.length} controls of window ${window.id} of ${window.process}`, { source: 'windows', event: 'window.read', threadId: thread.id, data: { windowId: window.id, process: window.process, controls: controls.length } });
    return snapshot;
  }

  /** The one control named `name`: an exact match without case first, then the names that contain it. */
  #named(snapshot: Snapshot, name: string): WindowControl {
    const wanted = name.toLowerCase();
    let matches = snapshot.controls.filter(control => control.name.toLowerCase() === wanted);
    if (matches.length === 0) matches = snapshot.controls.filter(control => control.name.toLowerCase().includes(wanted));
    if (matches.length === 1) return matches[0]!;
    const process = snapshot.window.process;
    if (matches.length === 0) throw refused(`no control of ${process} is named "${name}": \`boite window read\` lists them`, { field: 'name' });
    throw refused(`${matches.length} controls of ${process} match "${name}"; point at one by id:\n${matches.slice(0, 10).map(controlLine).join('\n')}`, { field: 'name' });
  }

  /** `at` in the window's pixels, kept inside the window. */
  #rectangle(window: NativeWindow, at: WindowCrop): { x: number; y: number; width: number; height: number } {
    const rect = cropRect(at, window.width, window.height);
    if (rect.width <= 0 || rect.height <= 0) throw refused(`at lies outside the ${window.width}x${window.height} window`, { field: 'at' });
    return rect;
  }

  #seconds(value: number | undefined, field: string): number {
    if (value === undefined) return WINDOW_POINT_SECONDS.default;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > WINDOW_POINT_SECONDS.max) {
      throw invalidParams(`${field} must lie between 1 and ${WINDOW_POINT_SECONDS.max}`, { field });
    }
    return value;
  }

  /**
   * The box goes where its control or its window went, hides while the window
   * is minimized or the control is out of view, and goes away with the window.
   */
  #follow(threadId: string, shown: Shown, guide: WindowGuide): void {
    if (this.#shown.get(threadId) !== shown) return;
    const frame = guide.frame(shown.window.id);
    if (frame === null) {
      this.#remove(threadId, 'gone', shown);
      return;
    }
    let screen: ScreenRect | null;
    if (frame.minimized) {
      screen = null;
    } else if (shown.tracked) {
      const live = shown.tracked.rect();
      if (live === 'busy') return;
      if (live === 'gone') {
        shown.tracked.release();
        shown.tracked = null;
        shown.lost = { nextAt: 0, looking: false };
        screen = null;
      } else {
        // In the window's pixels, so dragging the window moves the box at once and only a scroll waits.
        const inWindow = live === 'hidden' || !centerInside(live, frame.rect) ? null
          : { left: live.left - frame.rect.left, top: live.top - frame.rect.top, width: live.width, height: live.height };
        const now = Date.now();
        if (shown.seen === undefined || !sameRect(inWindow, shown.seen.rect)) shown.seen = { rect: inWindow, since: now };
        const settle = CHROMIUM_CLASS.test(shown.window.className) ? this.#settleMs : 0;
        if (inWindow === null || now - shown.seen.since < settle) {
          screen = null;
        } else {
          screen = live as ScreenRect;
          Object.assign(shown.pointer, { x: inWindow.left, y: inWindow.top, width: inWindow.width, height: inWindow.height });
        }
      }
    } else if (shown.lost && shown.control) {
      screen = null;
      this.#retrack(threadId, shown, guide, frame.rect);
    } else {
      screen = { left: frame.rect.left + shown.pointer.x, top: frame.rect.top + shown.pointer.y, width: shown.pointer.width, height: shown.pointer.height };
    }
    if (sameRect(screen, shown.screen)) return;
    shown.screen = screen;
    this.#core.subscribers.pointer({ id: shown.boxId, rect: screen, label: shown.pointer.label, look: shown.pointer.look });
  }

  /** Looks again, at most once a second, for the control the app dropped: a list that re-renders its rows, or one scrolled far enough to recycle them. */
  #retrack(threadId: string, shown: Shown, guide: WindowGuide, frame: ScreenRect): void {
    const lost = shown.lost!;
    if (lost.looking || Date.now() < lost.nextAt) return;
    lost.looking = true;
    const control = shown.control!;
    // Near where it was last seen: a list holds rows of the same name.
    const { pointer } = shown;
    const near = { left: frame.left + pointer.x, top: frame.top + pointer.y, width: pointer.width, height: pointer.height };
    void guide.track(shown.window.id, { type: control.type, name: control.name, automationId: control.automationId ?? '', rect: near })
      .catch(() => null)
      .then(found => {
        lost.looking = false;
        lost.nextAt = Date.now() + RETRACK_MS;
        if (found === null) return;
        if (this.#shown.get(threadId) !== shown) { found.release(); return; }
        shown.tracked = found;
        delete shown.lost;
      });
  }

  /**
   * A Chromium or Electron window builds its controls only while in front:
   * the desktop app brings it there and frames it, saying why, and the read
   * waits for it. Any other window is read where it is.
   */
  async #front(threadId: string, guide: WindowGuide, window: NativeWindow): Promise<void> {
    if (!CHROMIUM_CLASS.test(window.className)) return;
    if (!this.#showFrame(threadId, guide, window) || guide.foreground(window.id)) return;
    const until = Date.now() + FRONT_WAIT_MS;
    while (Date.now() < until && !guide.foreground(window.id)) await Bun.sleep(50);
  }

  /** Frames `window` for the conversation, once; false with no desktop app to draw it. */
  #showFrame(threadId: string, guide: WindowGuide, window: NativeWindow): boolean {
    const current = this.#frames.get(threadId);
    if (current?.window.id === window.id && current.window.pid === window.pid) {
      if (current.idle) { clearTimeout(current.idle); current.idle = null; }
      return true;
    }
    this.#hideFrame(threadId);
    const at = guide.frame(window.id);
    const rect = at === null || at.minimized ? null : at.rect;
    const boxId = newId('frame_');
    if (this.#send(boxId, rect, window) === 0) return false;
    const frame: Frame = { window, boxId, rect, idle: null, follow: setInterval(() => this.#followFrame(threadId, frame, guide), FRAME_FOLLOW_MS) };
    frame.follow.unref?.();
    this.#frames.set(threadId, frame);
    this.#core.logs.info(`Framed window ${window.id} of ${window.process} and asked to bring it to the front`, { source: 'windows', event: 'window.frame', threadId, data: { windowId: window.id, process: window.process } });
    return true;
  }

  #send(boxId: string, rect: ScreenRect | null, window: NativeWindow): number {
    return this.#core.subscribers.pointer({ id: boxId, rect, label: '', look: { shape: 'box', pad: 0 }, frame: { app: window.process.replace(/\.exe$/i, ''), windowId: window.id } });
  }

  #followFrame(threadId: string, frame: Frame, guide: WindowGuide): void {
    if (this.#frames.get(threadId) !== frame) return;
    const at = guide.frame(frame.window.id);
    if (at === null) { this.#hideFrame(threadId); return; }
    const rect = at.minimized ? null : at.rect;
    if (sameRect(rect, frame.rect)) return;
    frame.rect = rect;
    this.#send(frame.boxId, rect, frame.window);
  }

  /** The frame goes `FRAME_IDLE_MS` after the last box in it, unless a new box comes first. */
  #frameLater(threadId: string): void {
    const frame = this.#frames.get(threadId);
    if (!frame || frame.idle) return;
    frame.idle = setTimeout(() => this.#hideFrame(threadId), this.#frameIdleMs);
    frame.idle.unref?.();
  }

  #hideFrame(threadId: string): void {
    const frame = this.#frames.get(threadId);
    if (!frame) return;
    this.#frames.delete(threadId);
    clearInterval(frame.follow);
    if (frame.idle) clearTimeout(frame.idle);
    this.#send(frame.boxId, null, frame.window);
  }

  /**
   * Takes the conversation's box away, or only `only` when given, and ends the
   * waits on it. A box the agent took away or replaced tells it nothing.
   */
  #remove(threadId: string, why: BoxEnd, only?: Shown): boolean {
    const shown = this.#shown.get(threadId);
    if (!shown || (only !== undefined && shown !== only)) return false;
    this.#shown.delete(threadId);
    clearInterval(shown.follow);
    clearTimeout(shown.expiry);
    if (shown.clicks) clearInterval(shown.clicks);
    if (shown.notify && shown.waiters.size === 0 && why !== 'cleared') this.#tell(threadId, shown, why);
    shown.tracked?.release();
    shown.tracked = null;
    this.#frameLater(threadId);
    this.#core.subscribers.pointer({ id: shown.boxId, rect: null, label: shown.pointer.label, look: shown.pointer.look });
    for (const finish of [...shown.waiters]) finish(why);
    this.#core.logs.info(`Box over window ${shown.window.id} of ${shown.window.process} taken away: ${why}`, { source: 'windows', event: 'window.unpoint', threadId, data: { windowId: shown.window.id, process: shown.window.process, why } });
    return true;
  }
}
