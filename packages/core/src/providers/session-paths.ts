import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { ProviderDescriptor } from '@boite/contracts';
import { homePath } from '../paths.ts';
import { variableHome } from '../profile-share.ts';
import { profileFor } from './resolve.ts';

export function below(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

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

/** Add exact protected paths. Project admission also checks nested login folders themselves. */
export function addSessionFilePaths(paths: Set<string>, home: string, { session, sqlite }: ReturnType<typeof providerSessionFiles>, includeNestedFolder = false): void {
  function add(name: string): string {
    const path = join(home, name);
    paths.add(path);
    const parent = dirname(path);
    if (includeNestedFolder && below(home, parent)) paths.add(parent);
    return path;
  }
  for (const name of session) add(name);
  if (sqlite === undefined) return;
  const database = add(sqlite.file);
  let target = database;
  try { target = realpathSync(database); } catch { /* There may be no login yet. */ }
  paths.add(target);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    paths.add(database + suffix);
    paths.add(target + suffix);
  }
}
