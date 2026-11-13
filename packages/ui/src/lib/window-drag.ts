import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { linuxShell } from './shell-platform';

/**
 * The window's drag, shared by the main column's top bar and the app rail:
 * every bit of chrome with nothing to press moves the window, the way a
 * native title bar does.
 */
const inShell = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

let cached: Promise<TauriWindow> | null = null;

/** The shell's window, loaded once on first use. */
export function shellWindow(): Promise<TauriWindow> {
  cached ??= import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow());
  return cached;
}

export async function toggleMaximize(): Promise<void> {
  await (await shellWindow()).toggleMaximize();
}

/**
 * By hand rather than through `data-tauri-drag-region`: that attribute only
 * works on the exact element under the pointer, and it toggles maximize on its
 * own double-click, so pairing it with a handler would toggle twice. Linux
 * draws its own decorations, so nothing here drags there.
 */
export function dragWindow(event: MouseEvent): void {
  if (!inShell || linuxShell() || event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest('button, input, a, textarea, [role=button], [role=menu], [role=dialog]')) return;
  if (event.detail === 2) {
    void toggleMaximize();
    return;
  }
  void shellWindow().then((win) => win.startDragging());
}
