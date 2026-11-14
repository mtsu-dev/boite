/**
 * Live mode: the same tasks as goals in words, one turn each on a real
 * Claude thread. It reaches a login the way the repository's opt-in live
 * tests do (packages/core/test/claude.live.test.ts): a fresh core on a
 * temporary data directory, host agents enabled by the bench's own opt-in
 * variable, and the machine's Default Claude account, which reads the CLI's
 * own login in place. The bench never reads, copies or prints a credential.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Message, RpcEvents } from '../../packages/contracts/src/index.ts';
import { startTestCore } from '../../packages/core/test/harness.ts';
import type { LiveRun } from './report.ts';
import type { FixtureSite } from './site.ts';
import type { Task } from './tasks.ts';

export interface LiveOptions {
  model: string;
  effort: string;
  runs: number;
  timeoutMs: number;
}

const toolParts = (messages: Message[]) =>
  messages.filter((m) => m.role === 'assistant').flatMap((m) => m.parts.filter((p): p is Extract<typeof p, { type: 'tool' }> => p.type === 'tool'));

/** How many `boite browser` commands a tool call ran: a shell call can chain several with `&&`. */
function browserCommands(input: unknown): number {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  return (text.match(/\bboite browser\b/g) ?? []).length;
}

/**
 * A core that just started may still be discovering the account's models and
 * refuses a thread or a turn until it settles ("refresh models"): that call is
 * retried, any other failure is not.
 */
async function settled<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= 3 || !(error instanceof Error) || !error.message.includes('refresh models')) throw error;
      await Bun.sleep(2_000);
    }
  }
}

export function prompt(task: Task, base: string): string {
  return [
    `Open ${base}${task.path} with the \`boite browser\` command and do this task on that site.`,
    task.goal,
    'Use only `boite browser` commands to read and act on the site; do not reach it any other way.',
    'When the task is done, reply with one line: DONE.',
  ].join('\n');
}

export async function runLive(tasks: Task[], site: FixtureSite, options: LiveOptions, log: (line: string) => void): Promise<LiveRun[]> {
  // The harness enables installed agents and their logins only for a listed opt-in; `--live` is this bench's.
  process.env.BOITE_BENCH_CLAUDE = '1';
  const harness = await startTestCore();
  const client = await harness.connect();
  const results: LiveRun[] = [];
  try {
    // The guide is what tells an agent `boite browser` exists; no brain folder is linked.
    await client.call('brain.configure', { path: null, enabled: false, boiteGuide: true });
    const accounts = await client.call('accounts.list', {});
    const account = accounts.find((entry) => entry.providerId === 'claude' && entry.label === 'Default');
    if (account === undefined) throw new Error(`no Default Claude account on this machine (accounts: ${accounts.map((a) => `${a.providerId}/${a.label}`).join(', ')})`);
    if (account.status !== 'ok') throw new Error(`the Default Claude account is not usable: status ${JSON.stringify(account.status)}`);

    for (const task of tasks) {
      for (let run = 1; run <= options.runs; run++) {
        const workspace = join(harness.dataDir, 'live', `${task.id}-${run}`);
        mkdirSync(workspace, { recursive: true });
        const project = await client.call('projects.add', { path: workspace, name: `${task.id}-${run}` });
        const thread = await settled(() => client.call('threads.create', {
          projectId: project.id,
          providerId: 'claude',
          accountId: account.id,
          cwd: workspace,
          model: options.model,
          effort: options.effort,
          permissionMode: 'bypassPermissions',
          title: `browser bench ${task.id}`,
        }));
        await client.call('threads.subscribe', { threadId: thread.id });
        site.reset(task.id);
        log(`[live] ${task.id} run ${run}`);
        const finished = client.next('turn.finished', (turn) => turn.threadId === thread.id, options.timeoutMs);
        const started = performance.now();
        await settled(() => client.call('turns.start', { threadId: thread.id, prompt: prompt(task, site.url) }));
        let turn: RpcEvents['turn.finished'] | null = null;
        let error: string | null = null;
        try {
          turn = await finished;
        } catch {
          error = `no turn.finished within ${Math.round(options.timeoutMs / 1000)} s`;
          await client.call('turns.stop', { threadId: thread.id }).catch(() => undefined);
          await client.next('turn.finished', (t) => t.threadId === thread.id, 30_000).catch(() => undefined);
        }
        const wallMs = performance.now() - started;
        const { messages } = await client.call('threads.get', { threadId: thread.id });
        const tools = toolParts(messages);
        const checked = task.check(site.state);
        const usage = turn?.usage ?? null;
        results.push({
          task: task.id,
          run,
          ok: checked.ok,
          detail: checked.detail,
          toolCalls: tools.length,
          browserCommands: tools.reduce((sum, part) => sum + browserCommands(part.input), 0),
          inputTokens: usage?.inputTokens ?? null,
          cacheReadTokens: usage?.cacheReadTokens ?? null,
          cacheWriteTokens: usage?.cacheWriteTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          costUsdEquivalent: usage?.costUsdEquivalent ?? null,
          wallMs,
          status: turn?.status ?? 'timeout',
          error: error ?? turn?.error ?? null,
          ranWith: turn?.execution === undefined ? 'n/a' : `${turn.execution.model} ${turn.execution.effort ?? 'default'}`,
        });
        log(`[live] ${task.id} run ${run}: ${checked.ok ? 'ok' : 'failed'} (${checked.detail}), ${tools.length} tool calls, ${Math.round(wallMs / 1000)} s`);
        await client.call('threads.unsubscribe', { threadId: thread.id }).catch(() => undefined);
      }
    }
  } finally {
    client.close();
    await harness.stop();
  }
  return results;
}
