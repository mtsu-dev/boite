import type { Chord } from '@boite/contracts';
import { holdsModifiers, isMac } from './keybindings';
import { desktopShell } from './shell-platform';
/*
 * The interface zoom: `Ctrl+=`, `Ctrl+-`, `Ctrl+0` and, once the user binds it
 * on the Keyboard page, the `zoom-wheel` chord anywhere in the desktop shell,
 * and the Zoom row of Settings, Appearance. It is the webview's own
 * zoom, the one a browser applies, so the layout recomputes at the new size
 * (the media queries included) rather than scaling a picture of it. For the
 * same reason the page of a browser surface keeps its own ladder.
 *
 * A browser tab reading the UI has its own `Ctrl+=` and Ctrl + wheel already, so nothing here
 * runs outside the shell. The factor is kept on this device under `boite.zoom`
 * and applied before the shell shows its window, which waits for the first
 * painted frame (`main.ts`).
 */

/** The rungs a zoom walks, the UI's and a browser surface's alike. */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const ZOOM_DEFAULT = 1;
export const ZOOM_KEY = 'boite.zoom';

/** The rung after this one in that direction, or the end of the ladder. */
export function stepZoom(current: number, direction: -1 | 1): number {
  const at = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.001);
  const from = at < 0 ? ZOOM_STEPS.indexOf(ZOOM_DEFAULT) : at;
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + direction));
  return ZOOM_STEPS[next] ?? ZOOM_DEFAULT;
}

/** Which way a keydown moves the zoom, `0` for back to 100 %, null when it is not a zoom key. */
export function zoomKey(event: KeyboardEvent): -1 | 0 | 1 | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  // Shift is let through: `+` is Shift+= on a US board and its own key on a
  // French one, and the keypad sends `+` and `-` with no Shift at all.
  switch (event.key) {
    case '=': case '+': return 1;
    case '-': case '_': return -1;
    case '0': return 0;
    default: return null;
  }
}

/** The wheel chord the zoom listens for now: null with no chord bound, outside the shell, or while the Keyboard page records one. */
let listening: { chord: Chord; mac: boolean } | null = null;
let recording = false;

/** A wheel turned with exactly the bound chord's modifiers: one the zoom takes, so nothing else scrolls with it. */
export function zoomWheel(event: WheelEvent): boolean {
  return listening !== null && !recording && holdsModifiers(event, listening.chord, listening.mac);
}

/** While the Keyboard page records a wheel chord, the wheel is the page's: the old chord zooms nothing. */
export function recordingWheel(on: boolean): void {
  recording = on;
}

/** How long the wheel rests before its next notch starts a new turn. A pinch sends its deltas far closer. */
const WHEEL_REST = 250;

/**
 * Wheel deltas made rungs. The first delta of a turn steps at once, however
 * small: one notch is one rung on every wheel. Within the turn, the next rung
 * waits for a whole notch more (100 pixels or 3 lines, as the device screen
 * counts them), so a pinch or a trackpad, which send a stream of small
 * deltas, walk one rung per notch's worth rather than one per event.
 */
export function wheelSteps(): (event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'timeStamp'>) => -1 | 1 | null {
  let way = 0, turned = 0, last = -Infinity;
  return (event) => {
    const notches = event.deltaY * (event.deltaMode === 1 ? 1 / 3 : event.deltaMode === 2 ? 3 : 1 / 100);
    if (!notches) return null;
    // Turned up, away from the reader, the wheel enlarges, as in a browser.
    const next = notches < 0 ? 1 : -1;
    const rested = event.timeStamp - last > WHEEL_REST;
    last = event.timeStamp;
    if (rested || next !== way) {
      way = next;
      turned = 0;
      return next;
    }
    turned += Math.abs(notches);
    if (turned < 1) return null;
    turned = 0;
    return next;
  };
}

/**
 * The `zoom-wheel` chord (`mod+wheel`, `alt+wheel`...) walks the same ladder
 * as the keys, from anywhere in the shell, before the terminal or a list can
 * scroll with it. With no chord, the default, nothing is listened to at all.
 * The modifiers must be the chord's exactly: `mod+wheel` leaves Ctrl+Alt with
 * the wheel alone.
 *
 * A view that zooms its own content with the wheel, a picture, says so with
 * `data-wheel-zoom` and keeps every wheel, whatever the chord: the image
 * viewer zooms on Ctrl and pans on the rest, a file's picture zooms on any.
 *
 * The listener can cancel a scroll only once the chord's modifiers are down:
 * a cancellable wheel listener makes every scroll wait for the main thread
 * first. A pinch on a trackpad is a Ctrl wheel with no key down, so it zooms
 * only on a `ctrl+wheel` chord, or `mod+wheel` off a Mac: its first delta
 * zooms without being cancelled, the rest of it is.
 */
export function watchZoomWheel(chord: Chord | null, failed: (error: unknown) => void, mac: boolean = isMac()): () => void {
  if (!inShell() || chord === null || chord.key !== 'wheel') return () => {};
  const mine = { chord, mac };
  listening = mine;
  const step = wheelSteps();
  let held = false;
  const wheel = (event: WheelEvent): void => {
    if (recording || !holdsModifiers(event, chord, mac)) {
      // A pinch is over, or the key came up where this window could not hear it.
      hold(false);
      return;
    }
    if (event.target instanceof Element && event.target.closest('[data-wheel-zoom]')) return;
    hold(true);
    event.preventDefault();
    event.stopPropagation();
    const way = step(event);
    if (way) void setZoom(stepZoom(wantedZoom(), way)).catch(failed);
  };
  const hold = (on: boolean): void => {
    if (on === held) return;
    held = on;
    window.removeEventListener('wheel', wheel, true);
    window.addEventListener('wheel', wheel, { capture: true, passive: !on });
  };
  const keys = (event: KeyboardEvent): void => hold(holdsModifiers(event, chord, mac));
  const release = (): void => hold(false);
  window.addEventListener('wheel', wheel, { capture: true, passive: true });
  window.addEventListener('keydown', keys, true);
  window.addEventListener('keyup', keys, true);
  window.addEventListener('blur', release);
  return () => {
    if (listening === mine) listening = null;
    window.removeEventListener('wheel', wheel, true);
    window.removeEventListener('keydown', keys, true);
    window.removeEventListener('keyup', keys, true);
    window.removeEventListener('blur', release);
  };
}

export function inShell(): boolean {
  return typeof window !== 'undefined' && desktopShell();
}

/** The stored factor, 1 when none is stored or it is not a rung of the ladder. */
export function readZoom(): number {
  try {
    const stored = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(stored) ? stored : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

let current = ZOOM_DEFAULT;
let wanted = ZOOM_DEFAULT;
let applying: Promise<void> | null = null;
const listeners = new Set<(factor: number) => void>();

/** The factor the webview wears right now. The browser bridge scales a surface's rectangle by it. */
export function currentZoom(): number {
  return current;
}

/** The factor last asked for, worn or on its way: a key pressed twice quickly steps from it twice. */
export function wantedZoom(): number {
  return wanted;
}

export function subscribeZoom(listener: (factor: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function apply(factor: number): Promise<void> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  await getCurrentWebview().setZoom(factor);
}

/*
 * One factor goes to the webview at a time, and each time the latest asked:
 * a reset pressed while a step is on its way lands after it rather than being
 * dropped as already worn. A refusal ends the run, reaches every caller and
 * leaves the next step to start from the factor worn.
 */
async function drain(): Promise<void> {
  try {
    while (wanted !== current) {
      const factor = wanted;
      await apply(factor);
      current = factor;
      keep(factor);
      for (const listener of listeners) listener(factor);
    }
  } catch (error) {
    wanted = current;
    throw error;
  } finally {
    applying = null;
  }
}

/** Stored once worn, so a factor the webview refused is not tried again at the next launch. */
function keep(factor: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(factor));
  } catch {
    // Storage refused: the zoom holds until the window closes.
  }
}

function want(factor: number): Promise<void> {
  wanted = factor;
  if (applying) return applying;
  if (wanted === current) {
    keep(factor);
    return Promise.resolve();
  }
  applying = drain();
  return applying;
}

/** Zooms the shell's webview and keeps the factor. Outside the shell it does nothing. */
export async function setZoom(factor: number): Promise<void> {
  if (!inShell() || !ZOOM_STEPS.includes(factor)) return;
  await want(factor);
}

/** Applies the stored factor at boot. Resolved once the webview wears it, or refused it. */
export async function startZoom(): Promise<void> {
  const stored = readZoom();
  if (!inShell() || stored === ZOOM_DEFAULT) return;
  try {
    await want(stored);
  } catch {
    // An older shell without the permission keeps 100 %.
  }
}
