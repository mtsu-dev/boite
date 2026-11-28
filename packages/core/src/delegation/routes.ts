/**
 * Which harness, account, model and reasoning level a delegated child runs on.
 * An agent names a model (`codex/gpt-5.5`, `gpt-5.5`, `opus`) and a level;
 * Boite picks the account: the parent's for its own provider, else that
 * provider's usable login. A child runs on a speed tier only when the request
 * names one: it never inherits the parent's.
 */
import { CONVERSATION_PROFILE_ID, loggedInAccount, matchSpeed, resolveModelId, SPEED_NEEDS_MODEL, speedRefusal } from '@boite/contracts';
import type { Account, DelegationConfig, DelegationModelChoice, DelegationModels, DelegationProfile, ProviderId, ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { probedModelsOf } from '../drivers/index.ts';
import { checkEffort, modelsFor, PROBED_PROTOCOLS, selectionFor } from '../threads/selection.ts';
import type { ProviderProbe } from '../providers/probe.ts';

/** A profile, or a conversation's own route, whose model may be the provider's default. */
export type ChildRoute = Omit<DelegationProfile, 'model'> & { model: string | null; speed?: string | null };

export interface RouteRequest {
  profileId?: string | null;
  model?: string;
  effort?: string;
  /** A speed tier of the route's model, by id or label. */
  speed?: string;
}

export const PROBE_TIMEOUT_MS = 30_000;

/** What a model list is read for: a thread here, or the agent of another machine asking for one. */
export type Asker = Pick<ThreadSummary, 'providerId' | 'accountId' | 'model'>;

/** On unless the owner turned it off. Older saved configs have no field. */
export const anyModel = (config: DelegationConfig): boolean => config.anyModel !== false;

/** Explicit model choices respect the same owner-approved routes here and on another machine. */
export function checkModelAllowed(config: DelegationConfig, parent: ThreadSummary, choice: Pick<ChildRoute, 'providerId' | 'accountId' | 'model' | 'effort'>, models: DelegationModelChoice[], base?: ChildRoute): void {
  if (anyModel(config)) return;
  const accountModels = models.filter(model => model.providerId === choice.providerId && model.accountId === choice.accountId);
  if (base) {
    const alias = resolveModelId(accountModels, base.model, row => row.model, row => row.aliases)?.alias;
    checkAliasEffortAllowed(config, base, alias?.effort, choice.effort);
    return;
  }
  const allowed = [conversationRoute(parent), ...config.profiles];
  if (!allowed.some(route => {
    if (route.providerId !== choice.providerId) return false;
    const resolved = resolveModelId(accountModels, route.model, row => row.model, row => row.aliases);
    const required = resolved?.alias?.effort === undefined ? undefined : route.effort ?? resolved.alias.effort;
    return resolved?.row.model === choice.model && (required === undefined || required === choice.effort);
  })) throw modelNotAllowed(allowed);
}

function modelNotAllowed(allowed: Pick<ChildRoute, 'id'>[]) {
  return refused(`the owner limited subagents to this conversation's model and the profiles (${allowed.map(route => route.id).join(', ')}); use an allowed model and effort`);
}

/** An effort override on a named route must also respect its legacy model ID. */
function checkAliasEffortAllowed(config: DelegationConfig, base: ChildRoute, aliasEffort: string | undefined, effort: string | null): void {
  if (!anyModel(config) && aliasEffort !== undefined && (base.effort ?? aliasEffort) !== effort) throw modelNotAllowed([base]);
}

/** The parent's account on its own provider, else that provider's logged-in default login. */
export function accountFor(core: Core, parent: Asker, providerId: ProviderId): Account | undefined {
  const accounts = core.accounts.list().filter(account => account.providerId === providerId);
  if (parent.providerId === providerId) {
    const own = accounts.find(account => account.id === parent.accountId);
    if (own) return own;
  }
  return loggedInAccount(accounts);
}

export { loggedInAccount };

/** Every model a child can start on right now, from descriptors and the last probes. Reads no process. */
export function catalog(core: Core, parent: Asker, withLegacy = false): DelegationModels & { legacy: DelegationModelChoice[] } {
  const choices: DelegationModelChoice[] = [], legacy: DelegationModelChoice[] = [];
  const unavailable: DelegationModels['unavailable'] = [];
  for (const summary of core.providers.available()) {
    const account = accountFor(core, parent, summary.id);
    if (!account) { unavailable.push({ providerId: summary.id, reason: 'no logged-in account' }); continue; }
    const provider = core.providers.require(summary.id);
    const models = modelsFor(provider, account.id);
    if (!models.length && PROBED_PROTOCOLS.includes(provider.protocol)) unavailable.push({ providerId: summary.id, reason: 'models not read yet' });
    const current = resolveModelId(models, parent.model, row => row.id, row => row.aliases)?.row;
    for (const model of models) {
      const choice: DelegationModelChoice = {
        providerId: summary.id, providerName: summary.name, accountId: account.id, model: model.id, name: model.name,
        efforts: model.effort?.levels.map(level => level.id) ?? [], defaultEffort: model.effort?.default ?? null,
        speeds: model.speeds?.map(speed => ({ ...speed })) ?? [],
        ...(model.aliases ? { aliases: model.aliases } : {}),
        current: parent.providerId === summary.id && current?.id === model.id,
      };
      (model.legacy ? legacy : choices).push(choice);
    }
  }
  return { anyModel: true, choices: withLegacy ? [...choices, ...legacy] : choices, legacy, unavailable };
}

/**
 * Read the model lists an agent process owns and nobody asked for yet. Only the
 * providers named, or every installed one; a slow or failing probe is reported,
 * never thrown. `timeoutMs` bounds each read. `refresh` reads a list already
 * held again, as the picker's refresh does: a model released since the last
 * read only shows up that way.
 */
export async function discover(core: Core, probe: ProviderProbe, parent: Asker, only?: ProviderId[], timeoutMs = PROBE_TIMEOUT_MS, refresh = false): Promise<{ providerId: ProviderId; reason: string }[]> {
  const failures: { providerId: ProviderId; reason: string }[] = [];
  await Promise.all(core.providers.available().filter(summary => !only || only.includes(summary.id)).map(async summary => {
    const provider = core.providers.require(summary.id);
    const account = accountFor(core, parent, summary.id);
    if (!account || !PROBED_PROTOCOLS.includes(provider.protocol)) return;
    if (!refresh && probedModelsOf(provider.protocol, provider.id, account.id) !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        probe({ providerId: provider.id, accountId: account.id, ...(refresh ? { refresh: true } : {}) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out reading its models')), timeoutMs); }),
      ]);
    } catch (error) {
      failures.push({ providerId: provider.id, reason: messageOf(error) });
    } finally { clearTimeout(timer); }
  }));
  return failures;
}

/** The providers a model name could belong to, so a spawn probes only those. */
export function providersNamed(core: Core, model: string): ProviderId[] | undefined {
  const slash = model.indexOf('/');
  const head = slash > 0 ? model.slice(0, slash) : '';
  return core.providers.get(head) ? [head] : undefined;
}

/** How long a list re-read for a missing model answers the next miss on that provider and account. */
const MISS_REFRESH_MS = 60_000;
/** Per core: when each provider and account's list was re-read for a miss, and the read while it runs. */
const missRefreshes = new WeakMap<Core, Map<string, { at: number; read: Promise<unknown> }>>();

/**
 * Read the lists the named models need, when the catalog does not list them yet.
 * A model missing from a list already held may have been released since that
 * read: its provider's list is read again, at most once a minute per account,
 * so a spawn on a new model works without the owner's refresh. A spawn that
 * misses while that read runs waits for it instead of being refused.
 */
export async function readNamed(core: Core, probe: ProviderProbe, parent: Asker, models: string[]): Promise<void> {
  if (!models.length) return;
  const absent = (): string[] => {
    const known = catalog(core, parent, true).choices;
    return models.filter(model => !hasNamedModel(known, model));
  };
  const missing = absent();
  if (!missing.length) return;
  const named = (list: string[]) => [...new Set(list.flatMap(model => providersNamed(core, model) ?? []))];
  // Only a list held before this request can be stale; one read now is fresh.
  const held = named(missing).filter(providerId => {
    const account = accountFor(core, parent, providerId);
    const provider = core.providers.get(providerId);
    return account !== undefined && provider !== undefined && probedModelsOf(provider.protocol, providerId, account.id) !== null;
  });
  const only = missing.map(model => providersNamed(core, model));
  await discover(core, probe, parent, only.some(list => list === undefined) ? undefined : [...new Set(only.flat() as string[])]);
  const stale = named(absent()).filter(providerId => held.includes(providerId));
  if (!stale.length) return;
  let recent = missRefreshes.get(core);
  if (!recent) missRefreshes.set(core, recent = new Map());
  const now = Date.now();
  for (const [key, entry] of recent) if (now - entry.at >= MISS_REFRESH_MS) recent.delete(key);
  const reads: Promise<unknown>[] = [];
  for (const providerId of stale) {
    const account = accountFor(core, parent, providerId);
    if (!account) continue;
    const key = JSON.stringify([providerId, account.id]);
    const entry = recent.get(key) ?? { at: now, read: discover(core, probe, parent, [providerId], PROBE_TIMEOUT_MS, true) };
    recent.set(key, entry);
    reads.push(entry.read);
  }
  await Promise.all(reads);
}

const label = (choice: DelegationModelChoice) => `${choice.providerId}/${choice.model}`;

function byName(choices: DelegationModelChoice[], wanted: string, qualified: boolean) {
  const identify = (choice: DelegationModelChoice) => qualified ? label(choice).toLowerCase() : choice.model.toLowerCase();
  return resolveModelId(choices, wanted, identify, choice => choice.aliases?.map(alias => ({
    ...alias, id: (qualified ? `${choice.providerId}/${alias.id}` : alias.id).toLowerCase(),
  })));
}

export function hasNamedModel(choices: DelegationModelChoice[], wanted: string): boolean {
  const id = wanted.trim().toLowerCase();
  return Boolean(byName(choices, id, true) ?? byName(choices, id, false));
}

/** Qualified ID, bare ID, exact alias, then a unique part of an ID or name. */
function pick(choices: DelegationModelChoice[], parent: Pick<ThreadSummary, 'providerId'>, wanted: string, list = 'boite delegate models') {
  const query = wanted.trim().toLowerCase();
  const qualified = choices.find(choice => label(choice).toLowerCase() === query);
  if (qualified) return { row: qualified };
  const exact = choices.filter(choice => choice.model.toLowerCase() === query);
  const alias = exact.length === 0 ? byName(choices, query, true) ?? byName(choices.filter(choice => choice.providerId === parent.providerId), query, false) : undefined;
  if (alias) return alias;
  const aliases = exact.length ? [] : choices.filter(choice => byName([choice], query, false));
  const exactMatches = exact.length ? exact : aliases;
  const partial = exactMatches.length ? exactMatches : choices.filter(c => c.model.toLowerCase().includes(query) || c.name.toLowerCase().includes(query) || label(c).toLowerCase().includes(query));
  const own = partial.filter(c => c.providerId === parent.providerId);
  const selected = partial.length === 1 ? partial[0] : exactMatches.length && own.length === 1 ? own[0] : undefined;
  if (selected) return byName([selected], query, false) ?? { row: selected };
  if (!partial.length) throw invalidParams(`model: no installed model matches "${wanted}"; run ${list}`, { field: 'model', expected: choices.slice(0, 40).map(label) });
  throw invalidParams(`model: "${wanted}" matches ${partial.length} models; name one of ${partial.slice(0, 8).map(label).join(', ')}`, { field: 'model', expected: partial.map(label) });
}

function pickedEffort(choice: DelegationModelChoice, caller: Pick<ThreadSummary, 'model' | 'effort'>, own: boolean, alias: string | undefined): string | null {
  const inherited = own ? caller.effort ?? choice.aliases?.find(entry => entry.id === caller.model)?.effort : undefined;
  return alias ?? (inherited && choice.efforts.includes(inherited) ? inherited : choice.defaultEffort);
}

function namedEffort(choice: DelegationModelChoice, level: string): string {
  if (choice.efforts.includes(level)) return level;
  const name = label(choice);
  throw refused(choice.efforts.length ? `effort: ${name} has no "${level}" level; expected ${choice.efforts.join(', ')}`
    : `effort: ${name} offers no reasoning level; leave --effort out`, { field: 'effort', expected: choice.efforts });
}

function sameModel(choice: DelegationModelChoice, caller: Pick<ThreadSummary, 'providerId' | 'model'>): boolean {
  return choice.providerId === caller.providerId && (choice.model === caller.model || choice.aliases?.some(alias => alias.id === caller.model) === true);
}

/** The agent a thread an agent starts runs on. */
export interface ModelPick { providerId: ProviderId; accountId: string; model: string; effort: string | null; speed: string | null }

/**
 * `--model`, `--effort` and `--speed` of a thread an agent starts, matched
 * against a machine's model list as `delegate spawn` matches them, and
 * refused with what that list offers. Without `model` it is the caller's own;
 * on the caller's own model the caller's level and tier stay unless named,
 * on another the model's default level and no tier.
 */
export function chooseModel(choices: DelegationModelChoice[], caller: Pick<ThreadSummary, 'providerId' | 'model' | 'effort' | 'speed'>, request: Omit<RouteRequest, 'profileId'>, list: string): ModelPick {
  const wanted = request.model ?? (caller.model === null ? null : `${caller.providerId}/${caller.model}`);
  if (wanted === null) throw invalidParams(request.speed === undefined ? 'effort: this thread runs on the provider\'s default model; name a model with --model to choose its reasoning' : SPEED_NEEDS_MODEL, { field: 'model' });
  const { row: choice, alias } = pick(choices, caller, wanted, list);
  const name = label(choice);
  const own = sameModel(choice, caller);
  const inherit = request.model === undefined && own && choice.efforts.includes(caller.effort ?? '');
  const effort = request.effort === undefined ? pickedEffort(choice, caller, own, inherit ? undefined : alias?.effort) : namedEffort(choice, request.effort.trim());
  const speeds = choice.speeds;
  let speed = own && speeds?.some(tier => tier.id === caller.speed) ? caller.speed ?? null : null;
  if (request.speed !== undefined) {
    speed = matchSpeed(speeds, request.speed);
    if (speed === null) throw refused(speedRefusal(name, speeds, request.speed), speeds === undefined ? { field: 'speed' } : { field: 'speed', expected: speeds.map(tier => tier.id) });
  }
  return { providerId: choice.providerId, accountId: choice.accountId, model: choice.model, effort, speed };
}

/** The parent's own route, under the built-in id. A profile an owner named `conversation` keeps its route. */
export function conversationRoute(parent: ThreadSummary): ChildRoute {
  return { id: CONVERSATION_PROFILE_ID, name: parent.model ?? parent.providerId, providerId: parent.providerId, accountId: parent.accountId, model: parent.model, effort: parent.effort ?? null };
}

/** The route a request names, checked against what is installed and what the owner allows. */
export function resolveRoute(core: Core, parent: ThreadSummary, config: DelegationConfig, request: RouteRequest, defaultNamedEffort: 'inherit' | 'automatic' = 'inherit'): ChildRoute {
  const profiles = config.profiles;
  const named = (id: string) => profiles.find(p => p.id === id) ?? (id === CONVERSATION_PROFILE_ID ? conversationRoute(parent) : undefined);
  let route: ChildRoute;
  let choices: DelegationModelChoice[] | undefined;
  if (request.model !== undefined) {
    ({ choices } = catalog(core, parent, true));
    const { row: choice, alias } = pick(choices, parent, request.model);
    route = {
      id: label(choice), name: choice.name, providerId: choice.providerId, accountId: choice.accountId, model: choice.model,
      effort: alias?.effort ?? (defaultNamedEffort === 'automatic' ? null : pickedEffort(choice, parent, sameModel(choice, parent), undefined)),
    };
  } else {
    const id = request.profileId ?? CONVERSATION_PROFILE_ID;
    const found = named(id);
    if (!found) throw invalidParams(`profileId: expected ${[...new Set([CONVERSATION_PROFILE_ID, ...profiles.map(p => p.id)])].join(', ')}`);
    route = found;
  }
  if (request.effort !== undefined) {
    const provider = core.providers.require(route.providerId);
    if (route.model === null) throw invalidParams('effort: this route runs on the provider\'s default model; name a model with --model to choose its reasoning');
    const effort = checkEffort(provider, route.accountId, route.model, request.effort);
    if (!choices) checkAliasEffortAllowed(config, route, selectionFor(provider, route.accountId, route.model)?.alias?.effort, effort);
    route = { ...route, effort };
  }
  if (choices) checkModelAllowed(config, parent, route, choices);
  if (request.speed === undefined) return { ...route, speed: null };
  if (route.model === null) throw invalidParams(SPEED_NEEDS_MODEL);
  const provider = core.providers.require(route.providerId);
  const listed = selectionFor(provider, route.accountId, route.model)?.model.speeds;
  const speed = matchSpeed(listed, request.speed);
  if (speed !== null) return { ...route, speed };
  // A spawn reads no agent. Tiers are unread only while an agent that owns its list has given none; anything else without tiers offers none.
  const unread = listed === undefined && PROBED_PROTOCOLS.includes(provider.protocol) && probedModelsOf(provider.protocol, provider.id, route.accountId) === null;
  // Unread tiers are unknown, not empty: no `expected` list then.
  throw refused(speedRefusal(`${route.providerId}/${route.model}`, unread ? null : listed ?? [], request.speed), unread ? { field: 'speed' } : { field: 'speed', expected: (listed ?? []).map(option => option.id) });
}
