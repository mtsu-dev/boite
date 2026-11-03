/** Debates between AIs behind their experiment behave alike on the real core and the in-memory transport (`docs/debates.md`). */
import { RpcErrorCode } from '../../packages/contracts/src/index.ts';
import type { ContractEnv, Scenario } from './scenarios.ts';

function check(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
function same(actual: unknown, expected: unknown, what: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
/** The refusal's data, once the call failed with `code`. */
async function refused(call: Promise<unknown>, code: number): Promise<Record<string, unknown>> {
  let failure: unknown;
  try { await call; } catch (error) { failure = error; }
  const e = failure as { code?: number; data?: Record<string, unknown>; rpc?: { code: number; data?: Record<string, unknown> } } | undefined;
  check((e?.rpc?.code ?? e?.code) === code, `expected ${code}, got ${String(failure)}`);
  return e?.rpc?.data ?? e?.data ?? {};
}
async function until(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!ready()) {
    check(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const experiments = (env: ContractEnv, on: boolean) =>
  env.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: on ? ['debates'] : [], labels: {} });

export const DEBATE_SCENARIOS: Record<string, Scenario> = {
  'debates wait for their experiment; a start is checked and idempotent, the salon runs no agent, posts aim with @ and a stopped debate takes nothing more': async (env: ContractEnv) => {
    await experiments(env, false);
    same((await refused(env.call('debates.list', {}), RpcErrorCode.Refused)).reason, 'experiment-off', 'a list with the experiment off');
    same((await refused(env.call('debates.start', { threadId: 'none', topic: 'x', models: ['a', 'b'] }), RpcErrorCode.Refused)).reason, 'experiment-off', 'a start with the experiment off');
    await experiments(env, true);
    let debateId: string | null = null;
    try {
      const { loaded } = await env.call('providers.list', {});
      const provider = loaded.find(entry => entry.protocol === 'echo');
      check(provider, 'no echo provider');
      const account = (await env.call('accounts.list', {})).find(entry => entry.providerId === provider.id);
      check(account, 'no echo account');
      const route = `${provider.id}/${(provider.models.find(entry => entry.default === true) ?? provider.models[0])!.id}`;
      const project = await env.call('projects.add', { path: await env.newFolder(), name: 'debate' });
      const parent = await env.call('threads.create', { projectId: project.id, providerId: provider.id, accountId: account.id, title: 'debate' });
      const tag = Math.random().toString(36).slice(2, 7);
      // The echo debaters sleep through the scenario, so the debate is still running when it is read and stopped.
      const params = { threadId: parent.id, topic: `Which cache? [sleep:30000] ${tag}`, models: [route, route], summary: route, rounds: 2, requestId: `debate-${tag}` };

      same((await refused(env.call('debates.start', { ...params, models: [route] }), RpcErrorCode.InvalidParams)).field, 'models', 'a single debater');
      same((await refused(env.call('debates.start', { ...params, rounds: 6 }), RpcErrorCode.InvalidParams)).field, 'rounds', 'six rounds');
      same((await refused(env.call('debates.start', { ...params, angles: ['one'] }), RpcErrorCode.InvalidParams)).field, 'angles', 'one angle for two debaters');

      const debate = await env.call('debates.start', params);
      debateId = debate.id;
      same([debate.status, debate.round, debate.rounds, debate.participants.length, debate.parentThreadId], ['running', 1, 2, 2, parent.id], 'a started debate');
      same(debate.participants.map(p => p.letter).sort(), ['A', 'B'], 'the debaters\' letters');
      check(new Set(debate.participants.map(p => p.handle.toLowerCase())).size === 2, 'two debaters share a handle');
      same((await env.call('debates.start', params)).id, debate.id, 'a retried start');
      same((await refused(env.call('debates.start', { ...params, rounds: 3 }), RpcErrorCode.Refused)).field, 'requestId', 'a reused requestId for another debate');

      same((await env.call('debates.list', { threadId: parent.id })).debates.map(entry => entry.id), [debate.id], 'the parent\'s debates');
      const read = await env.call('debates.get', { debateId: debate.id });
      same([read.debate.id, Array.isArray(read.posts)], [debate.id, true], 'a read debate');
      same((await refused(env.call('debates.get', { debateId: `dbt_none_${tag}` }), RpcErrorCode.NotFound)).debateId, `dbt_none_${tag}`, 'an unknown debate');

      // The salon runs no agent: what would reach a provider refuses there.
      const salon = (await env.call('threads.list', { includeArchived: true })).find(entry => entry.id === debate.salonThreadId);
      same(salon?.debateId, debate.id, 'the salon names its debate');
      same(String((await refused(env.call('turns.start', { threadId: debate.salonThreadId, prompt: 'hello', clientRequestId: `salon-${tag}` }), RpcErrorCode.Refused)).threadId), debate.salonThreadId, 'a turn in the salon');

      same((await refused(env.call('debates.post', { debateId: debate.id, text: '   ' }), RpcErrorCode.InvalidParams)).field, 'text', 'an empty post');
      let changes = 0;
      const off = env.on('debates.changed', event => { if (event.debateId === debate.id && event.threadId === parent.id && event.salonThreadId === debate.salonThreadId) changes += 1; });
      try {
        const target = debate.participants[1]!;
        const aimed = await env.call('debates.post', { debateId: debate.id, text: `@${target.handle} say more`, id: `post-${tag}` });
        same([aimed.author, aimed.to, aimed.round], ['owner', target.id, 2], 'a post naming a debater');
        same((await env.call('debates.post', { debateId: debate.id, text: `@${target.handle} say more`, id: `post-${tag}` })).id, aimed.id, 'a retried post');
        same((await env.call('debates.post', { debateId: debate.id, text: 'to everyone' })).to, null, 'a post naming nobody');
        await until('a debates.changed event', () => changes > 0);
      } finally { off(); }

      const stopped = await env.call('debates.stop', { debateId: debate.id });
      same(stopped.status, 'stopped', 'a stopped debate');
      same((await refused(env.call('debates.post', { debateId: debate.id, text: 'late' }), RpcErrorCode.Refused)).status, 'stopped', 'a post after the stop');
      await refused(env.call('debates.next', { debateId: debate.id }), RpcErrorCode.Refused);
      same((await env.call('debates.conclude', { debateId: debate.id })).status, 'stopped', 'concluding a stopped debate');
      same((await env.call('debates.stop', { debateId: debate.id })).status, 'stopped', 'stopping twice');
    } finally {
      if (debateId) await env.call('debates.stop', { debateId }).catch(() => undefined);
      await experiments(env, false);
    }
  },
};
