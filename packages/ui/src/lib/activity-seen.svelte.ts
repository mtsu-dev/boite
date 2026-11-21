import { storeNeedsKeys } from './activity-feed';
import { threadsNeedingYou } from './app-rail';
import type { Store } from './store.svelte';

/**
 * The asks of Activity's Needs you the user has already seen, by a middle click on the rail's Activity button
 * (AppRail.svelte): they stay listed in Activity, unanswered, but leave the rail's badge and the phone's tab until
 * their thread asks again, a new question, permission or failure, whose key (`storeNeedsKeys`) is new. Each entry is
 * `machineId` and the key, since ids collide between machines; this device keeps them, the way it keeps the rail's
 * order, so a reload does not bring the number back.
 */
const STORAGE_KEY = 'boite.activity.seen';

type SeenMachine = { id: string; store: Pick<Store, 'threads' | 'pendingQuestions' | 'pendingPermissions' | 'subagents'> };

function read(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    // A damaged list counts everything again.
    return [];
  }
}

const keysOf = (machine: SeenMachine) => storeNeedsKeys(machine.store, machine.store.threads).map(key => `${machine.id}\n${key}`);

class ActivitySeen {
  keys = $state<ReadonlySet<string>>(new Set(read()));

  /** Everything Needs you holds now, seen; what an earlier click saw and is gone drops out. */
  see(machines: readonly SeenMachine[]): void {
    const keys = machines.flatMap(keysOf);
    this.keys = new Set(keys);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(0, 500))); } catch { /* Storage full or off: this session only. */ }
  }

  /** The rows of Needs you on every machine not seen yet: the rail's badge and the phone's Activity tab, before contacts. */
  unseen(machines: readonly SeenMachine[]): number {
    const ids = new Map(machines.map(machine => [machine.store, machine.id]));
    return threadsNeedingYou(machines.map(machine => machine.store), (store, key) => this.keys.has(`${ids.get(store)}\n${key}`));
  }
}

export const activitySeen = new ActivitySeen();
