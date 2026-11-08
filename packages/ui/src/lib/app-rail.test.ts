import { expect, test } from 'vitest';
import { railBotState, threadsNeedingYou } from './app-rail';

test("a bot's picture reads its thread first, then its snapshot, a question outranking work", () => {
  const active = { status: 'active' } as const;
  expect(railBotState(active, null, { status: 'running' }, false)).toBe('working');
  expect(railBotState(active, null, { status: 'running' }, true)).toBe('waiting');
  expect(railBotState(active, null, { status: 'queued' }, false)).toBe('queued');
  expect(railBotState(active, null, { status: 'idle' }, true)).toBe('waiting');
  expect(railBotState(active, { state: 'error' } as never, null, false)).toBe('failed');
  expect(railBotState({ status: 'paused' }, null, null, false)).toBe('paused');
  expect(railBotState(active, null, null, false)).toBe('idle');
});

test("the needs-you count is Activity's waiting rows: a bot's, a team's, a helper's and an archived thread count elsewhere, a bot's worker for itself", () => {
  const base = { unread: false, backgroundWork: undefined, openQuestions: undefined };
  const waiting = { ...base, status: 'waiting' as const };
  const store = {
    threads: [
      { id: 'a', ...waiting },
      { id: 'b', ...base, status: 'running' as const },
      { id: 'c', ...waiting, archived: true },
      { id: 'd', ...waiting, agentSessionId: 'bot' },
      { id: 'e', ...waiting, teamId: 'team' },
      { id: 'f', ...waiting, parentThreadId: 'a' },
      { id: 'g', ...waiting, parentThreadId: 'd' },
    ],
    subagents: (id: string) => (id === 'b' ? { count: 1, asking: 1 } : 0),
  };
  expect(threadsNeedingYou([store, { threads: [{ id: 'a', ...waiting }], subagents: () => 0 }])).toBe(4);
});
