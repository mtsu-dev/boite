import { subscriptionProxyOrigin, type SubscriptionProxy } from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams, refused, unavailable } from './errors.ts';
import { DOUANE_PLUGIN } from './plugins/gateway.ts';
import { localProxy } from './settings.ts';
import { proxyApiUrl } from './subscription-proxy.ts';

/**
 * Douane's management API (`/admin/api`), as the core calls it: moving logins
 * in (`gateway-move.ts`) and the usage order of its accounts
 * (`gateway-order.ts`). The management token is read here and sent in one
 * header; no answer, log or error of this module carries it.
 */

export const MANAGEMENT_TOKEN_SETTING = 'subscription-proxy-management-token';
const REQUEST_TIMEOUT_MS = 15_000;

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The Douane a management call talks to: the proxy's, or with `plugin` the Douane plugin running on this core. */
export function douaneOf(core: Core, target: unknown = 'proxy'): SubscriptionProxy | null {
  if (target !== 'proxy' && target !== 'plugin') throw invalidParams('target must be proxy, plugin or absent', { field: 'target', expected: 'proxy or plugin' });
  let proxy: SubscriptionProxy | null;
  if (target === 'plugin') {
    proxy = core.plugins.gateways.running(DOUANE_PLUGIN) ? localProxy({ enabled: false, kind: 'douane', baseUrl: '', dashboardUrl: '' }, core.plugins.gateways.port(DOUANE_PLUGIN)) : null;
  } else {
    const saved = core.settings.get().subscriptionProxy;
    proxy = saved && saved.kind === 'douane' && saved.baseUrl ? saved : null;
  }
  assertGateway(core, proxy);
  return proxy;
}

/** Check the resolved address, including disabled saved proxies and the plugin's local port. */
export function assertGateway(core: Core, proxy: SubscriptionProxy | null): void {
  const key = core.policy.gatewayBlock(proxy?.baseUrl);
  if (key !== null) throw core.policy.refusal(key, proxy?.baseUrl);
}

export function managementToken(core: Core): string | null {
  const token = core.journal.getSetting(MANAGEMENT_TOKEN_SETTING);
  return typeof token === 'string' && token ? token : null;
}

/** A gateway's sentence, bounded and without any of `secrets`: its answer cannot echo one back. */
export function scrub(message: string, secrets: readonly string[]): string {
  let text = message.slice(0, 300);
  for (const secret of secrets) text = text.split(secret).join('[hidden]');
  return text;
}

export interface GatewayCallOptions {
  /** GET without a body and POST with one, unless named. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** What a 404 says this address lacks. */
  feature?: string;
  /** A refusal (HTTP 400 and above) written as plain text comes back as `{ error }`, not as a silence. */
  plainErrors?: boolean;
}

/** One management call. A login page, a refusal or a silence becomes a sentence naming what to do. */
export async function gatewayCall(core: Core, proxy: SubscriptionProxy, token: string | null, path: string, body?: unknown, options: GatewayCallOptions = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  assertGateway(core, proxy);
  const origin = subscriptionProxyOrigin(proxy);
  const url = `${proxyApiUrl(proxy).replace(/\/v1$/, '')}/admin/api${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { 'x-management-key': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw unavailable(`Douane at ${origin} could not be reached`);
  }
  try { assertGateway(core, proxy); }
  catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  const type = response.headers.get('content-type') ?? '';
  if ((response.status >= 300 && response.status < 400) || /text\/html/i.test(type)) {
    await response.body?.cancel().catch(() => {});
    throw refused(`Douane at ${origin} answered with a sign-in page: its management API is behind a login. Enter its management token, or reach it at an address without that login`, { field: 'managementToken' });
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => {});
    throw refused(`Douane at ${origin} refused the management request (HTTP ${response.status}): ${token ? 'the management token is not the one it expects' : 'enter its management token'}`, { field: 'managementToken' });
  }
  if (response.status === 404 || response.status === 405) {
    await response.body?.cancel().catch(() => {});
    throw refused(`${origin} has no Douane ${options.feature ?? 'account import'} at /admin/api: check the API URL, or update Douane`, { field: 'subscriptionProxy.baseUrl' });
  }
  let json: Record<string, unknown> | null = null;
  try {
    const text = await response.text();
    try { json = record(JSON.parse(text)); }
    catch { if (options.plainErrors && response.status >= 400 && text.trim()) json = { error: text.trim() }; }
  } catch { /* answered below */ }
  assertGateway(core, proxy);
  if (json === null) throw unavailable(`Douane at ${origin} answered HTTP ${response.status} without JSON`);
  return { status: response.status, json };
}
