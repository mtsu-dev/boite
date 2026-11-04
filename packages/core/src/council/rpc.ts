/** The council methods (`docs/council.md`). Who may call which is in `access.ts`; each refuses while the experiment is off. */
import { COUNCIL_DEFAULT_MODELS } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams } from '../errors.ts';
import type { ProviderProbe } from '../providers/probe.ts';

export function registerCouncil(core: Core, probe: ProviderProbe): void {
  const object = <T>(params: T | undefined | null): T => {
    if (params === null || typeof params !== 'object') throw invalidParams('params: expected an object');
    return params;
  };
  core.router.register('council.start', async params => {
    core.council.gate();
    const body = object(params);
    const models = Array.isArray(body.models) ? body.models.filter((model): model is string => typeof model === 'string') : [...COUNCIL_DEFAULT_MODELS];
    // The model lists of every provider named are read first, as `delegate spawn` does.
    await core.delegation.prepareRoutes(body.threadId, probe, models);
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
