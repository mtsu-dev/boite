import { isThisPC, type Machine } from './workspace.svelte';
import { strings } from './strings';

/**
 * Whether a thread row names its machine: never this one, known by its own
 * core or by the default name the list gives it ("This PC", in any language
 * the app spoke), unless it stopped answering. A row reads its project by its
 * logo and its machine only when the work runs elsewhere.
 */
export function namesMachine(machine: Machine, away: boolean): boolean {
  if (away) return true;
  return !isThisPC(machine) && machine.label !== strings.machines.local && !['This PC', 'Ce PC'].includes(machine.label);
}
