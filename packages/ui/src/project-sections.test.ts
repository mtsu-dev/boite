import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import type { Project, ThreadSummary } from '@boite/contracts';
import App from './App.svelte';
import { store } from './lib/store.svelte';
import { workspace } from './lib/workspace.svelte';
import { writeExperiments } from './lib/experiments';
import { closeTour } from './lib/onboarding.svelte';
import { work } from './lib/work-prefs.svelte';
import { projectThreadView, projectSections } from './lib/project-threads.svelte';
import { recentPreferences } from './lib/recent.svelte';
import type { ProjectEntry } from './lib/project-view.svelte';

/*
 * The Projects view in sections, over the in-memory fake: projects whose every
 * conversation is at work on top once working grouping is on, the open ones, the paused ones where nothing
 * runs or waits, then the fold of projects without a thread. A project moves between them as its threads do.
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
  recentPreferences.groupWorking = false;
  work.load();
  workspace.view = 'projects';
  projectThreadView.resetFolds();
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
  await waitFor(() => document.querySelectorAll('section[data-testid=project]').length === 2);
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
const card = (within: string, projectId: string) => document.querySelector<HTMLElement>(`${within} section[data-testid=project][data-project-id="${projectId}"]`);
const cards = () => [...document.querySelectorAll<HTMLElement>('[data-testid=sidebar] section[data-testid=project]')].map((s) => s.dataset['projectId']);

test('with working grouping on, a project whose every conversation is at work sits on top, and moves down once one needs the user', async () => {
  await mountOnFake();
  const busy = await project('busy');
  const build = await thread(busy.id, 'Long build');
  const tests = await thread(busy.id, 'Test sweep');
  setThread(build.id, { status: 'running' });
  setThread(tests.id, { status: 'running' });
  // Off by default: the project at work stays among the open cards, with no section above them.
  await waitFor(() => card('[data-testid=sidebar]', busy.id) !== null);
  expect(document.querySelector('[data-testid=working-projects]')).toBeNull();
  recentPreferences.setGroupWorking(true);
  await waitFor(() => card('[data-testid=working-projects]', busy.id) !== null);
  // On top of every open project, under the section's own header.
  expect(cards()[0]).toBe(busy.id);
  expect(document.querySelector('[data-testid=working-projects-toggle]')?.textContent).toContain('Working');
  expect(card('[data-testid=working-projects]', 'p-boite')).toBeNull();

  // A pin is the user's: the project with it stays among the open ones, at work or not.
  setThread(tests.id, { pinned: true });
  await waitFor(() => document.querySelector('[data-testid=working-projects]') === null);
  setThread(tests.id, { pinned: false });
  await waitFor(() => card('[data-testid=working-projects]', busy.id) !== null);

  // One turn ends and waits to be read: the project leaves the section, which goes with its last project.
  setThread(build.id, { status: 'idle', unread: true });
  await waitFor(() => document.querySelector('[data-testid=working-projects]') === null);
  expect(cards()).toContain(busy.id);

  // Folded, the section keeps its header and count, and its fold closes.
  setThread(build.id, { status: 'running', unread: false });
  await waitFor(() => card('[data-testid=working-projects]', busy.id) !== null);
  document.querySelector<HTMLButtonElement>('[data-testid=working-projects-toggle]')!.click();
  await waitFor(() => document.querySelector('[data-testid=working-projects] .disclosure-fold')?.classList.contains('open') === false);
  const toggle = document.querySelector<HTMLElement>('[data-testid=working-projects-toggle]')!;
  expect([toggle.getAttribute('aria-expanded'), toggle.querySelector('.fold-count')?.textContent]).toEqual(['false', '1']);
});

test('a project where nothing runs and nothing waits sits under Inactive; one without a thread goes to the closed No threads fold, archived history included', async () => {
  await mountOnFake();
  const resting = await project('resting');
  const archivedOnly = await project('archived-only');
  const finished = await project('finished');
  const quiet = await thread(resting.id, 'Nothing to do');
  const putAway = await thread(resting.id, 'Put away');
  await store.archive(putAway.id);
  const later = await thread(archivedOnly.id, 'Pick this up');
  const shipped = await thread(finished.id, 'Shipped');
  await store.archive(later.id);
  await store.archive(shipped.id, true);
  // Read, its turn over: at rest.
  setThread(quiet.id, { status: 'idle', unread: false });

  // Inactive starts open and lists the card as the open ones are drawn.
  await waitFor(() => card('[data-testid=paused-projects]', resting.id) !== null);
  expect(document.querySelector('[data-testid=paused-projects-toggle]')?.getAttribute('aria-expanded')).toBe('true');
  // Archived by hand or done, a project left without a thread is no card and no section of its own anymore.
  expect(document.querySelector('[data-testid=later-projects]')).toBeNull();
  expect(card('[data-testid=sidebar]', archivedOnly.id)).toBeNull();
  expect(card('[data-testid=sidebar]', finished.id)).toBeNull();
  // A card counts its archived threads in its head, beside Done; the count opens them under the card, as Done does,
  // and the card's menu no longer sends them to Settings.
  const pausedCard = `[data-testid=paused-projects] section[data-project-id="${resting.id}"]`;
  const count = document.querySelector<HTMLButtonElement>(`${pausedCard} .head [data-testid=project-archived-toggle]`)!;
  expect([count.dataset.count, count.getAttribute('aria-expanded')]).toEqual(['1', 'false']);
  document.querySelector<HTMLButtonElement>(`${pausedCard} [data-testid=project-menu]`)!.click();
  await waitFor(() => document.querySelector('[data-testid=context-menu]') !== null);
  expect(document.querySelector('[data-testid=context-menu] [data-value=archived]')).toBeNull();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => document.querySelector('[data-testid=context-menu]') === null);
  count.click();
  await waitFor(() => document.querySelector(`${pausedCard} [data-testid=project-archived] [data-thread-id="${putAway.id}"]`) !== null);
  expect(store.page).toBe('chat');
  count.click();
  await waitFor(() => document.querySelector(`${pausedCard} [data-testid=project-archived] [data-thread-id="${putAway.id}"]`) === null);

  // Folded, Inactive keeps its header and count and hides the card.
  await waitFor(() => document.querySelector('[data-testid=paused-projects-toggle]') !== null);
  document.querySelector<HTMLButtonElement>('[data-testid=paused-projects-toggle]')!.click();
  await waitFor(() => document.querySelector('[data-testid=paused-projects] .disclosure-fold')?.classList.contains('open') === false);
  expect(document.querySelector('[data-testid=paused-projects-toggle] .fold-count')?.textContent).toBe(String(document.querySelectorAll('[data-testid=paused-projects] section[data-testid=project]').length));

  // A reply to read is for the user: the project leaves Inactive for the open cards, which no fold hides.
  setThread(quiet.id, { unread: true });
  await waitFor(() => card('[data-testid=paused-projects]', resting.id) === null && card('[data-testid=sidebar]', resting.id) !== null);

  // No threads starts closed; open, it lists both projects, each with its history's count.
  const shelf = document.querySelector<HTMLButtonElement>('[data-testid=project-shelf-toggle]')!;
  expect([shelf.getAttribute('aria-expanded'), shelf.querySelector('.label')?.textContent]).toEqual(['false', 'No threads']);
  shelf.click();
  const row = (id: string) => document.querySelector(`[data-testid=project-shelf] [data-testid=idle-project][data-project-id="${id}"]`);
  await waitFor(() => row(archivedOnly.id) !== null && row(finished.id) !== null);
  expect(row(archivedOnly.id)!.querySelector('[data-testid=project-archived-toggle]')?.getAttribute('data-count')).toBe('1');
  expect(row(finished.id)!.querySelector('[data-testid=project-done-toggle]')?.getAttribute('data-count')).toBe('1');

  // Restored, the conversation is back: its project leaves the fold for the cards.
  await store.client!.call('threads.archive', { threadId: later.id, archived: false });
  await waitFor(() => row(archivedOnly.id) === null && card('[data-testid=sidebar]', archivedOnly.id) !== null);
});

test('an unsent new draft keeps its project among the open ones; without a grouping, its projects stay open cards', () => {
  const entry = (id: string, threads: Partial<ThreadSummary>[], counts: Partial<Project> = {}, drafts: { projectId: string; text: string }[] = [], open = false): ProjectEntry => ({
    machine: {
      id: 'local', label: 'local',
      store: {
        threadsOf: () => threads.map((t, i) => ({ id: `${id}-${i}`, status: 'idle', pinned: false, ...t })),
        subagents: () => null, composerStates: {}, draft: open ? { projectId: id } : null, draftEntries: drafts
      }
    } as never,
    project: { id, name: id, path: `/${id}`, createdAt: 0, ...counts }
  });
  const entries = [
    entry('busy', [{ status: 'running' }]),
    // A prompt typed for a new conversation waits on the user: a folded Working section must not hide it.
    entry('drafting', [{ status: 'running' }], {}, [{ projectId: 'drafting', text: 'Unsent new conversation' }]),
    // So does the new draft open on screen, before it has text.
    entry('opened', [{ status: 'running' }], {}, [], true),
    // A reply to read waits on the user; a read one at rest does not.
    entry('news', [{ unread: true }]), entry('resting', [{}]),
    // Without a thread, archived or done history or none, a project has no card.
    entry('archived', [], { archivedThreads: 2 }), entry('quiet', [], { archivedThreads: 1, doneThreads: 1 })
  ];
  const ids = (sections: Record<string, ProjectEntry[]>) => Object.fromEntries(Object.entries(sections).map(([key, list]) => [key, list.map((e) => e.project.id)]));
  expect(ids(projectSections(entries, true, true))).toEqual({ working: ['busy'], open: ['drafting', 'opened', 'news'], paused: ['resting'], idle: ['archived', 'quiet'] });
  expect(ids(projectSections(entries, false, true))).toEqual({ working: ['busy'], open: ['drafting', 'opened', 'news', 'resting', 'archived', 'quiet'], paused: [], idle: [] });
  expect(ids(projectSections(entries, true, false))).toEqual({ working: [], open: ['busy', 'drafting', 'opened', 'news'], paused: ['resting'], idle: ['archived', 'quiet'] });
});
