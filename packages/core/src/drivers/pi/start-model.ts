import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isRecord } from '../stdio.ts';
import { piModelOf } from './models.ts';
import { piProcessCwd } from './session-model.ts';

/** The keys pi 1.6.1 `findInitialModel` chooses a new session's model from, in its order. */
const CHOOSING = ['enabledModels', 'defaultProvider', 'defaultModel'] as const;
/** pi 1.6.1's options that take the next argument whatever it is (cli/args.js `parseArgs`). */
const VALUED = new Set(['--provider', '--model', '--api-key', '--system-prompt', '--append-system-prompt', '--name', '-n', '--session',
  '--session-id', '--fork', '--session-dir', '--models', '--tools', '-t', '--exclude-tools', '-xt', '--thinking', '--export',
  '--extension', '-e', '--skill', '--prompt-template', '--theme']);
/** Its options that take the next argument only when it does not start with `-`. */
const OPTIONAL = new Set(['--mode', '--use-theme', '--tui-mode']);
/** Its flags that take nothing; any other `--name` takes the next argument when it starts with neither `-` nor `@`. */
const FLAGS = new Set(['--help', '-h', '--version', '-v', '--continue', '-c', '--resume', '-r', '--no-session', '--no-tools', '-nt',
  '--no-builtin-tools', '-nbt', '--no-extensions', '-ne', '--no-mcp', '--no-skills', '-ns', '--no-prompt-templates', '-np', '--no-themes',
  '--no-context-files', '-nc', '--verbose', '--approve', '-a', '--no-approve', '-na', '--offline']);

/** What the profile's own arguments decide for pi 1.6.1, read as `parseArgs` walks them: the last of each kind wins. */
export interface PiLaunchChoices {
  /** `--models`, split on commas without empty patterns: an empty list clears the scope. Null when absent. */
  scope: string[] | null;
  /** `--approve`/`-a` trusts the folder, `--no-approve`/`-na` does not, before `trust.json`. */
  trust: boolean | null;
  /** A `--model`, which beats any session or setting. */
  model: boolean;
}

/** A model of the account's catalog as Boite lists it (`drivers/pi/models.ts`): `provider/id`, and a name that starts with the provider. */
export interface CatalogModel { id: string; name: string }

/** A catalog model as pi holds it, with the `provider/id` Boite names it by. */
interface PiEntry { full: string; provider: string; id: string; name: string }

export function piLaunchChoices(args: readonly string[]): PiLaunchChoices {
  const choices: PiLaunchChoices = { scope: null, trust: null, model: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === '--') break;
    if (VALUED.has(arg)) {
      if (next === undefined) continue;
      i++;
      if (arg === '--models') choices.scope = next.split(',').map(pattern => pattern.trim()).filter(pattern => pattern.length > 0);
      else if (arg === '--model') choices.model = true;
    } else if (arg === '--approve' || arg === '-a') choices.trust = true;
    else if (arg === '--no-approve' || arg === '-na') choices.trust = false;
    else if (OPTIONAL.has(arg) || arg === '--list-models') {
      if (next !== undefined && !next.startsWith('-') && !(arg === '--list-models' && next.startsWith('@'))) i++;
    } else if (arg === '--print' || arg === '-p') {
      if (next !== undefined && !next.startsWith('@') && (!next.startsWith('-') || next.startsWith('---'))) i++;
    } else if (arg.startsWith('--') && !FLAGS.has(arg) && !arg.includes('=')) {
      if (next !== undefined && !next.startsWith('-') && !next.startsWith('@')) i++;
    }
  }
  return choices;
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
export function folderStartModel(agentDir: string, cwd: string, catalog: readonly CatalogModel[] | null, launch: Omit<PiLaunchChoices, 'model'> = { scope: null, trust: null }): string | 'account' | null {
  const global = settingsAt(join(agentDir, 'settings.json')) ?? {};
  const folder = piProcessCwd(cwd);
  const trust = launch.trust ?? trusted(agentDir, folder, global);
  const project = trust ? settingsAt(join(folder, '.pi', 'settings.json')) : null;
  // A trusted folder's own extensions load only there, and may register the model the settings name, which the
  // probe, run elsewhere, did not have: pi decides (`DefaultPackageManager.resolve`, 1.6.1).
  if (trust && (entriesIn(join(folder, '.pi', 'extensions')) || listed(project?.['extensions']) || listed(project?.['packages']))) return null;
  if (!project) return 'account';
  const value = (key: typeof CHOOSING[number]) => project[key] !== undefined ? project[key] : global[key];
  // An empty scope is no scope, as pi reads it: `enabledModels: []` changes nothing over a missing key.
  const shown = (setting: unknown) => JSON.stringify(Array.isArray(setting) && setting.length === 0 ? undefined : setting);
  const same = (key: typeof CHOOSING[number]) => shown(value(key)) === shown(global[key]);
  if (CHOOSING.every(same) || (launch.scope !== null && same('defaultProvider') && same('defaultModel'))) return 'account';
  const pool = catalog?.map(entry => {
    const model = piModelOf(entry);
    return model && { full: entry.id, ...model };
  });
  if (!pool || pool.some(entry => entry === undefined)) return null;
  const entries = pool as PiEntry[];
  const provider = value('defaultProvider');
  const model = value('defaultModel');
  const named = entries.find(entry => entry.provider === provider && entry.id === model)?.full ?? null;
  const patterns = launch.scope ?? value('enabledModels');
  if (Array.isArray(patterns) && patterns.length > 0) {
    // The catalog keeps one pair per spelled id, the longest provider's: behind `gateway/team` + `base` there may have
    // been a `gateway` + `team/base` it dropped, which pi still matches a scope against, by its id or by a name the
    // catalog no longer holds. A pattern resolves here only when its whole text names the same model with or without
    // such a pair: a partial match, or a `:suffix` dropped after one, may land on that unknown name in pi.
    const shadowed = entries.flatMap(entry => [...entry.provider.matchAll(/\//g)].map(({ index }) => ({
      full: '', provider: entry.provider.slice(0, index), id: `${entry.provider.slice(index + 1)}/${entry.id}`, name: '',
    }))).filter(pair => !entries.some(entry => entry.provider === pair.provider && entry.id === pair.id));
    const resolve = (pattern: string) => {
      const kept = scopedModel(pattern, entries);
      return shadowed.length === 0 || (kept !== null && reference(pattern.trim(), [...entries, ...shadowed]) === kept) ? kept : null;
    };
    const scope = patterns.map(pattern => typeof pattern === 'string' ? resolve(pattern) : null);
    if (scope.includes(null)) return null;
    return named && scope.includes(named) ? named : scope[0]!;
  }
  return named;
}

/**
 * The one catalog model pi 1.6.1 resolves a scope pattern to
 * (`resolveModelScopeFromModels`), or null when only pi can tell. pi matches
 * the whole text first (`selectReference`), then part of an id or a name, its
 * pick among those being its own; only then does it drop a `:suffix` and try
 * again. A glob, a partial or an ambiguous match are null.
 */
function scopedModel(pattern: string, pool: readonly PiEntry[]): string | null {
  if (/[*?[]/.test(pattern)) return null;
  for (let text = pattern.trim(); text.length > 0;) {
    const whole = reference(text, pool);
    if (whole !== undefined) return whole;
    const lower = text.toLowerCase();
    if (pool.some(entry => entry.id.toLowerCase().includes(lower) || entry.name.toLowerCase().includes(lower))) return null;
    const colon = text.lastIndexOf(':');
    if (colon < 0) return null;
    text = text.slice(0, colon);
  }
  return null;
}

/**
 * pi's `selectReference` with every model usable, as in a scope: the id on the
 * provider the longest known `provider/` prefix names, else the one provider
 * whose id is the whole text. Undefined when nothing matches whole; null when
 * only pi picks (part of an id within the named provider, several providers).
 */
function reference(text: string, pool: readonly PiEntry[]): string | null | undefined {
  const lower = text.toLowerCase();
  const raw = pool.filter(entry => entry.id.toLowerCase() === lower);
  const split = providerPrefix(text, pool);
  if (split) {
    const wanted = split.model.toLowerCase();
    const own = pool.filter(entry => entry.provider === split.provider);
    const named = own.find(entry => entry.id.toLowerCase() === wanted) ?? raw.find(entry => entry.provider === split.provider);
    if (named) return named.full;
    if (own.some(entry => entry.id.toLowerCase().includes(wanted) || entry.name.toLowerCase().includes(wanted))) return null;
  }
  if (raw.length === 0) return undefined;
  return new Set(raw.map(entry => entry.provider)).size === 1 ? raw[0]!.full : null;
}

/** pi's `splitProviderPrefix`: the longest provider id the text starts with before a `/`, and the rest. */
function providerPrefix(text: string, pool: readonly PiEntry[]): { provider: string; model: string } | undefined {
  const lower = text.toLowerCase();
  let best: { provider: string; model: string } | undefined;
  for (const { provider } of pool) {
    const prefix = provider.trim().toLowerCase();
    if (!prefix || (best && best.provider.length >= provider.length)) continue;
    const slash = lower.indexOf('/', prefix.length);
    if (slash === -1 || lower.slice(0, slash).trim() !== prefix) continue;
    const model = text.slice(slash + 1).trim();
    if (model) best = { provider, model };
  }
  return best;
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

function entriesIn(dir: string): boolean {
  try { return readdirSync(dir).length > 0; } catch { return false; }
}

function listed(setting: unknown): boolean {
  return Array.isArray(setting) && setting.length > 0;
}
