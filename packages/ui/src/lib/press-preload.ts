/*
 * Load on press: what a click would load starts on the press.
 * A mouse button stays down for 60 to 120 ms before the click fires, a finger
 * longer; on a remote machine that is most of a round trip. One capture
 * listener on the window reads two attributes, so a row costs nothing to mark:
 *
 * - `data-preload-thread="<thread id>"`: the owning machine's store (the
 *   nearest `data-machine-id`, else the active one) subscribes and asks for the
 *   page now, and the `open()` the click runs takes both over
 *   (`store/threads.svelte.ts`). A press that never becomes a click (a drag,
 *   a scroll on a phone, a release elsewhere) gives the subscription back.
 * - `data-preload-view`: the destination's chunks from the lazy views registry.
 *
 * It stays off under automation (`navigator.webdriver`), so benchmarks and
 * end-to-end runs measure the plain click; its own test opts in with
 * `__BOITE_PRESS_PRELOAD_TEST__`.
 */

import { preloadView } from './lazy-views';
import { prefetchAllowed } from './prefetch';
import type { Store } from './store.svelte';

/** What a press needs from a machine's store. */
type PreloadStore = Pick<Store, 'preload'> & Partial<Pick<Store, 'loadDelegation'>> & {
  openThread?: { id: string } | null;
  delegation?: { rootThreadId: string } | null;
};

export interface PreloadWorkspace {
  machines: { id: string; store: PreloadStore }[];
  active: PreloadStore;
}

/** How long a released press waits for its click before giving the thread back. */
export const PRESS_GRACE_MS = 400;
/** A press held longer than this is a drag or a long press, not a click on its way. */
const PRESS_HOLD_MS = 8_000;

/** False under a driven browser, unless its own test asked for it. */
function preloadAllowed(nav: { webdriver?: boolean } = navigator): boolean {
  return nav.webdriver !== true || window.__BOITE_PRESS_PRELOAD_TEST__ === true;
}

/**
 * The store that owns a marked element: its machine's, the one on screen when
 * it names none, and null for a machine no longer connected. Thread ids can
 * collide between machines, so a stale row never preloads on another one.
 */
function owningStore(workspace: PreloadWorkspace, element: Element): PreloadStore | null {
  const named = element.closest('[data-machine-id]');
  if (!named) return workspace.active;
  const machineId = named.getAttribute('data-machine-id');
  return workspace.machines.find((machine) => machine.id === machineId)?.store ?? null;
}

export function startPressPreload(workspace: PreloadWorkspace): () => void {
  let pending: { target: Element; store: PreloadStore; threadId: string; release(): void } | null = null;
  let pointer: { id: number; x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    clearTimeout(timer);
    pointer = null;
    const old = pending;
    pending = null;
    old?.release();
  };

  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) { stop(); return; }
    // A finger that starts a scroll costs a page it never shows: on a link
    // that cannot spare the bytes, touch waits for its click.
    const target = event.target instanceof Element ? event.target.closest('[data-preload-thread], [data-preload-view]') : null;
    if (!target || !preloadAllowed() || document.hidden) { stop(); return; }
    const view = target.getAttribute('data-preload-view');
    if (view) preloadView(view);
    const threadId = target.getAttribute('data-preload-thread');
    const allowed = event.pointerType !== 'touch' || prefetchAllowed();
    const store = allowed && (threadId || view === 'panel-agents') ? owningStore(workspace, target) : null;
    const openId = store?.openThread?.id;
    // The panel joins this generation-guarded read if its data is still on the way.
    if (view === 'panel-agents' && openId && store?.delegation?.rootThreadId !== openId) {
      void store?.loadDelegation?.(openId, { join: true });
    }
    if (!store || !threadId) { stop(); return; }
    if (pending?.target !== target || pending.store !== store || pending.threadId !== threadId) {
      stop();
      pending = { target, store, threadId, release: store.preload(threadId) };
    }
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    clearTimeout(timer);
    timer = setTimeout(stop, PRESS_HOLD_MS);
  };
  // The click lands right after the release; the grace covers a handler that
  // awaits something of its own before it opens.
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer?.id || !pending) return;
    // A touch pointer can be implicitly captured by the row even outside it.
    const hit = document.elementFromPoint ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
    if (!(hit instanceof Node) || !pending.target.contains(hit)) { stop(); return; }
    pointer = null;
    clearTimeout(timer);
    timer = setTimeout(stop, PRESS_GRACE_MS);
  };
  const move = (event: PointerEvent) => {
    if (pointer && event.pointerId === pointer.id && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) stop();
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === pointer?.id) stop();
  };
  const blur = (event: Event) => { if (event.target === window) stop(); };
  const visibility = () => { if (document.hidden) stop(); };

  const options = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', down, options);
  window.addEventListener('pointerup', up, options);
  window.addEventListener('pointermove', move, options);
  window.addEventListener('pointercancel', cancel, options);
  window.addEventListener('lostpointercapture', cancel, options);
  for (const type of ['dragstart', 'contextmenu']) window.addEventListener(type, stop, options);
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('pointerdown', down, options);
    window.removeEventListener('pointerup', up, options);
    window.removeEventListener('pointermove', move, options);
    window.removeEventListener('pointercancel', cancel, options);
    window.removeEventListener('lostpointercapture', cancel, options);
    for (const type of ['dragstart', 'contextmenu']) window.removeEventListener(type, stop, options);
    window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', visibility);
    stop();
  };
}
