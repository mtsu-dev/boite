/** The council methods (`docs/council.md`). Who may call which is in `access.ts`; each refuses while the experiment is off. */
import { COUNCIL_DEFAULT_EFFORT, COUNCIL_DEFAULT_MODELS } from '@boite/contracts';
import type { Core } from '../core.ts';
import { accountFor, catalog, providersNamed } from '../delegation/routes.ts';
import { invalidParams } from '../errors.ts';
import type { ProviderProbe } from '../providers/probe.ts';
import { needsModelDiscovery, PROBED_PROTOCOLS } from '../threads/selection.ts';

/**
 * What the members' checks read, before they run. As `delegate spawn` does, the
 * lists of the providers named. A route naming its provider and missing from the
 * list may only be missing from one an earlier core saved, which stands until a
 * fresh read settles. ACP writes a model's effort scale only once a session is
 * on it. A read that fails is left to the member's own check, which says why.
 */
async function prepareMembers(core: Core, probe: ProviderProbe, threadId: string, models: string[]): Promise<void> {
  await core.delegation.prepareRoutes(threadId, probe, models);
  const parent = core.threads.require(threadId);
  await Promise.allSettled(models.map(async model => {
    const providerId = providersNamed(core, model)?.[0];
    const account = providerId === undefined ? undefined : accountFor(core, parent, providerId);
    if (account !== undefined && PROBED_PROTOCOLS.includes(core.providers.require(account.providerId).protocol)
      && !catalog(core, parent, true).choices.some(choice => `${choice.providerId}/${choice.model}` === model)) {
      await probe({ providerId: account.providerId, accountId: account.id, refresh: true });
    }
    const route = core.delegation.resolve(parent.id, { profileId: null, model });
    const provider = core.providers.require(route.providerId);
    if (provider.protocol === 'acp' && route.model !== null && needsModelDiscovery(provider, route.accountId, route.model, COUNCIL_DEFAULT_EFFORT, null)) {
      await probe({ providerId: route.providerId, accountId: route.accountId, model: route.model });
    }
  }));
}

export function registerCouncil(core: Core, probe: ProviderProbe): void {
  const object = <T>(params: T | undefined | null): T => {
    if (params === null || typeof params !== 'object') throw invalidParams('params: expected an object');
    return params;
  };
  core.router.register('council.start', async params => {
    core.council.gate();
    const body = object(params);
    const models = Array.isArray(body.models) ? body.models.filter((model): model is string => typeof model === 'string') : [...COUNCIL_DEFAULT_MODELS];
    await prepareMembers(core, probe, body.threadId, models);
    return core.council.start(body);
  });
  core.router.register('council.again', (params, ctx) => core.council.again(object(params), ctx.connection.identity.principal));
  core.router.register('council.list', params => core.council.list(object(params ?? {})));
  core.router.register('council.get', params => core.council.get(object(params)));
  core.router.register('council.table', (params, ctx) => core.council.table(object(params), ctx.connection.identity.principal));
  core.router.register('council.post', params => core.council.post(object(params)));
  core.router.register('council.closeRound', params => core.council.closeRound(object(params)));
  core.router.register('council.stop', (params, ctx) => core.council.stop(object(params), ctx.connection.identity.principal));
}
