import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { ignoreQuestions } from '../lib/question-reply.svelte';
import { mountOnFake, query, test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('a question answered while the agent works leaves a receipt in the dock until the turn ends, the field in place', async () => {
  await mountOnFake();
  const threadId = store.openThread!.id;
  const question = await store.client!.call('questions.ask', { threadId, text: 'Which checks?', options: ['Unit', 'Browser'] });
  await waitFor(() => document.querySelector('[data-testid=question-option]') !== null);
  // The agent keeps working while the question waits (`boite ask`).
  store.openThread!.status = 'running';
  query<HTMLButtonElement>('[data-testid=question-option]').click();
  // A pick alone leaves Stop as Stop (round 18 turned it into Send): the card's own Answer sends.
  await waitFor(() => document.querySelector<HTMLButtonElement>('[data-testid=question-submit]')?.disabled === false);
  expect(document.querySelector('[data-testid=composer-stop]')).not.toBeNull();
  expect(query('[data-testid=composer-send]').classList.contains('resting')).toBe(true);
  const field = query('[data-testid=composer-input]');
  query<HTMLButtonElement>('[data-testid=question-submit]').click();
  await waitFor(() => !store.pendingQuestions.some((pending) => pending.id === question.questionId));
  await waitFor(() => document.querySelector('[data-testid=answer-receipt]') !== null);
  expect(query('[data-testid=answer-receipt]').textContent?.trim()).toBe('You answered: Unit');
  // The same field, never remounted by the dock's change.
  expect(query('[data-testid=composer-input]')).toBe(field);
  // The turn ends: the receipt goes with it.
  store.openThread!.status = 'idle';
  await waitFor(() => document.querySelector('[data-testid=answer-receipt]') === null);
});

test('the docked card answering on its own leaves the same receipt as the composer', async () => {
  await mountOnFake();
  const threadId = store.openThread!.id;
  const question = await store.client!.call('questions.ask', { threadId, text: 'Which checks?', options: ['Unit', 'Browser'] });
  await waitFor(() => document.querySelector('[data-testid=question-option]') !== null);
  store.openThread!.status = 'running';
  // The composer writes ordinary messages: the card's own Answer sends.
  ignoreQuestions(store);
  query<HTMLButtonElement>('[data-testid=question-option]').click();
  await waitFor(() => document.querySelector<HTMLButtonElement>('[data-testid=question-submit]')?.disabled === false);
  query<HTMLButtonElement>('[data-testid=question-submit]').click();
  await waitFor(() => !store.pendingQuestions.some((pending) => pending.id === question.questionId));
  await waitFor(() => document.querySelector('[data-testid=answer-receipt]') !== null);
  expect(query('[data-testid=answer-receipt]').textContent?.trim()).toBe('You answered: Unit');
  store.openThread!.status = 'idle';
  await waitFor(() => document.querySelector('[data-testid=answer-receipt]') === null);
});
