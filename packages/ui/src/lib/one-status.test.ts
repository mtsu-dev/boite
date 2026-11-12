import { expect, test } from 'vitest';
import { asksDocked } from './one-status';
import type { Store } from './store.svelte';

const store = (asks: object[]) => ({ openThread: { id: 't1' }, pendingQuestions: asks.map((ask, at) => ({ id: `q${at}`, threadId: 't1', ...ask })) }) as unknown as Store;

test('only a question that waits at the top of the composer counts as docked: a settings or team card keeps its own', () => {
  expect(asksDocked(store([{}]), 't1')).toBe(true);
  expect(asksDocked(store([{ setting: { key: 'model' } }]), 't1')).toBe(false);
  expect(asksDocked(store([{ team: { id: 'x' } }]), 't1')).toBe(false);
  expect(asksDocked(store([{ team: { id: 'x' }, async: true }]), 't1')).toBe(true);
  expect(asksDocked(store([{}]), 't2')).toBe(false);
});
