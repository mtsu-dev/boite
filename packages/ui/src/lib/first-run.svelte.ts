import { connected } from './provider-setup';
import type { Store } from './store.svelte';

/**
 * The empty app's two steps: connect an AI, then pick a folder. While either
 * is missing the home card shows them in place of a composer that could not
 * send. The folder step can be skipped once, on this device: someone who only
 * wants to chat starts in the scratch folder.
 */
const SKIPPED = 'boite.first-run-folder-skipped';

let skipped = $state(read());
function read(): boolean {
  try { return localStorage.getItem(SKIPPED) === '1'; } catch { return false; }
}

export interface FirstRunSteps {
  /** An AI is signed in and ready. */
  connected: boolean;
  /** A folder of the user's own is open as a project. */
  folder: boolean;
  /** The checklist stands in for the composer. */
  active: boolean;
}

export function firstRunSteps(store: Pick<Store, 'owner' | 'booted' | 'providers' | 'accounts' | 'projects' | 'threads'>): FirstRunSteps {
  const ai = store.providers.some(provider => connected(provider, store.accounts));
  const folder = store.projects.some(project => project.kind !== 'drafts');
  // Only the owner can connect or add a folder, and only an app with no thread yet is new:
  // someone signed out later keeps the composer and its Connect chip.
  const active = store.owner && store.booted && store.threads.length === 0 && (!ai || (!folder && !skipped));
  return { connected: ai, folder, active };
}

export function skipFolderStep(): void {
  skipped = true;
  try { localStorage.setItem(SKIPPED, '1'); } catch { /* A private window keeps it for the session. */ }
}
