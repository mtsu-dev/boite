import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MODEL_ROUTE_FAMILIES, nativeModelId, subscriptionProxyName, subscriptionProxyOf, type ModelFamily, type ModelInfo, type ProviderDescriptor, type ProviderId, type SubscriptionProxy } from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams, refused, unavailable, RpcFailure } from './errors.ts';
import { isOpenCode, OPENCODE_V2 } from './providers/opencode.ts';
import { hostAgentsEnabled, profileFor } from './providers/resolve.ts';
import { shareProfile } from './profile-share.ts';
import { ensureLocalProxyKey, prepareLocalProxyKey, proxyKey, validateProxyKey as validateKey, writeProxyKey as writeKey, PROXY_AUTH_ERROR } from './subscription-proxy-auth.ts';
export { proxyKey } from './subscription-proxy-auth.ts';

/** The gateway models both OpenCode versions were last offered, kept so a restart can start a turn on one. */
const OPENCODE_MODELS_SETTING = 'subscription-proxy-opencode-models';
const PROXY_URL_ENV = 'BOITE_SUBSCRIPTION_PROXY_URL';
const PROXY_KEY_ENV = 'BOITE_SUBSCRIPTION_PROXY_KEY';
const CODEX_CATALOG_ENV = 'BOITE_SUBSCRIPTION_PROXY_CODEX_CATALOG';
/**
 * The start of every model id the core injected into an agent as a provider of
 * its own, `douane/`. An agent may take such a model without listing it among
 * its own, which is what the ACP driver reads this for.
 */
export const PROXY_PREFIX_ENV = 'BOITE_SUBSCRIPTION_PROXY_PREFIX';
const GROK: ProviderId = 'grok';
const ANTIGRAVITY: ProviderId = 'antigravity';

export function activeSubscriptionProxy(core: Core, provider: ProviderDescriptor): SubscriptionProxy | null {
  return subscriptionProxyOf(core.settings.get(), provider, core.quotas?.gateway.state());
}

interface GatewayModel {
  id: string;
  name: string;
  reasoning?: true;
  limit?: { context?: number; output?: number };
}

function positiveTokenLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function gatewayModelLimits(context: unknown, output: unknown): GatewayModel['limit'] {
  const contextLimit = positiveTokenLimit(context), outputLimit = positiveTokenLimit(output);
  if (contextLimit === undefined && outputLimit === undefined) return undefined;
  return { ...(contextLimit === undefined ? {} : { context: contextLimit }), ...(outputLimit === undefined ? {} : { output: outputLimit }) };
}

/**
 * The gateway models last offered to OpenCode, read back from the journal: a
 * bad row is dropped, not trusted, and so is one a catalog stored before
 * Antigravity's models were kept to their harness still holds.
 */
function openCodeGatewayModels(core: Core): GatewayModel[] {
  const stored = core.journal.getSetting(OPENCODE_MODELS_SETTING);
  if (!Array.isArray(stored)) return [];
  return stored.filter((row): row is GatewayModel =>
    row !== null && typeof row === 'object' && typeof (row as GatewayModel).id === 'string' && typeof (row as GatewayModel).name === 'string'
    && !antigravityOnly((row as GatewayModel).id))
    .map(row => {
      const limit = gatewayModelLimits(row.limit?.context, row.limit?.output);
      return { id: row.id, name: row.name, ...(row.reasoning === true ? { reasoning: true as const } : {}), ...(limit ? { limit } : {}) };
    });
}

/**
 * Both OpenCode versions take the gateway as one more model provider, named after the
 * gateway's kind, beside the ones it already has. The provider is written into
 * the inline configuration the descriptor already sends, so what that carries
 * (the denial of OpenCode's own subagents) is kept. A custom provider lists
 * only the models its configuration names, hence the stored catalog. The key
 * goes by environment, where the provider block tells OpenCode to look.
 */
function openCodeGatewayEnv(core: Core, provider: ProviderDescriptor, proxy: SubscriptionProxy, key: string): Record<string, string> {
  let base: Record<string, unknown> = {};
  try {
    const declared: unknown = JSON.parse(profileFor(provider)?.env?.['OPENCODE_CONFIG_CONTENT'] ?? '{}');
    if (declared !== null && typeof declared === 'object' && !Array.isArray(declared)) base = declared as Record<string, unknown>;
  } catch {
    // A descriptor whose inline configuration is not JSON keeps the gateway and loses nothing it could have applied.
  }
  const collection = provider.id === OPENCODE_V2 ? 'providers' : 'provider';
  const declaredProviders = base[collection];
  const others = declaredProviders !== null && typeof declaredProviders === 'object' && !Array.isArray(declaredProviders) ? declaredProviders as Record<string, unknown> : {};
  const models = Object.fromEntries(openCodeGatewayModels(core).map((model) => [model.id, {
    name: model.name,
    ...(model.limit && (provider.id === OPENCODE_V2 || (model.limit.context !== undefined && model.limit.output !== undefined))
      ? { limit: model.limit } : {}),
    ...(model.reasoning ? provider.id === OPENCODE_V2
      ? { compatibility: { reasoningField: 'reasoning_content' } }
      : { reasoning: true, interleaved: { field: 'reasoning_content' } } : {}),
  }]));
  const integration = provider.id === OPENCODE_V2 ? {
    package: '@opencode/ai/providers/openai-compatible', name: subscriptionProxyName(proxy.kind),
    settings: { baseURL: proxyApiUrl(proxy) }, env: [PROXY_KEY_ENV], models,
  } : {
    npm: '@ai-sdk/openai-compatible', name: subscriptionProxyName(proxy.kind),
    options: { baseURL: proxyApiUrl(proxy), apiKey: `{env:${PROXY_KEY_ENV}}` }, models,
  };
  const content = {
    ...base,
    [collection]: {
      ...others,
      [proxy.kind]: integration,
    },
  };
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify(content), [PROXY_KEY_ENV]: key, [PROXY_PREFIX_ENV]: `${proxy.kind}/` };
}

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

export function proxyApiUrl(proxy: SubscriptionProxy): string {
  return `${proxy.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/v1`;
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

/**
 * The agent's native list first, as a subscription shows it, then the models
 * only the gateway routes. Without a native list the gateway's stands alone.
 * A gateway can name a model after the subscription that serves it
 * (`codex/gpt-5.4`): behind a vendor's route that is the agent's own model
 * again, already listed with its speeds, so it is not offered twice. Another
 * route to the same name (`<pool>/claude-sonnet-5`) is another pool and stays.
 */
export function mergeProxyModels(native: ModelInfo[], proxy: ModelInfo[]): ModelInfo[] {
  if (!native.length) return proxy;
  const ids = new Set(native.map(model => model.id));
  const listed = (id: string): boolean => ids.has(id) || ids.has(nativeModelId(id));
  return [...native, ...proxy.filter(model => !listed(model.id)).map(model => ({ ...model, default: false }))];
}

/** Effort controls come from explicit gateway capabilities, including Codex's native metadata. */
function proxyEffort(row: Record<string, unknown>): ModelInfo['effort'] | undefined {
  const thinking = row.thinking as { levels?: unknown } | null;
  const native = Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts : [];
  const options = native.length ? native : Array.isArray(thinking?.levels) ? thinking.levels.map(reasoningEffort => ({ reasoningEffort })) : [];
  const levels: NonNullable<ModelInfo['effort']>['levels'] = [];
  for (const option of options.slice(0, 20)) {
    if (!option || typeof option !== 'object') continue;
    const { reasoningEffort: id, description } = option as { reasoningEffort?: unknown; description?: unknown };
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(id) || levels.some(level => level.id === id)) continue;
    levels.push({ id, label: id === 'xhigh' ? 'Extra high' : `${id[0]!.toUpperCase()}${id.slice(1)}`,
      ...(typeof description === 'string' && description ? { description: description.slice(0, 2000) } : {}) });
  }
  if (!levels.length) return undefined;
  const wanted = row.defaultReasoningEffort;
  return { levels, default: typeof wanted === 'string' && levels.some(level => level.id === wanted) ? wanted : levels[0]!.id };
}


/** Open-weight families: offered to every harness, whatever routing prefix the gateway gives them. */
const OPEN_MODEL = /gpt-oss|kimi|qwen|llama|deepseek|mistral|mixtral|glm/i;

/**
 * The vendor whose harness a proprietary model belongs to, or null for an open
 * or unknown model. The name is read after the gateway's routing prefix, so
 * `antigravity/claude-opus-5-5` is a Claude model; an unknown name falls back
 * to a vendor prefix, so `codex/computer-use-preview` is an OpenAI model.
 */
function proprietaryFamily(id: string): ModelFamily | null {
  const slash = id.lastIndexOf('/');
  const name = id.slice(slash + 1);
  if (OPEN_MODEL.test(name)) return null;
  if (/claude|opus|sonnet|haiku|fable/i.test(name)) return 'anthropic';
  if (/^(?:chatgpt|gpt|codex)(?:[-_.\d]|$)|^openai(?:[-_]|$)|^o\d+(?:-|$)/i.test(name)) return 'openai';
  if (/gemini/i.test(name)) return 'google';
  if (/grok/i.test(name)) return 'xai';
  if (/muse/i.test(name)) return 'meta';
  const route = slash > 0 ? id.slice(0, slash).split('/').pop()!.toLowerCase() : '';
  return Object.hasOwn(MODEL_ROUTE_FAMILIES, route) ? MODEL_ROUTE_FAMILIES[route]! : null;
}

/**
 * A model only the Antigravity harness is offered: one the gateway routes
 * through Antigravity (`antigravity/claude-opus-5-5`, `antigravity/gpt-oss-120b`),
 * whatever its family, and any Gemini model. Google bans an account used
 * outside Antigravity, so these run there alone, through the gateway's Gemini
 * API or the native sign-in, as Claude's models run in Claude Code.
 */
function antigravityOnly(id: string): boolean {
  const slash = id.lastIndexOf('/');
  const routes = slash > 0 ? id.slice(0, slash).toLowerCase().split('/') : [];
  return routes.includes(ANTIGRAVITY) || proprietaryFamily(id) === 'google';
}

/**
 * Whether a row an earlier version saved for this agent may still be offered:
 * a list saved before Antigravity's models were kept to their harness can hold
 * them, and it answers a picker before any fresh read. OpenCode's gateway rows
 * carry the gateway's kind first (`douane/`); its own rows are left alone.
 */
export function savedRowOffered(core: Core, provider: ProviderDescriptor, id: string): boolean {
  const proxy = activeSubscriptionProxy(core, provider);
  if (!proxy || provider.id === ANTIGRAVITY) return true;
  if (!isOpenCode(provider.id)) return !antigravityOnly(id);
  return !(id.startsWith(`${proxy.kind}/`) && antigravityOnly(id.slice(proxy.kind.length + 1)));
}

/** Discovery is a bounded HTTP read on the core, so a phone uses its host's gateway. */
export async function readSubscriptionProxyModels(core: Core, provider: ProviderDescriptor): Promise<ModelInfo[] | null> {
  if (!activeSubscriptionProxy(core, provider)) return null;
  await ensureLocalProxyKey(core);
  const proxy = activeSubscriptionProxy(core, provider);
  if (!proxy) return null;
  if (provider.id === 'muse') {
    // Its own MSP catalog carries native model ids and efforts, through Douane's Muse endpoint.
    return null;
  }
  // Grok's CLI reads the gateway's list itself and takes no model outside it: its discovery is the whole catalog.
  if (provider.id === GROK) return null;
  // Antigravity lists the gateway's Gemini API models itself (`/v1beta/models`): an OpenAI catalog would add nothing it can run.
  if (provider.id === ANTIGRAVITY) return null;
  let response: Response;
  try {
    response = await fetch(`${proxyApiUrl(proxy)}/models`, {
      headers: { Authorization: `Bearer ${proxyKey(core)}` },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
  } catch { throw unavailable('Subscription proxy model discovery could not reach the configured API URL'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw unavailable(response.status === 401 && proxy.kind === 'douane' ? PROXY_AUTH_ERROR : `Subscription proxy model discovery returned HTTP ${response.status}`);
  }
  // Do not propagate a gateway's raw body: it can echo a credential.
  let body: { data?: unknown };
  try { body = await response.json() as { data?: unknown }; }
  catch { throw unavailable('Subscription proxy model discovery expected an OpenAI models response'); }
  if (!body || typeof body !== 'object' || !Array.isArray(body.data) || body.data.length > 10_000) throw unavailable('Subscription proxy model discovery expected a bounded data array');
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  if (isOpenCode(provider.id)) return openCodeModels(core, proxy, body.data as Record<string, unknown>[]);
  for (const row of body.data as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || row.id.length > 200 || seen.has(row.id)) continue;
    const endpoints = row.supported_endpoint_types;
    const own = provider.protocol === 'claude-sdk' ? 'anthropic' : 'openai';
    const family = proprietaryFamily(row.id);
    // A gateway can translate any model to any API; a proprietary model still stays in its own harness, and Antigravity's in Antigravity.
    if (antigravityOnly(row.id) || (family !== null && family !== own)) continue;
    if (Array.isArray(endpoints) && !endpoints.includes(provider.protocol === 'claude-sdk' ? 'anthropic' : 'openai-response')) continue;
    // Older gateways omit endpoint metadata; their known native model families remain selectable.
    if (!Array.isArray(endpoints) && (provider.protocol === 'claude-sdk' ? !/claude|opus|sonnet|haiku|fable/i.test(row.id) : !/gpt|codex|\bo[134](?:-|$)/i.test(row.id))) continue;
    seen.add(row.id);
    const name = row.name ?? row.display_name;
    const effort = proxyEffort(row);
    models.push({ id: row.id, name: typeof name === 'string' && name ? name.slice(0, 200) : row.id, default: models.length === 0,
      ...(effort ? { effort } : {}) });
  }
  if (!models.length) throw unavailable(`Subscription proxy listed no compatible models for ${provider.name}`);
  return models;
}

/** The families whose models stay in the harness their vendor ships: Claude Code, Codex, Grok and Antigravity. */
const OWN_HARNESS: ReadonlySet<ModelFamily> = new Set(['anthropic', 'openai', 'xai', 'google']);
/** A model id becomes a key of OpenCode's configuration and part of a `provider/model` name. */
const OPENCODE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;

/**
 * What OpenCode is offered from the gateway: Muse and open-weight families,
 * none routed through Antigravity, with Chat Completions support. Each is
 * named `<kind>/<gateway id>`, the way OpenCode names a model of a provider.
 * The catalog is stored for the next spawn, and an empty one is an answer: the
 * agent's own models stand, where the other harnesses would have nothing left.
 */
function openCodeModels(core: Core, proxy: SubscriptionProxy, rows: Record<string, unknown>[]): ModelInfo[] {
  const catalog: GatewayModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !OPENCODE_MODEL_ID.test(row.id) || seen.has(row.id)) continue;
    const family = proprietaryFamily(row.id);
    const endpoints = row.supported_endpoint_types;
    if (antigravityOnly(row.id) || (family !== null && OWN_HARNESS.has(family))) continue;
    // A gateway that says which APIs a model answers must name Chat Completions; one that says nothing is taken at its word.
    if (Array.isArray(endpoints) && !endpoints.includes('openai')) continue;
    seen.add(row.id);
    const name = row.name ?? row.display_name;
    const thinking = row.thinking !== null && typeof row.thinking === 'object' && !Array.isArray(row.thinking)
      ? row.thinking as Record<string, unknown> : null;
    const reasoning = proxyEffort(row) !== undefined || (thinking !== null && (positiveTokenLimit(thinking.min) !== undefined
      || positiveTokenLimit(thinking.max) !== undefined || thinking.dynamic_allowed === true));
    const limit = gatewayModelLimits(positiveTokenLimit(row.context_length) ?? row.context_window, row.max_output_tokens);
    catalog.push({ id: row.id, name: typeof name === 'string' && name ? name.slice(0, 200) : row.id,
      ...(reasoning ? { reasoning: true } : {}), ...(limit ? { limit } : {}) });
  }
  if (JSON.stringify(catalog) !== JSON.stringify(openCodeGatewayModels(core))) core.journal.setSetting(OPENCODE_MODELS_SETTING, catalog);
  return catalog.map((model) => ({ id: `${proxy.kind}/${model.id}`, name: model.name }));
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
