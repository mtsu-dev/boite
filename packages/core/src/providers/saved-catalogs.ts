/**
 * The last list each account's agent answered, kept in the journal so it
 * outlives a restart. Reading it again starts the agent: Antigravity unpacks
 * itself first, 12.3 s on a desktop (2026-10-22) and 45 to 54 s on a laptop,
 * and OpenCode 2 took 3 to 5 s on the server. A picker that has no list yet is
 * answered from here while a fresh read runs behind it.
 */
import { createHash } from 'node:crypto';
import type { AccountId, ModelInfo, ProviderId } from '@boite/contracts';
import type { Core } from '../core.ts';
import { activeSubscriptionProxy, mergeProxyModels } from '../subscription-proxy.ts';

import { antigravityCatalog } from '../drivers/acp/antigravity-catalog.ts';
import { isAntigravity } from '../drivers/antigravity.ts';
import { agentEnv as piLaunchEnv, configuredAgentDir } from '../drivers/pi/mapping.ts';

const PREFIX = 'model-catalog:';

export interface SavedCatalog {
  models: ModelInfo[];
  probedAt: number;
}

interface Stored extends SavedCatalog {
  /** What the list was read under, see `contextOf`. */
  context: string;
  /** Gateway rows in this format can advertise speeds themselves. */
  capabilityCatalog?: true;
}

const keyOf = (providerId: ProviderId, accountId: AccountId): string => `${PREFIX}${JSON.stringify([providerId, accountId])}`;

/**
 * What an agent's list depends on: its descriptor, the program that answers,
 * the gateway it goes through, the login and, for pi, the configuration folder
 * the driver starts it on (the core's own environment may name it, so a restart
 * can change it). Hashed, since the gateway settings name an address. Null when
 * the provider or the account is gone.
 */
function contextOf(core: Core, providerId: ProviderId, accountId: AccountId): string | null {
  const provider = core.providers.get(providerId);
  const account = core.journal.getAccount(accountId);
  if (provider === undefined || account === null || account.providerId !== providerId) return null;
  const executable = core.providers.list().loaded.find(summary => summary.id === providerId)?.executable ?? null;
  const login = { status: account.status, identity: account.identity, isolationDir: account.isolationDir };
  const piFolder = provider.protocol === 'pi' ? configuredAgentDir(piLaunchEnv(core.accounts.profileEnv(account, provider))) : null;
  return createHash('sha256')
    .update(JSON.stringify([provider, executable, activeSubscriptionProxy(core, provider), login, piFolder]))
    .digest('base64url');
}

/** The saved list when it was read under what stands now, else null. */
export function readSavedCatalog(core: Core, providerId: ProviderId, accountId: AccountId): SavedCatalog | null {
  // A row that does not parse costs the instant list, never the probe.
  let stored: Partial<Stored> | null | undefined;
  try { stored = core.journal.getSetting(keyOf(providerId, accountId)) as Partial<Stored> | null | undefined; }
  catch { return null; }
  if (stored === null || typeof stored !== 'object' || !Array.isArray(stored.models) || !Number.isFinite(stored.probedAt)) return null;
  if (stored.context !== contextOf(core, providerId, accountId)) return null;
  const provider = core.providers.require(providerId);
  const models = isAntigravity(provider) ? antigravityCatalog(stored.models)
    : provider.protocol === 'claude-sdk' ? mergeProxyModels([], stored.models, 'claude-sdk') : stored.models;
  return { models, probedAt: stored.probedAt as number };
}

export function saveCatalog(core: Core, providerId: ProviderId, accountId: AccountId, catalog: SavedCatalog, capabilityCatalog?: true): void {
  const context = contextOf(core, providerId, accountId);
  if (context === null) return;
  // Written on every read, so the list a restart answers carries when it was read.
  core.journal.setSetting(keyOf(providerId, accountId), { context, models: catalog.models, probedAt: catalog.probedAt, capabilityCatalog } satisfies Stored);
}

/** Old gateways never advertised tiers, so these rows came from the native probe. */
export function readLegacyNativeList(core: Core, providerId: ProviderId, accountId: AccountId): ModelInfo[] | undefined {
  let stored: Partial<Stored> | null | undefined;
  try { stored = core.journal.getSetting(keyOf(providerId, accountId)) as Partial<Stored> | null | undefined; }
  catch { return undefined; }
  if (stored?.capabilityCatalog) return undefined;
  return readSavedCatalog(core, providerId, accountId)?.models.filter(row => (row.speeds?.length ?? 0) > 0);
}

export function forgetSavedCatalog(core: Core, accountId: AccountId): void {
  core.journal.db.query('DELETE FROM settings WHERE key GLOB ?').run(`${PREFIX}*${JSON.stringify(accountId)}]`);
}

/**
 * The agent's own part of a list read through a gateway, kept apart from the
 * gateway rows: when the agent fails behind a gateway that answers, this part
 * still describes its models, speed tiers included, after a restart.
 */
const nativeKeyOf = (providerId: ProviderId, accountId: AccountId): string => `${PREFIX}native:${JSON.stringify([providerId, accountId])}`;

export function saveNativeList(core: Core, providerId: ProviderId, accountId: AccountId, models: ModelInfo[]): void {
  const context = contextOf(core, providerId, accountId);
  if (context === null) return;
  core.journal.setSetting(nativeKeyOf(providerId, accountId), { context, models, probedAt: Date.now() } satisfies Stored);
}

export function readNativeList(core: Core, providerId: ProviderId, accountId: AccountId): ModelInfo[] | null {
  let stored: Partial<Stored> | null | undefined;
  try { stored = core.journal.getSetting(nativeKeyOf(providerId, accountId)) as Partial<Stored> | null | undefined; }
  catch { return null; }
  if (stored === null || typeof stored !== 'object' || !Array.isArray(stored.models)) return null;
  return stored.context === contextOf(core, providerId, accountId) ? stored.models : null;
}
