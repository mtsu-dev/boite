import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import type { Project, ThreadSummary } from '@boite/contracts';
import App from './App.svelte';
import { store } from './lib/store.svelte';
import { workspace } from './lib/workspace.svelte';
import { writeExperiments } from './lib/experiments';
import { closeTour } from './lib/onboarding.svelte';
import { work } from './lib/work-prefs.svelte';
import { lifecycleFilter } from './lib/lifecycle-filter.svelte';
import { moreRows, LANES_STORAGE_KEY } from './lib/thread-lanes.svelte';

/*
 * The sidebar's lifecycle strip and lanes, over the in-memory fake: four
 * counts that filter the list across projects with the headers kept, and a
 * busy project that shows six resting rows, never folding what needs the user.
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
  lifecycleFilter.clear();
  moreRows.open = [];
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

async function mountOnFake(): Promise<void> {
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
  await waitFor(() => document.querySelectorAll('[data-testid=sidebar] section[data-testid=project]').length > 0);
}

async function project(name: string): Promise<Project> {
  return store.client!.call('projects.add', { path: `/workspace/${name}`, name });
}
async function thread(projectId: string, title: string): Promise<ThreadSummary> {
  const created = await store.client!.call('threads.create', { projectId, providerId: 'echo', accountId: 'a-echo', title });
  await waitFor(() => store.threads.some((t) => t.id === created.id));
  return created;
}
function setThread(id: string, change: Partial<ThreadSummary>): void {
  store.threads = store.threads.map((t) => (t.id === id ? { ...t, ...change } : t));
}
const stage = (kind: string) => document.querySelector<HTMLButtonElement>(`[data-testid=lifecycle-${kind}]`)!;
const count = (kind: string) => Number(stage(kind).dataset['count']);
const sidebar = () => document.querySelector<HTMLElement>('[data-testid=sidebar]')!;
const rowIds = (within: Element) => [...within.querySelectorAll<HTMLElement>('[data-testid=thread-row]')].map((row) => row.dataset['threadId']);

test('the lifecycle strip counts every listed project and filters the list to one state, headers kept', async () => {
  await mountOnFake();
  for (const t of store.threads) if (!t.archived) setThread(t.id, { status: 'idle', unread: false, openQuestions: 0, backgroundWork: null, pullRequestWatches: [] });
  const alpha = await project('alpha');
  const beta = await project('beta');
  const asking = await thread(alpha.id, 'Asks a question');
  const failing = await thread(beta.id, 'Build broke');
  const busy = await thread(beta.id, 'Long build');
  await thread(beta.id, 'Quiet one');
  setThread(asking.id, { status: 'waiting' });
  setThread(failing.id, { status: 'error' });
  setThread(busy.id, { status: 'running', runningSince: Date.now() - 60_000 });
  await waitFor(() => document.querySelector('[data-testid=lifecycle]') !== null && count('waiting') === 2 && count('working') === 1);
  // Done and archived are the projects' own counts, the numbers their folds list.
  const listed = store.projects.filter((p) => !p.archived);
  expect(count('done')).toBe(listed.reduce((sum, p) => sum + (p.doneThreads ?? 0), 0));
  expect(count('archived')).toBe(listed.reduce((sum, p) => sum + Math.max(0, (p.archivedThreads ?? 0) - (p.doneThreads ?? 0)), 0));

  // Needs you: a question and a failure, each under its own project's header, nothing else.
  stage('waiting').click();
  await waitFor(() => stage('waiting').getAttribute('aria-pressed') === 'true' && sidebar().querySelectorAll('section[data-filter=waiting]').length === 2);
  const section = (id: string) => sidebar().querySelector<HTMLElement>(`section[data-filter][data-project-id="${id}"]`)!;
  expect(rowIds(section(alpha.id))).toEqual([asking.id]);
  expect(rowIds(section(beta.id))).toEqual([failing.id]);
  expect(section(beta.id).querySelector('.name')?.textContent).toBe('beta');
  expect(rowIds(sidebar())).toHaveLength(2);

  // Another button moves the filter; the same one again clears it.
  stage('working').click();
  await waitFor(() => rowIds(sidebar()).length === 1 && rowIds(sidebar())[0] === busy.id);
  stage('working').click();
  await waitFor(() => sidebar().querySelector('section[data-filter]') === null && rowIds(sidebar()).length > 2);

  // Escape clears from inside the list and never stops the turn there.
  stage('waiting').click();
  await waitFor(() => lifecycleFilter.current === 'waiting');
  const stop = vi.spyOn(store, 'stop').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'busy', 'get').mockReturnValue(true);
  stage('waiting').focus();
  stage('waiting').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => lifecycleFilter.current === null && sidebar().querySelector('section[data-filter]') === null);
  expect(stop).not.toHaveBeenCalled();

  // Archived lists the threads put aside, inline under their project.
  await store.archive(failing.id);
  await waitFor(() => count('archived') > 0);
  stage('archived').click();
  await waitFor(() => section(beta.id)?.querySelector(`[data-testid=done-thread][data-thread-id="${failing.id}"]`) != null);
  expect(sidebar().querySelectorAll('[data-testid=thread-row]')).toHaveLength(0);
});

test('the Recent view keeps its flat rows and their order under a filter, each naming its project', async () => {
  await mountOnFake();
  for (const t of store.threads) if (!t.archived) setThread(t.id, { status: 'idle', unread: false, openQuestions: 0, backgroundWork: null, pullRequestWatches: [] });
  const alpha = await project('alpha');
  const beta = await project('beta');
  const asking = await thread(alpha.id, 'Asks a question');
  const failing = await thread(beta.id, 'Build broke');
  const later = await thread(alpha.id, 'Asks later');
  await thread(beta.id, 'Quiet one');
  setThread(asking.id, { status: 'waiting', lastUserMessageAt: Date.now() - 3 * 60_000 });
  setThread(failing.id, { status: 'error', lastUserMessageAt: Date.now() - 2 * 60_000 });
  setThread(later.id, { status: 'waiting', lastUserMessageAt: Date.now() - 60_000 });
  workspace.view = 'recent';
  await waitFor(() => sidebar().querySelector('section[data-testid=project]') === null && rowIds(sidebar()).includes(later.id) && count('waiting') === 3);
  const wanted = new Set([asking.id, failing.id, later.id]);
  const order = rowIds(sidebar()).filter(id => wanted.has(id!));

  stage('waiting').click();
  await waitFor(() => sidebar().querySelector('[data-testid=recent-filtered][data-filter=waiting]') !== null && rowIds(sidebar()).length === 3);
  // The rows Recent drew, in the order it drew them: no project card, the project under each title.
  expect(sidebar().querySelector('section[data-filter]')).toBeNull();
  expect(rowIds(sidebar())).toEqual(order);
  const projects = [...sidebar().querySelectorAll('[data-testid=thread-project] > .ui-label')].map(name => name.textContent);
  expect(projects).toEqual(order.map(id => id === failing.id ? 'beta' : 'alpha'));

  // The Projects view keeps its cards under the same filter.
  workspace.view = 'projects';
  await waitFor(() => sidebar().querySelectorAll('section[data-filter=waiting]').length === 2);
});

test('a project away from the open thread shows what needs the user and folds its resting rows under one row', async () => {
  await mountOnFake();
  const busy = await project('busy');
  const made: ThreadSummary[] = [];
  for (let index = 0; index < 9; index++) made.push(await thread(busy.id, `Topic ${index}`));
  for (const [index, t] of made.entries()) setThread(t.id, { status: 'idle', unread: false, lastUserMessageAt: Date.now() - (index + 1) * 60_000 });
  // The oldest one asks a question and one past the cap failed: both stay drawn.
  setThread(made[8]!.id, { status: 'waiting' });
  setThread(made[7]!.id, { status: 'error' });
  const card = () => sidebar().querySelector<HTMLElement>(`section[data-testid=project][data-project-id="${busy.id}"]`)!;
  await waitFor(() => card()?.querySelector('[data-testid=project-more]') != null);
  const shown = rowIds(card());
  expect(shown.slice(0, 2)).toEqual([made[8]!.id, made[7]!.id]);
  // The open thread lives elsewhere, so the seven resting rows all fold under `7 more` (B1: the headers fit the first screen).
  expect(shown).toHaveLength(2);
  const more = card().querySelector<HTMLButtonElement>('[data-testid=project-more]')!;
  expect([more.dataset['count'], more.textContent?.trim(), more.getAttribute('aria-expanded')]).toEqual(['7', '7 more', 'false']);
  expect(shown).not.toContain(made[6]!.id);

  // It opens in place and is remembered for that project.
  more.click();
  await waitFor(() => rowIds(card()).length === 9);
  expect(card().querySelector('[data-testid=project-more]')?.textContent?.trim()).toBe('Show fewer');
  expect(JSON.parse(window.localStorage.getItem(LANES_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  card().querySelector<HTMLButtonElement>('[data-testid=project-more]')!.click();
  await waitFor(() => rowIds(card()).length === 2);

  // Work folds too away from the open thread (B1, six headers on the first screen): the fold counts it.
  for (const t of made.slice(0, 5)) setThread(t.id, { status: 'running', runningSince: Date.now() - 60_000 });
  await waitFor(() => card().querySelector('[data-testid=project-more-working]') != null);
  expect(rowIds(card())).toEqual([made[8]!.id, made[7]!.id]);
  expect(card().querySelector<HTMLElement>('[data-testid=project-more-working]')!.dataset['count']).toBe('5');

  // A fold of one row would cost the row's own height: a project away with one thread shows it, never `1 more`.
  const solo = await project('solo');
  const only = await thread(solo.id, 'The only topic');
  setThread(only.id, { status: 'idle', unread: false });
  const soloCard = () => sidebar().querySelector<HTMLElement>(`section[data-testid=project][data-project-id="${solo.id}"]`);
  await waitFor(() => soloCard() != null && rowIds(soloCard()!).includes(only.id));
  expect(soloCard()!.querySelector('[data-testid=project-more]')).toBeNull();
});

test('at home no thread is open: the project the composer starts in shows its rows, the others fold', async () => {
  await mountOnFake();
  const here = await project('here');
  const there = await project('there');
  const mine = [await thread(here.id, 'Mine 1'), await thread(here.id, 'Mine 2'), await thread(here.id, 'Mine 3')];
  const theirs = [await thread(there.id, 'Theirs 1'), await thread(there.id, 'Theirs 2')];
  for (const t of [...mine, ...theirs]) setThread(t.id, { status: 'idle', unread: false });
  store.startDraft(here.id);
  await waitFor(() => store.openThread === null && store.draft?.projectId === here.id);
  const card = (id: string) => sidebar().querySelector<HTMLElement>(`section[data-testid=project][data-project-id="${id}"]`);
  await waitFor(() => card(here.id) != null && mine.every(t => rowIds(card(here.id)!).includes(t.id)));
  expect(card(here.id)!.querySelector('[data-testid=project-more]')).toBeNull();
  await waitFor(() => card(there.id)?.querySelector('[data-testid=project-more]') != null);
  expect(rowIds(card(there.id)!)).toEqual([]);
});

test('a folded sidebar leaves a rail whose project tile carries the Needs you dot and unfolds the list on it', async () => {
  await mountOnFake();
  const p = await project('rail');
  const t = await thread(p.id, 'Asks');
  if (!store.sidebarCollapsed) store.toggleSidebar();
  const tile = () => [...document.querySelectorAll<HTMLElement>('[data-testid=sidebar-rail] [data-testid=rail-project]')].find((tile) => JSON.parse(tile.dataset['projectKey']!)[1] === p.id) ?? null;
  await waitFor(() => tile() !== null);
  expect(tile()!.dataset['needs']).toBe('0');
  setThread(t.id, { status: 'waiting' });
  await waitFor(() => tile()!.dataset['needs'] === '1');
  expect(tile()!.querySelector('.needs')).not.toBeNull();
  // jsdom draws nothing to scroll to; the unfolded card is asked to come into view.
  const reveal = vi.fn();
  Element.prototype.scrollIntoView = reveal;
  tile()!.click();
  await waitFor(() => reveal.mock.contexts.some((card) => (card as HTMLElement).dataset['projectId'] === p.id));
  await waitFor(() => !store.sidebarCollapsed && document.querySelector('[data-testid=sidebar-rail]') === null);
});
