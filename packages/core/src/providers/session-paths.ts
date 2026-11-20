import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderDescriptor } from '@boite/contracts';
import { homePath } from '../paths.ts';
import { variableHome } from '../profile-share.ts';
import { profileFor } from './resolve.ts';

/** Where a provider's default account looks, in profile order. */
export function providerLoginHome(provider: ProviderDescriptor, profile = profileFor(provider)): { path: string; variable: string | null } {
  for (const variable of Object.keys(profile?.isolation ?? {})) {
    const path = variableHome(variable, profile);
    if (path !== null) return { path, variable };
  }
  return { path: join(homePath(), `.${provider.id}`), variable: null };
}

/** An empty profile list still lets a fallback file prove login, but its absence proves nothing. */
export function providerSessionFiles(provider: ProviderDescriptor, profile = profileFor(provider)) {
  const own = profile?.session;
  return {
    session: own !== undefined && own.length > 0 ? own : provider.auth.session ?? [],
    sqlite: provider.auth.sqlite,
    mayBeExternal: own?.length === 0,
  };
}

/** A shared login directory may contain projects beside these exact files. */
export function addSessionFilePaths(paths: Set<string>, home: string, { session, sqlite }: ReturnType<typeof providerSessionFiles>): void {
  for (const name of session) paths.add(join(home, name));
  if (sqlite === undefined) return;
  const database = join(home, sqlite.file);
  let target = database;
  try { target = realpathSync(database); } catch { /* There may be no login yet. */ }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    paths.add(database + suffix);
    paths.add(target + suffix);
  }
}
