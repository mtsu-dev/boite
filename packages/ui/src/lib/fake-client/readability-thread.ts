import type { Message, MessagePart, Thread, Turn } from '@boite/contracts';

/**
 * A conversation shaped like the long ones a coding agent leaves over a few
 * days, what `?fake=1&readability=1` opens: a request worked through with
 * narration between its calls and a compaction in the middle, an automatic
 * compaction, then the pull request's watch and a subagent's review waking
 * the agent the next day, and a last question today. The shape is the one the
 * user's own threads showed on 2026-10-31 ([development](../../../../../docs/development.md)).
 */
const MINUTE = 60_000;
const DAY = 86_400_000;

type Step = { tool: string; input: Record<string, unknown>; output: string } | { text: string } | { compaction: [number, number] };

export function readabilityThread(now = Date.now()): Thread {
  const id = 't-readable';
  const turns: Turn[] = [];
  const messages: Message[] = [];
  let seq = 0;
  /** Two days ago at 15:00, local time. */
  const start = new Date(now - 2 * DAY);
  start.setHours(15, 0, 0, 0);
  const base = start.getTime();

  function turn(at: number, minutes: number, prompt: { text: string; display?: string; role?: 'user' | 'system' }, steps: Step[], operation?: NonNullable<Turn['execution']>['operation'], automatic = false): void {
    const turnId = `turn-readable-${++seq}`;
    turns.push({
      id: turnId, threadId: id, status: 'done', queuedAt: at, startedAt: at, finishedAt: at + minutes * MINUTE, usage: null, error: null,
      ...(operation ? { execution: { providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, speed: null, permissionMode: 'default', sessionId: 'sess-readable', sessionGeneration: 0, selectionVersion: 0, operation, ...(automatic ? { automatic: true as const } : {}) } } : {})
    });
    messages.push({ id: `m-readable-${seq}-0`, threadId: id, turnId, role: prompt.role ?? 'user', state: 'complete', createdAt: at,
      parts: [{ type: 'text', text: prompt.text, ...(prompt.display ? { displayText: prompt.display } : {}) }] });
    const parts: MessagePart[] = steps.map((step, index): MessagePart => {
      if ('text' in step) return { type: 'text', text: step.text };
      if ('compaction' in step) return { type: 'compaction', trigger: 'auto', preTokens: step.compaction[0], postTokens: step.compaction[1] };
      const startedAt = at + 5_000 + index * 15_000;
      return { type: 'tool', toolId: `tool-readable-${seq}-${index}`, name: step.tool, input: step.input, output: step.output, status: 'done', startedAt, finishedAt: startedAt + 6_000 };
    });
    messages.push({ id: `m-readable-${seq}-1`, threadId: id, turnId, role: 'assistant', state: 'complete', createdAt: at + 1_000, parts });
  }

  const bash = (command: string, output = 'ok'): Step => ({ tool: 'Bash', input: { command }, output });
  const edit = (file: string): Step => ({ tool: 'Edit', input: { file_path: file, old_string: 'repo', new_string: 'branchRepo' }, output: 'ok' });

  turn(base, 22, { text: 'the PR badge never shows merged, fix it' }, [
    { text: 'I reproduce it first, then check how a branch finds its pull request.' },
    bash('rg -n "pullRequest" packages/core/src'), bash('bun test packages/core/test/pull-requests.test.ts', '3 fail'), bash('gh pr view 904 --json state'),
    { text: 'Reproduced: the badge asks the wrong repository when the branch was pushed to a fork.' },
    edit('packages/core/src/pull-requests.ts'), edit('packages/core/test/pull-requests.test.ts'), bash('bun test packages/core/test/pull-requests.test.ts', '82 pass'),
    { compaction: [201_200, 13_400] },
    bash('bun run check'), bash('git push -u origin boite/pr-badge'),
    { text: 'Tests pass. Sol reviews it before I open the pull request.' },
    bash('boite delegate spawn "review the diff"'),
    { text: 'Fixed. The badge reads the branch\'s own repository now, and a merged pull request turns purple within a minute. 82 tests pass; pull request #904 is open.' },
  ]);
  turn(base + 40 * MINUTE, 1, { text: '/compact', display: 'Automatic compaction', role: 'system' }, [{ compaction: [76_000, 9_700] }], 'compact', true);
  turn(base + DAY - 6 * 60 * MINUTE, 6, { text: 'Boite is watching this pull request for you and it changed.', display: 'Pull request update, #904: new comments', role: 'system' }, [
    bash('gh pr view 904 --comments'), edit('packages/core/src/pull-requests.ts'), bash('bun test packages/core/test/pull-requests.test.ts', '83 pass'), bash('git push'),
    { text: 'Fixed the point mtsu-patrol raised in `c320811` and pushed it. CI and the new review are running.' },
  ], 'pull-request');
  turn(base + DAY - 5 * 60 * MINUTE, 1, { text: 'Boite is watching this pull request for you and it changed.', display: 'Pull request update, #904: checks passed', role: 'system' }, [
    bash('gh pr checks 904'),
    { text: 'CI passed on `c320811`; the review is still running. I end the turn, the watch wakes me.' },
  ], 'pull-request');
  turn(base + DAY - 4 * 60 * MINUTE, 9, { text: 'Boite delegation messages.', display: 'Agent delegation', role: 'system' }, [
    bash('boite delegate list'),
    { text: 'Sol found a race between the event and the reply in flight. I fix it with a regression test.' },
    edit('packages/core/src/pull-requests.ts'), bash('bun test packages/core/test/pull-requests.test.ts', '84 pass'), bash('git push'),
    { text: 'The race is fixed with a test that fails before the change. PR #904 is green and waits for your merge.' },
  ], 'delegation');
  const today = new Date(now);
  today.setHours(10, 30, 0, 0);
  turn(Math.min(today.getTime(), now - 10 * MINUTE), 1, { text: 'alors ?' }, [
    { text: 'PR #904 is green: the badge follows the branch\'s repository, merged turns purple within a minute, and the race Sol found has its test. It waits for your merge.' },
  ]);

  const last = messages.at(-1)!.createdAt;
  return {
    id, projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default',
    archived: false, pinned: false, title: 'Fix the pull request badge', titleSource: 'prompt', cwd: 'C:\\src\\boite', branch: 'boite/pr-badge',
    status: 'idle', unread: false, sessionId: 'sess-readable', load: null, context: { tokens: 31_000, window: 200_000, at: last },
    createdAt: base, updatedAt: last + MINUTE, messagesBefore: null, commands: [], turns, messages
  };
}
