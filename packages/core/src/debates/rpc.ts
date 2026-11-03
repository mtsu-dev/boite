/** The debate methods (`docs/debates.md`). Who may call which is in `access.ts`; each refuses while the `debates` experiment is off. */
import type { Core } from '../core.ts';
import { invalidParams } from '../errors.ts';
import type { ProviderProbe } from '../providers/probe.ts';

export function registerDebates(core: Core, probe: ProviderProbe): void {
  const object = <T>(params: T | undefined | null): T => {
    if (params === null || typeof params !== 'object') throw invalidParams('params: expected an object');
    return params;
  };
  core.router.register('debates.start', async params => {
    core.debates.gate();
    const body = object(params);
    const models = Array.isArray(body.models) ? body.models.filter((model): model is string => typeof model === 'string') : [];
    // The model lists of every provider named are read first, as `delegate spawn` does.
    await core.delegation.prepareRoutes(body.threadId, probe, [...models, typeof body.summary === 'string' ? body.summary : undefined]);
    return core.debates.start(body);
  });
  core.router.register('debates.list', params => core.debates.list(object(params ?? {})));
  core.router.register('debates.get', params => core.debates.get(object(params)));
  core.router.register('debates.post', params => core.debates.post(object(params)));
  core.router.register('debates.next', params => core.debates.next(object(params)));
  core.router.register('debates.conclude', params => core.debates.conclude(object(params)));
  core.router.register('debates.stop', (params, ctx) => core.debates.stop(object(params), ctx.connection.identity.principal));
}
