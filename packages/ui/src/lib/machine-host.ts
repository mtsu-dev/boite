import { fill, strings } from './i18n.svelte';

export type Host = { id: string; label: string; store?: { connection: string } };

/**
 * The machine a project card, a palette heading or a flat row names, so titles keep the room: none while one machine
 * is listed; an unreachable one always, the word in its name ("Builder offline"), since its rows read dimmed; a
 * connected one only once two are connected, and never `home`, this app's own, where everything runs by default.
 */
export function hostName(machine: Host, machines: readonly Host[], home?: string): { text: string; away: boolean } | null {
  if (machines.length < 2) return null;
  const connection = machine.store?.connection ?? 'ready';
  if (connection === 'connecting') return { text: `${machine.label} · ${strings.connection.connecting}`, away: true };
  if (connection !== 'ready') return { text: fill(strings.connection.nameOffline, { name: machine.label }), away: true };
  if (machine.id === home) return null;
  return severalConnected(machines) ? { text: machine.label, away: false } : null;
}

/** Whether a machine mark tells rows apart: only once two of the listed machines are connected. */
export function severalConnected(machines: readonly Host[]): boolean {
  return machines.filter(entry => (entry.store?.connection ?? 'ready') === 'ready').length > 1;
}
