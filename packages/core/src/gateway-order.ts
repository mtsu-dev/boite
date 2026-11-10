import { GATEWAY_ORDER_STRATEGIES, subscriptionProxyOrigin, type GatewayOrder, type GatewayOrderAccount, type GatewayOrderChoice, type GatewayOrderProvider, type GatewayOrderStrategy, type SubscriptionProxy } from '@boite/contracts';
import type { Core } from './core.ts';
import { douaneOf, gatewayCall, managementToken, record, scrub } from './douane-admin.ts';
import { invalidParams, refused, RpcFailure } from './errors.ts';

/**
 * The usage order of Douane's accounts. The core reads and writes it through
 * Douane's `/admin/api` (`settings`, `accounts`, `accounts/order`) with the
 * management token it holds; a client sees names, places and strategies, never
 * the token nor a login.
 */

const STRATEGIES: readonly GatewayOrderStrategy[] = ['fill-first', 'reset-first', 'round-robin', 'smart'];
const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FAMILY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FEATURE = { feature: 'account order' } as const;
/** The names Boite gives Douane's providers; another one shows its id. */
const NAMES: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', xai: 'Grok', meta: 'Muse Code' };

function strategyOf(value: unknown): GatewayOrderStrategy | null {
  return STRATEGIES.find(strategy => strategy === value) ?? null;
}

/** What a person recognises the account by, without its whole address. */
function accountName(account: Record<string, unknown>, id: string): string {
  if (typeof account.name === 'string' && account.name.trim()) return account.name.trim().slice(0, 120);
  if (typeof account.email === 'string' && account.email.includes('@')) return `${account.email.slice(0, account.email.indexOf('@')).slice(0, 80)}@…`;
  return id.slice(0, 8);
}

interface Held {
  settings: Record<string, unknown>;
  accounts: Record<string, unknown>[];
  /** False for a Douane that predates the account order. */
  supported: boolean;
}

async function read(core: Core, proxy: SubscriptionProxy, token: string | null): Promise<Held> {
  const [settings, listed] = await Promise.all([
    gatewayCall(core, proxy, token, '/settings', undefined, FEATURE),
    gatewayCall(core, proxy, token, '/accounts', undefined, FEATURE),
  ]);
  const accounts = Array.isArray(listed.json.accounts) ? listed.json.accounts.map(record).filter(account => account !== null) : [];
  const supported = 'spare_families' in settings.json && accounts.every(account => 'position' in account);
  return { settings: settings.json, accounts, supported };
}

function providersOf(held: Held): GatewayOrderProvider[] {
  const strategies = record(held.settings.provider_strategies) ?? {};
  const spared = record(held.settings.spare_families) ?? {};
  const fallback = strategyOf(held.settings.strategy) ?? 'smart';
  const groups = new Map<string, GatewayOrderAccount[]>();
  for (const account of held.accounts) {
    if (typeof account.id !== 'string' || typeof account.provider !== 'string') continue;
    const position = typeof account.position === 'number' && Number.isInteger(account.position) ? account.position : null;
    const group = groups.get(account.provider) ?? [];
    group.push({ id: account.id, name: accountName(account, account.id), position, enabled: account.enabled !== false });
    groups.set(account.provider, group);
  }
  return [...groups].map(([providerId, accounts]): GatewayOrderProvider => {
    const families = spared[providerId];
    return {
      providerId, name: NAMES[providerId] ?? providerId,
      strategy: strategyOf(strategies[providerId]) ?? fallback,
      spareFamilies: Array.isArray(families) ? families.filter((family): family is string => typeof family === 'string') : [],
      // Douane's own order under `fill-first`: by position, the unordered ones last, then by id.
      accounts: accounts.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
  });
}

function needsToken(error: unknown): boolean {
  return error instanceof RpcFailure && record(error.data)?.field === 'managementToken';
}

export async function gatewayOrder(core: Core): Promise<GatewayOrder> {
  const proxy = douaneOf(core);
  const token = managementToken(core);
  const base = { origin: proxy ? subscriptionProxyOrigin(proxy) : null, managementToken: token !== null };
  if (proxy === null) return { ...base, status: 'noProxy', providers: [] };
  let held: Held;
  try { held = await read(core, proxy, token); }
  catch (error) {
    if (needsToken(error)) return { ...base, status: 'needsToken', providers: [] };
    throw error;
  }
  if (!held.supported) return { ...base, status: 'unsupported', providers: [] };
  return { ...base, status: 'ready', providers: providersOf(held) };
}

/** Douane's answer to a write, or its refusal as a sentence without the token. */
function accepted(answer: { status: number; json: Record<string, unknown> }, origin: string, token: string | null): void {
  if (answer.status < 300) return;
  const said = answer.json.error ?? answer.json.message;
  throw refused(`Douane at ${origin} refused the change: ${scrub(typeof said === 'string' && said ? said : `HTTP ${answer.status}`, token ? [token] : [])}`);
}

interface Change { providerId: string; strategy?: GatewayOrderChoice; ids?: string[]; spareFamilies?: string[] }

function validate(params: unknown): Change {
  const { providerId, strategy, ids, spareFamilies } = record(params) ?? {};
  if (typeof providerId !== 'string' || !PROVIDER.test(providerId)) throw invalidParams('providerId must be one of Douane\'s provider ids', { field: 'providerId' });
  if (strategy !== undefined && !GATEWAY_ORDER_STRATEGIES.some(known => known === strategy)) {
    throw invalidParams(`strategy must be ${GATEWAY_ORDER_STRATEGIES.join(' or ')}`, { field: 'strategy', expected: GATEWAY_ORDER_STRATEGIES.join(' or ') });
  }
  if (ids !== undefined && (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(ids).size !== ids.length)) {
    throw invalidParams('ids must list every account id of the provider once', { field: 'ids' });
  }
  if (spareFamilies !== undefined && (!Array.isArray(spareFamilies) || spareFamilies.length > 20 || spareFamilies.some(family => typeof family !== 'string' || !FAMILY.test(family)))) {
    throw invalidParams('spareFamilies must be lowercase family keys such as fable', { field: 'spareFamilies' });
  }
  if (strategy === undefined && ids === undefined && spareFamilies === undefined) throw invalidParams('give a strategy, ids or spareFamilies to write', { field: 'strategy' });
  return { providerId, strategy: strategy as GatewayOrderChoice | undefined, ids: ids as string[] | undefined, spareFamilies: spareFamilies as string[] | undefined };
}

/** One write at a time per core: a settings map is read, changed and written back whole. */
const writing = new WeakMap<Core, Promise<unknown>>();

async function write(core: Core, change: Change): Promise<GatewayOrder> {
  const proxy = douaneOf(core);
  if (proxy === null) throw refused('configure a Douane gateway first: the account order is Douane\'s', { field: 'subscriptionProxy.kind', expected: 'douane' });
  const origin = subscriptionProxyOrigin(proxy);
  const token = managementToken(core);
  const held = await read(core, proxy, token);
  if (!held.supported) throw refused(`Douane at ${origin} has no account order yet: update Douane`, { field: 'subscriptionProxy.baseUrl' });
  if (!held.accounts.some(account => account.provider === change.providerId)) throw refused(`Douane at ${origin} has no ${change.providerId} account`, { field: 'providerId' });
  if (change.ids !== undefined) {
    accepted(await gatewayCall(core, proxy, token, '/accounts/order', { provider: change.providerId, ids: change.ids }, { method: 'PUT', plainErrors: true, ...FEATURE }), origin, token);
  }
  const patch: Record<string, unknown> = {};
  // Douane replaces each top-level setting whole, so the other providers' entries go back with this one.
  if (change.strategy !== undefined) patch.provider_strategies = { ...record(held.settings.provider_strategies), [change.providerId]: change.strategy };
  if (change.spareFamilies !== undefined) {
    const spared: Record<string, unknown> = { ...record(held.settings.spare_families) };
    if (change.spareFamilies.length > 0) spared[change.providerId] = [...new Set(change.spareFamilies)];
    else delete spared[change.providerId];
    patch.spare_families = spared;
  }
  if (Object.keys(patch).length > 0) accepted(await gatewayCall(core, proxy, token, '/settings', patch, { method: 'PATCH', plainErrors: true, ...FEATURE }), origin, token);
  core.log('info', `subscription proxy: wrote the ${change.providerId} account order to Douane at ${origin}`);
  return gatewayOrder(core);
}

export function setGatewayOrder(core: Core, params: unknown): Promise<GatewayOrder> {
  const change = validate(params);
  const next = (writing.get(core) ?? Promise.resolve()).then(() => write(core, change), () => write(core, change));
  writing.set(core, next.catch(() => {}));
  return next;
}

export function registerGatewayOrder(core: Core): void {
  core.router.register('subscriptionProxy.order', () => gatewayOrder(core));
  core.router.register('subscriptionProxy.setOrder', params => setGatewayOrder(core, params));
}
