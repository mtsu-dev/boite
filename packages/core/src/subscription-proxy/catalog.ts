import { nativeModelId, type ModelInfo, type Protocol } from '@boite/contracts';
import type { Core } from '../core.ts';
import type { ProviderDescriptor } from '@boite/contracts';
import { unavailable } from '../errors.ts';
import { isOpenCode } from '../providers/opencode.ts';
import { ensureLocalProxyKey, proxyKey, PROXY_AUTH_ERROR } from '../subscription-proxy-auth.ts';
import { canonicalClaudeModel } from '../drivers/claude/config.ts';
import { fillModelCapabilities, modelCapabilities, publicModel, type DiscoveredModel } from '../drivers/model-capabilities.ts';
import { activeSubscriptionProxy, proxyApiUrl } from './config.ts';
import { antigravityOnly, proprietaryFamily, ANTIGRAVITY } from './routes.ts';
import { openCodeModels } from './opencode.ts';

export interface CatalogRow {
  id: string;
  name: string;
  raw: Record<string, unknown>;
  family: ReturnType<typeof proprietaryFamily>;
  antigravityOnly: boolean;
  endpoints?: unknown[];
}

function catalogRows(data: unknown[]): CatalogRow[] {
  const seen = new Set<string>();
  const rows: CatalogRow[] = [];
  for (const value of data) {
    if (!value || typeof value !== 'object') continue;
    const raw = value as Record<string, unknown>;
    const { id, supported_endpoint_types: endpoints } = raw;
    if (typeof id !== 'string' || !id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    const label = raw.name ?? raw.display_name;
    rows.push({ id, name: typeof label === 'string' && label ? label.slice(0, 200) : id, raw,
      family: proprietaryFamily(id), antigravityOnly: antigravityOnly(id),
      ...(Array.isArray(endpoints) ? { endpoints } : {}) });
  }
  return rows;
}

/** Native capabilities and explicit refusals win. The proxy supplies unknown fields and extra models. */
export function mergeProxyModels(native: ModelInfo[], proxy: ModelInfo[], protocol?: Protocol): ModelInfo[] {
  const claude = protocol === 'claude-sdk';
  if (!claude && !native.length) return (proxy as DiscoveredModel[]).some(row => row.capabilityRefusals) ? proxy.map(publicModel) : proxy;
  const canonical = claude ? canonicalClaudeModel : (model: ModelInfo) => model;
  const models = new Map<string, DiscoveredModel>();
  for (const row of native.map(canonical)) {
    const first = models.get(row.id);
    models.set(row.id, first ? fillModelCapabilities(first, row) : row);
  }
  for (const row of proxy.map(canonical)) {
    const id = protocol === 'codex-appserver' || protocol === undefined ? nativeModelId(row.id) : row.id;
    const key = models.has(row.id) ? row.id : id;
    const listed = models.get(key);
    if (listed) models.set(key, fillModelCapabilities(listed, row));
    else models.set(row.id, native.length ? { ...row, default: false } : row);
  }
  return [...models.values()].map(publicModel);
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
  if (!activeSubscriptionProxy(core, provider) || ['muse', 'grok', ANTIGRAVITY].includes(provider.id)) return null;
  await ensureLocalProxyKey(core);
  const proxy = activeSubscriptionProxy(core, provider);
  if (!proxy) return null;
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
  const rows = catalogRows(body.data);
  if (isOpenCode(provider.id)) return openCodeModels(core, proxy, rows);
  const claude = provider.protocol === 'claude-sdk';
  const offered = rows.filter(row => nativeRouteOffered(row, claude));
  if (!offered.length) throw unavailable(`Subscription proxy listed no compatible models for ${provider.name}`);
  const models = offered.map((row, index) => ({
    id: row.id, name: row.name, default: index === 0, ...modelCapabilities(row.raw, { claude }),
  }));
  return claude ? mergeProxyModels([], models, 'claude-sdk') : models;
}

function nativeRouteOffered(row: CatalogRow, claude: boolean): boolean {
  const own = claude ? 'anthropic' : 'openai';
  if (row.antigravityOnly || (row.family !== null && row.family !== own)) return false;
  if (row.endpoints !== undefined) return row.endpoints.includes(claude ? 'anthropic' : 'openai-response');
  const legacy = claude ? /claude|opus|sonnet|haiku|fable/i : /gpt|codex|\bo[134](?:-|$)/i;
  return legacy.test(row.id);
}
