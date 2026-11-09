import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { QuestionRequest, Thread, ThreadSummary } from '@boite/contracts';
import { Store } from '../lib/store.svelte';
import { replyTarget, repliesOf } from '../lib/question-reply.svelte';
import { decisionTail } from '../lib/decision-tail.svelte';
import { workspace } from '../lib/workspace.svelte';
import ThreadDecision from './ThreadDecision.svelte';
import DecisionPill from './DecisionPill.svelte';

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
  // The head holds the question, Skip and the fold; the pager is its own line under the choices.
  const head = document.querySelector('[data-testid=activity-question]:not([hidden]) .decision-head')!;
  expect(head.querySelector('[data-testid=activity-question-index]')).toBeNull();
  expect(head.querySelector('[data-testid=activity-question-toggle]')).not.toBeNull();
  expect(document.querySelector('[data-testid=activity-question]:not([hidden]) .pager-line [data-testid=activity-question-index]')).not.toBeNull();
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

test('a subagent\'s questions stay out of its parent\'s card while permissions still link to the child', async () => {
  const question = (id: string, threadId: string, async: boolean): QuestionRequest => ({
    id, threadId, turnId: 'turn', text: `Which way for ${id}?`, options: [{ id: 'a', label: 'A' }], allowText: true, multiple: false, ...(async ? { async: true } : {}), createdAt: 1
  });
  const store = render();
  const open = vi.spyOn(store, 'open').mockResolvedValue(undefined as never);
  const row = (id: string, title: string, parentThreadId: string | null, archived = false) => ({ id, title, parentThreadId, archived, status: 'running' }) as ThreadSummary;
  flushSync(() => {
    store.threads = [row('thread', 'Parent', null), row('child', 'Migrate the keys', 'thread'), row('gone', 'Archived child', 'thread', true), row('stranger', 'Elsewhere', null)];
    // Its own question without stopping, a child's of both kinds, and questions no child of this thread asked.
    store.pendingQuestions = [question('own', 'thread', true), question('child-async', 'child', true), question('child-stop', 'child', false), question('archived', 'gone', true), question('stranger', 'stranger', true)];
    store.pendingPermissions = [{ id: 'perm', threadId: 'child', turnId: 'turn', toolName: 'Bash', input: { command: 'bun run migrate' }, description: 'Run it', createdAt: 2 }];
  });
  const docked = () => [...document.querySelectorAll<HTMLElement>('[data-testid=activity-question]')];
  expect(docked().map(card => card.dataset['question'])).toEqual(['own']);
  const shown = () => document.querySelector<HTMLElement>('[data-testid=activity-question]:not([hidden])')!;
  expect(shown().dataset['question']).toBe('own');
  expect(shown().querySelector('[data-testid=activity-subagent-question]')).toBeNull();
  expect(replyTarget(store)?.id).toBe('own');

  const wait = document.querySelector<HTMLElement>('[data-testid=activity-subagent-permission]')!;
  expect(wait.dataset['thread']).toBe('child');
  expect(wait.textContent).toContain('Migrate the keys waits for your permission');
  await vi.waitFor(() => expect(wait.textContent).toContain('Run migrate'));
  wait.querySelector<HTMLButtonElement>('[data-testid=activity-open-subagent]')!.click();
  expect(open).toHaveBeenLastCalledWith('child');
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


test('with no field focused, the keys answer the card: 1 to 9 pick, Enter allows, Escape denies', async () => {
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
  flushSync(() => { store.pendingPermissions = [push]; });
  expect(document.querySelector('[data-testid=permission-card]')).not.toBeNull();
  key(document.body, 'Escape');
  expect(answer).toHaveBeenLastCalledWith('perm', 'deny');
  key(document.body, 'Enter');
  expect(answer).toHaveBeenLastCalledWith('perm', 'allow');
});

test('allowed while the agent works, the card folds in place to one line that says what was allowed', async () => {
  const store = render('running');
  vi.spyOn(store, 'busy', 'get').mockReturnValue(true);
  vi.spyOn(store, 'answer').mockImplementation(async () => { store.pendingPermissions = []; return true; });
  flushSync(() => { store.pendingPermissions = [push]; });
  expect(decisionTail.count).toBe(1);
  document.querySelector<HTMLButtonElement>('[data-testid=permission-allow]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=answer-receipt]')?.textContent).toBe('Allowed: git push'));
  expect(document.querySelector('[data-testid=permission-card]')).toBeNull();
  expect(decisionTail.count).toBe(0);
});

test('out of view, the card leaves a pill over the composer that brings it back and never holds the form', async () => {
  let seen: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null;
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof seen) { seen = callback; } observe() {} disconnect() {} });
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const store = new Store();
  store.connection = 'ready';
  store.openThread = { id: 'thread', status: 'waiting', turns: [], activity: null } as unknown as Thread;
  const root = document.body.appendChild(Object.assign(document.createElement('div'), { tabIndex: -1 }));
  root.setAttribute('data-scroll-root', '');
  Object.defineProperty(root, 'clientHeight', { value: 400 });
  const strip = document.body.appendChild(document.createElement('div'));
  store.pendingPermissions = [push];
  view = mount(ThreadDecision, { target: root, props: { store, threadId: 'thread' } });
  const pill = mount(DecisionPill, { target: strip });
  flushSync();
  const away = (ratio: number) => { flushSync(() => seen!([{ intersectionRatio: ratio, intersectionRect: { height: ratio * 100 } as DOMRectReadOnly }])); };
  try {
    away(1);
    expect(strip.querySelector('[data-testid=decision-pill]')).toBeNull();
    away(0);
    const button = strip.querySelector<HTMLButtonElement>('[data-testid=decision-pill]')!;
    expect([button.textContent?.trim(), button.title]).toEqual(['1 decision waiting', '1 decision waiting']);
    expect(strip.querySelector('[data-testid=permission-card], [data-testid=permission-allow]')).toBeNull();
    // Several: a bare count, the words in its name.
    flushSync(() => { store.pendingPermissions = [push, { ...push, id: 'perm-2' }]; });
    expect([button.textContent?.trim(), button.getAttribute('aria-label')]).toEqual(['2', '2 decisions waiting']);
    button.click();
    const card = root.querySelector('[data-testid=thread-decision]')!;
    expect(scroll.mock.contexts.at(-1)).toBe(card);
    expect(document.activeElement).toBe(card);
    away(1);
    expect(strip.querySelector('[data-testid=decision-pill]')).toBeNull();
  } finally {
    unmount(pill);
    vi.unstubAllGlobals();
  }
});
