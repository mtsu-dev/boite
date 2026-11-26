import type { Store } from './store.svelte';
import { desktopShell } from './shell-platform';

/** What the shell finds at a path on this computer (`client_path_info`). */
export type ClientPathKind = 'missing' | 'document' | 'folder' | 'program';

/**
 * The thread's folder when the core runs on this computer: its paths are this
 * computer's, so the shell can open or show them. Null on a phone, in a
 * browser, or for a thread on another machine.
 */
export function localFileDirectory(store: Store | undefined, threadId: string | undefined): string | null {
  if (!desktopShell() || !store?.owner || !store.localCore || !threadId) return null;
  return store.threads.find(thread => thread.id === threadId)?.cwd ?? null;
}

async function shell<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<T>(command, args);
}

/** What an absolute path names on this computer; the shell refuses a share or a device path. */
export function clientPathInfo(path: string): Promise<ClientPathKind> {
  return shell('client_path_info', { path });
}

/**
 * Opens a path in its default app, after a click. A program opens only with
 * `confirmed`, once the user said yes: the shell checks again and refuses it otherwise.
 */
export function openClientPath(path: string, confirmed = false): Promise<void> {
  return shell('open_client_path', { path, confirmed });
}

/** Shows the file selected in the system's file manager; nothing runs. */
export function revealClientPath(path: string): Promise<void> {
  return shell('reveal_client_path', { path });
}
