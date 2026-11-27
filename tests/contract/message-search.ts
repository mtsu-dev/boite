import { RpcErrorCode } from '../../packages/contracts/src/index.ts';
import type { ContractEnv, Scenario } from './scenarios.ts';

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until(what: string, test: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!(await test())) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function refused(call: Promise<unknown>, code: number, field?: string): Promise<void> {
  let error: unknown = null;
  try { await call; } catch (caught) { error = caught; }
  check(error !== null, `expected code ${code}, the call succeeded`);
  const raw = error as { code?: number; data?: { field?: unknown }; rpc?: { code?: number; data?: { field?: unknown } } };
  const got = raw.rpc ?? raw;
  check(got.code === code, `expected code ${code}, got ${String(got.code)}`);
  if (field !== undefined) check(got.data?.field === field, `expected field ${field}, got ${String(got.data?.field)}`);
}

async function finishedTurn(env: ContractEnv, threadId: string, prompt: string): Promise<void> {
  await env.call('turns.start', { threadId, prompt });
  await until('the echo turn to finish', async () => {
    const thread = (await env.call('threads.list', { includeArchived: true })).find(item => item.id === threadId);
    return thread !== undefined && !['queued', 'running', 'waiting'].includes(thread.status);
  });
}

export const MESSAGE_SEARCH_SCENARIOS: Record<string, Scenario> = {
  'threads.search finds message mentions across threads, ignores incognito threads, and validates params': async (env: ContractEnv) => {
    const account = (await env.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
    const project = await env.call('projects.add', { path: await env.newFolder(), name: 'Search contract' });
    const visible = await env.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Searchable thread' });
    const drafts = await env.call('projects.drafts', {});
    const secret = await env.call('threads.create', { projectId: drafts.id, providerId: 'echo', accountId: account.id, title: 'Private thread', incognito: true });
    await finishedTurn(env, visible.id, 'Investigate zephyr-contract-token failure');
    await finishedTurn(env, secret.id, 'Investigate zephyr-contract-token privately');

    const hits = await env.call('threads.search', { query: 'zephyr-contract-token' });
    check(hits.matches.some(match => match.threadId === visible.id), 'expected threads.search to match the visible thread');
    check(!hits.matches.some(match => match.threadId === secret.id), 'expected threads.search to exclude incognito threads');
    const empty = await env.call('threads.search', { query: '   ' });
    check(empty.matches.length === 0, 'blank query must return no matches');
    await refused(env.call('threads.search', { query: 'hello', limit: 0 }), RpcErrorCode.InvalidParams, 'limit');

    const agent = await env.peer({ agentThreadId: visible.id });
    await refused(agent.call('threads.search', { query: 'zephyr-contract-token' }), RpcErrorCode.Refused);
  },
};
