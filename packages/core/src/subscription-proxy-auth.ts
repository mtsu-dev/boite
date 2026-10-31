import type { SubscriptionProxy } from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams, unavailable } from './errors.ts';

const KEY_SETTING = 'subscription-proxy-key';
const pending = new WeakMap<Core, Promise<void>>();
export const PROXY_AUTH_ERROR = 'Douane requires a valid client API key (HTTP 401). Set it in the subscription proxy settings. In local mode, remove the saved key to let Boite create one.';

/** The gateway key stays out of settings snapshots, journal events and process arguments. */
export function proxyKey(core: Core): string {
  const key = core.journal.getSetting(KEY_SETTING);
  return typeof key === 'string' && key ? key : 'boite-subscription-proxy';
}

export function validateProxyKey(key: unknown): asserts key is string | null {
  if (key !== null && (typeof key !== 'string' || key.length > 4096 || !key.trim() || /[\u0000-\u0020\u007f]/.test(key))) {
    throw invalidParams('subscriptionProxy.key must be null or a non-empty token without whitespace');
  }
}

export function writeProxyKey(core: Core, key: string | null): void {
  if (key === null) core.journal.deleteSetting(KEY_SETTING);
  else core.journal.setSetting(KEY_SETTING, key);
}

/** Client setup failure leaves the dashboard running so the owner can supply a key. */
export async function prepareGatewayClient(core: Core, id: string, isCurrent: () => boolean): Promise<void> {
  if (id !== 'douane') return;
  try { await ensureLocalProxyKey(core, isCurrent); core.quotas.gateway.reset(); }
  catch { core.log('warn', 'Could not create the local Douane client key; set a client API key in the subscription proxy settings.'); }
}

/** Only the managed loopback plugin may create a client; a saved key is never replaced. */
export async function ensureLocalProxyKey(core: Core, isManaged = () => core.plugins.gateways.running('douane')): Promise<void> {
  const proxy = core.settings.get().subscriptionProxy;
  if (!proxy?.enabled || proxy.mode !== 'local' || proxy.kind !== 'douane' || !isManaged()) return;
  const before = core.journal.getSetting(KEY_SETTING);
  if (typeof before === 'string' && before && before !== 'boite-subscription-proxy') return;
  const running = pending.get(core);
  if (running) { await running; return ensureLocalProxyKey(core, isManaged); }
  const operation = createLocalClient(core, proxy, before, isManaged);
  pending.set(core, operation);
  try { await operation; } finally { if (pending.get(core) === operation) pending.delete(core); }
}

async function createLocalClient(core: Core, proxy: SubscriptionProxy, before: unknown, isManaged: () => boolean): Promise<void> {
  const origin = `http://127.0.0.1:${core.plugins.gateways.port('douane')}`;
  if (proxy.baseUrl !== `${origin}/v1`) throw unavailable('Local Douane must use the managed plugin API URL.');
  try {
    const response = await fetch(`${origin}/admin/api/clients`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Boite', access: { all: true } }),
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    // Older Douane versions do not have clients and accept the placeholder.
    if (response.status === 404) { await response.body?.cancel(); return; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    const body: unknown = await response.json();
    const key = body && typeof body === 'object' && 'key' in body ? body.key : undefined;
    validateProxyKey(key);
    if (key === null) throw new Error();
    // A form save, a key edit or a port change while the request ran wins.
    if (!isManaged() || JSON.stringify(core.settings.get().subscriptionProxy) !== JSON.stringify(proxy) || core.journal.getSetting(KEY_SETTING) !== before) return;
    writeProxyKey(core, key);
  } catch {
    // Neither Douane's body nor storage errors may echo the returned secret.
    throw unavailable('Could not create the local Douane client key. Set a client API key in the subscription proxy settings.');
  }
}
