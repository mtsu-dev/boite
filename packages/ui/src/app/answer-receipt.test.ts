import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { mountOnFake, query, test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('a question answered while the agent works leaves the composer and its receipt stays in the transcript, the field in place', async () => {
  await mountOnFake();
  const threadId = store.openThread!.id;
  const question = await store.client!.call('questions.ask', { threadId, text: 'Which checks?', options: ['Unit', 'Browser'] });
  await waitFor(() => document.querySelector('[data-testid=composer] [data-testid=question-option]') !== null);
  // The agent keeps working while the question waits (`boite ask`).
  store.openThread!.status = 'running';
  query<HTMLButtonElement>('[data-testid=question-option]').click();
  // While a question waits, the turn's Stop lives on the foot's Working line, never in the field; the card's own Answer sends.
  await waitFor(() => document.querySelector<HTMLButtonElement>('[data-testid=question-submit]')?.disabled === false);
  expect(document.querySelector('[data-testid=composer-stop]')).toBeNull();
  await waitFor(() => document.querySelector('[data-testid=agent-dock-stop]') !== null);
  const field = query('[data-testid=composer-input]');
  query<HTMLButtonElement>('[data-testid=question-submit]').click();
  await waitFor(() => !store.pendingQuestions.some((pending) => pending.id === question.questionId));
  // Gone from the composer at once, nothing left in its place.
  await waitFor(() => document.querySelector('[data-testid=thread-decision]') === null);
  await waitFor(() => document.querySelector('[data-testid=timeline] [data-testid=question-verdict]') !== null);
  expect(query('[data-testid=timeline] [data-testid=question-verdict]').textContent?.trim()).toBe('You answered: Unit');
  // The same field, never remounted by the card's change.
  expect(query('[data-testid=composer-input]')).toBe(field);
});
