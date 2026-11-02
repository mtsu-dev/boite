import type { ProjectId } from './ids';

/**
 * Native desktop windows of the machine that runs the core: an editor, a game,
 * an installer. An agent captures them with `boite window`, the owner watches
 * one in a conversation's Window panel (docs/windows.md). Read-only: no input
 * ever reaches a window, and none is restored, raised or focused.
 */
export interface DesktopWindow {
  /** The window's handle on its machine (an HWND, an X11 window id) in decimal. Valid until the window closes. */
  id: string;
  /** The executable's file name: `Unity.exe`, `blender`. */
  process: string;
  pid: number;
  /** The window's physical pixels. */
  width: number;
  height: number;
  minimized: boolean;
  /** Only for an app the project allows: another app's title can name a document, a mail or an account. */
  title?: string;
  /** The app is on this project's list of allowed apps. */
  allowed: boolean;
  /** Never captured, even on request: a password manager, the sign-in screen or an app listed in `windowCaptureExclusions`. */
  excluded?: true;
}

/**
 * Exactly one of the three. `process` is the executable's name, `.exe`
 * optional, case-insensitive. `title` is a case-insensitive part of the title
 * and matches only windows of allowed apps, since other titles are hidden.
 * More than one window answering is refused with the candidates.
 */
export interface WindowTarget {
  id?: string;
  process?: string;
  title?: string;
}

/** A rectangle of the window, in its pixels or, with `unit: 'fraction'`, in fractions of its size from 0 to 1. */
export interface WindowCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: 'px' | 'fraction';
}

/** Whether this machine can capture windows, and why not. */
export interface WindowSupport {
  available: boolean;
  reason?: string;
}

/** What the capture wrote. `source` is the window's size before `max` and `crop`. */
export interface WindowShot {
  windowId: string;
  process: string;
  /** The PNG's absolute path. */
  path: string;
  width: number;
  height: number;
  source: { width: number; height: number };
}

/** A contact sheet: `frames` pictures taken `1 / fps` seconds apart, each labelled with its number and time. */
export interface WindowClip extends WindowShot {
  frames: number;
  seconds: number;
  fps: number;
}

/** The window a conversation's Window panel shows. Nothing is captured until a viewer presses Show. */
export interface WindowWatch {
  windowId: string;
  process: string;
  /** Only for an allowed app, as in `DesktopWindow`. */
  title?: string;
  openedAt: number;
}

/** One JPEG of the watched window. `id` names that picture at one size and quality, as `MobileDeviceFrame` does. */
export interface WindowFrame {
  id: string;
  windowId: string;
  width: number;
  height: number;
  base64: string;
  at: number;
  unchanged?: never;
}

/** The answer to a `windows.frame` whose `previous` is still what the window shows: no picture is sent. */
export interface WindowFrameUnchanged {
  id: string;
  windowId: string;
  width: number;
  height: number;
  unchanged: true;
  at: number;
}

/** An app a project lets agents capture, named by its executable's path. */
export interface AllowedWindowApp {
  path: string;
  process: string;
  addedAt: number;
}

export type WindowConsentAnswer = 'once' | 'always' | 'refuse';
export const WINDOW_CONSENT_ANSWERS: readonly WindowConsentAnswer[] = ['once', 'always', 'refuse'];
export type WindowCaptureKind = 'screenshot' | 'clip' | 'stream';
/** What a consent card asks for: a capture, or `read`, the names of a window's controls for `boite window read` and `point`. */
export type WindowConsentKind = WindowCaptureKind | 'read';

/**
 * One control of a window a person can act on, as `boite window read` lists
 * it from the system's accessibility tree: a button, a menu item, a field.
 */
export interface WindowControl {
  /** `#3` in the CLI: names the control to `windows.point` until the conversation's next `windows.read`, which keeps it with `changes`. */
  id: number;
  /** UI Automation's control type in English: `Button`, `MenuItem`, `Edit`. */
  type: string;
  name: string;
  /** The app's own identifier for the control, when it gives one. */
  automationId?: string;
  /**
   * Set on a control of a menu or popup the app opened over the window, such
   * as the list under File: that popup's window id. The control closes with
   * it, and lies in the window's pixels like the others, possibly outside the
   * window's own rectangle.
   */
  popup?: string;
  /**
   * Set only by a read with `offscreen`, on a control scrolled out of view:
   * where it lies from the visible area of its window, or of its popup.
   */
  offscreen?: WindowOffscreen;
  /** Where it lies in the window, in the window's physical pixels: the coordinates of a full-size screenshot. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a control out of view lies from the visible area of its window: the
 * way the person scrolls to bring it in. `unknown` when its app says it is
 * out of view without a place outside the window, as for a control on a tab
 * not shown, or gives no place at all.
 */
export type WindowOffscreen = WindowEdge | 'unknown';
/** A side of a window, toward which a box points at a control past it. */
export type WindowEdge = 'above' | 'below' | 'left' | 'right';
export const WINDOW_EDGES: readonly WindowEdge[] = ['above', 'below', 'left', 'right'];

/**
 * What `windows.read` found. `total` counts every control that matched before
 * `limit`. With `changes`, `controls` and `total` hold only the controls that
 * appeared since the previous read, unless `changes.compared` is false.
 */
export interface WindowControls {
  windowId: string;
  process: string;
  controls: WindowControl[];
  total: number;
  changes?: WindowReadChanges;
}

/**
 * How a read with `changes` compares with the conversation's previous read of
 * the same window, taken with the same `any` and `offscreen`. A control still
 * there keeps the id it had; one that appeared takes the next id after the
 * previous read's highest. See `windowControlChanges` for what counts as the
 * same control.
 */
export interface WindowReadChanges {
  /** False when there was no such previous read: `controls` is then a full read, numbered from 1. */
  compared: boolean;
  /** The ids of the previous read whose controls are gone, ascending. */
  vanished: number[];
  /** How many controls of the previous read are still there, under the ids they had. */
  unchanged: number;
}

/** The ring's corners: `box` follows the control's own, `round` makes a pill, or a circle around a square control such as an app icon. */
export type WindowPointerShape = 'box' | 'round';

/** How the ring is drawn: its shape, and how far outside the control it runs, in the screen's CSS pixels. */
export interface WindowPointerLook {
  shape: WindowPointerShape;
  pad: number;
}

/** The box a conversation draws on the screen with `windows.point`; one at a time. */
export interface WindowPointer {
  windowId: string;
  process: string;
  label: string;
  /** The box in the window's physical pixels. It follows the window when the window moves. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** When the box goes away by itself. */
  expiresAt: number;
  look: WindowPointerLook;
  /** The control it shows, when it was named by id or by name. */
  control?: { type: string; name: string };
  /** The menu or popup window the control lies in: the box goes when it closes, as with its window. */
  popup?: string;
  /**
   * The system draws this window above every app's window, as it does the
   * Start menu: the box stays behind it, so the agent says where to click.
   */
  behind?: true;
  /** The agent hears of the click, or of the box ending without one, as a message instead of waiting. */
  notify?: true;
  /** What ends the box besides `seconds`, when it is not a click inside it: see `WindowPointerUntil`. */
  until?: Exclude<WindowPointerUntil, 'click'>;
  /**
   * The control lies out of view that way: the box shows as a marker on that
   * edge of the window, pointing toward it, and becomes the ring once the
   * person scrolls it into view. Absent while it is in view.
   */
  offscreen?: WindowEdge;
  /** Where this box stands in a guided tour of several: the box and its card show `index / total`. */
  step?: WindowPointerStep;
}

/**
 * A box's place in a tour the agent guides the person through, one box at a
 * time: step `index` of `total`, `1 <= index <= total <= WINDOW_POINT_STEPS_MAX`.
 * The core keeps no tour: each `windows.point` says its own step.
 */
export interface WindowPointerStep {
  index: number;
  total: number;
}

/**
 * What a box waits for. `click`: a press inside it. `change`: the control's
 * value, check state or selection changes, so the agent can teach "type your
 * name here"; it learns which of the three changed, never what the control
 * holds. `window`: the app opens a new window or dialog, so the agent can teach
 * "open this dialog"; it learns the window's id and title, to read it next.
 */
export type WindowPointerUntil = 'click' | 'change' | 'window';
export const WINDOW_POINTER_UNTIL: readonly WindowPointerUntil[] = ['click', 'change', 'window'];

/** What changed in a control a box with `until: 'change'` watched: its text or number, its check state, or whether it is selected. */
export type WindowChange = 'value' | 'toggle' | 'selection';

/** The window or dialog the app opened while a box with `until: 'window'` waited. */
export interface WindowOpened {
  windowId: string;
  title: string;
  /**
   * The window to `windows.read` for its controls: the window itself, or for
   * a dialog the window that owns it, which lists the dialog's controls first,
   * marked with its `popup`.
   */
  readWindowId: string;
}

/**
 * One box for the desktop app of the core's machine to draw above every
 * window, click-through, as `windows.point` asks: the app owns the window and
 * its look, the core where it goes and when it goes away.
 */
export interface WindowPointerBox {
  /** The box's own id: a later event with the same id moves it or takes it away. */
  id: string;
  /** Where the control is on the screen, in physical pixels; null takes the box away. */
  rect: { left: number; top: number; width: number; height: number } | null;
  label: string;
  look: WindowPointerLook;
  /**
   * Set on the frame drawn around a whole Chromium or Electron window, which
   * builds its controls only while it is in front: the desktop app brings that
   * window to the front once, and the page says why, naming the app.
   */
  frame?: { app: string; windowId: string };
  /**
   * The control lies past this edge of its window: the page draws a marker at
   * `rect`, just inside that edge, pointing out of it, instead of a ring. A
   * click on the marker is not a click on the control.
   */
  edge?: WindowEdge;
  /** The box's step in a tour, drawn as a small `index / total` badge on its label. */
  step?: WindowPointerStep;
}

/**
 * Why `windows.waitClick` ended without what its box waited for: its time ran
 * out, the agent took it away or replaced it, its window or popup went, or the
 * person ended it (`WindowGuideAnswer`).
 */
export type WindowWaitEnd = 'timeout' | 'cleared' | 'gone' | WindowGuideAnswer;

/**
 * How the person ends a box that is click-through, so cannot be answered on
 * the screen: `dismissed` with Done on its card or Escape on the machine,
 * `missing` with I cannot find it on its card.
 */
export type WindowGuideAnswer = 'dismissed' | 'missing';
export const WINDOW_GUIDE_ANSWERS: readonly WindowGuideAnswer[] = ['dismissed', 'missing'];

/** How a box ended, as its `window_guide` card says: what it waited for happened, or a `WindowWaitEnd`. */
export type WindowGuideEnd = 'clicked' | 'changed' | 'opened' | WindowWaitEnd;

/** How long a capture waits for the owner's answer on a consent card. */
export const WINDOW_CONSENT_TIMEOUT_MS = 10 * 60_000;
/** `--max` when none is given: the longest side, in pixels. 0 asks for the full size. */
export const WINDOW_SHOT_MAX = 1280;
export const WINDOW_CLIP_LIMITS = { seconds: 10, fps: 4 } as const;
/** Controls `windows.read` returns: a line costs about 10 tokens, so the default stays near 600. */
export const WINDOW_READ_LIMIT = { default: 60, max: 400 } as const;
/** How long a box stays drawn, and how long `windows.waitClick` waits, in seconds. */
export const WINDOW_POINT_SECONDS = { default: 120, max: 600 } as const;
export const WINDOW_POINT_LABEL_MAX = 80;
/** The longest tour a box's `step` counts in. */
export const WINDOW_POINT_STEPS_MAX = 20;
/** How far outside the control the ring runs, in CSS pixels. */
export const WINDOW_POINT_PAD = { default: 5, max: 24 } as const;
/** The longest side of a capture card's thumbnail. */
export const WINDOW_THUMBNAIL_MAX = 320;

/**
 * Executables never captured, matched on the file name without case: password
 * managers, the Windows sign-in, lock and elevation screens. The owner adds
 * more in Settings (`windowCaptureExclusions`).
 */
export const WINDOW_CAPTURE_EXCLUDED = [
  '1password.exe', '1password', 'bitwarden.exe', 'bitwarden', 'keepass.exe', 'keepassxc.exe', 'keepassxc', 'keepass2',
  'dashlane.exe', 'dashlane', 'logonui.exe', 'lockapp.exe', 'credentialuibroker.exe', 'consent.exe',
] as const;

export interface WindowsRpcMethods {
  /** The machine's top-level windows a person sees, minimized ones included, and what the Window panel shows. */
  'windows.list': { params: { threadId: string }; result: { windows: DesktopWindow[]; support: WindowSupport; watch: WindowWatch | null } };
  /**
   * One PNG of the window, written to `output`: inside the conversation's
   * folder or project, or its temporary folder, which is also where it goes
   * without `output`. `max` is the longest side, `WINDOW_SHOT_MAX` by default,
   * 0 for the full size. An app the project does not allow waits for the
   * owner's answer on a consent card, up to `WINDOW_CONSENT_TIMEOUT_MS`.
   */
  'windows.screenshot': {
    params: { threadId: string; target: WindowTarget; output?: string; max?: number; crop?: WindowCrop };
    result: WindowShot;
  };
  /** A labelled contact sheet of `seconds` (at most 10) at `fps` (at most 4, 2 by default), as one PNG. */
  'windows.clip': {
    params: { threadId: string; target: WindowTarget; seconds: number; fps?: number; output?: string; max?: number };
    result: WindowClip;
  };
  /** Shows the window in the conversation's Window panel, after the same consent as a capture. */
  'windows.watch': { params: { threadId: string; target: WindowTarget }; result: { watch: WindowWatch } };
  /** The watched window as a JPEG; with `previous`, `unchanged` while it shows the same picture. */
  'windows.frame': {
    params: { threadId: string; windowId: string; maxWidth?: number; quality?: number; previous?: string };
    result: WindowFrame | WindowFrameUnchanged;
  };
  /** Empties the conversation's Window panel. */
  'windows.close': { params: { threadId: string }; result: { closed: boolean } };
  /** The owner's answer to a `window_consent` card. */
  'windows.consent': { params: { threadId: string; requestId: string; answer: WindowConsentAnswer }; result: { ok: true } };
  'windows.allowlist': { params: { projectId: ProjectId }; result: { apps: AllowedWindowApp[] } };
  /** Takes an app off the project's list; its next capture asks again. */
  'windows.revoke': { params: { projectId: ProjectId; path: string }; result: { apps: AllowedWindowApp[] } };
  /**
   * The enabled controls on screen of the window, from its accessibility tree,
   * numbered for `windows.point`. `filter` keeps the names that contain it,
   * without case. Needs the same consent as a capture, asked as `read`. The
   * menus and popups the same app has open over the window come first, each
   * of their controls marked with its `popup`.
   */
  /**
   * `any` adds the containers (groups, panes, lists, images, text, documents)
   * to the controls a person acts on. `offscreen` adds the controls scrolled
   * out of view, each marked with where it lies (`WindowControl.offscreen`).
   * `changes` answers only what changed since the conversation's previous
   * read of the window (`WindowReadChanges`); the read still becomes the one
   * `windows.point` takes ids from, in full.
   */
  'windows.read': { params: { threadId: string; target: WindowTarget; filter?: string; limit?: number; any?: boolean; offscreen?: boolean; changes?: boolean }; result: WindowControls };
  /**
   * Draws a box with a label above every window, click-through, until a click
   * inside it ends a `windows.waitClick`, `windows.unpoint` or `seconds`.
   * Exactly one of: `control`, an id from the conversation's last
   * `windows.read`; `name`, the one control of `target` with that name, read
   * as `windows.read` does; `at`, a rectangle of `target` in its pixels or
   * fractions, for an app with no accessibility tree. Replaces the
   * conversation's previous box. With `notify`, the agent keeps working: the
   * click, or the box timing out or losing its window first, reaches its
   * conversation as a message, unless a `windows.waitClick` took the click.
   * `until` sets what ends the box instead of a click (`WindowPointerUntil`):
   * `change` needs a control, by id or by name; `until` other than `click`
   * reads the app, so a rectangle with it asks the same consent as a read.
   * A control out of view (`WindowControl.offscreen`) gets a marker on the
   * window's edge pointing toward it until it scrolls in; one whose place is
   * `unknown` is refused.
   */
  'windows.point': {
    params: { threadId: string; control?: number; target?: WindowTarget; name?: string; at?: WindowCrop; label?: string; seconds?: number; shape?: WindowPointerShape; pad?: number; notify?: boolean; any?: boolean; until?: WindowPointerUntil; step?: WindowPointerStep };
    result: { pointer: WindowPointer };
  };
  /**
   * Waits for what the conversation's box waits for, then takes the box away:
   * the person pressing the primary button inside it, or with `until`, the
   * control changing or the app opening a window.
   */
  'windows.waitClick': {
    params: { threadId: string; timeoutSeconds?: number };
    result: { clicked: true; pointer: WindowPointer }
      | { clicked: false; changed: WindowChange; pointer: WindowPointer }
      | { clicked: false; opened: WindowOpened; pointer: WindowPointer }
      | { clicked: false; reason: WindowWaitEnd };
  };
  /** Takes the conversation's box off the screen. */
  'windows.unpoint': { params: { threadId: string }; result: { cleared: boolean } };
  /**
   * The person's answer on a box's `window_guide` card: it takes box `boxId`
   * away as unpoint does, and the agent hears `answer` from its wait, or as a
   * message when none waits. Refused once that box is gone.
   */
  'windows.dismiss': { params: { threadId: string; boxId: string; answer: WindowGuideAnswer }; result: { ok: true } };
}

export interface WindowsRpcEvents {
  /** For the clients subscribed to the conversation: what its Window panel shows now. */
  'windows.changed': { threadId: string; watch: WindowWatch | null };
  /** Only to the desktop app of the core's own machine (`clientName` `shell` on the loopback): a box to draw, move or take away. */
  'windows.pointer': WindowPointerBox;
}

/** A window id as `windows.list` gives it. The core still acts only on a window it lists. */
export function windowIdError(id: unknown): string | null {
  return typeof id === 'string' && /^\d{1,20}$/.test(id) ? null : 'windowId must be an id from `boite window list`';
}

/** The one problem with a target, or null. */
export function windowTargetError(target: unknown): string | null {
  if (!target || typeof target !== 'object') return 'target must name a window by id, process or title';
  const { id, process, title } = target as WindowTarget;
  const given = [id, process, title].filter((value) => value !== undefined);
  if (given.length !== 1) return 'target must name exactly one of id, process or title';
  if (id !== undefined) return windowIdError(id);
  const value = process ?? title;
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 260 && !/\p{Cc}/u.test(value)
    ? null : `target ${process !== undefined ? 'process' : 'title'} must be 1 to 260 characters with no control characters`;
}

/** The one problem with a crop, or null. Pixels are integers; fractions lie in [0, 1] with a size above 0. */
export function windowCropError(crop: unknown): string | null {
  if (!crop || typeof crop !== 'object') return 'crop must be x,y,width,height';
  const { x, y, width, height, unit } = crop as WindowCrop;
  const values = [x, y, width, height];
  if (unit === 'px') {
    return values.every((value) => Number.isInteger(value) && value >= 0 && value <= 32768) && width > 0 && height > 0
      ? null : 'a crop in pixels needs integers from 0 with a width and height above 0';
  }
  if (unit === 'fraction') {
    return values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) && width > 0 && height > 0 && x + width <= 1 + 1e-9 && y + height <= 1 + 1e-9
      ? null : 'a crop in fractions needs values from 0 to 1, a width and height above 0, and x + width and y + height at most 1';
  }
  return 'crop unit must be px or fraction';
}

/**
 * Numbers `next`, a read of a window in tree order, against `previous`, the
 * conversation's last read of it. A control is the same as one before when
 * its type, automation id, name and whether it lies in a menu or popup are
 * the same. UI Automation's runtime ids are not used: the reads do not take
 * them, and an app that rebuilds its tree (Chromium, a recycled list row)
 * gives the same control a new one. Where several controls share that identity
 * (a Delete button on each row), each pairs with the nearest one before,
 * centre to centre. A pair keeps its previous id, wherever it moved; the
 * others take ids after the previous read's highest, in tree order.
 */
export function windowControlChanges(previous: readonly WindowControl[], next: readonly Omit<WindowControl, 'id'>[]): { controls: WindowControl[]; appeared: WindowControl[]; vanished: number[]; unchanged: number } {
  const identity = (control: Omit<WindowControl, 'id'>) => JSON.stringify([control.type, control.automationId ?? '', control.name, control.popup !== undefined]);
  const before = new Map<string, WindowControl[]>();
  for (const control of previous) {
    const key = identity(control);
    const group = before.get(key);
    if (group) group.push(control); else before.set(key, [control]);
  }
  const after = new Map<string, number[]>();
  next.forEach((control, index) => {
    const key = identity(control);
    const group = after.get(key);
    if (group) group.push(index); else after.set(key, [index]);
  });
  const ids: (number | undefined)[] = new Array(next.length);
  const centre = (control: Omit<WindowControl, 'id'>) => [control.x + control.width / 2, control.y + control.height / 2] as const;
  for (const [key, indexes] of after) {
    const candidates = before.get(key);
    if (!candidates) continue;
    if (candidates.length === 1 && indexes.length === 1) { ids[indexes[0]!] = candidates[0]!.id; continue; }
    const pairs: { index: number; id: number; distance: number }[] = [];
    for (const index of indexes) {
      const [x, y] = centre(next[index]!);
      for (const candidate of candidates) {
        const [cx, cy] = centre(candidate);
        pairs.push({ index, id: candidate.id, distance: Math.hypot(x - cx, y - cy) });
      }
    }
    pairs.sort((a, b) => a.distance - b.distance || a.id - b.id);
    const taken = new Set<number>();
    for (const pair of pairs) {
      if (ids[pair.index] !== undefined || taken.has(pair.id)) continue;
      ids[pair.index] = pair.id;
      taken.add(pair.id);
    }
  }
  let nextId = previous.reduce((highest, control) => Math.max(highest, control.id), 0);
  const kept = new Set<number>();
  const appeared: WindowControl[] = [];
  const controls = next.map((control, index) => {
    const id = ids[index];
    if (id !== undefined) { kept.add(id); return { id, ...control }; }
    const fresh = { id: ++nextId, ...control };
    appeared.push(fresh);
    return fresh;
  });
  const vanished = previous.map(control => control.id).filter(id => !kept.has(id)).sort((a, b) => a - b);
  return { controls, appeared, vanished, unchanged: kept.size };
}

/** The one problem with a box's tour step, or null: whole numbers with `1 <= index <= total <= WINDOW_POINT_STEPS_MAX`. */
export function windowStepError(step: unknown): string | null {
  const expected = `step must be N/M, whole numbers with 1 <= N <= M <= ${WINDOW_POINT_STEPS_MAX}`;
  if (!step || typeof step !== 'object') return expected;
  const { index, total } = step as WindowPointerStep;
  if (!Number.isInteger(index) || !Number.isInteger(total)) return expected;
  return index >= 1 && index <= total && total <= WINDOW_POINT_STEPS_MAX ? null : `${expected}, not ${index}/${total}`;
}

/** `N/M` as the CLI takes it, such as `2/5`; null when it is not two whole numbers around a slash. */
export function parseWindowStep(text: string): WindowPointerStep | null {
  const match = /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/.exec(text);
  return match ? { index: Number(match[1]), total: Number(match[2]) } : null;
}

/** `x,y,w,h` as the CLI takes it: pixels, or fractions when every value is at most 1 and one has a decimal point. */
export function parseWindowCrop(text: string): WindowCrop | null {
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => !/^\d+(\.\d+)?$|^\.\d+$/.test(part))) return null;
  const [x, y, width, height] = parts.map(Number) as [number, number, number, number];
  const fraction = parts.some((part) => part.includes('.')) && [x, y, width, height].every((value) => value <= 1);
  return { x, y, width, height, unit: fraction ? 'fraction' : 'px' };
}
