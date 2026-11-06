/*
 * What another part of the window asks the Bots page to show: the form of a
 * new bot, the dialog of a new team or the engine settings. The window's rail
 * holds those buttons on a desktop while the page owns the forms, so a request
 * is a counter the page answers once, on the machine it names.
 */

import type { Store } from './store.svelte';

export type AgentsIntent = 'new-bot' | 'new-team' | 'engine';

/** The request counter the page watches; the request itself stays outside the proxy, so its Store is compared as itself. */
export const agentsIntent = $state({ request: 0 });
let pending: { kind: AgentsIntent; store: Store } | null = null;

function ask(store: Store, kind: AgentsIntent): void {
  pending = { kind, store };
  agentsIntent.request += 1;
  store.showAgents();
}

/** Opens the Bots page on `store` with the form that creates a bot. */
export function newBot(store: Store): void { ask(store, 'new-bot'); }
/** Opens the Bots page on `store` with the dialog that creates a team. */
export function newTeam(store: Store): void { ask(store, 'new-team'); }
/** Opens the Bots page on `store` with the settings every bot shares. */
export function botEngine(store: Store): void { ask(store, 'engine'); }

/** The pending request for `store`, taken: the page calls it once it is drawn. */
export function takeAgentsIntent(store: Store): AgentsIntent | null {
  if (!pending || pending.store !== store) return null;
  const { kind } = pending;
  pending = null;
  return kind;
}
