import { providerOffFailure } from '../policy.ts';
import type { AccountId, ModelInfo, ProviderId, RpcEvents, RpcParams, RpcResult, ThreadId } from '@boite/contracts';
import type { Core } from '../core.ts';
import { forgetProbes, holdModels, probedModelsOf, probeModels, readModelsOf, refreshProbes, rememberExternalModels, settleRefresh } from '../drivers/index.ts';
import { launchTemp, type LaunchTemp } from '../drivers/launch-temp.ts';
import { publicModel } from '../drivers/model-capabilities.ts';
import { mergeProxyModels, readSubscriptionProxyModels, savedRowOffered } from '../subscription-proxy.ts';
import { invalidParams, refused } from '../errors.ts';
import { logMessageOf } from '../log-errors.ts';
import { forgetSavedCatalog, readLegacyNativeList, readNativeList, readSavedCatalog, saveCatalog, saveNativeList } from './saved-catalogs.ts';

/** The synthetic thread a probe process runs under, so the trace shows it like a login. */
export function probeThreadId(providerId: ProviderId, accountId: AccountId): ThreadId {
  return `probe:${providerId}:${accountId}`;
}

/**
 * Claude, ACP, Codex and pi list models through one temporary process.
 * Echo uses its descriptor. The probe's empty working directory
 * keeps project instructions and the core's journal outside that session.
 *
 * The caller is answered as soon as the models are read. Stopping the process
 * and removing its directory, up to a second more for Claude, land in
 * `cleanups`: the account's next probe waits for them, the picker does not.
 */
async function probeProvider(
  core: Core,
  providerId: ProviderId,
  accountId: AccountId,
  isCurrent: () => boolean,
  cleanups: Promise<void>[],
  natives: Map<string, ModelInfo[]>,
  model?: string,
): Promise<{ result: RpcResult<'providers.probe'>; partial: boolean }> {
  const provider = core.providers.require(providerId);
  const account = core.accounts.require(accountId);
  if (account.providerId !== provider.id) {
    throw refused('the account belongs to another provider', {
      accountId,
      accountProviderId: account.providerId,
      providerId: provider.id,
    });
  }
  // The probe starts the agent: a provider turned off lists nothing.
  if (!core.providers.enabled(provider.id)) {
    throw providerOffFailure(provider.name, core.providers.policyBlock(provider.id), { providerId: provider.id });
  }

  const proxyModels = await readSubscriptionProxyModels(core, provider);
  if (proxyModels !== null) return probeThroughGateway(core, provider, accountId, isCurrent, cleanups, natives, proxyModels, model);
  try {
    const native = await probeNative(core, provider, account.id, cleanups, model);
    const { probedAt } = native;
    const models = native.models.map(publicModel);
    core.accounts.require(account.id);
    if (!isCurrent()) throw refused('the provider or account changed during discovery; refresh models');
    core.bus.emit('providers.probed', { providerId: provider.id, accountId: account.id, models, probedAt });
    return { result: { models, probedAt }, partial: false };
  } catch (error) {
    core.logs.record('warn', logMessageOf(error), { source: provider.id, event: 'provider.probeFailed', threadId: probeThreadId(provider.id, account.id) });
    throw error;
  }
}

/** Keep the native reading with its provenance, scoped to the account and gateway. */
async function probeThroughGateway(
  core: Core, provider: ReturnType<Core['providers']['require']>, accountId: AccountId,
  isCurrent: () => boolean, cleanups: Promise<void>[], natives: Map<string, ModelInfo[]>, proxyModels: ModelInfo[], model?: string,
): Promise<{ result: RpcResult<'providers.probe'>; partial: boolean }> {
  const lane = JSON.stringify([provider.id, accountId]);
  let native: ModelInfo[] | null = null;
  try { native = (await probeNative(core, provider, accountId, cleanups, model)).models; }
  catch (error) { core.logs.record('warn', logMessageOf(error), { source: provider.id, event: 'provider.probeFailed', threadId: probeThreadId(provider.id, accountId) }); }
  if (!isCurrent()) throw refused('the subscription proxy changed during discovery; refresh models');
  if (native !== null && model === undefined) {
    natives.set(lane, native);
    try { saveNativeList(core, provider.id, accountId, native); }
    catch (error) { core.log('warn', `saving the ${provider.id} agent list: ${logMessageOf(error)}`); }
  }
  const kept = native ?? natives.get(lane) ?? readNativeList(core, provider.id, accountId) ?? readLegacyNativeList(core, provider.id, accountId);
  const models = mergeProxyModels(kept ?? [], proxyModels, provider.protocol);
  const probedAt = Date.now();
  rememberExternalModels(provider.protocol, provider.id, accountId, models);
  core.bus.emit('providers.probed', { providerId: provider.id, accountId, models, probedAt });
  return { result: { models, probedAt }, partial: native === null };
}

/**
 * One temporary agent process lists its models; every path stops it and
 * removes its directory, in a cleanup pushed to `cleanups` rather than awaited.
 */
async function probeNative(
  core: Core,
  provider: ReturnType<Core['providers']['require']>,
  accountId: AccountId,
  cleanups: Promise<void>[],
  model?: string,
): Promise<{ models: ModelInfo[]; probedAt: number }> {
  const account = core.accounts.require(accountId);
  const threadId = probeThreadId(provider.id, account.id);
  const cleanupContext = { source: provider.id, event: 'provider.probeCleanup', threadId };
  const log = (message: string): void => core.log('warn', `probing ${provider.id}: ${message}`, cleanupContext);
  // The account owns the probe: removing it stops this process and waits for it.
  // A probe runs the same executable a turn would, so its children hold the same lease.
  const operation = core.accounts.operations.open(account.id, provider.id, threadId, log);
  let temp: LaunchTemp | null = null;
  try {
    temp = launchTemp(provider, account.isolationDir);
    const accountEnv = core.accounts.accountEnv(account, provider);
    const { models, probedAt } = await probeModels(provider.protocol, {
      provider,
      accountId: account.id,
      accountEnv: temp === null ? accountEnv : { ...accountEnv, ...temp.env },
      cwd: operation.scratch('boite-probe-'),
      catalogThread: core.drafts.catalogThread(provider.id, account.id)
        ?? core.threads.list({}).find(thread => thread.providerId === provider.id && thread.accountId === account.id && core.threads.focus.viewed(thread.id)),
      ...(model === undefined ? {} : { model }),
      spawnChild: operation.spawnChild,
      killTree: operation.killTree,
      letExit: operation.letExit,
      log: (level, message, context) => {
        core.log(level, message, { ...context, source: provider.id, event: 'provider.probe', threadId });
      },
    });
    return { models, probedAt };
  } finally {
    // A descendant can hold the directory after the direct child closed. Neither
    // waiting for it nor removing the directory may replace the models just read.
    cleanups.push(operation.close().then(() => temp?.dispose(log)));
  }
}

/** Past this age, a list served from the cache is read again in the background. */
export const STALE_CATALOG_MS = 6 * 60 * 60 * 1000;
/** After a read that failed, or reached the gateway without the agent, the next background read waits this long. */
export const RETRY_CATALOG_MS = 5 * 60 * 1000;

export type ProviderProbe = (params: RpcParams<'providers.probe'>) => Promise<RpcResult<'providers.probe'>>;

export function registerProbeMethods(core: Core): ProviderProbe {
  /** Bumped when the descriptors are re-read, which outdates every probe. */
  let revision = 0;
  let proxyConfig = JSON.stringify(core.settings.get().subscriptionProxy);
  /** Bumped per account: another account signing in says nothing about this one's models. */
  const accountRevisions = new Map<AccountId, number>();
  const accountRevision = (accountId: AccountId): number => accountRevisions.get(accountId) ?? 0;
  const bumpAccount = (accountId: AccountId): void => {
    accountRevisions.set(accountId, accountRevision(accountId) + 1);
  };
  const pending = new Map<string, Promise<RpcResult<'providers.probe'>>>();
  /** When each account's list was last read, for an answer served from the cache. Dropped with the catalog. */
  const answered = new Map<string, number>();
  /** When each account's list is next read in the background, by this core's clock: an agent's `probedAt` may be its own. */
  const nextReadAt = new Map<string, number>();
  /** The agent's own last list per account, kept for a gateway read the agent failed. */
  const natives = new Map<string, ModelInfo[]>();
  const forgetAnswered = (accountId?: AccountId): void => {
    for (const map of [answered, nextReadAt, natives]) {
      for (const lane of map.keys()) if (accountId === undefined || (JSON.parse(lane) as string[])[1] === accountId) map.delete(lane);
    }
  };
  /** The last probe of each provider and account, settled or not: the next one waits for it. */
  const lanes = new Map<string, Promise<void>>();

  function cachedCatalog(providerId: ProviderId, accountId: AccountId, lane: string): RpcResult<'providers.probe'> | null {
    const provider = core.providers.require(providerId);
    const known = answered.get(lane);
    if (known !== undefined) {
      const models = probedModelsOf(provider.protocol, providerId, accountId);
      return models === null ? null : { models: models.map(publicModel), probedAt: known };
    }
    // A list from sign-in or from a turn takes precedence over the saved one.
    if (!core.providers.enabled(providerId) || readModelsOf(provider.protocol, providerId, accountId) !== null) return null;
    const saved = readSavedCatalog(core, providerId, accountId);
    if (saved === null) return null;
    const models = saved.models.filter(row => savedRowOffered(core, provider, row.id));
    // Validation accepts the advertised list while a fresh read is in flight.
    holdModels(providerId, accountId, models);
    return { ...saved, models };
  }

  const probe: ProviderProbe = (params) => {
    const { providerId, accountId, model, refresh } = params;
    if (model !== undefined && (typeof model !== 'string' || model.length === 0)) {
      throw invalidParams('model must be a non-empty string when given', { field: 'model', expected: 'a non-empty string' });
    }
    const lane = JSON.stringify([providerId, accountId]);
    const key = JSON.stringify([providerId, accountId, model ?? null, refresh === true]);
    if (!refresh && model === undefined) {
      const cached = cachedCatalog(providerId, accountId, lane);
      if (cached !== null) {
        // A stale list answers immediately while one background refresh reads the new one.
        const refreshKey = JSON.stringify([providerId, accountId, null, true]);
        if (Date.now() >= (nextReadAt.get(lane) ?? 0) && !pending.has(refreshKey)) {
          void probe({ providerId, accountId, refresh: true }).catch(() => undefined);
        }
        return Promise.resolve(cached);
      }
    }
    const existing = pending.get(key);
    if (existing) return existing;
    // One probe at a time per account: they share a synthetic thread, so the
    // `killTree` that ends one would take a second one's process with it, and a
    // refresh would drop the cache entry the other is still filling. The lane
    // holds until the process has exited; the caller is answered before that.
    const before = lanes.get(lane) ?? Promise.resolve();
    const cleanups: Promise<void>[] = [];
    const request = before.then(async () => {
      // Meta discovery can connect Muse and invalidate its old account catalog.
      // Settle that change before recording the revision this probe belongs to.
      if (params.providerId === 'muse') await core.quotas.gateway.read();
      const protocol = core.providers.require(params.providerId).protocol;
      if (params.refresh) refreshProbes(protocol, params.providerId, params.accountId);
      const startedAtRevision = revision;
      const startedAtAccount = accountRevision(params.accountId);
      const isCurrent = () => revision === startedAtRevision && accountRevision(params.accountId) === startedAtAccount;
      const read = probeProvider(core, params.providerId, params.accountId, isCurrent, cleanups, natives, params.model);
      if (params.model === undefined) {
        void read.then(({ result, partial }) => {
          if (!isCurrent()) return;
          answered.set(lane, result.probedAt);
          nextReadAt.set(lane, Date.now() + (partial ? RETRY_CATALOG_MS : STALE_CATALOG_MS));
        }, () => { if (isCurrent()) nextReadAt.set(lane, Date.now() + RETRY_CATALOG_MS); });
      }
      const answer = read.then(({ result }) => result);
      if (params.refresh) void answer.then(() => settleRefresh(params.providerId, params.accountId), () => undefined);
      return answer;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    const settled = request.then(() => undefined, () => undefined).then(() => Promise.all(cleanups)).then(() => undefined, () => undefined);
    lanes.set(lane, settled);
    void settled.then(() => {
      if (lanes.get(lane) === settled) lanes.delete(lane);
    });
    return request;
  };
  core.router.register('providers.probe', probe);

  core.bus.onAny((name, payload) => {
    if (name === 'providers.probed') {
      const { providerId, accountId, models, probedAt } = payload as RpcEvents['providers.probed'];
      // A failed write costs the next start its instant list, never this answer.
      try { saveCatalog(core, providerId, accountId, { models, probedAt }, true); }
      catch (error) { core.log('warn', `saving the ${providerId} model list: ${logMessageOf(error)}`); }
      return;
    }
    if (name === 'settings.updated') {
      const nextProxy = JSON.stringify((payload as RpcEvents['settings.updated']).subscriptionProxy);
      if (nextProxy === proxyConfig) return;
      proxyConfig = nextProxy;
      revision++;
      forgetProbes();
      forgetAnswered();
      return;
    }
    // The descriptors were re-read, so what an agent listed under the old ones
    // says nothing about the new ones.
    if (name === 'providers.updated') {
      revision++;
      forgetProbes();
      forgetAnswered();
      return;
    }
    // An account whose login or isolation changed may list other models.
    if (name === 'accounts.updated') {
      const account = payload as RpcEvents['accounts.updated'];
      bumpAccount(account.id);
      forgetProbes({ providerId: account.providerId, accountId: account.id });
      forgetAnswered(account.id);
      // A sign-in can reach another account under the same identity, or none
      // the core can read: only a list read after it stands for the next start.
      forgetSavedCatalog(core, account.id);
      return;
    }
    if (name === 'accounts.removed') {
      const { accountId } = payload as RpcEvents['accounts.removed'];
      bumpAccount(accountId);
      forgetProbes({ accountId });
      forgetAnswered(accountId);
      forgetSavedCatalog(core, accountId);
    }
  });
  return probe;
}
