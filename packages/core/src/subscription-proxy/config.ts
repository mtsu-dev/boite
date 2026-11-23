import { subscriptionProxyOf, type ProviderDescriptor, type SubscriptionProxy } from '@boite/contracts';
import type { Core } from '../core.ts';

export const PROXY_KEY_ENV = 'BOITE_SUBSCRIPTION_PROXY_KEY';
/** Prefix of an OpenCode provider injected by the core. */
export const PROXY_PREFIX_ENV = 'BOITE_SUBSCRIPTION_PROXY_PREFIX';

export function activeSubscriptionProxy(core: Core, provider: ProviderDescriptor): SubscriptionProxy | null {
  return subscriptionProxyOf(core.settings.get(), provider, core.quotas?.gateway.state());
}

export function proxyApiUrl(proxy: SubscriptionProxy): string {
  return `${proxy.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/v1`;
}
