/*
 * What another part of the window asks the Bots page to show: the form of a
 * new bot, the dialog of a new team or of a team to edit, or the engine
 * settings. The window's rail
 * holds those buttons on a desktop while the page owns the forms, so a request
 * is a counter the page answers once, on the machine it names.
 */

import type { Store } from './store.svelte';

export type AgentsIntent = { kind: 'new-bot' | 'new-team' | 'engine' } | { kind: 'edit-team'; teamId: string };

/** The request counter the page watches; the request itself stays outside the proxy, so its Store is compared as itself. */
export const agentsIntent = $state({ request: 0 });
let pending: { intent: AgentsIntent; store: Store } | null = null;

function ask(store: Store, intent: AgentsIntent): void {
  pending = { intent, store };
  agentsIntent.request += 1;
  store.showAgents();
}

/** Opens the Bots page on `store` with the form that creates a bot. */
export function newBot(store: Store): void { ask(store, { kind: 'new-bot' }); }
/** Opens the Bots page on `store` with the dialog that creates a team. */
export function newTeam(store: Store): void { ask(store, { kind: 'new-team' }); }
/** Opens the Bots page on `store` with the settings every bot shares. */
export function botEngine(store: Store): void { ask(store, { kind: 'engine' }); }

/** Opens the Bots page on `store` with the dialog that edits its team `teamId`. */
export function editTeam(store: Store, teamId: string): void { ask(store, { kind: 'edit-team', teamId }); }

/** The pending request for `store`, taken: the page calls it once it is drawn. */
export function takeAgentsIntent(store: Store): AgentsIntent | null {
  if (!pending || pending.store !== store) return null;
  const { intent } = pending;
  pending = null;
  return intent;
}
