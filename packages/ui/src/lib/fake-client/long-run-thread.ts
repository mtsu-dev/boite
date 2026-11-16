import type { MessagePart, Thread } from '@boite/contracts';

const COMMANDS = ['git status --short', 'bun run check', 'ls packages/ui/src/components', 'git diff --stat', 'bun test packages/core/test/turns.test.ts'];
const FILES = ['packages/ui/src/components/ToolGroup.svelte', 'packages/ui/src/lib/tool-groups.ts', 'docs/internals/performance.md', 'packages/core/src/turns.ts'];

/** Call `n` of the run: commands, reads and searches in turn, each with a short output. */
function call(n: number, at: number): Extract<MessagePart, { type: 'tool' }> {
  const kind = n % 5;
  const file = FILES[n % FILES.length]!;
  const name = kind < 3 ? 'Bash' : kind === 3 ? 'Read' : 'Grep';
  const input = name === 'Bash' ? { command: `${COMMANDS[n % COMMANDS.length]} # step ${n + 1}` } : name === 'Read' ? { file_path: file } : { pattern: `step${n + 1}`, path: file };
  return { type: 'tool', toolId: `long-run-${n}`, name, input, output: `step ${n + 1} done\n`, status: 'done', ...(name === 'Bash' ? { exitCode: 0 } : {}), startedAt: at, finishedAt: at + 400 };
}

/**
 * One finished turn whose work is a single run of `count` calls, no words
 * between them: what `?fake=1&run=<n>&open=recent` opens on, to look at a
 * long opened run. It is the most recent thread.
 */
export function longRunThread(count: number): Thread {
  const at = Date.now() - count * 500 - 60_000;
  const turnId = 'turn-long-run';
  const calls = Array.from({ length: count }, (_, n) => call(n, at + n * 500));
  const end = at + count * 500 + 1000;
  return {
    id: 't-long-run', projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default',
    archived: false, pinned: false, title: `A run of ${count} calls`, titleSource: 'prompt', cwd: '/src/boite', branch: null,
    status: 'idle', unread: false, sessionId: 'sess-long-run', load: null, context: null,
    createdAt: at, updatedAt: end, messagesBefore: null, commands: [],
    turns: [{ id: turnId, threadId: 't-long-run', status: 'done', queuedAt: at, startedAt: at, finishedAt: end, usage: null, error: null }],
    messages: [
      { id: 'm-long-run-0', threadId: 't-long-run', turnId, role: 'user', parts: [{ type: 'text', text: `Run the ${count} checks one by one and tell me what failed.` }], state: 'complete', createdAt: at },
      { id: 'm-long-run-1', threadId: 't-long-run', turnId, role: 'assistant', parts: [...calls, { type: 'text', text: `All ${count} checks passed.`, complete: true }], state: 'complete', createdAt: at + 1000 }
    ]
  };
}
