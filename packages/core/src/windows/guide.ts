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
 *
 * A menu the person opened is a window of its own (the list under File in
 * Unity), so a read takes in the menus and popups the same app has open over
 * the window, under the same consent: it is the same app. A box on one of
 * their controls goes when the popup closes, as with a closed window.
 *
 * A box waits for a click inside it, or with `until`, for what a click alone
 * cannot show: the control's value, check state or selection changing ("type
 * your name here"), or the app opening a window ("open Build Settings"). The
 * agent learns which of the three changed, never what the control holds: the
 * OS half hands the guide a hash of the value, not its text.
 *
 * The box is click-through, so the person answers it elsewhere: its card in
 * the conversation (a `window_guide` part, on every client of the owner)
 * offers Done and I cannot find it, and Escape pressed anywhere on the machine
 * is Done. Either ends the box as unpoint does, and the agent hears which from
 * its wait, or as a message, whether or not the box was drawn with `notify`.
 *
 * A tour of several boxes is the agent's to run, one `point` after another:
 * each may say its `step`, which the box and its card show as `2 / 5` so the
 * person knows where they are. The core checks the numbers and keeps no tour.
 */
import {
  WINDOW_POINT_LABEL_MAX,
  WINDOW_POINT_PAD,
  WINDOW_POINT_SECONDS,
  WINDOW_GUIDE_ANSWERS,
  WINDOW_POINTER_UNTIL,
  WINDOW_READ_LIMIT,
  windowCropError,
  windowStepError,
  type Message,
  type MessagePart,
  type RpcParams,
  type RpcResult,
  type ThreadSummary,
  type WindowControl,
  type WindowChange,
  type WindowEdge,
  type WindowCrop,
  type WindowGuideAnswer,
  type WindowGuideEnd,
  type WindowOpened,
  type WindowPointer,
  type WindowPointerUntil,
  type WindowTarget,
  type WindowWaitEnd,
} from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import type { ControlState, NativeWindow, ScreenRect, TrackedControl, WindowGuide } from '../platform/types.ts';
import type { Connection } from '../router.ts';
import { centerInside, edgeOf, markerRect, sameRect } from './guide-geometry.ts';
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
/**
 * How often a box with `until` looks at its control or at the app's windows:
 * up to four cross-process property reads, or one walk of the top-level
 * windows. A person reads a change a few tenths of a second after making it.
 */
const WATCH_MS = 200;
/**
 * How long a changed value must stay put before the box ends: a person types
 * a name a key at a time, and the agent should hear once they paused, not
 * after the first letter. A check box or a selection changes in one step and
 * ends the box at the next look.
 */
const VALUE_SETTLE_MS = 1_500;
/**
 * How long a box with `until: 'window'` on a menu item waits for the window
 * once the menu closed: the click that opens a dialog closes the menu first,
 * and a slow app shows the dialog after.
 */
const OPEN_GRACE_MS = 5_000;
const TITLE_MAX = 200;

export interface WindowGuidesOptions {
  /** How often a box follows its window and its control. */
  followMs?: number;
  /** How often a wait reads the mouse: a click holds the button down for 50 ms or more. */
  mouseMs?: number;
  /** How long a followed control must stay put in its window before its box shows again. */
  settleMs?: number;
  /** How long the frame around a Chromium window stays once no box shows in it. */
  frameIdleMs?: number;
  /** How often a box with `until` looks for a change or a new window. */
  watchMs?: number;
  /** How long a changed value must stay put before the box ends. */
  valueSettleMs?: number;
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
  /** The menu or popup window that control lies in: the box goes when it closes. */
  popup: string | null;
  /** The control lies past this edge of the window or popup: the box is a marker there, pointing toward it. */
  edge?: WindowEdge;
  /** Where the followed control last was in its window, and since when: the box shows once it stays put. */
  seen?: { rect: ScreenRect | null; since: number };
  /** Set once the app dropped the control: the box hides until it is found again. */
  lost?: { nextAt: number; looking: boolean };
  waiters: Set<(end: BoxEnd) => void>;
  /** The agent hears how the box ended as a message, when no wait took the click. */
  notify: boolean;
  /** Reads the mouse while a wait or `notify` needs the click. */
  clicks: ReturnType<typeof setInterval> | null;
  /** What ends the box besides its time: a click, a change of its control, or a new window of its app. */
  until: WindowPointerUntil;
  /** Looks for the change or the window, for a box with `until` other than a click. */
  watch: ReturnType<typeof setInterval> | null;
  /** For `change`: what the control held when the box was drawn; null until the app first answered. */
  baseline?: ControlState | null;
  /** A changed value and since when it stayed put: it ends the box once settled. */
  typing?: { value: string; since: number };
  /** For `window`: the app's windows when the box was drawn. */
  known?: Set<string>;
  /** For `window` on a menu item: when the menu closed, the window it opens still to come. */
  menuClosedAt?: number;
  /** Escape was down at the last look: a press counts once it starts, not while a key held before the box is still down. */
  escapeHeld: boolean;
  /** The box's card in the conversation, null when it had no turn to show in. */
  card: { messageId: string; part: GuidePart } | null;
}

type GuidePart = Extract<MessagePart, { type: 'window_guide' }>;

type BoxEnd = WindowWaitEnd | 'clicked' | { changed: WindowChange } | { opened: WindowOpened };
const endName = (end: BoxEnd): WindowGuideEnd => typeof end === 'string' ? end : 'changed' in end ? 'changed' : 'opened';
/** The person ended the box: the agent hears it even from a box drawn without `notify`. */
const answered = (end: BoxEnd): end is WindowGuideAnswer => end === 'dismissed' || end === 'missing';

/** The frame around a Chromium window a conversation guides in. */
interface Frame {
  window: NativeWindow;
  boxId: string;
  rect: ScreenRect | null;
  follow: ReturnType<typeof setInterval>;
  /** Takes the frame away once no box has shown in the window for `FRAME_IDLE_MS`. */
  idle: ReturnType<typeof setTimeout> | null;
}

/** What the OS half looks for to follow `control`, near `rect` on the screen. */
const nativeOf = (control: WindowControl, rect: ScreenRect) =>
  ({ type: control.type, name: control.name, automationId: control.automationId ?? '', rect, ...(control.popup ? { popup: control.popup } : {}) });
const controlLine = (control: WindowControl) => `  #${control.id} ${control.type} "${control.name}"${control.popup ? ` (in popup ${control.popup})` : ''}${control.offscreen ? ` (out of view${control.offscreen === 'unknown' ? '' : `: ${control.offscreen}`})` : ''}`;

export class WindowGuides {
  readonly #core: Core;
  readonly #host: WindowGuideHost;
  readonly #loader: () => Promise<WindowGuide | { unavailable: string }>;
  readonly #followMs: number;
  readonly #mouseMs: number;
  readonly #settleMs: number;
  readonly #frameIdleMs: number;
  readonly #watchMs: number;
  readonly #valueSettleMs: number;
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
    this.#watchMs = options.watchMs ?? WATCH_MS;
    this.#valueSettleMs = options.valueSettleMs ?? VALUE_SETTLE_MS;
  }

  async read({ threadId, target, filter, limit, any, offscreen }: RpcParams<'windows.read'>, connection?: Connection): Promise<RpcResult<'windows.read'>> {
    const thread = this.#host.activeThread(threadId, connection);
    if (any !== undefined && typeof any !== 'boolean') throw invalidParams('any must be true or false', { field: 'any' });
    if (offscreen !== undefined && typeof offscreen !== 'boolean') throw invalidParams('offscreen must be true or false', { field: 'offscreen' });
    if (filter !== undefined && (typeof filter !== 'string' || filter.trim() === '' || filter.length > FILTER_MAX || /\p{Cc}/u.test(filter))) {
      throw invalidParams(`filter must be 1 to ${FILTER_MAX} characters with no control characters`, { field: 'filter' });
    }
    const max = limit ?? WINDOW_READ_LIMIT.default;
    if (!Number.isInteger(max) || max < 1 || max > WINDOW_READ_LIMIT.max) throw invalidParams(`limit must be a whole number from 1 to ${WINDOW_READ_LIMIT.max}`, { field: 'limit' });
    const guide = await this.#load();
    const window = await this.#host.grantedWindow(thread, target, 'read', connection);
    await this.#front(thread.id, guide, window);
    const snapshot = await this.#read(thread, guide, window, any === true, offscreen === true);
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
    const until = params.until ?? 'click';
    if (!WINDOW_POINTER_UNTIL.includes(until)) throw invalidParams(`until must be one of ${WINDOW_POINTER_UNTIL.join(', ')}`, { field: 'until' });
    if (until === 'change' && at !== undefined) throw invalidParams('until change watches a control: point at one by id or by name, not at a rectangle', { field: 'until' });
    const stepProblem = params.step === undefined ? null : windowStepError(params.step);
    if (stepProblem) throw invalidParams(stepProblem, { field: 'step' });
    const step = params.step === undefined ? undefined : { index: params.step.index, total: params.step.total };

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
      if (control.offscreen === 'unknown') {
        throw refused(`#${id} is out of view and ${snapshot.window.process} does not say where: have the user bring it into view (another tab, a section to expand), then read again`, { field: 'control' });
      }
      box = control;
      const guide = await this.#load();
      if (control.popup !== undefined && guide.frame(control.popup) === null) {
        throw refused(`the menu or popup #${id} lay in has closed: have the user open it again, then read again`, { windowId: control.popup, code: 'gone' });
      }
      await this.#front(thread.id, guide, window);
    } else if (name !== undefined) {
      if (target === undefined) throw invalidParams('point by name needs the window\'s target', { field: 'target' });
      if (typeof name !== 'string' || name.trim() === '' || name.length > 260 || /\p{Cc}/u.test(name)) {
        throw invalidParams('name must be 1 to 260 characters with no control characters', { field: 'name' });
      }
      const guide = await this.#load();
      window = await this.#host.grantedWindow(thread, target, 'read', connection);
      await this.#front(thread.id, guide, window);
      const snapshot = await this.#read(thread, guide, window, params.any === true, false);
      control = this.#named(snapshot, name.trim());
      box = control;
    } else {
      if (target === undefined) throw invalidParams('point at a rectangle needs the window\'s target', { field: 'target' });
      const problem = windowCropError(at);
      if (problem) throw invalidParams(problem.replace(/^crop/, 'at').replace(/a crop/, 'a rectangle'), { field: 'at' });
      // Waiting for a window reads the app's window titles: the consent of a read.
      window = await this.#host.grantedWindow(thread, target, until === 'window' ? 'read' : null, connection);
      box = this.#rectangle(window, at!);
    }

    const guide = await this.#load();
    const frame = guide.frame(window.id);
    if (frame === null) throw refused(`window ${window.id} of ${window.process} is gone`, { windowId: window.id, code: 'gone' });
    const screen = { left: frame.rect.left + box.x, top: frame.rect.top + box.y, width: box.width, height: box.height };
    // A control out of view gets a marker on the edge it lies past, in its popup when it has one.
    const bounds = control?.popup !== undefined ? guide.frame(control.popup)?.rect ?? frame.rect : frame.rect;
    const edge = control?.offscreen !== undefined && control.offscreen !== 'unknown' ? control.offscreen : undefined;
    const drawn = edge === undefined ? screen : markerRect(edge, screen, bounds);
    // Without a label, a control's box says its name.
    const shownLabel = label === '' && control ? control.name.slice(0, WINDOW_POINT_LABEL_MAX) : label;
    let tracked: TrackedControl | null = null;
    if (control) {
      try { tracked = await guide.track(window.id, nativeOf(control, screen)); }
      catch { /* not followed: the box keeps its place in the window */ }
    }
    let baseline: ControlState | null = null;
    if (until === 'change') {
      const state = tracked?.state() ?? 'gone';
      if (state === 'gone') {
        tracked?.release();
        throw refused(`${window.process} does not let ${control!.type} "${control!.name}" be followed, so its change cannot be seen: wait for a click on it instead`, { field: 'until' });
      }
      if (state !== 'busy') {
        if (state.value === undefined && state.toggle === undefined && state.selected === undefined) {
          tracked!.release();
          throw refused(`${control!.type} "${control!.name}" has no value, check state or selection to watch: wait for a click or a window instead`, { field: 'until' });
        }
        baseline = state;
      }
    }
    const known = until === 'window' ? new Set(guide.appWindows(window.pid).map(other => other.id)) : undefined;
    // The previous box goes first, so the desktop app hands its window to the new one.
    this.#remove(thread.id, 'cleared');
    const boxId = newId('box_');
    if (this.#core.subscribers.pointer({ id: boxId, rect: frame.minimized ? null : drawn, label: shownLabel, look, ...(edge ? { edge } : {}), ...(step ? { step } : {}) }) === 0) {
      tracked?.release();
      throw refused('the box is drawn by the Boite desktop app of this computer, and none is open: ask the user to open Boite', { code: 'no-app' });
    }
    const pointer: WindowPointer = {
      windowId: window.id, process: window.process, label: shownLabel,
      x: box.x, y: box.y, width: box.width, height: box.height, expiresAt: Date.now() + seconds * 1000, look,
      ...(control ? { control: { type: control.type, name: control.name } } : {}),
      ...(control?.popup ? { popup: control.popup } : {}),
      ...(frame.above ? { behind: true as const } : {}),
      ...(notify ? { notify: true as const } : {}),
      ...(until !== 'click' ? { until } : {}),
      ...(edge ? { offscreen: edge } : {}),
      ...(step ? { step } : {}),
    };
    let escapeHeld = true;
    try { escapeHeld = guide.escape(); } catch { /* read again at the next look */ }
    const shown: Shown = {
      pointer, window, boxId, screen: frame.minimized ? null : drawn, ...(edge && !frame.minimized ? { edge } : {}), waiters: new Set(), tracked, control: control ?? null, popup: control?.popup ?? null, notify, clicks: null,
      until, watch: null, escapeHeld, card: null, ...(until === 'change' ? { baseline } : {}), ...(known ? { known } : {}),
      // Settled already where it was read: the box shows at once.
      ...(tracked && !frame.minimized ? { seen: { rect: { left: box.x, top: box.y, width: box.width, height: box.height }, since: 0 } } : {}),
      follow: setInterval(() => this.#follow(thread.id, shown, guide), this.#followMs),
      expiry: setTimeout(() => this.#remove(thread.id, 'timeout', shown), seconds * 1000),
    };
    shown.follow.unref?.();
    shown.expiry.unref?.();
    this.#shown.set(thread.id, shown);
    shown.card = this.#card(thread.id, shown);
    if (until !== 'click') {
      shown.watch = setInterval(() => this.#watchState(thread.id, shown, guide), this.#watchMs);
      shown.watch.unref?.();
    } else if (notify) {
      this.#watchClicks(thread.id, shown, guide);
    }
    const framed = this.#frames.get(thread.id);
    if (framed?.idle) { clearTimeout(framed.idle); framed.idle = null; }
    this.#core.logs.info(`Pointed at a ${control?.type ?? 'rectangle'} of window ${window.id} of ${window.process} until ${until}${edge ? `, out of view ${edge}` : ''}`, { source: 'windows', event: 'window.point', threadId: thread.id, data: { windowId: window.id, process: window.process, width: box.width, height: box.height, until, ...(edge ? { offscreen: edge } : {}), ...(step ? { step: `${step.index}/${step.total}` } : {}) } });
    return { pointer: { ...pointer, ...(step ? { step: { ...step } } : {}) } };
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
      // The card offers its answers for as long as the box now stays.
      if (shown.card) this.#foldCard(thread.id, shown.card, { expiresAt: until });
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
      if (shown.until === 'click') this.#watchClicks(thread.id, shown, guide);
    });
    const pointer = { ...shown.pointer };
    if (end === 'clicked') return { clicked: true, pointer };
    if (typeof end === 'object') return 'changed' in end ? { clicked: false, changed: end.changed, pointer } : { clicked: false, opened: end.opened, pointer };
    return { clicked: false, reason: end };
  }

  /**
   * For a box with `until`: ends it once its control changed, a value having
   * stayed put for `VALUE_SETTLE_MS`, or once its app shows a window it did
   * not have when the box was drawn.
   */
  #watchState(threadId: string, shown: Shown, guide: WindowGuide): void {
    if (this.#shown.get(threadId) !== shown) return;
    if (shown.until === 'window') {
      const opened = this.#opened(shown, guide);
      if (opened) this.#remove(threadId, { opened }, shown);
      return;
    }
    const state = shown.tracked?.state();
    // A dropped control is looked for again by `#follow`; a busy app is asked at the next look.
    if (state === undefined || state === 'busy' || state === 'gone') return;
    const was = shown.baseline;
    if (!was) { shown.baseline = state; return; }
    const differs = <T>(now: T | undefined, before: T | undefined) => now !== undefined && before !== undefined && now !== before;
    if (differs(state.toggle, was.toggle)) { this.#changed(threadId, shown, 'toggle'); return; }
    if (differs(state.selected, was.selected)) { this.#changed(threadId, shown, 'selection'); return; }
    if (!differs(state.value, was.value)) { delete shown.typing; return; }
    const now = Date.now();
    const typing = shown.typing;
    if (typing === undefined || typing.value !== state.value) shown.typing = { value: state.value!, since: now };
    else if (now - typing.since >= this.#valueSettleMs) this.#changed(threadId, shown, 'value');
  }

  #changed(threadId: string, shown: Shown, what: WindowChange): void {
    this.#core.logs.info(`The person changed the ${what} of the control under the box over window ${shown.window.id} of ${shown.window.process}`, { source: 'windows', event: 'window.change', threadId, data: { windowId: shown.window.id, process: shown.window.process, change: what } });
    this.#remove(threadId, { changed: what }, shown);
  }

  /** The first window of the box's app that was not there when the box was drawn. */
  #opened(shown: Shown, guide: WindowGuide): WindowOpened | null {
    const fresh = guide.appWindows(shown.window.pid).find(other => other.id !== shown.window.id && !shown.known!.has(other.id));
    if (!fresh) return null;
    // The title is the app's text: no line break or control character reaches the agent's message.
    const title = fresh.title.replace(/\p{Cc}+/gu, ' ').trim().slice(0, TITLE_MAX);
    return { windowId: fresh.id, title, readWindowId: fresh.owner ?? fresh.id };
  }

  /** Reads the mouse until a press inside the box ends it; a button already held when it starts is not that click. */
  #watchClicks(threadId: string, shown: Shown, guide: WindowGuide): void {
    if (shown.clicks) return;
    let held = true;
    shown.clicks = setInterval(() => {
      let mouse: { pressed: boolean; x: number; y: number };
      try { mouse = guide.mouse(); } catch { return; }
      // A marker on the window's edge lies over the app, not over the control.
      const at = shown.edge === undefined ? shown.screen : null;
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
    const where = `${what} in window ${pointer.windowId} (${pointer.process})${pointer.step ? `, step ${pointer.step.index} of ${pointer.step.total}` : ''}`;
    const awaited = shown.until === 'change' ? 'a change' : shown.until === 'window' ? 'a new window' : 'a click';
    let text: string;
    if (typeof why === 'object') {
      if ('changed' in why) {
        const part = why.changed === 'value' ? 'value' : why.changed === 'toggle' ? 'check state' : 'selection';
        text = `Boite: the user changed the ${part} of ${where}; the box is gone. What it holds now is not reported: ask the user if it matters.`;
      } else {
        const { opened } = why;
        const read = opened.readWindowId === opened.windowId ? `boite window read --id ${opened.windowId}`
          : `boite window read --id ${opened.readWindowId}, which lists its controls first (in popup ${opened.windowId})`;
        text = `Boite: ${pointer.process} opened window ${opened.windowId} "${opened.title}" after the box on ${where}; the box is gone. Read it with ${read}.`;
      }
    } else if (why === 'dismissed') {
      text = `Boite: the user dismissed the box on ${where} before ${awaited}, with Done or Escape; the box is gone. They may have done it another way, or want to stop: ask before pointing again.`;
    } else if (why === 'missing') {
      text = `Boite: the user cannot find the box on ${where}; the box is gone. It may be off screen, behind another window or on a closed menu: check with boite window screenshot, then point again or say where to look.`;
    } else {
      text = why === 'clicked' ? `Boite: the user clicked the box on ${where}; the box is gone.`
        : why === 'timeout' ? `Boite: the box on ${where} timed out without ${awaited}.`
        : pointer.popup ? `Boite: the menu or popup under the box on ${where} closed before ${awaited}.`
        : `Boite: the window under the box on ${where} closed before ${awaited}.`;
    }
    try { this.#core.threads.deferred.deliverAnswer(threadId, text); }
    catch (error) { this.#core.logs.warn(`The end of a box could not reach its conversation: ${messageOf(error)}`, { source: 'windows', event: 'window.notify', threadId }); }
  }

  unpoint({ threadId }: RpcParams<'windows.unpoint'>, connection?: Connection): RpcResult<'windows.unpoint'> {
    this.#host.activeThread(threadId, connection);
    return { cleared: this.#remove(threadId, 'cleared') };
  }

  /** The person's answer on the box's card: only that box, so a card left from an earlier one ends nothing. */
  dismiss({ threadId, boxId, answer }: RpcParams<'windows.dismiss'>, connection?: Connection): RpcResult<'windows.dismiss'> {
    this.#host.activeThread(threadId, connection);
    if (!WINDOW_GUIDE_ANSWERS.includes(answer)) throw invalidParams(`answer must be one of ${WINDOW_GUIDE_ANSWERS.join(', ')}`, { field: 'answer' });
    if (typeof boxId !== 'string' || boxId.length === 0 || boxId.length > 100) throw invalidParams('boxId must be the id of a window_guide card', { field: 'boxId' });
    const shown = this.#shown.get(threadId);
    if (!shown || shown.boxId !== boxId) throw refused('this box is no longer shown: the agent took it away, or it ended', { boxId });
    this.#core.logs.info(`The person ended the box over window ${shown.window.id} of ${shown.window.process} from its card: ${answer}`, { source: 'windows', event: 'window.dismiss', threadId, data: { windowId: shown.window.id, process: shown.window.process, answer } });
    this.#remove(threadId, answer, shown);
    return { ok: true };
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

  /**
   * Reads the window's controls in its own pixels and keeps them as the
   * conversation's last read; with `offscreen`, those out of view too, each
   * with the edge it lies past.
   */
  async #read(thread: ThreadSummary, guide: WindowGuide, window: NativeWindow, any: boolean, offscreen: boolean): Promise<Snapshot> {
    const frame = guide.frame(window.id);
    if (frame === null) throw refused(`window ${window.id} of ${window.process} is gone`, { windowId: window.id, code: 'gone' });
    let found: Awaited<ReturnType<WindowGuide['controls']>>;
    try {
      found = await guide.controls(window.id, READ_SCAN, any, offscreen);
    } catch (error) {
      throw refused(`reading the controls of ${window.process} failed: ${messageOf(error)}`, { windowId: window.id });
    }
    const { left, top } = frame.rect;
    // A popup's controls lie in the popup, which can reach past the window's edge.
    const popups = new Map<string, ScreenRect | null>();
    const boundsOf = (popup: string | undefined) => {
      if (popup === undefined) return frame.rect;
      if (!popups.has(popup)) popups.set(popup, guide.frame(popup)?.rect ?? null);
      return popups.get(popup)!;
    };
    const controls: WindowControl[] = [];
    let outOfView = 0;
    for (const control of found.controls) {
      const bounds = boundsOf(control.popup);
      if (bounds === null) continue;
      // A control scrolled out of the window can still say it is on screen.
      const { left: x0, top: y0, width: w, height: h } = control.rect;
      const outside = x0 + w <= bounds.left || y0 + h <= bounds.top || x0 >= bounds.left + bounds.width || y0 >= bounds.top + bounds.height;
      let side: WindowControl['offscreen'];
      if (outside || control.offscreen) {
        if (!offscreen) continue;
        side = w > 0 && h > 0 ? edgeOf(control.rect, bounds) ?? 'unknown' : 'unknown';
        outOfView += 1;
      }
      controls.push({
        id: controls.length + 1, type: control.type, name: control.name,
        ...(control.automationId ? { automationId: control.automationId } : {}),
        ...(control.popup ? { popup: control.popup } : {}),
        ...(side ? { offscreen: side } : {}),
        x: x0 - left, y: y0 - top, width: w, height: h,
      });
    }
    const snapshot = { window, controls };
    this.#snapshots.set(thread.id, snapshot);
    this.#core.logs.info(`Read ${controls.length} controls of window ${window.id} of ${window.process}`, { source: 'windows', event: 'window.read', threadId: thread.id, data: { windowId: window.id, process: window.process, controls: controls.length, popups: popups.size, ...(offscreen ? { offscreen: outOfView } : {}) } });
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
    if (this.#escaped(shown, guide)) {
      this.#core.logs.info(`The person pressed Escape on the box over window ${shown.window.id} of ${shown.window.process}`, { source: 'windows', event: 'window.escape', threadId, data: { windowId: shown.window.id, process: shown.window.process } });
      this.#remove(threadId, 'dismissed', shown);
      return;
    }
    const frame = guide.frame(shown.window.id);
    if (frame === null) {
      // The window that opened may be the one that replaced it.
      const opened = shown.until === 'window' ? this.#opened(shown, guide) : null;
      this.#remove(threadId, opened ? { opened } : 'gone', shown);
      return;
    }
    // A box in a menu goes when the menu closes; its controls are out of view only past the menu's edge.
    let bounds = frame.rect;
    if (shown.popup !== null) {
      const popup = guide.frame(shown.popup);
      if (popup === null) {
        // Clicking the item closed the menu: the box hides and waits a little for the window it opens.
        if (shown.until === 'window' && Date.now() - (shown.menuClosedAt ??= Date.now()) < OPEN_GRACE_MS) {
          if (shown.screen !== null) {
            shown.screen = null;
            this.#core.subscribers.pointer({ id: shown.boxId, rect: null, label: shown.pointer.label, look: shown.pointer.look });
          }
          return;
        }
        this.#remove(threadId, 'gone', shown);
        return;
      }
      bounds = popup.rect;
    }
    let screen: ScreenRect | null;
    let edge: WindowEdge | undefined;
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
        const rect = live === 'hidden' ? null : { left: live.left, top: live.top, width: live.width, height: live.height };
        // In the window's pixels, so dragging the window moves the box at once and only a scroll waits.
        const inWindow = rect === null ? null : { left: rect.left - frame.rect.left, top: rect.top - frame.rect.top, width: rect.width, height: rect.height };
        const now = Date.now();
        if (shown.seen === undefined || !sameRect(inWindow, shown.seen.rect)) shown.seen = { rect: inWindow, since: now };
        const settle = CHROMIUM_CLASS.test(shown.window.className) ? this.#settleMs : 0;
        if (rect === null || inWindow === null || now - shown.seen.since < settle) {
          screen = null;
        } else if (live !== 'hidden' && !live.offscreen && centerInside(rect, bounds)) {
          screen = rect;
          Object.assign(shown.pointer, { x: inWindow.left, y: inWindow.top, width: inWindow.width, height: inWindow.height });
          delete shown.pointer.offscreen;
        } else {
          // Out of view past an edge: a marker there points toward it. Out of view inside the window (another tab): hidden.
          edge = edgeOf(rect, bounds) ?? undefined;
          screen = edge === undefined ? null : markerRect(edge, rect, bounds);
          if (edge !== undefined) Object.assign(shown.pointer, { x: inWindow.left, y: inWindow.top, width: inWindow.width, height: inWindow.height, offscreen: edge });
        }
      }
    } else if (shown.lost && shown.control) {
      screen = null;
      this.#retrack(threadId, shown, guide, frame.rect);
    } else {
      screen = { left: frame.rect.left + shown.pointer.x, top: frame.rect.top + shown.pointer.y, width: shown.pointer.width, height: shown.pointer.height };
      // A control out of view the app does not let be followed: its marker stays on the edge.
      edge = shown.pointer.offscreen;
      if (edge !== undefined) screen = markerRect(edge, screen, bounds);
    }
    if (sameRect(screen, shown.screen) && edge === shown.edge) return;
    shown.screen = screen;
    if (edge === undefined) delete shown.edge;
    else shown.edge = edge;
    this.#core.subscribers.pointer({ id: shown.boxId, rect: screen, label: shown.pointer.label, look: shown.pointer.look, ...(edge ? { edge } : {}), ...(shown.pointer.step ? { step: shown.pointer.step } : {}) });
  }

  /** Whether Escape went down since the last look; a read that fails counts as no press. */
  #escaped(shown: Shown, guide: WindowGuide): boolean {
    let down: boolean;
    try { down = guide.escape(); } catch { return false; }
    const pressed = down && !shown.escapeHeld;
    shown.escapeHeld = down;
    return pressed;
  }

  /** Posts the box's card, which offers the person Done and I cannot find it; null with no turn to show it in. */
  #card(threadId: string, shown: Shown): Shown['card'] {
    const journal = this.#core.journal;
    if (journal.isClosed()) return null;
    const turn = journal.runningTurn(threadId) ?? journal.lastTurn(threadId);
    if (turn === null) return null;
    const { pointer } = shown;
    const part: GuidePart = {
      type: 'window_guide', boxId: shown.boxId, process: pointer.process, label: pointer.label,
      ...(pointer.control ? { control: { ...pointer.control } } : {}), ...(pointer.step ? { step: { ...pointer.step } } : {}),
      expiresAt: pointer.expiresAt, end: null,
    };
    const message: Message = { id: newId('msg_'), threadId, turnId: turn.id, role: 'assistant', parts: [part], state: 'complete', createdAt: Date.now() };
    journal.append({ type: 'message.started', threadId, version: 1, payload: message }, () => journal.putMessage(message));
    this.#core.bus.emit('message.started', message);
    this.#core.bus.emit('message.completed', { threadId, messageId: message.id, state: 'complete' });
    return { messageId: message.id, part };
  }

  /** Rewrites the box's card on every client, as a consent card is folded once answered. */
  #foldCard(threadId: string, card: NonNullable<Shown['card']>, change: Partial<Pick<GuidePart, 'expiresAt' | 'end'>>): void {
    const journal = this.#core.journal;
    card.part = { ...card.part, ...change };
    // A deleted conversation has no card left to fold.
    if (journal.isClosed() || journal.getThread(threadId) === null) return;
    const part = card.part;
    journal.append(
      { type: 'message.part', threadId, version: 1, payload: { messageId: card.messageId, partIndex: 0, part } },
      () => journal.setMessagePart(card.messageId, 0, part),
    );
    this.#core.bus.emit('message.part', { threadId, messageId: card.messageId, partIndex: 0, part });
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
    void guide.track(shown.window.id, nativeOf(control, near))
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
    if (shown.watch) clearInterval(shown.watch);
    if ((shown.notify || answered(why)) && shown.waiters.size === 0 && why !== 'cleared') this.#tell(threadId, shown, why);
    if (shown.card) this.#foldCard(threadId, shown.card, { end: endName(why) });
    shown.tracked?.release();
    shown.tracked = null;
    this.#frameLater(threadId);
    this.#core.subscribers.pointer({ id: shown.boxId, rect: null, label: shown.pointer.label, look: shown.pointer.look });
    for (const finish of [...shown.waiters]) finish(why);
    // The opened window's id, never its title: a title can name a document or an account.
    const opened: Record<string, string> = typeof why === 'object' && 'opened' in why ? { opened: why.opened.windowId } : {};
    this.#core.logs.info(`Box over window ${shown.window.id} of ${shown.window.process} taken away: ${endName(why)}`, { source: 'windows', event: 'window.unpoint', threadId, data: { windowId: shown.window.id, process: shown.window.process, why: endName(why), ...opened } });
    return true;
  }
}
