import { errorText } from './errors';
import { contactsShown } from './contacts-rail.svelte';
import { strings } from './strings';
import type { Store } from './store.svelte';

/** A machine this window may make a bot on: its owner, connected. A paired phone makes none. */
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
 * The group's Bots machine by name while that role is set and this window
 * does not reach it as its owner: it may hold the Operator out of sight, so
 * nothing makes another meanwhile. Null when it is reached or no role is set.
 */
export function botsHostAway(home: Store, stores: readonly Store[]): string | null {
  const coreId = home.group?.botsHome;
  if (!coreId || member(home, stores, coreId)) return null;
  return home.group?.cores?.find(core => core.coreId === coreId)?.name ?? coreId;
}

/**
 * The machine that hosts the group's one Operator. With a Bots machine, that
 * one only, and none while it is out of reach (`botsHostAway`); with no Bots
 * role, the Settings machine while it is connected, else this window's. The
 * one place that picks it.
 */
export function operatorHost(home: Store, stores: readonly Store[]): Store | null {
  if (home.group?.botsHome) return botsHost(home, stores);
  return member(home, stores, home.group?.settingsHome) ?? (owned(home) ? home : null);
}

/** A machine this window owns, other than `home`, that has not said which group it is in yet. */
export function groupLoading(home: Store, stores: readonly Store[]): boolean {
  return stores.some(store => store !== home && owned(store) && !store.groupKnown);
}

/**
 * Contacts opened: the group gets its one Operator. When a connected owner
 * machine already has one, nothing is made; else it is made on
 * `operatorHost`, and nowhere while the Bots machine is offline (the Contacts
 * page says so). A failure is told on `home` and answers false, so the next
 * opening retries.
 */
export async function ensureOperator(home: Store, stores: readonly Store[]): Promise<boolean> {
  const host = operatorHost(home, stores);
  if (!host) return false;
  // Another group's Operator is not this group's: only members are asked. A
  // reached machine whose group is still loading may be a member holding it:
  // wait for its answer rather than make a second one.
  if (groupLoading(home, stores)) return false;
  const machines = [home, ...stores.filter(store => store !== home && !!home.group && store.group?.id === home.group.id)].filter(owned);
  const found = await Promise.all(machines.map(async store => {
    try { return !!(await store.client!.call('contacts.get', {})).bot; } catch { return false; }
  }));
  if (found.some(Boolean)) return true;
  if (!contactsShown(host)) return false;
  try {
    await host.client!.call('agents.builtin.ensure', { kind: 'contacts', name: strings.agents.builtin.name.contacts });
    return true;
  } catch (error) {
    home.error = errorText(error);
    return false;
  }
}

/** The groups given their Operator, or being given it, in this session: by group id, or the machine itself when it has no group. */
const asked = new Set<string | Store>();

/**
 * The first time Contacts opens on `home` in this session, its page or its
 * column: `ensureOperator`, never at boot, and never before `home` knows its
 * group, which says where the Operator lives. Once it found or made the
 * Operator nothing asks again until a reload; a failure, or no machine to
 * hold it yet, lets the next opening try again.
 */
export function operatorOnOpen(home: Store, stores: readonly Store[]): void {
  if (!home.groupKnown || !operatorHost(home, stores)) return;
  const key = home.group?.id ?? home;
  if (asked.has(key)) return;
  asked.add(key);
  void ensureOperator(home, stores).then(done => { if (!done) asked.delete(key); });
}
