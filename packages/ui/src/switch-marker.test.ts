import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { store } from './lib/store.svelte';
import { workspace } from './lib/workspace.svelte';
import { writeExperiments } from './lib/experiments';
import { closeTour } from './lib/onboarding.svelte';
import { work } from './lib/work-prefs.svelte';

/*
 * A change of model, effort or account in the timeline, from the whole app
 * over the in-memory fake: the dashed row at the foot of the thread while the
 * change is only picked, and the divider above the turn that first ran on it.
 */

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn(async (_url: string) => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

let running: Record<string, unknown> | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  writeExperiments([]);
  window.localStorage.clear();
  work.load();
  workspace.view = 'projects';
});

async function waitFor(check: () => boolean, attempts = 2000): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`gave up waiting, body was:\n${document.body.textContent ?? ''}`);
}

function query<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

async function openThread(threadId: string): Promise<void> {
  window.history.replaceState(null, '', '/?fake=1&open=recent');
  const target = document.createElement('div');
  document.body.appendChild(target);
  store.booted = false;
  store.openThread = null;
  store.draft = null;
  store.page = 'chat';
  store.composerStates = {};
  store.projectPickerOpen = false;
  closeTour();
  running = mount(App, { target });
  await waitFor(() => store.booted && (store.openThread !== null || store.draft !== null));
  workspace.view = 'projects';
  await workspace.select(store, threadId);
  await waitFor(() => store.openThread?.id === threadId);
}

async function say(threadId: string, prompt: string): Promise<void> {
  const before = store.openThread!.turns.length;
  await store.client!.call('turns.start', { threadId, prompt });
  await waitFor(() => store.openThread!.turns.length > before && store.openThread!.status === 'idle');
}

const pending = '[data-testid=switch-pending]';
const marker = '[data-testid=switch-marker]';
/** The line as read: the shared model, each side, then what follows, without the agents' marks. */
const words = (selector: string) => Array.from(query(selector).querySelectorAll('.lead, [data-testid=switch-from], [data-testid=switch-to], .said'), (part) => part.textContent).join(' ');
const marks = (selector: string) => query(selector).querySelectorAll('.logo, .initial').length;

test('a picked change shows dashed at the foot of the thread, goes when picked back, and stays as a divider once a turn runs on it', async () => {
  await openThread('t-descriptors');
  await say('t-descriptors', 'first');
  const messages = () => store.openThread!.messages.length;
  expect(document.querySelector(`${pending}, ${marker}`)).toBeNull();

  // Only the effort changed: the model is said once, then the two efforts.
  expect(await store.update('t-descriptors', { effort: 'low' })).toBe(true);
  await waitFor(() => document.querySelector(pending) !== null);
  expect(words(pending)).toBe('Echo default low');
  expect(query(pending).title).toBe('Used from your next message');
  // The same agent on both sides: one mark.
  expect(marks(pending)).toBe(1);
  // Not used yet: nothing to unfold.
  expect(document.querySelector(`${pending} button`)).toBeNull();

  // Picked back before sending: the row goes.
  expect(await store.update('t-descriptors', { effort: null })).toBe(true);
  await waitFor(() => document.querySelector(pending) === null);

  await store.update('t-descriptors', { effort: 'low' });
  await waitFor(() => document.querySelector(pending) !== null);
  const before = messages();
  await say('t-descriptors', 'second');
  await waitFor(() => document.querySelector(marker) !== null && document.querySelector(pending) === null);
  expect(words(marker)).toBe('Echo default low');
  // The same session went on: nothing was handed over, nothing unfolds.
  expect(document.querySelector('[data-testid=switch-marker-toggle]')).toBeNull();
  // The divider is the turn's own field, above its prompt: no message was added for it.
  expect(messages()).toBe(before + 2);
  const turn = store.openThread!.turns.at(-1)!;
  expect(turn.switched).toMatchObject({ from: { effort: null }, to: { effort: 'low' } });
  const article = query(marker).closest('article')!;
  expect(article.textContent).toContain('second');
  // A turn on the same selection says nothing more.
  await say('t-descriptors', 'third');
  expect(document.querySelectorAll(marker).length).toBe(1);
});

test('another account says the context was handed over and unfolds on what went', async () => {
  await openThread('t-descriptors');
  await say('t-descriptors', 'first');
  const history = store.openThread!.messages.length;

  expect(await store.update('t-descriptors', { accountId: 'a-claude-main', model: 'claude-opus-5-5', effort: 'medium' })).toBe(true);
  await waitFor(() => document.querySelector(pending) !== null);
  // Another agent: both models, each behind its own mark.
  expect(words(pending)).toBe('Echo Opus 5.5 medium');
  expect(marks(pending)).toBe(2);

  await say('t-descriptors', 'second');
  await waitFor(() => document.querySelector('[data-testid=switch-marker-toggle]') !== null);
  expect(words(marker)).toBe('Echo Opus 5.5 medium context handed over');
  const toggle = query<HTMLButtonElement>('[data-testid=switch-marker-toggle]');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.title).toBe('Show what was handed over');
  toggle.click();
  await waitFor(() => toggle.getAttribute('aria-expanded') === 'true');
  const note = query('[data-testid=switch-handover]').textContent ?? '';
  expect(note).toContain('A new session started on excerpts of this conversation');
  expect(note).toContain(`${history} messages in full`);
  expect(note).toMatch(/[\d,]+ characters$/);
});

test('a thread that has run nothing shows no change', async () => {
  await openThread('t-descriptors');
  const created = await store.client!.call('threads.create', { projectId: 'p-notes', providerId: 'echo', accountId: 'a-echo', title: 'Empty' });
  await workspace.select(store, created.id);
  await waitFor(() => store.openThread?.id === created.id);
  expect(await store.update(created.id, { effort: 'low' })).toBe(true);
  await waitFor(() => store.openThread?.effort === 'low');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(document.querySelector(`${pending}, ${marker}`)).toBeNull();
});
