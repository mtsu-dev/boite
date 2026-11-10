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
/** `named` is false for a profile an icon pick wrote and true for a typed name; versions before it wrote neither. */
type Profile = { label: string; icon?: MachineIconName; named?: boolean };
export function profiles(): Record<string, Profile> {
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
    // A profile that says whether it was typed is no older version's.
    if (profile?.named !== undefined || profile?.label?.trim() !== label) return false;
    // One keyed by the address was written before the machine said its name: a rename and an icon pick look
    // alike there, and reading it as a rename would freeze a stale name, so it names nothing.
    let host: unknown;
    try { const parts: unknown = JSON.parse(key); host = Array.isArray(parts) ? parts[0] : undefined; } catch { return false; }
    return typeof host === 'string' && host !== label;
  });
}

/** A profile's name, unless an icon pick wrote it or the owner typed a newer one for that machine (`typed`). */
export function profileName(profile: Profile | undefined, typed: boolean): string | undefined {
  return !typed && profile?.named !== false && typeof profile?.label === 'string' && profile.label.trim() ? profile.label : undefined;
}

/** Whether a machine's current name is one the owner typed: its saved entry says so, or the profile that named it does. */
export function typedName(machine: Machine, saved: StoredEnvironment | undefined): boolean {
  return namedByUser(saved) || profiles()[profileKey(machine)]?.named === true;
}
