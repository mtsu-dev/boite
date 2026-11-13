/**
 * The machine the thread list shows, or null for every machine. Shared, so
 * the display menu and the rail's machine button both drive one filter. Not
 * saved: a filter left on after a restart would hide threads without a word.
 */
class MachineFilter {
  id = $state<string | null>(null);

  set(id: string | null): void {
    this.id = id;
  }

  /** A filter on a machine that has since gone filters nothing, so the list never empties itself. */
  shown(machines: readonly { id: string }[]): string | null {
    return machines.some(machine => machine.id === this.id) ? this.id : null;
  }
}

export const machineFilter = new MachineFilter();
