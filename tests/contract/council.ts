/** The council behind its experiment behaves alike on the real core and the in-memory transport (`docs/council.md`). */
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

export const COUNCIL_SCENARIOS: Record<string, Scenario> = {
  'a council waits for its experiment; a start is checked and idempotent, the salon runs no agent, posts aim with @, a closed round waits for what comes next and a closed council takes nothing more': async (env: ContractEnv) => {
    await experiments(env, false);
    same((await refused(env.call('council.list', {}), RpcErrorCode.Refused)).reason, 'experiment-off', 'a list with the experiment off');
    same((await refused(env.call('council.start', { threadId: 'none', request: 'x', models: ['a', 'b'] }), RpcErrorCode.Refused)).reason, 'experiment-off', 'a start with the experiment off');
    await experiments(env, true);
    const started: string[] = [];
    try {
      const { loaded } = await env.call('providers.list', {});
      const provider = loaded.find(entry => entry.protocol === 'echo');
      check(provider, 'no echo provider');
      const account = (await env.call('accounts.list', {})).find(entry => entry.providerId === provider.id);
      check(account, 'no echo account');
      const route = `${provider.id}/${(provider.models.find(entry => entry.default === true) ?? provider.models[0])!.id}`;
      const project = await env.call('projects.add', { path: await env.newFolder(), name: 'council' });
      const parent = await env.call('threads.create', { projectId: project.id, providerId: provider.id, accountId: account.id, title: 'council' });
      const tag = Math.random().toString(36).slice(2, 7);
      // The echo members sleep through the scenario, so the round is still running when it is read and closed.
      const params = { threadId: parent.id, request: `Review the cache plan [sleep:30000] ${tag}`, models: [route, route], requestId: `council-${tag}` };

      same((await refused(env.call('council.start', { ...params, models: [route] }), RpcErrorCode.InvalidParams)).field, 'models', 'a single member');
      same((await refused(env.call('council.start', { ...params, models: [route, 'nobody/model'] }), RpcErrorCode.InvalidParams)).field, 'models', 'a member who cannot run');
      same((await refused(env.call('council.start', { ...params, timeoutMinutes: 0 }), RpcErrorCode.InvalidParams)).field, 'timeoutMinutes', 'no time for a round');

      const council = await env.call('council.start', params);
      started.push(council.id);
      same([council.status, council.round, council.roundsDone, council.members.length, council.parentThreadId], ['running', 1, 0, 2, parent.id], 'a started council');
      same(council.members.map(member => member.scores), [[], []], 'scores before an answer');
      check(new Set(council.members.map(member => member.handle.toLowerCase())).size === 2, 'two members share a handle');
      same((await env.call('council.start', params)).id, council.id, 'a retried start');
      same((await refused(env.call('council.start', { ...params, timeoutMinutes: 3 }), RpcErrorCode.Refused)).field, 'requestId', 'a reused requestId for another council');

      same((await env.call('council.list', { threadId: parent.id })).councils.map(entry => entry.id), [council.id], 'the parent\'s councils');
      const read = await env.call('council.get', { councilId: council.id });
      same([read.council.id, Array.isArray(read.posts)], [council.id, true], 'a read council');
      same((await refused(env.call('council.get', { councilId: `cnl_none_${tag}` }), RpcErrorCode.NotFound)).councilId, `cnl_none_${tag}`, 'an unknown council');
      same((await refused(env.call('council.again', { councilId: council.id, changes: 'Too early' }), RpcErrorCode.Refused)).status, 'running', 'another round during this one');

      // The salon runs no agent: what would reach a provider refuses there.
      const salon = (await env.call('threads.list', { includeArchived: true })).find(entry => entry.id === council.salonThreadId);
      same(salon?.councilId, council.id, 'the salon names its council');
      same(String((await refused(env.call('turns.start', { threadId: council.salonThreadId, prompt: 'hello', clientRequestId: `salon-${tag}` }), RpcErrorCode.Refused)).threadId), council.salonThreadId, 'a turn in the salon');

      same((await refused(env.call('council.post', { councilId: council.id, text: '   ' }), RpcErrorCode.InvalidParams)).field, 'text', 'an empty post');
      let changes = 0;
      const off = env.on('council.changed', event => { if (event.councilId === council.id && event.threadId === parent.id && event.salonThreadId === council.salonThreadId) changes += 1; });
      try {
        const target = council.members[1]!;
        const aimed = await env.call('council.post', { councilId: council.id, text: `@${target.handle} say more`, id: `post-${tag}` });
        same([aimed.author, aimed.to, aimed.round], ['owner', target.id, 2], 'a post naming a member');
        same((await env.call('council.post', { councilId: council.id, text: `@${target.handle} say more`, id: `post-${tag}` })).id, aimed.id, 'a retried post');
        same((await env.call('council.post', { councilId: council.id, text: 'to everyone' })).to, null, 'a post naming nobody');
        await until('a council.changed event', () => changes > 0);
      } finally { off(); }

      // The user closes the round: nobody answered, so nobody has a score, and the table says so.
      const closed = await env.call('council.closeRound', { councilId: council.id });
      same([closed.status, closed.roundsDone, closed.members.map(member => member.absent), closed.members.map(member => member.scores)], ['waiting', 1, [[1], [1]], [[null], [null]]], 'a closed round');
      const { table } = await env.call('council.table', { councilId: council.id });
      same(table.split('\n').slice(0, 5), ['## Council review', '', 'Rounds: 1', '', '| Delegate | Round 1 |'], 'the table of a closed round');
      check(table.endsWith('no score |'), `a member without an answer: ${table}`);
      same((await refused(env.call('council.closeRound', { councilId: council.id }), RpcErrorCode.Refused)).status, 'waiting', 'closing it twice');

      same((await env.call('council.stop', { councilId: council.id })).status, 'done', 'closing between rounds');
      same((await env.call('council.stop', { councilId: council.id })).status, 'done', 'closing twice');
      same((await refused(env.call('council.post', { councilId: council.id, text: 'late' }), RpcErrorCode.Refused)).status, 'done', 'a post after the end');
      same((await refused(env.call('council.again', { councilId: council.id, changes: 'More' }), RpcErrorCode.Refused)).status, 'done', 'another round after the end');

      const second = await env.call('council.start', { ...params, requestId: `council-${tag}-2` });
      started.push(second.id);
      same((await env.call('council.stop', { councilId: second.id })).status, 'stopped', 'stopping a round under way');
      same((await refused(env.call('council.closeRound', { councilId: second.id }), RpcErrorCode.Refused)).status, 'stopped', 'closing a stopped round');
    } finally {
      for (const councilId of started) await env.call('council.stop', { councilId }).catch(() => undefined);
      await experiments(env, false);
    }
  },
};
