import type { AgentRuntimeConfig, AgentSelection } from '@boite/contracts';
import { secureId } from './secure-id';
import type { Store } from './store.svelte';

/** What a bot's routes are checked against: the providers and accounts this machine still has. */
export interface RouteCatalog {
  hasProvider: (providerId: string) => boolean;
  hasAccount: (accountId: string) => boolean;
  modelName: (route: AgentSelection) => string | undefined;
}

/** The catalog of the machine whose Store holds the bot. */
export function routeCatalog(store: Store): RouteCatalog {
  return {
    hasProvider: id => store.providerOf(id) !== null,
    hasAccount: id => store.accounts.some(account => account.id === id),
    modelName: route => store.modelOf(route)?.name
  };
}

/** The bot's default route points at a provider or an account this machine no longer has. */
export function routeGone(store: Store, route: Pick<AgentSelection, 'providerId' | 'accountId'>): boolean {
  return !store.providerOf(route.providerId) || !store.accounts.some(account => account.id === route.accountId);
}

/**
 * The bot's runtime with `patch` as its default route. The core refuses a
 * default outside the allowed list, so picking a new default allows it.
 * Replacing a missing provider or account also repairs its allowed route:
 * keeping that removed route would make the whole configuration fail
 * validation. Shared by the bot's settings and the problem banner's account
 * picker, which repairs the bot in place.
 */
export function withDefaultRoute(config: AgentRuntimeConfig, patch: Partial<AgentSelection>, catalog: RouteCatalog): AgentRuntimeConfig {
  const previous = config.defaultRoute;
  const d = { ...previous, ...patch };
  let allowedRoutes = config.allowedRoutes;
  const missing = !catalog.hasProvider(previous.providerId) || !catalog.hasAccount(previous.accountId);
  if (missing && d.model && (d.providerId !== previous.providerId || d.accountId !== previous.accountId)) {
    const model = d.model;
    allowedRoutes = allowedRoutes.map(route => {
      const replaced = route.providerId === previous.providerId && route.accountId === previous.accountId && route.model === previous.model;
      return replaced ? { ...route, ...d, model } : route;
    }).filter(route => catalog.hasProvider(route.providerId) && catalog.hasAccount(route.accountId));
  }
  if (d.model && !allowedRoutes.some(r => r.providerId === d.providerId && r.accountId === d.accountId && r.model === d.model)) {
    allowedRoutes = [...allowedRoutes, { id: secureId(), name: catalog.modelName(d) ?? d.model, providerId: d.providerId, accountId: d.accountId, model: d.model, effort: d.effort }];
  }
  return { ...config, defaultRoute: d, allowedRoutes };
}
