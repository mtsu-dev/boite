import { RpcErrorCode } from '../../packages/contracts/src/index.ts';
import { failure, type ContractEnv, type Scenario } from './scenarios.ts';

/* `presence.set`, the same on the real core and the in-memory client. Only refusals and the clear: an activity would reach a chat app running beside the test. */

async function refusedField(call: Promise<unknown>, field: string): Promise<void> {
  let answer: unknown;
  try { answer = await call; } catch (error) {
    const { code, data } = failure(error);
    if (code !== RpcErrorCode.InvalidParams || data['field'] !== field) throw new Error(`expected invalid ${field}, got code ${code} on ${String(data['field'])}`);
    return;
  }
  throw new Error(`expected invalid ${field}, the call answered ${JSON.stringify(answer)}`);
}

export const PRESENCE_SCENARIOS: Record<string, Scenario> = {
  'presence.set refuses a line Discord would refuse or a field it does not know, and a clear answers no chat app': async (env: ContractEnv) => {
    await refusedField(env.call('presence.set', { activity: { details: 'x' } }), 'activity.details');
    await refusedField(env.call('presence.set', { activity: { details: 'Working', state: 'y'.repeat(129) } }), 'activity.state');
    await refusedField(env.call('presence.set', { activity: { details: 'Working', button: 'z'.repeat(33) } }), 'activity.button');
    await refusedField(env.call('presence.set', { activity: { details: 'Working', color: 'red' } as never }), 'activity.color');
    const cleared = await env.call('presence.set', { activity: null });
    if (JSON.stringify(cleared) !== JSON.stringify({ active: false, targets: [] })) throw new Error(`a clear answered ${JSON.stringify(cleared)}`);
  },
};
