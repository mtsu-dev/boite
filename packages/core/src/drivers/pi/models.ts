import type { EffortLevel, ModelInfo, ProviderDescriptor } from '@boite/contracts';
import { unavailable } from '../../errors.ts';
import { profileFor, resolveLaunch } from '../../providers/resolve.ts';
import type { ProbeContext } from '../types.ts';
import { probeModels } from '../model-probe.ts';
import { agentEnv, piAgentDirFollowsCwd, textOf } from './mapping.ts';
import { AGENT_OWN_MODEL, PROBE_TIMEOUT_MS, STDERR_MAX, THINKING_LEVELS, VIRTUAL_API } from './protocol.ts';
import type { PiModel } from './protocol.ts';
import { dataOf, PiPeer } from './rpc.ts';

/** The words the picker shows for pi's level ids. */
const EFFORT_LABELS: Record<string, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

function effortLabel(id: string): string {
  return EFFORT_LABELS[id] ?? `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`;
}

/**
 * The levels one model supports, exactly as pi decides them itself: the rule is
 * `getSupportedThinkingLevels` of `@earendil-works/pi-ai`
 * (`node_modules/@earendil-works/pi-ai/dist/models.js`). A model without
 * reasoning has `off` and nothing else, a level mapped to `null` is dropped, and
 * `xhigh` and `max` are only there when the model maps them.
 *
 * It is reproduced here rather than asked for because
 * `get_available_thinking_levels` answers for the model the session is on and
 * for no other, so reading the scale of five hundred models would mean five
 * hundred `set_model` round trips. The session's own answer is still read, as
 * the cross-check below.
 */
function supportedLevels(model: PiModel): string[] {
  if (model.reasoning !== true) return ['off'];
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
}

/**
 * A model's `ModelInfo.effort`. A scale of one level is no choice at all, which
 * is what a model without reasoning answers, so it carries no effort block.
 * `current` is the level the probe's session runs this model on, known only for
 * the model it is on; every other model gets no default, so a thread picking it
 * sends no level and pi keeps its own, clamped to that model, rather than a
 * guessed `off`.
 */
function effortOf(model: PiModel, current: string | null): ModelInfo['effort'] | null {
  const ids = supportedLevels(model);
  if (ids.length < 2) return null;
  const levels: EffortLevel[] = ids.map((id) => ({ id, label: effortLabel(id) }));
  return current !== null && ids.includes(current) ? { levels, default: current } : { levels };
}

/** pi's provider ids are lowercase; the picker shows them with a capital. */
function providerLabel(provider: string): string {
  return `${provider.slice(0, 1).toUpperCase()}${provider.slice(1)}`;
}

/** Whether the model pi reports reads images: undefined when pi named no inputs. */
export function piReadsImages(model: PiModel | null | undefined): boolean | undefined {
  return Array.isArray(model?.input) ? model.input.includes('image') : undefined;
}

/** Whether pi's own listing (`get_available_models`) holds this exact pair, which `set_model` requires. */
export function piListsPair(models: unknown, pair: { provider: string; modelId: string }): boolean {
  return Array.isArray(models) && (models as PiModel[]).some(model => model?.provider === pair.provider && model.id === pair.modelId);
}

/**
 * The pair pi reads a `<provider>/<id>` text as among `models` (its `get_available_models` answer): a provider id
 * may hold a `/`, and pi takes the longest provider that spells the text, as the catalog keeps. Without one, the text
 * splits at its first `/` and pi answers for that pair itself.
 */
export function piPairOf(models: unknown, text: string): { provider: string; modelId: string } | undefined {
  let best: { provider: string; modelId: string } | undefined;
  for (const model of Array.isArray(models) ? (models as PiModel[]) : []) {
    if (typeof model?.provider !== 'string' || typeof model.id !== 'string' || `${model.provider}/${model.id}` !== text) continue;
    if (best === undefined || model.provider.length > best.provider.length) best = { provider: model.provider, modelId: model.id };
  }
  const slash = text.indexOf('/');
  return best ?? (slash > 0 && slash < text.length - 1 ? { provider: text.slice(0, slash), modelId: text.slice(slash + 1) } : undefined);
}

/**
 * pi's launch arguments for a named model. A provider id may hold a `/` and pi matches a text in part, or reads a
 * `:<level>` tail as part of an id, so the pair the catalog lists goes as `--provider` with the whole
 * `<provider>/<id>`, which pi then reads as that exact pair, and the level goes as `--thinking`. A model the catalog
 * does not list (no probe yet) goes as its text alone. `default` is Boite's id for "pi keeps its own": nothing.
 */
export function piModelArgs(model: string | null, effort: string | null, catalog: readonly ModelInfo[] | null): string[] {
  if (model === null || model === AGENT_OWN_MODEL) return [];
  const pair = piCatalogPair(model, catalog);
  return [...(pair ? ['--provider', pair.provider] : []), '--model', model, ...(effort === null ? [] : ['--thinking', effort])];
}

/** The pi provider a Boite model id goes to: the catalog's pair, else the text before its first `/`; '' when neither names one. */
export function piProviderOf(model: string, catalog: readonly ModelInfo[] | null): string {
  return piCatalogPair(model, catalog)?.provider ?? model.slice(0, Math.max(model.indexOf('/'), 0));
}

/**
 * The provider pi 1.6.1 starts a profile on, from its own `--provider`, else its `--model`, else a `--models` scope
 * whose patterns all name one provider, the last of each kind winning as `parseArgs` reads them. A text resolves only
 * through the catalog: the pair it lists, else the longest provider whose `<provider>/` starts it (a provider id may
 * hold a `/`), else the one provider holding that bare id. Null when only pi can tell.
 */
export function piProfileProvider(args: readonly string[], catalog: readonly ModelInfo[] | null): string | null {
  let provider: string | null = null, model: string | null = null, scope: string[] | null = null;
  for (let i = 0; i + 1 < args.length; i++) {
    const arg = args[i]!, next = args[i + 1]!;
    if (arg === '--provider') provider = next;
    else if (arg === '--model') model = next;
    else if (arg === '--models') scope = next.split(',').map(pattern => pattern.trim()).filter(pattern => pattern.length > 0);
    else continue;
    i++;
  }
  if (provider !== null) return provider;
  if (model !== null) return catalogProvider(model, catalog);
  const named = new Set((scope ?? []).map(pattern => catalogProvider(pattern, catalog)));
  return named.size === 1 && !named.has(null) ? [...named][0]! : null;
}

function catalogProvider(text: string, catalog: readonly ModelInfo[] | null): string | null {
  if (catalog === null) return null;
  const listed = piCatalogPair(text, catalog);
  if (listed) return listed.provider;
  const pairs = catalog.flatMap(entry => piModelOf(entry) ?? []);
  const prefixed = pairs.filter(pair => text.startsWith(`${pair.provider}/`)).map(pair => pair.provider).sort((a, b) => b.length - a.length);
  if (prefixed.length > 0) return prefixed[0]!;
  const holders = new Set(pairs.filter(pair => pair.id === text).map(pair => pair.provider));
  return holders.size === 1 ? [...holders][0]! : null;
}

/** Whether the profile starts pi on `model`'s provider, or on `model` itself. */
export function piProfilePins(args: readonly string[], model: string, catalog: readonly ModelInfo[] | null): boolean {
  const provider = piProviderOf(model, catalog);
  return args.some((arg, i) => arg === '--model' && args[i + 1] === model) || (provider !== '' && piProfileProvider(args, catalog) === provider);
}

/**
 * A profile's launch arguments for a process Boite starts on `model`. Boite's own `--provider` and `--model` name it,
 * so the profile's go, or pi would read a model the catalog does not list under the profile's provider. pi 1.6.1
 * binds `--api-key` to the provider of the model it starts on (`setRuntimeApiKey` in main.js), so the profile's key
 * goes only where the catalog shows that provider is the one the profile starts on. A key no `--provider`, `--model`
 * or `--models` names a provider for follows the model, as pi itself would.
 */
export function piProfileArgs(args: readonly string[], model: string | null, catalog: readonly ModelInfo[] | null): string[] {
  if (model === null || model === AGENT_OWN_MODEL) return [...args];
  const selected = piCatalogPair(model, catalog)?.provider ?? null;
  const names = args.some((arg, i) => i + 1 < args.length && (arg === '--provider' || arg === '--model' || arg === '--models'));
  const keyed = !names || (selected !== null && piProfileProvider(args, catalog) === selected);
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (i + 1 < args.length && (arg === '--provider' || arg === '--model' || (arg === '--api-key' && !keyed))) i++;
    else kept.push(arg);
  }
  return kept;
}

/** The provider a launch on `model` binds the profile's `--api-key` to, or null when it passes none. */
export function piKeyedProvider(args: readonly string[], model: string | null, catalog: readonly ModelInfo[] | null): string | null {
  if (model === null || model === AGENT_OWN_MODEL || !piProfileArgs(args, model, catalog).includes('--api-key')) return null;
  return piCatalogPair(model, catalog)?.provider ?? null;
}

/** The pair `catalog` names behind a Boite model id, the one image admission checked; undefined when it lists none. */
export function piCatalogPair(model: string, catalog: readonly ModelInfo[] | null): { provider: string; modelId: string } | undefined {
  const listed = catalog?.find(entry => entry.id === model);
  const pair = listed && piModelOf(listed);
  return pair ? { provider: pair.provider, modelId: pair.id } : undefined;
}

/**
 * The pi provider, id and name behind a catalog entry, read back from the id and
 * the name `modelsFrom` gives it: a provider id may hold a `/` itself, which the
 * `<provider>/<id>` text alone cannot tell. Undefined for an entry of another shape.
 */
export function piModelOf(model: { id: string; name: string }): { provider: string; id: string; name: string } | undefined {
  for (let slash = model.id.indexOf('/'); slash > 0 && slash + 1 < model.id.length; slash = model.id.indexOf('/', slash + 1)) {
    const provider = model.id.slice(0, slash);
    const label = `${providerLabel(provider)} / `;
    if (model.name.startsWith(label)) return { provider, id: model.id.slice(slash + 1), name: model.name.slice(label.length) };
  }
  return undefined;
}

/** What one probe read from the agent, before any of it becomes a `ModelInfo`. */
interface PiListing {
  models: PiModel[];
  /** The model the session is on, as `<provider>/<id>`, or an empty string. */
  current: string;
  /** Its provider, which that text alone cannot tell when a provider id holds a `/`. */
  currentProvider: string;
  /** The thinking level the session is on: the default effort of the current model, and of it alone. */
  thinkingLevel: string;
  /** `get_available_thinking_levels`: the scale of the current model, and of it alone. */
  sessionLevels: string[];
}

/**
 * A pi listing as a model list. The id is what `--model` takes, `<provider>/<id>`,
 * and the name carries the provider so two models called the same are told apart.
 * The descriptor's `default` stays first so the choice can always go back to
 * pi's own configuration, and it carries no effort of its own. An agent that
 * lists nothing, which is what an unauthenticated pi does, leaves the
 * descriptor's models standing. With a relative configuration folder, each
 * folder pi starts in reads its own `models.json`, so what the probe read
 * elsewhere says nothing of a model's images (`imagesKnown` false): none is
 * marked text-only and pi answers for each.
 */
function modelsFrom(provider: ProviderDescriptor, listing: PiListing, imagesKnown = true): ModelInfo[] {
  const models: ModelInfo[] = [];
  // Each id's provider, so a later pair that spells the same id can take its place.
  const seen = new Map<string, string>();
  const own = provider.models.find((model) => model.id === AGENT_OWN_MODEL);
  if (own !== undefined) {
    models.push({ id: AGENT_OWN_MODEL, name: own.name, default: false });
    seen.set(AGENT_OWN_MODEL, '');
  }
  for (const entry of listing.models) {
    const id = entry.id ?? '';
    const providerId = entry.provider ?? '';
    if (id.length === 0 || providerId.length === 0) continue;
    const full = `${providerId}/${id}`;
    // `gateway` + `team/base` and `gateway/team` + `base` spell one id; pi reads that text on the longest provider
    // (`splitProviderPrefix`), for `--model` as for a scope, so that pair is the one the id names.
    const held = seen.get(full);
    if (held !== undefined && held.length >= providerId.length) continue;
    if (held !== undefined) models.splice(models.findIndex((model) => model.id === full), 1);
    seen.set(full, providerId);
    const current = full === listing.current && providerId === listing.currentProvider;
    const effort = effortOf(entry, current ? listing.thinkingLevel : null);
    models.push({
      id: full,
      name: `${providerLabel(providerId)} / ${entry.name ?? id}`,
      default: current,
      ...(imagesKnown && Array.isArray(entry.input) && !entry.input.includes('image') ? { images: false as const } : {}),
      ...(entry.api === VIRTUAL_API ? { virtual: true as const } : {}),
      ...(effort === null ? {} : { effort }),
    });
  }
  // "pi default" runs the current model, so it reads images only when that model does.
  const current = listing.models.find((model) => model.provider === listing.currentProvider && `${model.provider}/${model.id ?? ''}` === listing.current);
  if (imagesKnown && own !== undefined && Array.isArray(current?.input) && !current.input.includes('image')) models[0]!.images = false;
  return models.length === (own === undefined ? 0 : 1) ? provider.models : models;
}

/**
 * One short-lived `pi --mode rpc --no-session`: `get_state` for the model and the
 * level the session is on, `get_available_models` for the list, and
 * `get_available_thinking_levels` for the current model's own scale, which is
 * what `supportedLevels` is checked against. `--no-session` because a probe must
 * leave no transcript anywhere. The child goes through the registry that traced
 * it on every path; nothing of this process is kept.
 */
export async function readModels(ctx: ProbeContext): Promise<ModelInfo[]> {
  const profile = profileFor(ctx.provider);
  const launch = resolveLaunch(profile);
  if (launch === null) {
    throw unavailable(`no ${ctx.provider.id} executable on this machine`, { providerId: ctx.provider.id });
  }

  const child = ctx.spawnChild(launch.executable, [...launch.prefix, ...(profile?.launch?.args ?? []), '--no-session'], {
    cwd: ctx.cwd,
    env: agentEnv(ctx.accountEnv),
  });
  const peer = new PiPeer(child, {
    // A probe runs no turn: pi has nothing to stream and nothing to ask.
    event: () => undefined,
    log: (level, message, context) => {
      ctx.log(level, message, context);
    },
  });

  return probeModels(ctx, child, { noun: 'agent', timeoutMs: PROBE_TIMEOUT_MS, stderrMax: STDERR_MAX, over: () => peer.fail('the pi probe is over') }, async () => {
    const state = dataOf(await peer.command('get_state'));
    const listed = dataOf(await peer.command('get_available_models'));
    const levels = dataOf(await peer.command('get_available_thinking_levels'));
    const current = (state['model'] ?? {}) as PiModel;
    const currentId =
      typeof current.id === 'string' && typeof current.provider === 'string'
        ? `${current.provider}/${current.id}`
        : '';
    const listing: PiListing = {
      models: Array.isArray(listed['models']) ? (listed['models'] as PiModel[]) : [],
      current: currentId,
      currentProvider: currentId === '' ? '' : current.provider!,
      thinkingLevel: textOf(state['thinkingLevel']),
      sessionLevels: Array.isArray(levels['levels']) ? (levels['levels'] as string[]) : [],
    };
    return listing;
  }, (listing) => {
    checkLevels(ctx, listing);
    return modelsFrom(ctx.provider, listing, !piAgentDirFollowsCwd(agentEnv(ctx.accountEnv)));
  });
}

/**
 * The one place pi answers a scale itself is the model the session is on, so
 * that answer is what says whether `supportedLevels` still matches pi's rule. A
 * mismatch means pi changed it: one warning naming both, never a silent list of
 * levels the agent would refuse.
 */
function checkLevels(ctx: ProbeContext, listing: PiListing): void {
  if (listing.sessionLevels.length === 0 || listing.current === '') return;
  const current = listing.models.find((model) => model.provider === listing.currentProvider && `${model.provider}/${model.id ?? ''}` === listing.current);
  if (current === undefined) return;
  const computed = supportedLevels(current).join(',');
  const answered = listing.sessionLevels.join(',');
  if (computed === answered) return;
  ctx.log(
    'warn',
    `pi probe: the levels of ${listing.current} read as ${computed} but the agent answered ${answered}`,
  );
}
