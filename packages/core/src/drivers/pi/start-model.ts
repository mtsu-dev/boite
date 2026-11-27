import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isRecord } from '../stdio.ts';
import { piProcessCwd } from './session-model.ts';

/** The keys pi 1.6.1 `findInitialModel` chooses a new session's model from, in its order. */
const CHOOSING = ['enabledModels', 'defaultProvider', 'defaultModel'] as const;
/** pi 1.6.1's thinking levels, which a scoped pattern may end with (`provider/id:high`). */
const LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** What the profile's own arguments decide for pi 1.6.1 (cli/args.js): the last flag of each kind wins. */
export interface PiLaunchChoices {
  /** `--models`, split on commas without empty patterns: an empty list clears the scope. Null when absent. */
  scope: string[] | null;
  /** `--approve`/`-a` trusts the folder, `--no-approve`/`-na` does not, before `trust.json`. */
  trust: boolean | null;
}

export function piLaunchChoices(args: readonly string[]): PiLaunchChoices {
  const choices: PiLaunchChoices = { scope: null, trust: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--models' && i + 1 < args.length) choices.scope = args[++i]!.split(',').map(pattern => pattern.trim()).filter(pattern => pattern.length > 0);
    else if (arg === '--approve' || arg === '-a') choices.trust = true;
    else if (arg === '--no-approve' || arg === '-na') choices.trust = false;
  }
  return choices;
}

/** Where pi keeps an account's settings and trust decisions, from the environment it starts with. */
export function piAgentDir(env: Record<string, string | undefined>, cwd: string): string {
  const home = env['HOME'] || homedir();
  const configured = env['PI_CODING_AGENT_DIR'] || join(home, '.pi', 'agent');
  return resolve(cwd, configured === '~' ? home : configured.startsWith('~/') ? join(home, configured.slice(2)) : configured);
}

/**
 * The model pi 1.6.1 starts a new session on in `cwd`, without `--model`, as far
 * as the folder changes it. pi reads `<cwd>/.pi/settings.json` over the account's
 * `settings.json` only for a trusted folder: the profile's `--approve` or
 * `--no-approve`, else a decision in the account's `trust.json` for it or a
 * parent, else `defaultProjectTrust: "always"` (in RPC mode, "ask" means no). With a scope (`--models`, else `enabledModels`), the
 * saved `defaultProvider`/`defaultModel` wins when the scope holds it, else the
 * first scoped model (main.js `buildSessionOptions`); without one,
 * `findInitialModel` takes the saved default when available.
 *
 * `'account'` when the folder changes none of that: the account's probe, run
 * elsewhere on the same settings, saw the same model. A `provider/id` from
 * `catalog` (the account's available models) when Boite can name it. Null when
 * only pi can: a glob or fuzzy pattern, a model missing from the catalog, or no
 * catalog yet.
 */
export function folderStartModel(agentDir: string, cwd: string, catalog: readonly string[] | null, launch: PiLaunchChoices = { scope: null, trust: null }): string | 'account' | null {
  const global = settingsAt(join(agentDir, 'settings.json')) ?? {};
  const folder = piProcessCwd(cwd);
  const project = (launch.trust ?? trusted(agentDir, folder, global)) ? settingsAt(join(folder, '.pi', 'settings.json')) : null;
  if (!project) return 'account';
  const value = (key: typeof CHOOSING[number]) => project[key] !== undefined ? project[key] : global[key];
  const same = (key: typeof CHOOSING[number]) => JSON.stringify(value(key)) === JSON.stringify(global[key]);
  if (CHOOSING.every(same) || (launch.scope !== null && same('defaultProvider') && same('defaultModel'))) return 'account';
  if (!catalog) return null;
  const provider = value('defaultProvider');
  const model = value('defaultModel');
  const named = typeof provider === 'string' && typeof model === 'string' ? `${provider}/${model}` : null;
  const patterns = launch.scope ?? value('enabledModels');
  if (Array.isArray(patterns) && patterns.length > 0) {
    const scope = patterns.map(pattern => typeof pattern === 'string' ? exactModel(pattern, catalog) : null);
    if (scope.includes(null)) return null;
    return named && scope.includes(named) ? named : scope[0]!;
  }
  return named && catalog.includes(named) ? named : null;
}

/**
 * A pattern naming one catalog model exactly, as pi resolves it before any glob
 * or fuzzy match. Null otherwise: a glob, a partial id pi may still match, or a
 * model the catalog lacks, which pi would skip.
 */
function exactModel(pattern: string, catalog: readonly string[]): string | null {
  if (catalog.includes(pattern)) return pattern;
  if (/[*?[]/.test(pattern)) return null;
  const colon = pattern.lastIndexOf(':');
  const base = colon > 0 && LEVELS.has(pattern.slice(colon + 1)) ? pattern.slice(0, colon) : pattern;
  if (catalog.includes(base)) return base;
  const byId = catalog.filter(id => id.slice(id.indexOf('/') + 1) === base);
  return !base.includes('/') && byId.length === 1 ? byId[0]! : null;
}

/** pi's trust for a folder: the nearest decision in `trust.json`, else its `defaultProjectTrust`. */
function trusted(agentDir: string, folder: string, global: Record<string, unknown>): boolean {
  const decisions = settingsAt(join(agentDir, 'trust.json')) ?? {};
  const key = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  const keys = new Map(Object.entries(decisions).map(([path, decision]) => [key(path), decision]));
  let dir = canonical(folder);
  for (;;) {
    const decision = keys.get(key(dir));
    if (typeof decision === 'boolean') return decision;
    const parent = dirname(dir);
    if (parent === dir) return global['defaultProjectTrust'] === 'always';
    dir = parent;
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A JSON object as pi reads it (a leading BOM allowed), or null when missing or unreadable. */
function settingsAt(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}
