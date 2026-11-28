import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { type ProviderDescriptor, type SubscriptionProxy } from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams, refused, unavailable, RpcFailure } from './errors.ts';
import { isOpenCode } from './providers/opencode.ts';
import { hostAgentsEnabled, profileFor } from './providers/resolve.ts';
import { shareProfile } from './profile-share.ts';
import { prepareLocalProxyKey, proxyKey, validateProxyKey as validateKey, writeProxyKey as writeKey } from './subscription-proxy-auth.ts';
export { proxyKey } from './subscription-proxy-auth.ts';

import { activeSubscriptionProxy, PROXY_KEY_ENV, proxyApiUrl } from './subscription-proxy/config.ts';
import { openCodeGatewayEnv } from './subscription-proxy/opencode.ts';
import { ANTIGRAVITY } from './subscription-proxy/routes.ts';

export { activeSubscriptionProxy, PROXY_PREFIX_ENV, proxyApiUrl } from './subscription-proxy/config.ts';
export { mergeProxyModels, readSubscriptionProxyModels, savedRowOffered } from './subscription-proxy/catalog.ts';

const PROXY_URL_ENV = 'BOITE_SUBSCRIPTION_PROXY_URL';
const CODEX_CATALOG_ENV = 'BOITE_SUBSCRIPTION_PROXY_CODEX_CATALOG';
const GROK = 'grok';

/**
 * Grok's CLI is sent to the gateway by its environment alone, and stays the
 * same agent. It lists the gateway's Grok models itself (`provider=xai`) under
 * xAI's ids and in xAI's order (`ids=upstream`): a thread keeps its model
 * whether the proxy is on or off, and a session opens on xAI's default, the
 * first of a list. Each row carries the window and the efforts the CLI reads.
 * Turns name the pool they spend, since another subscription of the gateway
 * can route a model of the same name.
 *
 * The CLI prefers a stored sign-in to a key and would send that token to the
 * gateway. `GROK_AUTH_PATH` points it at a file nothing writes, so it finds no
 * sign-in and the account's own stays as it was for when the proxy is off. Its
 * key check and its chat proxy move to the gateway with the rest: the key
 * never reaches xAI.
 */
function grokGatewayEnv(core: Core, proxy: SubscriptionProxy, key: string): Record<string, string> {
  const api = proxyApiUrl(proxy);
  return {
    XAI_API_KEY: key,
    GROK_MODELS_BASE_URL: api,
    GROK_MODELS_LIST_URL: `${api}/models?provider=xai&ids=upstream`,
    GROK_XAI_API_BASE_URL: api,
    GROK_CLI_CHAT_PROXY_BASE_URL: api,
    GROK_AUTH_PATH: join(core.dataDir, 'subscription-proxy', 'grok-auth.json'),
    GROK_CONFIG: JSON.stringify({ models: { extra_headers: { 'x-douane-provider': 'xai' } } }),
  };
}

export function subscriptionProxyEnv(core: Core, provider: ProviderDescriptor): Record<string, string> {
  const proxy = activeSubscriptionProxy(core, provider);
  if (!proxy) return {};
  const key = proxyKey(core);
  if (provider.id === 'muse') return museGatewayEnv(core, proxy, key);
  if (isOpenCode(provider.id)) return openCodeGatewayEnv(core, provider, proxy, key);
  if (provider.id === GROK) return grokGatewayEnv(core, proxy, key);
  if (provider.id === ANTIGRAVITY) return antigravityGatewayEnv(core, provider, proxy, key);
  if (provider.protocol === 'claude-sdk') return {
    ANTHROPIC_BASE_URL: proxyApiUrl(proxy).replace(/\/v1$/, ''),
    ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: '',
    ...(proxy.kind === 'douane' ? { ANTHROPIC_CUSTOM_HEADERS: 'x-douane-model-catalog: claude' } : {}),
    // The gateway relays Messages verbatim to Anthropic on a subscription. A
    // custom base URL would otherwise switch Claude Code to its third-party
    // behavior: no tool search, no first-party model aliases, and a 5-minute
    // prompt cache where a subscription gets one hour. Fast mode's organization
    // check needs a native login the gateway holds instead, so it is skipped.
    _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
    CLAUDE_CODE_PROMPT_CACHE_TTL: '1h',
    CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK: '1',
  };
  const api = proxyApiUrl(proxy);
  return {
    [PROXY_URL_ENV]: api,
    [PROXY_KEY_ENV]: key,
    ...(proxy.kind === 'douane' && provider.protocol === 'codex-appserver'
      ? { [CODEX_CATALOG_ENV]: `${api}/codex/models` }
      : {}),
  };
}

/** Muse serve takes its endpoint from settings, never the TUI's --base-url flag. Keep native settings and logins intact. */
function museGatewayEnv(core: Core, proxy: SubscriptionProxy, key: string): Record<string, string> {
  const api = proxyApiUrl(proxy).replace(/\/v1$/, '/muse-code');
  const identity = createHash('sha256').update(api).digest('hex').slice(0, 24);
  const directory = join(core.dataDir, 'subscription-proxy', 'muse', identity);
  mkdirSync(join(directory, 'muse'), { recursive: true });
  const settings = join(directory, 'muse', 'settings.json');
  if (!existsSync(settings)) writeFileSync(settings, JSON.stringify({ schema_version: 1, endpoint_transport: { base_url: api, auth: 'bearer' } }));
  // META_API_KEY overrides a saved login and is deliberately supplied after the profile's unsetEnv.
  return { XDG_CONFIG_HOME: directory, META_API_KEY: key };
}

/**
 * Antigravity's server has a gateway mode of its own: `auth.type: "gateway"` in
 * `<GEMINI_HOME>/antigravity-acp/settings.json`, the gateway's origin in
 * `AGY_LLM_GATEWAY_URL` (no `/v1`: it calls `/v1beta/models` and
 * `/v1beta/models/<model>:streamGenerateContent` under it) and the key, sent as
 * a bearer token, in `AGY_LLM_GATEWAY_API_KEY`. It then lists the gateway's
 * models itself. The settings live in a home of their own per gateway, so the
 * account's home keeps its `oauth-personal` settings and its sign-in for when
 * the proxy is off. The profile's shared paths (skills) are mirrored into that
 * home as into an account's. Applied after the profile's unsetEnv and isolation.
 */
const gatewayShareLog = new Map<string, string>();

function antigravityGatewayEnv(core: Core, provider: ProviderDescriptor, proxy: SubscriptionProxy, key: string): Record<string, string> {
  const origin = proxyApiUrl(proxy).replace(/\/v1$/, '');
  const identity = createHash('sha256').update(origin).digest('hex').slice(0, 24);
  const home = join(core.dataDir, 'subscription-proxy', 'antigravity', identity);
  const settings = join(home, 'antigravity-acp', 'settings.json');
  mkdirSync(join(home, 'antigravity-acp'), { recursive: true });
  let current: Record<string, unknown> = {};
  try {
    const read: unknown = JSON.parse(readFileSync(settings, 'utf8'));
    if (read !== null && typeof read === 'object' && !Array.isArray(read)) current = read as Record<string, unknown>;
  } catch {
    // Missing or not JSON: written anew below.
  }
  const auth = current['auth'];
  if (auth === null || typeof auth !== 'object' || (auth as Record<string, unknown>)['type'] !== 'gateway') {
    // What the agent keeps beside the auth type stays.
    writeFileSync(settings, JSON.stringify({ ...current, auth: { type: 'gateway' } }));
  }
  const profile = profileFor(provider);
  if (profile !== undefined && hostAgentsEnabled()) {
    const said = shareProfile(home, profile, provider.shared ?? []).map((problem) => `${problem.path}: ${problem.message}`).join('; ');
    // Said once per change, as for an account: this runs before every spawn.
    if (said !== (gatewayShareLog.get(home) ?? '')) {
      gatewayShareLog.set(home, said);
      if (said.length > 0) core.log('warn', `subscription proxy: the Antigravity gateway home does not share ${said}`);
    }
  }
  return { GEMINI_HOME: home, AGY_LLM_GATEWAY_URL: origin, AGY_LLM_GATEWAY_API_KEY: key };
}

/** Only addresses go on the command line; Codex reads the key from its environment. */
export async function subscriptionProxyCodexArgs(args: string[], env: Record<string, string>): Promise<string[]> {
  const baseUrl = env[PROXY_URL_ENV];
  if (!baseUrl) return args;
  const provider = 'boite_subscription_proxy';
  const config = [
    `model_provider=${JSON.stringify(provider)}`,
    `model_providers.${provider}.name="Subscription proxy"`,
    `model_providers.${provider}.base_url=${JSON.stringify(baseUrl)}`,
    `model_providers.${provider}.wire_api="responses"`,
    `model_providers.${provider}.supports_websockets=true`,
    `model_providers.${provider}.requires_openai_auth=false`,
    `model_providers.${provider}.env_key="${PROXY_KEY_ENV}"`,
  ];
  const catalog = env[CODEX_CATALOG_ENV];
  // An explicit Codex catalog replaces its bundled list. Older gateways keep
  // the bundled models until they support the native catalog endpoint.
  if (catalog) {
    const response = await fetch(catalog, {
      method: 'HEAD', headers: { Authorization: `Bearer ${env[PROXY_KEY_ENV]}` },
      signal: AbortSignal.timeout(3_000), redirect: 'error',
    }).catch(() => null);
    if (response?.ok && response.headers.get('content-type')?.startsWith('application/json')) {
      // Douane routes bare ids from this key's catalog to Codex.
      config.push(`model_providers.${provider}.model_catalog_url=${JSON.stringify(catalog)}`,
        `model_providers.${provider}.http_headers={"x-douane-model-catalog"="codex"}`);
    }
  }
  return [...args, ...config.flatMap(value => ['--config', value])];
}

export function registerSubscriptionProxy(core: Core): void {
  core.router.register('subscriptionProxy.quotas', ({ refresh }) => {
    if (refresh !== undefined && typeof refresh !== 'boolean') throw invalidParams('subscriptionProxy.quotas refresh must be a boolean');
    return core.quotas.gateway.read(refresh === true);
  });
  core.router.register('subscriptionProxy.configure', async ({ subscriptionProxy, key }) => {
    if (!subscriptionProxy || typeof subscriptionProxy !== 'object') throw invalidParams('subscriptionProxy configuration is required');
    if (key !== undefined) validateKey(key);
    try {
      core.settings.set({ subscriptionProxy }, key === undefined ? undefined : () => writeKey(core, key));
    } catch (error) {
      if (error instanceof RpcFailure) throw error;
      // A storage error must not expose a bound private value to the caller or logs.
      throw unavailable('Subscription proxy configuration could not be saved');
    }
    // A new key can change the answer even when the settings did not.
    if (key !== undefined) core.quotas.gateway.reset();
    await prepareLocalProxyKey(core);
    return core.settings.get();
  });
  core.router.register('subscriptionProxy.setEnabled', async ({ enabled }) => {
    if (typeof enabled !== 'boolean') throw invalidParams('subscriptionProxy.setEnabled enabled must be a boolean', { field: 'enabled' });
    const proxy = core.settings.get().subscriptionProxy;
    if (!proxy?.baseUrl) throw refused('no subscription proxy is configured: the owner sets one up in Settings > Providers > Subscription proxy', { field: 'subscriptionProxy' });
    if (proxy.enabled !== enabled) core.settings.set({ subscriptionProxy: { ...proxy, enabled } });
    await prepareLocalProxyKey(core);
    return core.settings.get();
  });
}
