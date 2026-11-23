import { subscriptionProxyName, type ModelFamily, type ModelInfo, type ProviderDescriptor, type SubscriptionProxy } from '@boite/contracts';
import type { Core } from '../core.ts';
import { OPENCODE_V2 } from '../providers/opencode.ts';
import { profileFor } from '../providers/resolve.ts';
import { modelCapabilities } from '../drivers/model-capabilities.ts';
import { PROXY_KEY_ENV, PROXY_PREFIX_ENV, proxyApiUrl } from './config.ts';
import type { CatalogRow } from './catalog.ts';
import { antigravityOnly } from './routes.ts';

const OPENCODE_MODELS_SETTING = 'subscription-proxy-opencode-models';

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
export function openCodeGatewayEnv(core: Core, provider: ProviderDescriptor, proxy: SubscriptionProxy, key: string): Record<string, string> {
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

const OWN_HARNESS: ReadonlySet<ModelFamily> = new Set(['anthropic', 'openai', 'xai', 'google']);
const OPENCODE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;

function injectedModel(row: CatalogRow): GatewayModel {
  const { raw, id, name } = row;
  const thinking = raw.thinking as Record<string, unknown> | null | undefined;
  const reasoning = modelCapabilities(raw).effort !== undefined
    || positiveTokenLimit(thinking?.min) !== undefined || positiveTokenLimit(thinking?.max) !== undefined || thinking?.dynamic_allowed === true;
  const limit = gatewayModelLimits(positiveTokenLimit(raw.context_length) ?? raw.context_window, raw.max_output_tokens);
  return { id, name, ...(reasoning ? { reasoning: true } : {}), ...(limit ? { limit } : {}) };
}

function openCodeOffered(row: CatalogRow): boolean {
  return OPENCODE_MODEL_ID.test(row.id) && !row.antigravityOnly && (row.family === null || !OWN_HARNESS.has(row.family))
    && (row.endpoints === undefined || row.endpoints.includes('openai'));
}

export function openCodeModels(core: Core, proxy: SubscriptionProxy, rows: CatalogRow[]): ModelInfo[] {
  const catalog = rows.filter(openCodeOffered).map(injectedModel);
  if (JSON.stringify(catalog) !== JSON.stringify(openCodeGatewayModels(core))) core.journal.setSetting(OPENCODE_MODELS_SETTING, catalog);
  return catalog.map(model => ({ id: `${proxy.kind}/${model.id}`, name: model.name }));
}
