/** The usage order of Douane's accounts, as the core reads and writes it, against no real gateway. */
import { GATEWAY_ORDER_STRATEGIES, isLoopbackHost, RpcErrorCode, subscriptionProxyOrigin, type GatewayOrder, type GatewayOrderChange, type GatewayOrderProvider } from '@boite/contracts';
import { RpcFailure } from '../client';
import type { FakeContext } from './context';
import { douane, hasManagementToken } from './gateway-move';

/** Douane's accounts behind the limit rows of `gatewayQuotas`: the ids are those rows' entry ids. */
const seed = (): GatewayOrderProvider[] => [
  { providerId: 'claude', name: 'Claude', strategy: 'reset-first', spareFamilies: [], accounts: [
    { id: 'claude-1', name: 'chris@…', position: null, enabled: true },
    { id: 'claude-2', name: 'work@…', position: null, enabled: true },
  ] },
  { providerId: 'codex', name: 'Codex', strategy: 'reset-first', spareFamilies: [], accounts: [
    { id: 'codex-1', name: 'chris@…', position: null, enabled: true },
  ] },
  // Shown as one averaged limit row: its accounts have no row of their own.
  { providerId: 'antigravity', name: 'Antigravity', strategy: 'smart', spareFamilies: [], accounts: [
    { id: 'antigravity-1', name: 'one@…', position: null, enabled: true },
    { id: 'antigravity-2', name: 'two@…', position: null, enabled: true },
    { id: 'antigravity-3', name: 'three@…', position: null, enabled: true },
  ] },
];

const states = new WeakMap<FakeContext, GatewayOrderProvider[]>();
function providersOf(ctx: FakeContext): GatewayOrderProvider[] {
  let state = states.get(ctx);
  if (!state) states.set(ctx, state = seed());
  return state;
}

const refusal = (message: string, field: string) => new RpcFailure({ code: RpcErrorCode.Refused, message, data: { field } });
const invalid = (message: string, field: string) => new RpcFailure({ code: RpcErrorCode.InvalidParams, message, data: { field } });

function order(ctx: FakeContext): GatewayOrder {
  const proxy = douane(ctx);
  const token = hasManagementToken(ctx);
  if (!proxy) return { status: 'noProxy', origin: null, managementToken: token, providers: [] };
  const origin = subscriptionProxyOrigin(proxy);
  // A remote Douane wants its management token, as the move does.
  if (!token && !isLoopbackHost(new URL(origin).hostname)) return { status: 'needsToken', origin, managementToken: false, providers: [] };
  return { status: 'ready', origin, managementToken: token, providers: structuredClone(providersOf(ctx)) };
}

export function gatewayOrderMethods(ctx: FakeContext) {
  return {
    'subscriptionProxy.order': async () => order(ctx),
    'subscriptionProxy.setOrder': async ({ providerId, strategy, ids, spareFamilies }: GatewayOrderChange) => {
      if (strategy !== undefined && !GATEWAY_ORDER_STRATEGIES.includes(strategy)) throw invalid(`strategy must be ${GATEWAY_ORDER_STRATEGIES.join(' or ')}`, 'strategy');
      if (strategy === undefined && ids === undefined && spareFamilies === undefined) throw invalid('give a strategy, ids or spareFamilies to write', 'strategy');
      const current = order(ctx);
      if (current.status === 'noProxy') throw refusal('configure a Douane gateway first: the account order is Douane\'s', 'subscriptionProxy.kind');
      if (current.status === 'needsToken') throw refusal(`Douane at ${current.origin} refused the management request (HTTP 401): enter its management token`, 'managementToken');
      const provider = providersOf(ctx).find(entry => entry.providerId === providerId);
      if (!provider) throw refusal(`Douane at ${current.origin} has no ${providerId} account`, 'providerId');
      if (ids !== undefined) {
        const known = new Set(provider.accounts.map(account => account.id));
        if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) {
          throw new RpcFailure({ code: RpcErrorCode.Refused, message: `Douane at ${current.origin} refused the change: ids must list every ${providerId} account exactly once` });
        }
        provider.accounts = ids.map((id, position) => ({ ...provider.accounts.find(account => account.id === id)!, position }));
      }
      if (strategy !== undefined) provider.strategy = strategy;
      if (spareFamilies !== undefined) provider.spareFamilies = [...new Set(spareFamilies)];
      return order(ctx);
    },
  };
}
