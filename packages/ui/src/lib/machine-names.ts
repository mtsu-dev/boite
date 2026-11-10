// Owns what a machine is called: the owner's profiles of names and icons, and whether a saved name is one the owner typed.
import type { StoredEnvironment } from './endpoint';
import type { Machine } from './workspace.svelte';

export const machineIcons = [
  'desktop', 'laptop', 'phone', 'tablet', 'apple', 'server', 'rack', 'nas',
  'database', 'cloud', 'cpu', 'router', 'terminal', 'bot', 'gamepad', 'tv', 'house',
] as const;
export type MachineIconName = typeof machineIcons[number];
export const PROFILE_KEY = 'boite.machine-profiles';
export function profileKey(machine: Machine): string {
  const core = machine.store.core;
  return core?.hostname ? JSON.stringify([core.hostname, core.dataDir, core.channel]) : machine.id;
}
export function profiles(): Record<string, { label: string; icon?: MachineIconName }> {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

/**
 * Whether the owner typed the name saved for a machine. Versions before the
 * `named` mark saved every name alike, the host name a machine had when it
 * first connected included. Their rename also wrote a profile under the host
 * name the machine had then: a saved name counts as typed when such a profile
 * holds it and it differs from that host name. Picking an icon wrote the
 * current name too, which is no rename.
 */
export function namedByUser(saved: StoredEnvironment | undefined): boolean {
  if (!saved?.label.trim()) return false;
  if (saved.named) return true;
  const label = saved.label.trim();
  return Object.entries(profiles()).some(([key, profile]) => {
    if (profile?.label?.trim() !== label) return false;
    let host: unknown;
    try { const parts: unknown = JSON.parse(key); host = Array.isArray(parts) ? parts[0] : undefined; } catch { host = hostOf(key); }
    return host !== label;
  });
}

/** A profile written before a machine reported its name is keyed by its address. */
function hostOf(url: string): string | undefined {
  try { return new URL(url).host; } catch { return undefined; }
}
