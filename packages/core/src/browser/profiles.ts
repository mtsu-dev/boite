import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { browserProfileIdError, browserProfilesOf, BROWSER_PROFILES_MAX, findBrowserProfile, DEFAULT_BROWSER_PROFILE, PRIVATE_BROWSER_PROFILE, type Settings } from '@boite/contracts';
import { refused } from '../errors.ts';
import type { Core } from '../core.ts';
import type { BrowserEngines } from './engines.ts';

/** Close engines and remove storage for deleted profiles and private tabs that ended. */
export async function pruneProfiles(core: Core, engines: BrowserEngines, probeHolds: (dir: string) => boolean, settings: Settings): Promise<void> {
  try {
    const kept = new Set([DEFAULT_BROWSER_PROFILE, ...browserProfilesOf(settings).profiles.map(profile => profile.id)]);
    for (const [key, pending] of [...engines.pending]) {
      const profile = key.replace(/^host:/, '');
      if (kept.has(profile) || profile === PRIVATE_BROWSER_PROFILE) continue;
      const engine = await pending.catch(() => null);
      if (engine) await engines.shut(engine);
    }
    const privateDir = (await engines.pending.get(PRIVATE_BROWSER_PROFILE)?.catch(() => null))?.dir;
    const root = join(core.dataDir, 'browser');
    let names: string[];
    try { names = readdirSync(root); } catch { return; }
    for (const name of names) {
      const dir = join(root, name);
      const throwaway = /^private-[0-9a-f-]{36}$/.test(name);
      if (throwaway ? dir === privateDir || probeHolds(dir) || engines.holdsIdentityDir(dir) : kept.has(name) || browserProfileIdError(name) !== null) continue;
      engines.removeDir(dir);
    }
  } catch (error) {
    core.log('warn', `browser profile cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function profileName(settings: Settings, id: string): string {
  if (id === DEFAULT_BROWSER_PROFILE) return 'Default';
  if (id === PRIVATE_BROWSER_PROFILE) return 'Private';
  return browserProfilesOf(settings).profiles.find(profile => profile.id === id)?.name ?? id;
}

/**
 * An agent signing in a second account needs a profile that outlives its
 * tabs and the core, which `private` never does. It may add one, never
 * remove or rename one: that stays in Settings, with the owner. A name
 * already listed answers that profile, so a repeated command is harmless.
 */
export function addProfile(core: Core, wanted: string): { id: string; name: string; created: boolean } {
  const name = wanted.trim();
  const { profiles } = browserProfilesOf(core.settings.get());
  const known = profiles.find(profile => profile.name.toLowerCase() === name.toLowerCase());
  if (known) return { ...known, created: false };
  // `--profile` tries ids before names: a name that is another profile's id would open that one.
  if (findBrowserProfile(profiles, name) !== null) throw refused(`a browser profile already uses ${name} as its id; pick another name`);
  if (profiles.length >= BROWSER_PROFILES_MAX) throw refused(`this machine already has ${BROWSER_PROFILES_MAX} browser profiles; the owner removes one in Settings`);
  // The id the Settings card makes: `p-` and 12 random hexadecimal digits.
  const id = `p-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  core.settings.set({ browserProfiles: [...profiles, { id, name }] });
  return { id, name, created: true };
}
