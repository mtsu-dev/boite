import { resolveModelSelection } from '@boite/contracts';
import type { AccountId, AgentProfile, AgentSelection, ModelInfo, Protocol, ProviderDescriptor, Thread } from '@boite/contracts';
import type { Core } from '../core.ts';
import { antigravityVariant } from '../drivers/acp/antigravity-catalog.ts';
import { isAntigravity } from '../drivers/antigravity.ts';
import { probedModelsOf } from '../drivers/index.ts';
import { refused } from '../errors.ts';
import { readSavedCatalog } from '../providers/saved-catalogs.ts';

/** The protocols whose models come from the agent, not from the descriptor. */
export const PROBED_PROTOCOLS: readonly Protocol[] = ['claude-sdk', 'acp', 'codex-appserver', 'muse', 'pi'];

/**
 * The provider a persistent agent runs on. A profile saved on a provider this
 * Boite does not have, one retired since (`providers/retired.ts`) or a user
 * descriptor removed, still loads; whatever would start it refuses here and
 * asks for another model, which `agents.profile.save` checks as any choice.
 */
export function agentProvider(core: Core, agent: Pick<AgentProfile, 'name' | 'selection'>): ProviderDescriptor {
  const provider = core.providers.get(agent.selection.providerId);
  if (provider !== undefined) return provider;
  throw refused(`selection.providerId: ${agent.name} runs on ${agent.selection.providerId}, which is not installed here; choose another model for this mochi`, {
    field: 'selection.providerId', providerId: agent.selection.providerId, expected: 'an installed provider',
  });
}

/**
 * What this account may run: the descriptor's models, plus the ones the last
 * probe read from the agent for a provider that owns its own list. Nothing is
 * probed here; a model the agent could list but nobody asked for is not offered
 * yet.
 */
export function modelsFor(provider: ProviderDescriptor, accountId: AccountId): ModelInfo[] {
  const probed = probedModelsOf(provider.protocol, provider.id, accountId);
  if (probed === null) return provider.models;
  const known = new Set(probed.map((model) => model.id));
  return [...probed, ...provider.models.filter((model) => !known.has(model.id))];
}

export function selectionFor(provider: ProviderDescriptor, accountId: AccountId, model: string | null, effort?: string | null) {
  return resolveModelSelection(modelsFor(provider, accountId), model, effort);
}

/** Image admission also uses pi's saved list before the first probe after a restart. */
export function imageInputModel(core: Core, provider: ProviderDescriptor, { accountId, model }: Pick<Thread, 'accountId' | 'model'>): ModelInfo | undefined {
  if (!model || !provider.capabilities.images) return undefined;
  if (provider.protocol === 'pi' && probedModelsOf(provider.protocol, provider.id, accountId) === null) {
    const saved = readSavedCatalog(core, provider.id, accountId);
    const selected = saved && resolveModelSelection(saved.models, model);
    if (selected) return selected.model;
  }
  return selectionFor(provider, accountId, model)?.model;
}

/**
 * Whether `models` offers `model`: listed, aliased, or for Antigravity a pre-1.4
 * leveled id of a listed base family when its catalog carries no explicit alias yet.
 */
export function listsModel(provider: ProviderDescriptor, models: readonly ModelInfo[], model: string): boolean {
  if (resolveModelSelection(models, model) !== undefined) return true;
  if (!isAntigravity(provider)) return false;
  const variant = antigravityVariant(model);
  if (variant === undefined) return false;
  const family = models.find(entry => entry.id === variant.family);
  return family !== undefined && (family.effort === undefined || family.effort.levels.some(level => level.id === variant.effort));
}

/** Read missing native metadata before validating a new choice, including ACP's per-model scale. */
export function needsModelDiscovery(
  provider: ProviderDescriptor, accountId: AccountId, model: string | null, effort: string | null, speed: string | null,
): boolean {
  if (model === null || !PROBED_PROTOCOLS.includes(provider.protocol)) return false;
  const listed = selectionFor(provider, accountId, model)?.model;
  const missingEffort = effort !== null && listed?.effort === undefined;
  if (provider.protocol === 'acp' && missingEffort) return true;
  return probedModelsOf(provider.protocol, provider.id, accountId) === null &&
    (listed === undefined || missingEffort || (speed !== null && listed.speeds === undefined));
}

/**
 * Null is always allowed and means the provider's own default. Anything else
 * must be a model the descriptor lists or one the last probe read.
 */
export function checkModel(provider: ProviderDescriptor, accountId: AccountId, model: string | null): string | null {
  if (model === null) return null;
  const models = modelsFor(provider, accountId);
  const resolved = resolveModelSelection(models, model);
  if (resolved) return resolved.model.id;
  if (listsModel(provider, models, model)) return model;
  throw refused(
    PROBED_PROTOCOLS.includes(provider.protocol) && probedModelsOf(provider.protocol, provider.id, accountId) === null
      ? 'the agent has not listed this model: open the model picker so Boite reads its models first'
      : 'the provider does not offer this model',
    { providerId: provider.id, accountId, model, expected: models.map((entry) => entry.id) },
  );
}

/**
 * Null is always allowed and means the model's own default. Anything else must
 * be one of the levels that model lists, from the descriptor or from the probe,
 * or the call is refused.
 */
export function checkEffort(
  provider: ProviderDescriptor,
  accountId: AccountId,
  model: string | null,
  effort: string | null,
): string | null {
  if (effort === null) return null;
  const levels = selectionFor(provider, accountId, model)?.model?.effort?.levels ?? [];
  if (levels.some((level) => level.id === effort)) return effort;
  throw refused('the model does not offer this reasoning effort', {
    providerId: provider.id,
    model,
    effort,
    expected: levels.length === 0 ? 'null: this model has no effort levels' : levels.map((level) => level.id),
  });
}

/** Validate and store the resolved model and the effort represented by an old ID. */
export function checkSelection(provider: ProviderDescriptor, accountId: AccountId, model: string | null, effort: string | null, speed: string | null) {
  const id = checkModel(provider, accountId, model);
  const resolved = selectionFor(provider, accountId, model, effort);
  return { model: id, effort: checkEffort(provider, accountId, id, resolved?.effort ?? effort), speed: checkSpeed(provider, accountId, id, speed) };
}

/** Keep an approved choice through catalog changes; new models and effort still need validation. */
export function checkSavedSelection(
  provider: ProviderDescriptor,
  accountId: AccountId,
  value: Pick<AgentSelection, 'model' | 'effort'>,
  previous?: Pick<AgentSelection, 'providerId' | 'accountId' | 'model' | 'effort'>,
): void {
  const kept = previous?.providerId === provider.id && previous.accountId === accountId && previous.model === value.model;
  if (!kept) checkModel(provider, accountId, value.model);
  if (!kept || previous.effort !== value.effort) checkEffort(provider, accountId, value.model, value.effort);
}

/**
 * The effort a thread already carries was checked when it was chosen. A probed
 * scale lives in memory, so after a core restart it may not be read yet: only a
 * scale that is known and lacks the level refuses the turn.
 */
export function checkStoredEffort(
  provider: ProviderDescriptor,
  accountId: AccountId,
  model: string | null,
  effort: string | null,
): void {
  if (effort === null) return;
  const known = selectionFor(provider, accountId, model)?.model?.effort;
  if (known === undefined) return;
  checkEffort(provider, accountId, model, effort);
}

export function defaultModel(provider: ProviderDescriptor): string | null {
  const preferred = provider.models.find((model) => model.default === true);
  if (preferred !== undefined) return preferred.id;
  return provider.models[0]?.id ?? null;
}

/**
 * The model a bot takes when its route names none: the descriptor's default,
 * else the account's listed default or first model. Claude's descriptor lists
 * none, so until its agent has listed them (`modelsFor`) there is no default
 * and the caller reads them first (`BuiltinBots`).
 */
export function botDefaultModel(provider: ProviderDescriptor, accountId: AccountId): string | null {
  const listed = modelsFor(provider, accountId);
  return defaultModel(provider) ?? listed.find(model => model.default === true)?.id ?? listed[0]?.id ?? null;
}

export function checkSpeed(provider: ProviderDescriptor, accountId: string, model: string | null, speed: string | null): string | null {
  if (speed === null) return null;
  const options = selectionFor(provider, accountId, model)?.model?.speeds ?? [];
  if (options.some(option => option.id === speed)) return speed;
  throw refused('the model does not offer this speed', { providerId: provider.id, model, speed, expected: options.map(option => option.id) });
}

/** Like stored effort, a validated speed survives the loss of the in-memory catalog. */
export function checkStoredSpeed(provider: ProviderDescriptor, accountId: AccountId, model: string | null, speed: string | null): void {
  if (speed === null || selectionFor(provider, accountId, model)?.model?.speeds === undefined) return;
  checkSpeed(provider, accountId, model, speed);
}
