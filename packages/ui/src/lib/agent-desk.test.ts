import { expect, test } from 'vitest';
import type { AgentWatch } from '@boite/contracts';
import { deskOrder, deskState, deskTone, memoryNotes, splitDesk } from './agent-desk';

const watch = (threadId: string, extra: Partial<AgentWatch> = {}): AgentWatch => ({
  agentId: 'a', threadId, title: threadId, projectId: null, origin: 'started', since: 0, state: 'idle', stalledSince: null, lastActivityAt: 0, pullRequest: null, question: null, ...extra,
});
const pr = (state: 'open' | 'merged' | 'closed', checks: 'pending' | 'passing' | 'failing' | null = null) => ({ number: 1, url: 'https://example.test/pull/1', state, checks });

test('a desk card says first what needs the user, then a silent turn, a failure, work under way, then its pull request and how it rests', () => {
  expect(deskState(watch('q', { state: 'needs-you', stalledSince: 5, pullRequest: pr('open', 'failing') }))).toBe('needs-you');
  expect(deskState(watch('s', { state: 'working', stalledSince: 5 }))).toBe('stalled');
  // A stall belongs to a running turn: one left over on a settled thread says nothing.
  expect(deskState(watch('s2', { state: 'idle', stalledSince: 5 }))).toBe('idle');
  expect(deskState(watch('f', { state: 'failed', pullRequest: pr('open') }))).toBe('failed');
  expect(deskState(watch('w', { state: 'working', pullRequest: pr('open', 'pending') }))).toBe('working');
  expect(deskState(watch('m', { state: 'done', pullRequest: pr('merged') }))).toBe('merged');
  expect(deskState(watch('r', { state: 'idle', pullRequest: pr('open', 'failing') }))).toBe('review');
  expect(deskState(watch('c', { state: 'done', pullRequest: pr('closed') }))).toBe('done');
  expect(deskState(watch('a', { state: 'archived' }))).toBe('archived');
  // Hue says status: yellow for what waits, danger for what broke, success once merged or done, the accent only for work under way.
  expect(['needs-you', 'stalled', 'review'].map(s => deskTone(s as never))).toEqual(['live', 'live', 'live']);
  expect([deskTone('failed'), deskTone('merged'), deskTone('working'), deskTone('done'), deskTone('idle')]).toEqual(['danger', 'success', 'accent', 'success', 'muted']);
});

test('the desk lists its threads in launch order, whatever their state or last activity', () => {
  const order = deskOrder([
    watch('done', { state: 'done', createdAt: 40, lastActivityAt: 90 }),
    watch('old-work', { state: 'working', createdAt: 10, lastActivityAt: 10 }),
    watch('ask', { state: 'needs-you', createdAt: 30, lastActivityAt: 1 }),
    watch('new-work', { state: 'working', createdAt: 20, lastActivityAt: 50 }),
    // Another machine's thread has no creation date: it takes the day it came onto the desk.
    watch('remote', { state: 'working', since: 25, coreId: 'core_b', lastActivityAt: 3 }),
    // Launched in the same millisecond: the id breaks the tie, the same way each time.
    watch('twin-b', { state: 'idle', createdAt: 50 }),
    watch('twin-a', { state: 'failed', createdAt: 50 }),
  ]);
  expect(order.map(w => w.threadId)).toEqual(['old-work', 'new-work', 'remote', 'ask', 'done', 'twin-a', 'twin-b']);
});

test('a card holds its place while its thread works, stalls, asks or fails, and moves only when it changes section', () => {
  const launched = [
    watch('models', { state: 'working', createdAt: 100, since: 100 }),
    watch('audit', { state: 'working', createdAt: 200, since: 200 }),
    watch('settings', { state: 'working', createdAt: 300, since: 300 }),
  ];
  const ids = (list: AgentWatch[]) => list.map(w => w.threadId);
  // Every tool call bumps the activity, the bot touching a thread again moves its `since`, and states swap.
  const moves: Partial<AgentWatch>[][] = [
    [{ lastActivityAt: 900 }, { lastActivityAt: 500 }, { lastActivityAt: 700 }],
    [{ stalledSince: 400 }, { state: 'needs-you', lastActivityAt: 950 }, { state: 'queued', since: 50 }],
    [{ state: 'failed', lastActivityAt: 1 }, { state: 'idle', pullRequest: pr('open', 'failing') }, { lastActivityAt: 2000, since: 1500 }],
  ];
  for (const move of moves) {
    const { handling, done } = splitDesk(launched.map((w, i) => ({ ...w, ...move[i] })).reverse());
    expect(ids(handling)).toEqual(['models', 'audit', 'settings']);
    expect(done).toEqual([]);
  }
  // The middle one finishes: it leaves for Done, the others keep their order.
  const { handling, done } = splitDesk([launched[2]!, { ...launched[1]!, state: 'done', lastActivityAt: 5000 }, { ...launched[0]!, lastActivityAt: 4000 }]);
  expect(ids(handling)).toEqual(['models', 'settings']);
  expect(ids(done)).toEqual(['audit']);
});

test('the column keeps what the mochi still handles apart from what it is done with', () => {
  const { handling, done } = splitDesk([
    watch('merged', { state: 'done', pullRequest: pr('merged'), createdAt: 1, lastActivityAt: 9 }),
    watch('review', { state: 'idle', pullRequest: pr('open', 'failing'), createdAt: 2, lastActivityAt: 8 }),
    watch('ask', { state: 'needs-you', createdAt: 3, lastActivityAt: 1 }),
    watch('old', { state: 'archived', createdAt: 4, lastActivityAt: 2 }),
    watch('closed', { state: 'done', pullRequest: pr('closed'), createdAt: 5, lastActivityAt: 7 }),
  ]);
  expect(handling.map(w => w.threadId)).toEqual(['review', 'ask']);
  expect(done.map(w => w.threadId)).toEqual(['merged', 'old', 'closed']);
});

test('a memory reads as its list items, else its paragraphs, in plain words', () => {
  expect(memoryNotes('# Memory\n\n- The **e2e** suite needs `staging` once a week.\n* [Retry](https://x.test) once.\n1. Release PRs wait.\n')).toEqual([
    'The e2e suite needs staging once a week.', 'Retry once.', 'Release PRs wait.',
  ]);
  expect(memoryNotes('## Notes\nFirst paragraph.\n\n---\nSecond one.')).toEqual(['First paragraph.', 'Second one.']);
  expect(memoryNotes('  \n')).toEqual([]);
  // An identifier keeps its underscores; only a word wrapped in them is emphasis.
  expect(memoryNotes('- Deploy my_cool_project with _care_.')).toEqual(['Deploy my_cool_project with care.']);
});
