/** Douane's account order answers alike on the real core and the in-memory transport (`docs/providers.md`). */
import { RpcErrorCode } from '../../packages/contracts/src/index.ts';
import { failure, type ContractEnv, type Scenario } from './scenarios.ts';

function check(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
async function refusal(call: Promise<unknown>): Promise<{ code: number; data: Record<string, unknown> }> {
  let caught: unknown;
  try { await call; } catch (error) { caught = error; }
  check(caught !== undefined, 'the call was accepted');
  return failure(caught);
}

export const GATEWAY_ORDER_SCENARIOS: Record<string, Scenario> = {
  'the account order checks a change before any gateway, and without a Douane gateway says so': async (env: ContractEnv) => {
    for (const bad of [{ providerId: 'claude', strategy: 'smart' }, { providerId: 'claude' }]) {
      const refused = await refusal(env.call('subscriptionProxy.setOrder', bad as never));
      check(refused.code === RpcErrorCode.InvalidParams && refused.data.field === 'strategy', `a change of ${JSON.stringify(bad)} was not refused on strategy`);
    }
    const saved = (await env.call('settings.get', {})).subscriptionProxy;
    if (saved?.kind === 'douane') return;
    const order = await env.call('subscriptionProxy.order', {});
    check(order.status === 'noProxy' && order.origin === null && order.providers.length === 0, `no Douane gateway read ${JSON.stringify(order)}`);
    check(!('token' in order) && typeof order.managementToken === 'boolean', 'the order carries more than whether a token is saved');
    const refused = await refusal(env.call('subscriptionProxy.setOrder', { providerId: 'claude', strategy: 'fill-first' }));
    check(refused.code === RpcErrorCode.Refused && refused.data.field === 'subscriptionProxy.kind', 'a write without a Douane gateway was not refused on the gateway kind');
  },
};
