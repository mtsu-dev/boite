import type { SubscriptionProxy, SubscriptionProxyQuotas } from '@boite/contracts';
import { proxyApiUrl } from '../subscription-proxy.ts';
import { PROXY_AUTH_ERROR } from '../subscription-proxy-auth.ts';
import { boundedJson, object, parseGatewayQuotas } from './decode.ts';

/**
 * `null` means the route does not exist: an older Douane answers 404.
 * `refresh` marks a read the user asked for: Douane reads every account first
 * and reports a failure at once instead of after several in a row.
 */
export async function fetchGatewayQuotas(proxy: SubscriptionProxy, key: string, names: (providerId: string) => string | null, max: number, refresh: boolean): Promise<Pick<SubscriptionProxyQuotas, 'providers' | 'updatedAt' | 'nativeMuse'> | null> {
  let response: Response;
  try {
    response = await fetch(`${proxyApiUrl(proxy)}/quotas${refresh ? '?refresh=1' : ''}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
  } catch { throw new Error('Douane quotas could not reach the configured API URL.'); }
  // Never the raw body: a gateway's error page can echo a credential.
  if (response.status === 404) { await response.body?.cancel().catch(() => {}); return null; }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(response.status === 401 ? PROXY_AUTH_ERROR : `Douane quotas returned HTTP ${response.status}.`); }
  const quotas = parseGatewayQuotas(await boundedJson(response, max), names);
  if (quotas.providers.some(pool => pool.providerId === 'meta' && pool.entries.some(entry => entry.status !== 'disabled'))) {
    return { ...quotas, nativeMuse: await nativeMuseRoutes(proxy, key, max) };
  }
  return quotas;
}

/** Older Douane versions report Meta quotas without serving the native CLI routes. Never POST a probe. */
async function nativeMuseRoutes(proxy: SubscriptionProxy, key: string, max: number): Promise<boolean> {
  const base = proxyApiUrl(proxy).replace(/\/v1$/, '/muse-code');
  const options = { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' as const };
  try {
    const catalog = await fetch(`${base}/models`, options);
    if (!catalog.ok) { await catalog.body?.cancel().catch(() => {}); return false; }
    const root = object(await boundedJson(catalog, max));
    if (!Array.isArray(root?.['data']) || !root['data'].some(value => {
      const row = object(value);
      const metadata = object(row?.['metadata']);
      const muse = object(metadata?.['muse-code']);
      return typeof row?.['id'] === 'string' && row['id'].length > 0 && typeof muse?.['name'] === 'string';
    })) return false;
    const responses = await fetch(`${base}/responses`, { ...options, method: 'OPTIONS', signal: AbortSignal.timeout(15_000) });
    await responses.body?.cancel().catch(() => {});
    return (responses.ok || responses.status === 405) && (responses.headers.get('allow') ?? '').split(',').some(method => method.trim().toUpperCase() === 'POST');
  } catch { return false; }
}
