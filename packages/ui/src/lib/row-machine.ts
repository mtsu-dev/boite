import { isThisPC, type Machine } from './workspace.svelte';

/**
 * Whether a thread row names its machine: never this one, known by its own
 * core or as the window's only machine before it has an address, unless it
 * stopped answering. A remote keeps its name whatever it is called, "This PC"
 * included. A row reads its project by its logo and its machine only when the
 * work runs elsewhere.
 */
export function namesMachine(machine: Machine, away: boolean): boolean {
  if (away) return true;
  return machine.id !== 'local' && !isThisPC(machine);
}
