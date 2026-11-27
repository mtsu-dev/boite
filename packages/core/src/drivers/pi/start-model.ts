import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DISK_VIEW, type FileView } from '../../file-view.ts';
import { isRecord } from '../stdio.ts';
import { piArgs, PI_VALUED } from './args.ts';
import { piModelOf } from './models.ts';
import { piProcessCwd } from './session-model.ts';

/** The keys pi 1.6.1 `findInitialModel` chooses a new session's model from, in its order. */
const CHOOSING = ['enabledModels', 'defaultProvider', 'defaultModel'] as const;
/** What the profile's own arguments decide for pi 1.6.1, read as `parseArgs` walks them: the last of each kind wins. */
export interface PiLaunchChoices {
  /** `--models`, split on commas without empty patterns: an empty list clears the scope. Null when absent. */
  scope: string[] | null;
  /** `--approve`/`-a` trusts the folder, `--no-approve`/`-na` does not, before `trust.json`. */
  trust: boolean | null;
  /** A `--model`, which beats any session or setting. */
  model: boolean;
  /** An `--extension`/`-e`, which loads before pi decides whether it trusts the folder. */
  extensions?: boolean;
  /** `--no-extensions`/`-ne`: pi then loads only the `-e` ones, none it discovers (`loadCurrentExtensionSet`). */
  noExtensions?: boolean;
  /** The last valid `--thinking` level; pi warns of any other value and keeps the level it had. */
  thinking?: string;
}

/** The levels pi 1.6.1 takes from `--thinking` (cli/args.js `VALID_THINKING_LEVELS`). */
const LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** A model of the account's catalog as Boite lists it (`drivers/pi/models.ts`): `provider/id`, and a name that starts with the provider. */
export interface CatalogModel { id: string; name: string }

/** A catalog model as pi holds it, with the `provider/id` Boite names it by. */
interface PiEntry { full: string; provider: string; id: string; name: string }

export function piLaunchChoices(args: readonly string[]): PiLaunchChoices {
  const choices: PiLaunchChoices = { scope: null, trust: null, model: false };
  for (const { words: [arg, value] } of piArgs(args)) {
    if (arg === '--') break;
    if (PI_VALUED.has(arg!)) {
      if (value === undefined) continue;
      if (arg === '--models') choices.scope = value.split(',').map(pattern => pattern.trim()).filter(pattern => pattern.length > 0);
      else if (arg === '--model') choices.model = true;
      else if (arg === '--extension' || arg === '-e') choices.extensions = true;
      else if (arg === '--thinking' && LEVELS.has(value)) choices.thinking = value;
    } else if (arg === '--no-extensions' || arg === '-ne') choices.noExtensions = true;
    else if (arg === '--approve' || arg === '-a') choices.trust = true;
    else if (arg === '--no-approve' || arg === '-na') choices.trust = false;
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
export function folderStartModel(
  agentDir: string, cwd: string, catalog: readonly CatalogModel[] | null, launch: Omit<PiLaunchChoices, 'model'> = { scope: null, trust: null }, files: FileView = DISK_VIEW,
): string | 'account' | null {
  const { global, project, undecided } = folderView(agentDir, cwd, launch, files);
  if (undecided) return null;
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
 * Whether only pi 1.6.1 can tell the models it holds in `cwd`, a resumed session's included: an extension may
 * register a pair over the catalog's that depends on the folder, the folder's own ones, which the probe, run elsewhere,
 * did not load, and the account's or the profile's, which the probe ran outside that folder.
 */
export function folderExtends(agentDir: string, cwd: string, launch: Omit<PiLaunchChoices, 'model'> = { scope: null, trust: null }, files: FileView = DISK_VIEW): boolean {
  const view = folderView(agentDir, cwd, launch, files);
  return view.undecided || view.extensions;
}

/**
 * What pi 1.6.1 reads of the account's and the folder's settings in `cwd`, whether only it can tell the start model,
 * and whether the account or the profile loads extensions (`--no-extensions` leaves only the `-e` ones).
 */
function folderView(agentDir: string, cwd: string, launch: Omit<PiLaunchChoices, 'model'>, files: FileView): { global: Record<string, unknown>; project: Record<string, unknown> | null; undecided: boolean; extensions: boolean } {
  const global = settingsAt(files, join(agentDir, 'settings.json')) ?? {};
  const folder = piProcessCwd(cwd);
  const own = join(folder, '.pi');
  const extended = files.listsAny(join(own, 'extensions'));
  const discovers = launch.noExtensions !== true;
  const extensions = launch.extensions === true
    || (discovers && (files.listsAny(join(agentDir, 'extensions')) || listed(global['extensions']) || listed(global['packages'])));
  // For a folder with settings or extensions of its own, pi first asks the extensions it loads before trusting any
  // folder (the account's and the profile's): a `project_trust` hook decides over `trust.json` (`resolveProjectTrusted`).
  const asks = launch.trust === null && extensions;
  const hooked = asks && (extended || files.exists(join(own, 'settings.json')));
  const trust = launch.trust ?? trusted(files, agentDir, folder, global);
  const project = trust ? settingsAt(files, join(own, 'settings.json')) : null;
  // A file reached through a link is pi's to read, since the view predicts only link-free paths: each counts where
  // this launch lets pi read it, and the account's settings always.
  const linked = [
    join(agentDir, 'settings.json'),
    ...launch.trust === null ? [join(agentDir, 'trust.json')] : [],
    ...discovers && launch.extensions !== true ? [join(agentDir, 'extensions')] : [],
    ...asks || trust ? [join(own, 'settings.json')] : [],
    ...asks || (trust && discovers) ? [join(own, 'extensions')] : [],
  ].some(path => files.linked(path));
  // A trusted folder's own extensions load only there (`DefaultPackageManager.resolve`).
  const undecided = linked || hooked || (trust && discovers && (extended || listed(project?.['extensions']) || listed(project?.['packages'])));
  return { global, project, undecided, extensions };
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
function trusted(files: FileView, agentDir: string, folder: string, global: Record<string, unknown>): boolean {
  const decisions = settingsAt(files, join(agentDir, 'trust.json')) ?? {};
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
function settingsAt(files: FileView, path: string): Record<string, unknown> | null {
  const text = files.read(path);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function listed(setting: unknown): boolean {
  return Array.isArray(setting) && setting.length > 0;
}
