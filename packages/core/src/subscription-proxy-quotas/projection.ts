import type { AccountQuota, GatewayQuotaEntry, GatewayQuotaProvider, SubscriptionProxyQuotas } from '@boite/contracts';

function accountQuota(state: SubscriptionProxyQuotas, provider: GatewayQuotaProvider, entry: GatewayQuotaEntry): AccountQuota {
  const gatewayFailed = state.status === 'unavailable';
  const accountFailed = entry.status === 'error';
  const error = gatewayFailed ? state.error : entry.error ?? (accountFailed ? entry.statusReason ?? null : null);
  return {
    accountId: `proxy:${provider.providerId}:${entry.id}`,
    providerId: provider.providerId, providerName: provider.name, label: entry.label, enabled: true,
    status: gatewayFailed || accountFailed || error !== null ? 'unavailable' : 'ready',
    windows: entry.windows, checkedAt: entry.updatedAt ?? state.checkedAt,
    error,
    gateway: {
      kind: 'douane', entryId: entry.id, display: provider.display, plan: entry.plan, accounts: entry.accounts, status: entry.status,
      credits: entry.credits,
      ...(entry.statusReason !== undefined ? { statusReason: entry.statusReason } : {}),
      ...(entry.retryAt !== undefined ? { retryAt: entry.retryAt } : {}),
    },
  };
}

export function gatewayQuotaRows(state: SubscriptionProxyQuotas): AccountQuota[] {
  return state.providers.flatMap((provider) => provider.entries.map((entry) => accountQuota(state, provider, entry)));
}
