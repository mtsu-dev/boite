import { errorText } from './errors';
import { strings } from './strings';
import type { Store } from './store.svelte';

/** A machine this window may make a bot on: its owner, connected. A paired phone only flips its switch. */
function owned(store: Store): boolean {
  return store.owner && store.connection === 'ready' && !!store.client;
}

/** A member of `home`'s group this window may make a bot on, by its core id. */
function member(home: Store, stores: readonly Store[], coreId: string | undefined): Store | undefined {
  if (!coreId) return undefined;
  return [home, ...stores.filter(store => store !== home)].filter(owned).find(store => store.group?.self === coreId);
}

/** The group's Bots machine while this window reaches it as its owner: where a new bot is made. */
export function botsHost(home: Store, stores: readonly Store[]): Store | null {
  return member(home, stores, home.group?.botsHome) ?? null;
}

/**
 * The machine that hosts the group's one Operator: the group's Bots machine
 * while it is connected, else its Settings machine while that one is, else
 * this window's. The one place that picks it.
 */
export function operatorHost(home: Store, stores: readonly Store[]): Store | null {
  return botsHost(home, stores) ?? member(home, stores, home.group?.settingsHome) ?? (owned(home) ? home : null);
}

/**
 * The Contacts switch turned on: the group gets its one Operator. When a
 * connected owner machine already has one, nothing is made; else it is made
 * on `operatorHost`. A failure is told on `home` and the switch stays on, so
 * turning it on again retries.
 */
export async function ensureOperator(home: Store, stores: readonly Store[]): Promise<void> {
  const machines = [home, ...stores.filter(store => store !== home)].filter(owned);
  const found = await Promise.all(machines.map(async store => {
    try { return !!(await store.client!.call('contacts.get', {})).bot; } catch { return false; }
  }));
  if (found.some(Boolean)) return;
  const host = operatorHost(home, stores);
  if (!host) return;
  try {
    await host.client!.call('agents.builtin.ensure', { kind: 'contacts', name: strings.agents.builtin.name.contacts });
  } catch (error) {
    home.error = errorText(error);
  }
}
