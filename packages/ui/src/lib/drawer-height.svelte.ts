/**
 * The height of the drawer under the chat, shared by its two tabs (the
 * terminal and the project board) and kept per device. Until the user drags
 * it, the drawer opens at 30 % of the chat's height, so the conversation keeps
 * most of the room; a drag picks a height up to 70 %.
 */
const HEIGHT_KEY = 'boite:terminal-height';
export const DRAWER_MIN = 120;
const OPEN_SHARE = 0.3;
const MAX_SHARE = 0.7;

function readPicked(): number | null {
  try {
    const stored = localStorage.getItem(HEIGHT_KEY);
    const value = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(value) && value >= DRAWER_MIN ? value : null;
  } catch {
    return null;
  }
}

export class DrawerHeight {
  /** The chat column's height, which the drawer shares. */
  room = $state(typeof window === 'undefined' ? 800 : window.innerHeight);
  #picked = $state<number | null>(readPicked());
  readonly max = $derived(Math.max(DRAWER_MIN, Math.round(this.room * MAX_SHARE)));
  readonly visible = $derived(Math.min(this.#picked ?? Math.max(DRAWER_MIN, Math.round(this.room * OPEN_SHARE)), this.max));

  /** Follows the element the drawer sits in; returns the cleanup. */
  observe(parent: HTMLElement | null | undefined): () => void {
    if (!parent) return () => {};
    this.room = parent.clientHeight;
    const observer = new ResizeObserver(() => { this.room = parent.clientHeight; });
    observer.observe(parent);
    return () => observer.disconnect();
  }

  set(next: number): void {
    this.#picked = Math.min(this.max, Math.max(DRAWER_MIN, Math.round(next)));
  }

  save(): void {
    try {
      if (this.#picked === null) localStorage.removeItem(HEIGHT_KEY);
      else localStorage.setItem(HEIGHT_KEY, String(this.#picked));
    } catch { /* private mode keeps the height for this session */ }
  }

  /** A double click on the edge: back to the opening share, forgotten on this device. */
  reset(): void {
    this.#picked = null;
    this.save();
  }
}
