import { fill, strings } from './i18n.svelte';

export type Host = { id: string; label: string; store?: { connection: string } };

/**
 * A machine named as a place: its label, whether it is reachable, and the whole in words ("on Builder", "on Builder ·
 * Offline") for a tooltip or a plain line. `MachinePlace.svelte` draws it: one monitor glyph and "on <machine>", with
 * an unreachable state as its own small mark beside the name, never run into it.
 */
export type HostMark = { label: string; state: 'ready' | 'connecting' | 'offline'; away: boolean; text: string };

export function hostMark(label: string, connection = 'ready'): HostMark {
  const on = fill(strings.connection.onMachine, { name: label });
  const state = connection === 'ready' ? 'ready' : connection === 'connecting' ? 'connecting' : 'offline';
  const word = state === 'connecting' ? strings.connection.connecting : state === 'offline' ? strings.connection.offline : null;
  return { label, state, away: state !== 'ready', text: word ? `${on} · ${word}` : on };
}

/**
 * The machine a project card, a palette heading or a flat row names, so titles keep the room: none while one machine
 * is listed; an unreachable one always, with its state, since its rows read dimmed; a connected one only once two
 * are connected, and never `home`, this app's own, where everything runs by default.
 */
export function hostName(machine: Host, machines: readonly Host[], home?: string): HostMark | null {
  if (machines.length < 2) return null;
  const connection = machine.store?.connection ?? 'ready';
  if (connection !== 'ready') return hostMark(machine.label, connection);
  if (machine.id === home) return null;
  return severalConnected(machines) ? hostMark(machine.label) : null;
}

/** Whether a machine mark tells rows apart: only once two of the listed machines are connected. */
export function severalConnected(machines: readonly Host[]): boolean {
  return machines.filter(entry => (entry.store?.connection ?? 'ready') === 'ready').length > 1;
}
