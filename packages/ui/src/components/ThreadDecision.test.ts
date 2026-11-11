import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { QuestionRequest, Thread, ThreadSummary } from '@boite/contracts';
import { Store } from '../lib/store.svelte';
import { replyTarget, repliesOf } from '../lib/question-reply.svelte';
import { workspace } from '../lib/workspace.svelte';
import ThreadDecision from './ThreadDecision.svelte';

let view: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (view) unmount(view, { outro: false });
  view = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
/** The card at the end of thread `thread`'s timeline, as MessageList draws it. */
function render(status: 'idle' | 'running' = 'idle') {
  const store = new Store();
  store.connection = 'ready';
  store.openThread = { id: 'thread', status, turns: [], activity: null } as unknown as Thread;
  view = mount(ThreadDecision, { target: document.body, props: { store, threadId: 'thread' } });
  flushSync();
  return store;
}
const question = (id: string, createdAt: number): QuestionRequest => ({
  id, threadId: 'thread', turnId: 'turn', text: `Question ${id}`, options: [{ id: 'yes', label: 'Yes' }], allowText: true, multiple: false, async: true, createdAt
});
const shownQuestion = () => document.querySelector('[data-testid=activity-question]:not([hidden])')?.getAttribute('data-question');
const push = { id: 'perm', threadId: 'thread', turnId: 'turn', toolName: 'Bash', input: { command: 'git push' }, description: 'Push', createdAt: 1 };
const key = (target: EventTarget, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

test('pending questions open oldest first, including a restored unordered list', () => {
  const store = render();
  flushSync(() => { store.pendingQuestions = [question('middle', 2), question('oldest', 1), question('newest', 3)]; });
  expect(shownQuestion()).toBe('oldest');
  // The head holds the question and the fold; the pager leads the line of Skip and Answer.
  const head = document.querySelector('[data-testid=activity-question]:not([hidden]) .decision-head')!;
  expect(head.querySelector('[data-testid=activity-question-index]')).toBeNull();
  expect(head.querySelector('[data-testid=activity-question-toggle]')).not.toBeNull();
  expect(document.querySelector('[data-testid=activity-question]:not([hidden]) .decision-actions .pager-line [data-testid=activity-question-index]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[data-testid=activity-question-next]')!.click();
  flushSync();
  expect(shownQuestion()).toBe('middle');
});

test('new questions leave the current question and selection in place, then answers advance oldest first', () => {
  const store = render();
  flushSync(() => { store.pendingQuestions = [question('oldest', 1)]; });
  const option = document.querySelector<HTMLButtonElement>('[data-testid=question-option]')!;
  option.click();
  flushSync();
  const fold = document.querySelector<HTMLButtonElement>('[data-testid=activity-question-toggle]')!;
  fold.click();
  flushSync();
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  flushSync(() => { store.pendingQuestions = [...store.pendingQuestions, question('middle', 2), question('newest', 3)]; });
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  expect(shownQuestion()).toBe('oldest');
  expect(document.querySelector('[data-testid=activity-question-index]')!.textContent).toBe('Question 1 of 3');
  expect(option.getAttribute('aria-checked')).toBe('true');
  // Explicit navigation remains possible, and later arrivals do not steal it.
  document.querySelector<HTMLButtonElement>('[data-testid=activity-question-next]')!.click();
  flushSync();
  expect(shownQuestion()).toBe('middle');
  flushSync(() => { store.pendingQuestions = [...store.pendingQuestions, question('last', 4)]; });
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  expect(shownQuestion()).toBe('middle');
  flushSync(() => { store.pendingQuestions = store.pendingQuestions.filter(q => q.id !== 'middle'); });
  expect(shownQuestion()).toBe('oldest');
  flushSync(() => { store.pendingQuestions = store.pendingQuestions.filter(q => q.id !== 'oldest'); });
  expect(shownQuestion()).toBe('newest');
});

test('with two questions the first one\'s primary reads Next and pages to the second, which reads Answer', async () => {
  const store = render();
  flushSync(() => { store.pendingQuestions = [question('first', 1), question('second', 2)]; });
  const submit = () => document.querySelector<HTMLButtonElement>('[data-testid=activity-question]:not([hidden]) [data-testid=question-submit]')!;
  expect(shownQuestion()).toBe('first');
  expect(submit().textContent).toBe('Next');
  vi.spyOn(store, 'answerQuestion').mockImplementation(async (_thread, id) => {
    store.pendingQuestions = store.pendingQuestions.filter(q => q.id !== id);
    return true;
  });
  document.querySelector<HTMLButtonElement>('[data-testid=activity-question]:not([hidden]) [data-testid=question-option]')!.click();
  flushSync();
  submit().click();
  await vi.waitFor(() => expect(shownQuestion()).toBe('second'));
  flushSync();
  expect(submit().textContent).toBe('Answer');
});

test('a card holds its own thread\'s questions; one for another thread opens its own, unfolded', () => {
  const question = (id: string, threadId: string): QuestionRequest => ({
    id, threadId, turnId: 'turn', text: `Which way for ${threadId}?`, options: [], allowText: true, multiple: false, async: true, createdAt: 1
  });
  const store = render();
  flushSync(() => { store.pendingQuestions = [question('first', 'thread'), question('second', 'other')]; });
  expect(document.querySelector('[data-testid=composer-reply]')!.getAttribute('data-question')).toBe('first');
  expect(document.querySelectorAll('[data-testid=activity-question]')).toHaveLength(1);
  const fold = () => document.querySelector<HTMLButtonElement>('[data-testid=activity-question-toggle]')!;
  fold().click();
  flushSync();
  expect(fold().getAttribute('aria-expanded')).toBe('false');
  unmount(view!, { outro: false });
  flushSync(() => { store.openThread = { id: 'other', status: 'idle', turns: [] } as unknown as Thread; });
  view = mount(ThreadDecision, { target: document.body, props: { store, threadId: 'other' } });
  flushSync();
  expect(fold().getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('[data-testid=activity-question]:not([hidden])')!.getAttribute('data-question')).toBe('second');
});

test('a subagent\'s question is the parent\'s composer question, asked by its name, the reply stays the parent\'s, and its permission stays in its own conversation', async () => {
  const question = (id: string, threadId: string, async: boolean): QuestionRequest => ({
    id, threadId, turnId: 'turn', text: `Which way for ${id}?`, options: [{ id: 'a', label: 'A' }], allowText: true, multiple: false, ...(async ? { async: true } : {}), createdAt: 1
  });
  const store = render();
  const row = (id: string, title: string, parentThreadId: string | null, archived = false) => ({ id, title, parentThreadId, archived, status: 'running' }) as ThreadSummary;
  flushSync(() => {
    store.threads = [row('thread', 'Parent', null), row('child', 'Migrate the keys', 'thread'), row('gone', 'Archived child', 'thread', true), row('stranger', 'Elsewhere', null)];
    // Its own question without stopping, a child's of both kinds, and questions no child of this thread asked.
    store.pendingQuestions = [question('own', 'thread', true), question('child-async', 'child', true), question('child-stop', 'child', false), question('archived', 'gone', true), question('stranger', 'stranger', true)];
    store.pendingPermissions = [{ id: 'perm', threadId: 'child', turnId: 'turn', toolName: 'Bash', input: { command: 'bun run migrate' }, description: 'Run it', createdAt: 2 }];
  });
  // Its own first, then its live child's, the one that stopped before the one that did not; no archived child's, no stranger's.
  const docked = () => [...document.querySelectorAll<HTMLElement>('[data-testid=activity-question]')];
  expect(docked().map(card => card.dataset['question'])).toEqual(['own', 'child-stop', 'child-async']);
  const shown = () => document.querySelector<HTMLElement>('[data-testid=activity-question]:not([hidden])')!;
  expect(shown().dataset['question']).toBe('own');
  expect(shown().querySelector('[data-testid=activity-subagent-question]')).toBeNull();
  expect(replyTarget(store)?.id).toBe('own');
  document.querySelector<HTMLButtonElement>('[data-testid=activity-question-next]')!.click();
  flushSync();
  expect(shown().dataset['question']).toBe('child-stop');
  expect(shown().querySelector('[data-testid=activity-subagent-question]')?.textContent).toContain('Asked by Migrate the keys');
  // Text typed in the parent's composer answers neither: it stays a message to the parent.
  expect(replyTarget(store)).toBeNull();

  // The child's permission is approved where it asked; the parent's grouped row marks that child as needing the user.
  expect(document.querySelector('[data-testid=thread-decision] [data-testid=permission-card]')).toBeNull();
  expect(document.body.textContent).not.toContain('bun run migrate');
});

test('the card links child questions on their owning machine without taking the parent reply', async () => {
  const store = render();
  const select = vi.spyOn(workspace, 'select').mockResolvedValue(undefined);
  const remoteStore = new Store();
  vi.spyOn(workspace, 'machineOf').mockReturnValue({ id: 'other-machine', label: 'Other machine', store: remoteStore });
  flushSync(() => { store.threads = [{ id: 'thread', subagentQuestions: [
    { threadId: 'child', title: 'Check the parser' },
    { threadId: 'child', title: 'Remote parser', machine: { coreId: 'other-core', name: 'Other machine' } }
  ] } as ThreadSummary]; });
  const bar = document.querySelector('[data-testid=thread-decision]')!;
  expect(bar).not.toBeNull();
  const alerts = bar.querySelectorAll<HTMLButtonElement>('[data-testid=subagent-question-alert]');
  expect(alerts).toHaveLength(2);
  expect(alerts[0]!.textContent).toContain('A subagent has a question');
  expect(alerts[0]!.textContent).toContain('Check the parser');
  expect(replyTarget(store)).toBeNull();
  alerts[0]!.click();
  expect(select).toHaveBeenCalledExactlyOnceWith(store, 'child');
  expect(alerts[1]!.disabled).toBe(true);
  flushSync(() => { remoteStore.connection = 'ready'; });
  expect(alerts[1]!.disabled).toBe(false);
  alerts[1]!.click();
  expect(select).toHaveBeenLastCalledWith(remoteStore, 'child');
  flushSync(() => { store.pendingQuestions = [question('own', 1)]; });
  expect(replyTarget(store)?.id).toBe('own');
  flushSync(() => { store.threads = [{ id: 'thread', subagentQuestions: [] } as unknown as ThreadSummary]; });
  expect(document.querySelector('[data-testid=subagent-question-alert]')).toBeNull();
  expect(replyTarget(store)?.id).toBe('own');
  flushSync(() => { store.pendingQuestions = []; });
  expect(document.querySelector('[data-testid=activity-question]')).toBeNull();
});


test('with no field focused, 1 to 9 pick the question\'s choices, and a permission never joins the question', async () => {
  const store = render('running');
  const answer = vi.spyOn(store, 'answer').mockResolvedValue(true);
  flushSync(() => { store.pendingQuestions = [{ ...question('pick', 1), options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }]; });
  key(document.body, '2');
  flushSync();
  expect(repliesOf(store).picks['pick']).toEqual(['b']);
  // A key typed into a field is the field's own.
  const field = document.body.appendChild(document.createElement('textarea'));
  key(field, '1');
  expect(repliesOf(store).picks['pick']).toEqual(['b']);
  // A permission waits on its command row in the timeline: the top of the composer keeps the question alone.
  flushSync(() => { store.pendingPermissions = [push]; });
  expect(document.querySelector('[data-testid=permission-card]')).toBeNull();
  key(document.body, 'Escape');
  key(document.body, 'Enter');
  expect(answer).not.toHaveBeenCalledWith('perm', expect.anything());
});
