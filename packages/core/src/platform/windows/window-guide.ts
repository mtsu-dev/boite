/**
 * `boite window read`, `point` and `wait-click` on Windows, through `bun:ffi`:
 * the controls of a window (`window-controls.ts`), where a window lies, the
 * mouse's and Escape's state and the windows an app has open. `platform/windows/index.ts` loads it on first use, never
 * at startup.
 *
 * The box itself is drawn by the desktop app (`pointer_window.rs` in the
 * shell): the core sends it where to go with `windows.pointer`.
 *
 * Every rectangle is in physical pixels: the thread is per-monitor aware
 * (V2) for each call, as `window-capture.ts` does, so a box lands on the
 * control at 100 % and 150 % scaling and on every monitor.
 */
import { dlopen, FFIType, ptr } from 'bun:ffi';
import type { AppWindow, NativeControl, ScreenRect, WindowGuide } from '../types.ts';
import { frameBounds, physicalPixels, windowOf } from './window-capture.ts';
import { readControls, trackControl } from './window-controls.ts';

/**
 * Chromium and Electron apps (Discord, VS Code, Slack, a browser) build their
 * accessibility tree only once a UIA client asks for it, so the first read
 * finds nothing: an empty read is tried again for about a second. Measured on
 * Discord on 2026-10-31: 0 controls, then 112 two seconds later.
 */
const EMPTY_RETRIES = 4;
const EMPTY_WAIT_MS = 250;

const U64 = FFIType.u64;
const PTR = FFIType.ptr;
const I32 = FFIType.i32;

function loadUser32() {
  return dlopen('user32.dll', {
    GetCursorPos: { args: [PTR], returns: I32 },
    GetAsyncKeyState: { args: [I32], returns: FFIType.i16 },
    GetSystemMetrics: { args: [I32], returns: I32 },
    IsIconic: { args: [U64], returns: I32 },
    IsHungAppWindow: { args: [U64], returns: I32 },
    GetForegroundWindow: { args: [], returns: U64 },
    GetAncestor: { args: [U64, FFIType.u32], returns: U64 },
    IsWindowVisible: { args: [U64], returns: I32 },
    FindWindowExW: { args: [U64, U64, PTR, PTR], returns: U64 },
    GetWindow: { args: [U64, FFIType.u32], returns: U64 },
    GetWindowThreadProcessId: { args: [U64, PTR], returns: FFIType.u32 },
    GetWindowLongPtrW: { args: [U64, I32], returns: FFIType.i64 },
    GetClassNameW: { args: [U64, PTR, I32], returns: I32 },
    InternalGetWindowText: { args: [U64, PTR, I32], returns: I32 },
  }).symbols;
}

function loadDwm() {
  return dlopen('dwmapi.dll', {
    DwmGetWindowAttribute: { args: [U64, FFIType.u32, PTR, FFIType.u32], returns: I32 },
  }).symbols;
}

function loadKernel32() {
  return dlopen('kernel32.dll', {
    GetModuleHandleW: { args: [PTR], returns: U64 },
    GetProcAddress: { args: [U64, PTR], returns: U64 },
  }).symbols;
}

let user32Symbols: ReturnType<typeof loadUser32> | null = null;
let kernel32Symbols: ReturnType<typeof loadKernel32> | null = null;
let dwmSymbols: ReturnType<typeof loadDwm> | null = null;
const user32 = () => (user32Symbols ??= loadUser32());
const dwm = () => (dwmSymbols ??= loadDwm());
const kernel32 = () => (kernel32Symbols ??= loadKernel32());

const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const VK_ESCAPE = 0x1b;
const SM_SWAPBUTTON = 23;
const ZBID_DESKTOP = 1;

/** UTF-16 code units with a terminating zero. */
function utf16z(text: string): Uint16Array {
  const units = new Uint16Array(text.length + 1);
  for (let index = 0; index < text.length; index += 1) units[index] = text.charCodeAt(index);
  return units;
}

/**
 * `GetWindowBand`, when user32 exports it. It is not documented: it names the
 * layer of the Z order a window lives in. Every app's window, topmost ones and
 * the box included, is in `ZBID_DESKTOP` (1); the Start menu, search and the
 * other system flyouts are in higher ones that only the system can draw over.
 */
type BandReader = (hwnd: bigint, band: Uint32Array) => boolean;
let bandReader: BandReader | null | undefined;

function windowBand(): BandReader | null {
  if (bandReader !== undefined) return bandReader;
  bandReader = null;
  try {
    const user32Module = kernel32().GetModuleHandleW(ptr(utf16z('user32.dll')));
    if (kernel32().GetProcAddress(user32Module, ptr(new TextEncoder().encode('GetWindowBand\0'))) !== 0n) {
      const { GetWindowBand } = dlopen('user32.dll', { GetWindowBand: { args: [U64, PTR], returns: I32 } }).symbols;
      bandReader = (hwnd, band) => GetWindowBand(hwnd, ptr(band)) !== 0;
    }
  } catch { /* no band: every window reads as an app's */ }
  return bandReader;
}

function frameOf(id: string): { rect: ScreenRect; minimized: boolean; above: boolean } | null {
  try {
    const hwnd = windowOf(id);
    // A WinForms dropdown is hidden when it closes, not destroyed: its box goes as if it were.
    if (user32().IsWindowVisible(hwnd) === 0) return null;
    const bounds = physicalPixels(() => frameBounds(hwnd));
    if (bounds === null) return null;
    const band = new Uint32Array(1);
    const above = windowBand()?.(hwnd, band) === true && band[0]! > ZBID_DESKTOP;
    return { rect: { left: bounds.left, top: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }, minimized: user32().IsIconic(hwnd) !== 0, above };
  } catch {
    return null;
  }
}

const GA_ROOTOWNER = 3;
const GW_OWNER = 4;

/**
 * The window at the top of `hwnd`'s chain of owners, `hwnd` itself when
 * nothing owns it. `GetAncestor(GA_ROOTOWNER)` walks `GetParent`, which names
 * the owner of a `WS_POPUP` window only: a WinForms dialog is overlapped, and
 * it answered the dialog itself (measured on 2026-11-02).
 */
function rootOwner(hwnd: bigint): bigint {
  let top = hwnd;
  // An owner chain is short; the bound guards against a cycle.
  for (let depth = 0; depth < 32; depth++) {
    const owner = user32().GetWindow(top, GW_OWNER);
    if (owner === 0n) break;
    top = owner;
  }
  return top;
}
const GWL_EXSTYLE = -20;
const GWL_STYLE = -16;
/** A title bar: a main window and a dialog have one; a menu, a dropdown and a tooltip do not. */
const WS_CAPTION = 0x00C00000n;
const WS_EX_TOOLWINDOW = 0x80n;
const WS_EX_APPWINDOW = 0x40000n;
const DWMWA_CLOAKED = 14;
/** Popups that hold no control: a menu's drop shadow, a tooltip, the input method's windows. */
const NOT_POPUPS = new Set(['SysShadow', 'tooltips_class32', 'IME', 'MSCTFIME UI']);

/**
 * The menus and popups the process of `hwnd` shows over it, topmost first:
 * its visible top-level windows above it in the Z order that `boite window
 * list` leaves out, a tool window or one `hwnd` owns. A Win32 menu (the list
 * under File, a context menu) is its own top-level `#32768` window with no
 * owner, and a WinForms dropdown one the form owns; UI Automation finds
 * neither among the form's descendants, nor most apps' (measured on a
 * WinForms form on 2026-11-02: both showed within 12 ms of being opened, the
 * menu was destroyed on closing, the dropdown hidden). Another process's
 * window is never one of them: the consent to read covers one app.
 */
function popupsOf(hwnd: bigint): bigint[] {
  const api = user32();
  const pid = new Uint32Array(1);
  api.GetWindowThreadProcessId(hwnd, ptr(pid));
  const owner = pid[0]!;
  const popups: bigint[] = [];
  const text = new Uint16Array(64);
  const cloaked = new Uint32Array(1);
  for (let other = api.FindWindowExW(0n, 0n, null, null); other !== 0n && other !== hwnd; other = api.FindWindowExW(0n, other, null, null)) {
    pid[0] = 0;
    api.GetWindowThreadProcessId(other, ptr(pid));
    if (pid[0] !== owner || api.IsWindowVisible(other) === 0 || api.IsIconic(other) !== 0) continue;
    cloaked[0] = 0;
    if (dwm().DwmGetWindowAttribute(other, DWMWA_CLOAKED, ptr(cloaked), 4) === 0 && cloaked[0] !== 0) continue;
    if (NOT_POPUPS.has(new TextDecoder('utf-16le').decode(text.subarray(0, Math.max(0, api.GetClassNameW(other, ptr(text), text.length)))))) continue;
    const owned = api.GetWindow(other, GW_OWNER) !== 0n;
    if (owned) {
      // A dialog of another window of the same app is that window's.
      if (rootOwner(other) !== hwnd) continue;
    } else {
      const exStyle = BigInt(api.GetWindowLongPtrW(other, GWL_EXSTYLE));
      // An app's other main window is listed on its own.
      if ((exStyle & WS_EX_TOOLWINDOW) === 0n || (exStyle & WS_EX_APPWINDOW) !== 0n) continue;
    }
    popups.push(other);
  }
  return popups;
}

const sameControl = (a: NativeControl, b: NativeControl) => a.type === b.type && a.name === b.name && a.automationId === b.automationId
  && a.rect.left === b.rect.left && a.rect.top === b.rect.top && a.rect.width === b.rect.width && a.rect.height === b.rect.height;

/**
 * The controls of the window's popups, then its own. WinForms also lists a
 * dropdown's items among the form's descendants (2026-11-02): each is kept
 * once, as the popup's, so its box goes when the dropdown closes.
 */
function readWithPopups(hwnd: bigint, limit: number, any: boolean, offscreen: boolean): { controls: NativeControl[]; total: number } {
  const controls: NativeControl[] = [];
  let total = 0;
  for (const popup of popupsOf(hwnd)) {
    let read: ReturnType<typeof readControls>;
    // A popup that closed during the read holds nothing.
    try { read = readControls(popup, limit, any, offscreen); } catch { continue; }
    total += read.total;
    for (const control of read.controls) controls.push({ ...control, popup: popup.toString() });
  }
  const fromPopups = controls.length;
  const own = readControls(hwnd, limit, any, offscreen);
  total += own.total;
  for (const control of own.controls) {
    if (fromPopups > 0 && controls.slice(0, fromPopups).some(other => sameControl(other, control))) { total -= 1; continue; }
    controls.push(control);
  }
  return { controls: controls.slice(0, limit), total };
}

/**
 * The visible windows of process `pid` with a title bar, in the Z order: what
 * a box with `until: 'window'` watches for a new one. A dialog is owned by the
 * window it opened from, and `readWithPopups` reads it with that window.
 */
function appWindows(pid: number): AppWindow[] {
  const api = user32();
  const windows: AppWindow[] = [];
  const of = new Uint32Array(1);
  const text = new Uint16Array(256);
  const cloaked = new Uint32Array(1);
  try {
    for (let hwnd = api.FindWindowExW(0n, 0n, null, null); hwnd !== 0n; hwnd = api.FindWindowExW(0n, hwnd, null, null)) {
      of[0] = 0;
      api.GetWindowThreadProcessId(hwnd, ptr(of));
      if (of[0] !== pid || api.IsWindowVisible(hwnd) === 0) continue;
      if ((BigInt(api.GetWindowLongPtrW(hwnd, GWL_STYLE)) & WS_CAPTION) !== WS_CAPTION) continue;
      cloaked[0] = 0;
      if (dwm().DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ptr(cloaked), 4) === 0 && cloaked[0] !== 0) continue;
      const title = new TextDecoder('utf-16le').decode(text.subarray(0, Math.max(0, api.InternalGetWindowText(hwnd, ptr(text), text.length))));
      const owned = api.GetWindow(hwnd, GW_OWNER) !== 0n;
      windows.push({ id: hwnd.toString(), title, ...(owned ? { owner: rootOwner(hwnd).toString() } : {}) });
    }
  } catch { /* a window that closed during the walk ends it */ }
  return windows;
}

/** The window in front is `id`, or a window it owns, such as one of its dialogs. */
function foreground(id: string): boolean {
  try {
    const hwnd = windowOf(id);
    const front = user32().GetForegroundWindow();
    return front === hwnd || (front !== 0n && (user32().GetAncestor(front, GA_ROOTOWNER) === hwnd || rootOwner(front) === hwnd));
  } catch {
    return false;
  }
}

function mouse(): { pressed: boolean; x: number; y: number } {
  const api = user32();
  // GetAsyncKeyState reads the physical buttons: with them swapped, the primary one is the right.
  const primary = api.GetSystemMetrics(SM_SWAPBUTTON) !== 0 ? VK_RBUTTON : VK_LBUTTON;
  const pressed = (api.GetAsyncKeyState(primary) & 0x8000) !== 0;
  const point = new Int32Array(2);
  physicalPixels(() => api.GetCursorPos(ptr(point)));
  return { pressed, x: point[0]!, y: point[1]! };
}

/**
 * Escape's state, read as `mouse` reads the buttons: a poll of the key, not a
 * keyboard hook, so the key still reaches the window in front (it closes a
 * menu there too) and nothing else typed is seen.
 */
function escape(): boolean {
  return (user32().GetAsyncKeyState(VK_ESCAPE) & 0x8000) !== 0;
}

export async function loadWindowGuide(): Promise<WindowGuide | { unavailable: string }> {
  if (process.platform !== 'win32') return { unavailable: 'the on-screen guide needs Windows' };
  try {
    user32();
    kernel32();
  } catch (error) {
    return { unavailable: `user32 cannot be loaded: ${error instanceof Error ? error.message : String(error)}` };
  }
  return {
    controls: async (id, limit, any = false, offscreen = false) => {
      const hwnd = windowOf(id);
      if (user32().IsHungAppWindow(hwnd) !== 0) throw new Error('the window is not responding');
      let read = physicalPixels(() => readWithPopups(hwnd, limit, any, offscreen));
      for (let attempt = 0; attempt < EMPTY_RETRIES && read.total === 0; attempt++) {
        await Bun.sleep(EMPTY_WAIT_MS);
        read = physicalPixels(() => readWithPopups(hwnd, limit, any, offscreen));
      }
      return read;
    },
    track: async (id, control) => {
      const hwnd = windowOf(id);
      if (user32().IsHungAppWindow(hwnd) !== 0) throw new Error('the window is not responding');
      let within = hwnd;
      if (control.popup !== undefined) {
        within = windowOf(control.popup);
        if (!popupsOf(hwnd).includes(within)) return null;
      }
      const live = physicalPixels(() => trackControl(within, control));
      if (live === null) return null;
      return {
        // A hung app is not asked: the call would hold the core's thread until the transaction timeout.
        rect: () => user32().IsHungAppWindow(hwnd) !== 0 ? 'busy' : physicalPixels(() => live.rect()),
        state: () => user32().IsHungAppWindow(hwnd) !== 0 ? 'busy' : live.state(),
        release: () => live.release(),
      };
    },
    frame: frameOf,
    mouse,
    escape,
    foreground,
    appWindows,
  };
}
