/*
 * `boite window point`'s box on the desktop: the core sends `windows.pointer`
 * to the desktop app of its own machine, and the main UI hands each event to
 * the shell, which owns the transparent window the box is drawn in
 * (`pointer_window.rs`). That window's page is `PointerApp.svelte`.
 */
import type { WindowPointerBox, WindowPointerLook } from '@boite/contracts';

/** What the shell tells a pointer page, in that page's CSS pixels: the control, and whether the label goes under it. */
export interface PointerLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  below: boolean;
  look: WindowPointerLook;
}

/** The ring around the control, `look.pad` outside it, kept inside the window so a control at a screen edge keeps all four sides. */
export function pointerRing(layout: PointerLayout, size: { width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const pad = layout.look.pad;
  const left = Math.max(0, layout.x - pad);
  const top = Math.max(0, layout.y - pad);
  const right = Math.min(size.width, layout.x + layout.width + pad);
  const bottom = Math.min(size.height, layout.y + layout.height + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Space between the ring and the label's bubble, in CSS pixels. */
export const TAG_GAP = 10;
/** Where the bubble's tail sits from the bubble's near edge, at most. */
const TAIL_INSET = 22;

/**
 * The label's bubble above or below the ring. Its tail points at the ring's
 * middle when the control is small, and near its edge when it is wide. A ring
 * in the window's right half hangs its bubble to the left, from its right
 * edge: the window ends at the monitor's edge, so a bubble running right from
 * a control there would have no room for its text.
 */
export function pointerTag(ring: { left: number; top: number; width: number; height: number }, size: { width: number; height: number }, below: boolean): { side: 'left' | 'right'; edge: number; top: number | null; bottom: number | null; tail: number; maxWidth: number } {
  const reach = Math.min(ring.width / 2, TAIL_INSET + 6);
  const side = ring.left + ring.width / 2 > size.width / 2 ? 'right' : 'left';
  // `aim` and `edge` are measured from the side the bubble hangs from.
  const aim = side === 'left' ? ring.left + reach : size.width - (ring.left + ring.width) + reach;
  const edge = Math.max(4, aim - TAIL_INSET);
  return {
    side,
    edge,
    top: below ? ring.top + ring.height + TAG_GAP : null,
    bottom: below ? null : size.height - ring.top + TAG_GAP,
    tail: aim - edge,
    maxWidth: Math.max(0, size.width - edge - 4)
  };
}

type Invoke =(command: string, args: Record<string, unknown>) => Promise<unknown>;

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);

/** The shell's commands run in parallel: one at a time, in the core's order, so a box that replaces another gets its window. */
let queue: Promise<void> = Promise.resolve();

/**
 * One `windows.pointer` event as the Store that received it hands it on.
 * Outside the shell, or from another machine's core, nothing happens: only
 * this computer's screen is the core's to draw on.
 */
export function pointerRequested(from: { localCore: boolean }, box: WindowPointerBox, invoke: Invoke = tauriInvoke): Promise<void> {
  if (window.__TAURI_INTERNALS__ === undefined || !from.localCore) return Promise.resolve();
  const rect = box.rect;
  queue = queue.then(() => rect === null
    ? invoke('pointer_hide', { id: box.id })
    : invoke('pointer_show', { id: box.id, rect, label: box.label, look: box.look }))
    .then(() => undefined, (error: unknown) => { console.warn('windows.pointer failed', error); });
  return queue;
}
