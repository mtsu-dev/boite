import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import CommandPalette from './CommandPalette.svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import * as palette from '../lib/palette';
import { waitingSince } from '../lib/inbox';
import { shortAgo } from '../lib/thread-state';
import { setExperiment } from '../lib/experiments';
import { workspace } from '../lib/workspace.svelte';

let running: Record<string, unknown> | null = null;
let store: Store;
let client: FakeClient;

beforeEach(async () => {
  window.localStorage.clear();
  store = new Store();
  client = new FakeClient({ delayMs: 0 });
  store.attach(client);
  await store.connect();
  await store.open('t-descriptors');
  running = mount(CommandPalette, { target: document.body, props: { store } });
  flushSync();
});

afterEach(async () => {
  if (running) await unmount(running, { outro: false });
  running = null;
  store.detach();
  client.close();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  window.localStorage.clear();
});

function rows(): string[] {
  return Array.from(document.querySelectorAll('[data-testid=palette-row]')).map(
    (row) => row.getAttribute('data-palette-id') ?? ''
  );
}

function selectedId(): string | null {
  return document.querySelector('[data-testid=palette-row][aria-selected=true]')?.getAttribute('data-palette-id') ?? null;
}

async function type(text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('[data-testid=palette-input]');
  if (!input) throw new Error('no palette input');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await tick();
}

function key(name: string): void {
  const input = document.querySelector<HTMLInputElement>('[data-testid=palette-input]');
  if (!input) throw new Error('no palette input');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  flushSync();
}

test('closed until asked, then the recents come first and the commands after them', async () => {
  expect(document.querySelector('[data-testid=palette]')).toBeNull();

  store.paletteOpen = true;
  flushSync();
  await tick();

  expect(document.querySelector('[data-testid=palette]')).not.toBeNull();
  expect(document.activeElement?.getAttribute('data-testid')).toBe('palette-input');
  const ids = rows();
  // Every seeded thread first, then the commands; nothing typed, no project rows.
  expect([...ids.slice(0, 4)].sort()).toEqual(['thread:t-bench', 'thread:t-descriptors', 'thread:t-scheduler', 'thread:t-trace']);
  expect(ids).toContain('new-thread');
  expect(ids).toContain('settings');
  expect(ids.some((id) => id.startsWith('project:'))).toBe(false);
  expect(ids.at(-1)).toBe('archive');
  expect(selectedId()).toBe(ids[0]);
  // Every recent sits under one "Recent" heading, the commands after them; no project heading.
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=palette-section]'));
  const of = (section: HTMLElement) => Array.from(section.querySelectorAll('[data-testid=palette-row]')).map((row) => row.getAttribute('data-palette-id'));
  expect(sections.map((section) => section.querySelector('.section-label')?.textContent)).toEqual(['Recent', 'Commands']);
  expect(document.querySelectorAll('[data-testid=palette-recent]')).toHaveLength(1);
  expect(document.querySelector('[data-testid=palette-project]')).toBeNull();
  expect(of(sections[0]!).sort()).toEqual(['thread:t-bench', 'thread:t-descriptors', 'thread:t-scheduler', 'thread:t-trace']);
  // Each row names its project after its title, where a heading would have.
  expect(document.querySelector('[data-palette-id="thread:t-descriptors"] [data-testid=palette-where] .where-name')?.textContent).toBe('notes');
  expect(document.querySelector('[data-palette-id="thread:t-bench"] [data-testid=palette-where] .where-name')?.textContent).toBe('boite');
  // A row says what its thread is doing the way the sidebar does: the ring draws it, the words stay in the time's label.
  const bench = document.querySelector('[data-palette-id="thread:t-bench"]')!;
  expect(bench.querySelector('[data-testid=state-ring]')?.getAttribute('data-ring')).toBe('waiting');
  expect(bench.querySelector('[data-testid=thread-state]')?.getAttribute('aria-label')).toBe('Needs you');
  expect(document.body.textContent).toContain('Commands');
});

/** Lays the list out as a short window draws it: `room` px tall, each heading 30 px and each row 34 px, in DOM order. */
function layOut(room: number): void {
  const list = document.querySelector<HTMLElement>('[data-testid=palette-list]')!;
  const tops = new Map<Element, number>();
  let y = 6;
  for (const section of list.querySelectorAll('[data-testid=palette-section]')) {
    tops.set(section, y);
    y += 30;
    for (const row of section.querySelectorAll('[data-testid=palette-row]')) {
      tops.set(row, y);
      y += 34;
    }
    y += 4;
  }
  const total = y + 2;
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) { return tops.get(this) ?? 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset['testid'] === 'palette-row' ? 34 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this !== list) return 0;
    const cap = parseFloat(this.style.maxHeight);
    return Number.isFinite(cap) ? Math.min(cap, room) : room;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this === list ? total : 0; });
  // jsdom scrolls nothing: the list keeps the offset it is given.
  let scrolled = 0;
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) { return this === list ? scrolled : 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value: number) { if (this === list) scrolled = value; });
  // jsdom applies no component CSS: the list's 6 px padding, as the stylesheet sets it.
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    return element === list ? ({ paddingBottom: '6px' } as CSSStyleDeclaration) : style;
  });
}

test('an overflowing list ends on a whole row, never on a heading, and the arrows bring a row in whole', async () => {
  store.paletteOpen = true;
  flushSync();
  await tick();
  // Recent: heading 6-36, rows 36-70, 70-104, 104-138, 138-172; commands: heading 176-206, rows 206-240, 240-274.
  layOut(260);
  window.dispatchEvent(new Event('resize'));
  flushSync();
  const list = document.querySelector<HTMLElement>('[data-testid=palette-list]')!;
  // 260 px would show 14 px of the second command row: the list stops under the first one, plus its 6 px padding.
  expect(list.style.maxHeight).toBe('246px');
  expect(list.hasAttribute('data-more')).toBe(false);

  // Down past the cut: the row's bottom lands on the list's, above its padding.
  for (let i = 0; i < 5; i++) key('ArrowDown');
  expect(selectedId()).toBe(rows()[5]);
  expect(list.scrollTop).toBe(240 + 34 + 6 - 246);
  // Back up to the first row: its heading comes with it.
  key('Home');
  expect(list.scrollTop).toBe(0);

  // A list that fits keeps its natural height.
  layOut(2000);
  window.dispatchEvent(new Event('resize'));
  flushSync();
  expect(list.style.maxHeight).toBe('');
});

test('a cut list counts the rows left under it at the right of the foot, and drops the count at the end', async () => {
  store.paletteOpen = true;
  flushSync();
  await tick();
  const total = rows().length;
  layOut(260);
  window.dispatchEvent(new Event('resize'));
  flushSync();
  const more = () => document.querySelector('[data-testid=palette-more]')?.textContent?.trim() ?? null;
  // Four thread rows and the first command show whole; the other commands wait under the cut.
  expect(more()).toBe(`${total - 5} more ↓`);
  key('End');
  await tick();
  expect(more()).toBeNull();
  key('Home');
  await tick();
  expect(more()).toBe(`${total - 5} more ↓`);
  // A list that fits says nothing.
  layOut(2000);
  window.dispatchEvent(new Event('resize'));
  flushSync();
  expect(more()).toBeNull();
});

test('a bot\'s own thread names Bots with the tab\'s glyph, in its recent row and under a query\'s heading', async () => {
  setExperiment('resident-agents', true);
  onTestFinished(() => setExperiment('resident-agents', false));
  store.threads = store.threads.map(thread => thread.id === 't-bench' ? { ...thread, agentSessionId: 'agt_session_nova' } : thread);
  flushSync();
  store.paletteOpen = true;
  flushSync();
  await tick();
  const where = document.querySelector('[data-palette-id="thread:t-bench"] [data-testid=palette-where]');
  // Bots in the project's place; t-bench asks, so its word follows.
  expect(where?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Bots ·Needs you');
  expect(where?.querySelector('[data-testid=palette-where-bots]')).not.toBeNull();
  await type(store.threads.find(thread => thread.id === 't-bench')!.title);
  const section = document.querySelector('[data-palette-id="thread:t-bench"]')!.closest<HTMLElement>('[data-testid=palette-section]')!;
  const heading = section.querySelector('[data-testid=palette-bots]');
  expect(heading?.querySelector('.name')?.textContent).toBe('Bots');
  expect(heading?.querySelector('[data-testid=palette-bots-glyph]')).not.toBeNull();
  expect(section.querySelector('[data-testid=palette-project]')).toBeNull();
});

test('a subagent stays out of the recents, and a query finds it named by its parent with the subagent glyph', async () => {
  // The sidebar keeps a subagent behind its parent's chip: with nothing typed it would take a recent's place.
  const parent = store.threads.find(thread => thread.id === 't-descriptors')!;
  store.threads = store.threads.map(thread => thread.id === 't-bench' ? { ...thread, parentThreadId: parent.id, lastUserMessageAt: Date.now() } : thread);
  flushSync();
  store.paletteOpen = true;
  flushSync();
  await tick();
  expect(rows()).not.toContain('thread:t-bench');
  expect(rows()).toContain('thread:t-descriptors');
  const child = store.threads.find(thread => thread.id === 't-bench')!;
  await type(child.title);
  const row = document.querySelector('[data-palette-id="thread:t-bench"]');
  expect(row).not.toBeNull();
  const hint = row!.querySelector('[data-testid=palette-parent]');
  expect(hint?.textContent).toBe(`in ${parent.title}`);
  expect(hint?.querySelector('svg')).not.toBeNull();
  // A top-level thread names no parent.
  expect(document.querySelector('[data-palette-id="thread:t-descriptors"] [data-testid=palette-parent]')).toBeNull();
  // The parent's title is something a query lands on.
  await type(parent.title);
  expect(rows()).toContain('thread:t-bench');
});

test('with nothing typed, the rows read in Recent\'s order under one heading, whatever their projects', async () => {
  // Recent's order puts notes' t-descriptors between boite's threads; a boite heading
  // would stand where t-bench ranked and drag t-trace up above it.
  const order = ['thread:t-bench', 'thread:t-scheduler', 'thread:t-descriptors', 'thread:t-trace'];
  vi.spyOn(palette, 'asRecents');
  store.paletteOpen = true;
  flushSync();
  await tick();
  const given = vi.mocked(palette.asRecents).mock.calls.at(-1)![0].map(item => item.id);
  expect(given).toEqual(order);
  expect(rows().filter(id => id.startsWith('thread:'))).toEqual(order);
  expect(document.querySelectorAll('[data-testid=palette-section]')[0]?.querySelector('[data-testid=palette-recent]')).not.toBeNull();
});

test('with nothing typed, a rule opens each Recent band, a row that needs the user says so in words, and an idle mark is muted', async () => {
  // Round 12: the ages read now, 2h, 3m under one heading with nothing marking where Needs you ended,
  // Failed and asks told apart by colour alone, and an idle row kept its brand hue.
  store.threads = store.threads.map(thread => ({ ...thread, pinned: false, openQuestions: 0, subagentQuestions: [],
    status: thread.id === 't-bench' ? 'error' : thread.id === 't-scheduler' ? 'running' : 'idle' }));
  store.pendingQuestions = []; store.pendingPermissions = [];
  flushSync();
  store.paletteOpen = true;
  flushSync();
  await tick();
  expect(rows().filter(id => id.startsWith('thread:')).slice(0, 2)).toEqual(['thread:t-bench', 'thread:t-scheduler']);
  const rules = [...document.querySelectorAll<HTMLElement>('[data-testid=palette-band-rule]')];
  expect(rules.map(rule => [rule.dataset['band'], rule.nextElementSibling?.getAttribute('data-palette-id')])).toEqual([['working', 'thread:t-scheduler'], ['earlier', rows().filter(id => id.startsWith('thread:'))[2]]]);
  expect(rules.every(rule => rule.getAttribute('aria-hidden') === 'true')).toBe(true);
  const needs = (id: string) => document.querySelector(`[data-palette-id="thread:${id}"] [data-testid=palette-where-needs]`)?.textContent ?? null;
  expect(needs('t-bench')).toBe('·Failed');
  expect(needs('t-scheduler')).toBeNull();
  expect(needs('t-descriptors')).toBeNull();
  // Nothing live on it: its mark takes the muted tier, the live rows keep their hue.
  expect(document.querySelector('[data-palette-id="thread:t-descriptors"] [data-mono]')).not.toBeNull();
  expect(document.querySelector('[data-palette-id="thread:t-scheduler"] [data-mono]')).toBeNull();
  // A query ranks its rows: no band rule then.
  await type('t');
  expect(document.querySelector('[data-testid=palette-band-rule]')).toBeNull();
});

test('a thread that asks reads Needs you after its project, since the palette draws no band heading', async () => {
  store.threads = store.threads.map(thread => thread.id === 't-bench' ? { ...thread, status: 'waiting', openQuestions: 1 } : thread);
  flushSync();
  store.paletteOpen = true;
  flushSync();
  await tick();
  expect(document.querySelector('[data-palette-id="thread:t-bench"] [data-testid=palette-where-needs]')?.textContent).toBe('·Needs you');
});

test('a recent names its machine as the Recent rows do: never this PC, the other one behind a dot and its glyph', async () => {
  const builder = new Store();
  const other = new FakeClient({ delayMs: 0 });
  builder.machineId = 'builder';
  builder.attach(other);
  await builder.connect();
  store.machineId = 'here';
  workspace.machines = [{ id: 'here', label: 'This PC', store }, { id: 'builder', label: 'Builder', store: builder }];
  onTestFinished(() => { workspace.machines = []; builder.detach(); other.close(); });
  store.paletteOpen = true;
  flushSync();
  await tick();
  const machines = [...document.querySelectorAll('[data-testid=palette-where-machine]')].map(node => node.textContent);
  expect(machines.length).toBeGreaterThan(0);
  expect(machines.every(text => text === '·Builder')).toBe(true);
  expect(document.querySelector('[data-testid=palette-list]')?.textContent).not.toContain('This PC');
  expect(document.querySelector('[data-testid=palette-where-machine] svg')).not.toBeNull();
});

test('with nothing typed, a thread that needs the user outranks newer idle ones, as in the Recent sidebar', async () => {
  // Eight newer idle threads would fill the recents; the waiting one, asked long ago, must still show and lead.
  const now = Date.now();
  const bench = store.threads.find(thread => thread.id === 't-bench')!;
  const idle = store.threads.find(thread => thread.id === 't-descriptors')!;
  const fresh = Array.from({ length: 8 }, (_, i) => ({ ...idle, id: `t-fresh-${i}`, title: `Fresh ${i}`, lastUserMessageAt: now - i * 1000 }));
  store.threads = [...store.threads.map(thread => thread.id === 't-bench' ? { ...thread, lastUserMessageAt: now - 86_400_000 } : thread), ...fresh];
  flushSync();
  expect(waitingSince(store, bench)).not.toBeNull();
  store.paletteOpen = true;
  flushSync();
  await tick();
  const threads = rows().filter(id => id.startsWith('thread:'));
  expect(threads).toContain('thread:t-bench');
  expect(threads.indexOf('thread:t-bench')).toBeLessThan(threads.indexOf('thread:t-fresh-0'));
});

test('a waiting thread reads the age of its home card, as its sidebar row does', async () => {
  const now = Date.now();
  // Asked an hour ago; the turn that now waits on the user started a minute ago.
  store.threads = store.threads.map(thread => thread.id === 't-bench' ? { ...thread, lastUserMessageAt: now - 3_600_000, runningSince: now - 30_000, updatedAt: now - 30_000 } : thread);
  flushSync();
  const bench = store.threads.find(thread => thread.id === 't-bench')!;
  const since = waitingSince(store, bench);
  expect(since).not.toBeNull();
  expect(shortAgo(since!, now)).not.toBe(shortAgo(bench.lastUserMessageAt!, now));
  store.paletteOpen = true;
  flushSync();
  await tick();
  const text = document.querySelector('[data-palette-id="thread:t-bench"] [data-testid=thread-state-text]')?.textContent;
  expect(text).toBe(shortAgo(since!, now));
});

test('the field is a combobox whose active option is the row Enter opens, after arrows, filtering and no result', async () => {
  store.paletteOpen = true;
  flushSync();
  await tick();
  const input = document.querySelector<HTMLInputElement>('[data-testid=palette-input]')!;
  const list = document.querySelector<HTMLElement>('[data-testid=palette-list]')!;
  expect(input.getAttribute('role')).toBe('combobox');
  expect(input.getAttribute('aria-autocomplete')).toBe('list');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(list.getAttribute('role')).toBe('listbox');
  expect(list.id).not.toBe('');
  expect(input.getAttribute('aria-controls')).toBe(list.id);
  expect(list.getAttribute('aria-label')).toBe(input.getAttribute('aria-label'));
  const options = Array.from(list.querySelectorAll('[role=option]'));
  expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  const active = () => {
    const id = input.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.getAttribute('data-palette-id') ?? 'missing' : null;
  };

  expect(active()).toBe(selectedId());
  key('ArrowDown');
  key('ArrowDown');
  expect(active()).toBe(rows()[2]);

  await type('zzzz');
  expect(rows()).toEqual([]);
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  expect(input.getAttribute('aria-expanded')).toBe('false');

  await type('trace');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(active()).toBe('trace');
  key('ArrowDown');
  expect(active()).toBe('thread:t-trace');
  key('Enter');
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(store.openThread?.id).toBe('t-trace');
});

test('two palettes never share a list or option id', async () => {
  const second = mount(CommandPalette, { target: document.body, props: { store } });
  store.paletteOpen = true;
  flushSync();
  await tick();
  const lists = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=palette-list]'));
  expect(lists).toHaveLength(2);
  expect(lists[0]!.id).not.toBe(lists[1]!.id);
  const ids = lists.map((list) => Array.from(list.querySelectorAll('[role=option]')).map((option) => option.id));
  expect(ids[0]!.length).toBeGreaterThan(0);
  expect(ids[0]!.filter((id) => ids[1]!.includes(id))).toEqual([]);
  await unmount(second, { outro: false });
});

test('a query finds a project by its name and folder, and Enter starts a thread there with the keyboard in the composer', async () => {
  const composer = document.createElement('textarea');
  composer.dataset['testid'] = 'composer-input';
  document.body.append(composer);
  store.paletteOpen = true;
  flushSync();
  await tick();

  // "boite src" lands one word on the name, the other on the folder.
  await type('boite src');
  const project = rows().find((id) => id.startsWith('project:'));
  expect(project).toBe('project:["local","p-boite"]');
  expect(rows()).not.toContain('project:["local","p-notes"]');
  while (selectedId() !== project) key('ArrowDown');
  // WebKit sends the Enter that confirms an IME candidate with keyCode 229.
  const input = document.querySelector<HTMLInputElement>('[data-testid=palette-input]')!;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
  flushSync();
  expect(store.paletteOpen).toBe(true);
  key('Enter');
  await new Promise((resolve) => setTimeout(resolve, 5));
  await tick();
  expect(store.paletteOpen).toBe(false);
  expect(store.openThread).toBeNull();
  expect(store.draft?.projectId).toBe('p-boite');
  expect(document.activeElement).toBe(composer);
});

test('typing filters across threads and commands, the arrows move, Enter opens the thread', async () => {
  store.paletteOpen = true;
  flushSync();
  await tick();

  await type('sched');
  expect(rows()).toEqual(['thread:t-scheduler']);

  // A word the thread and a command share: both rows, the command's word
  // start earlier in its label so it ranks first.
  await type('trace');
  expect(rows()).toEqual(['trace', 'thread:t-trace']);
  expect(selectedId()).toBe('trace');
  key('ArrowDown');
  expect(selectedId()).toBe('thread:t-trace');
  key('ArrowDown');
  expect(selectedId()).toBe('trace');
  key('End');
  expect(selectedId()).toBe('thread:t-trace');
  key('Enter');

  await tick();
  expect(store.paletteOpen).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(store.openThread?.id).toBe('t-trace');
});

test('a command runs: settings opens on the tab asked, and Escape closes without picking', async () => {
  store.paletteOpen = true;
  flushSync();
  await tick();

  await type('providers');
  expect(rows()).toEqual(['providers']);
  key('Enter');
  expect(store.page).toBe('settings');
  expect(store.settingsTab).toBe('accounts');
  expect(store.paletteOpen).toBe(false);

  store.paletteOpen = true;
  flushSync();
  await tick();
  await type('task manager');
  expect(rows()).toEqual(['task-manager']);
  key('Enter');
  expect(store.page).toBe('settings');
  expect(store.settingsTab).toBe('task-manager');
  expect(store.paletteOpen).toBe(false);

  store.paletteOpen = true;
  flushSync();
  await tick();
  await type('zzzz');
  expect(rows()).toEqual([]);
  expect(document.body.textContent).toContain('Nothing matches.');
  key('Escape');
  expect(store.paletteOpen).toBe(false);
});

test('pin and unpin follow the open thread', async () => {
  store.paletteOpen = true;
  flushSync();
  await tick();
  await type('pin this');
  expect(rows()).toEqual(['pin']);
  expect(document.body.textContent).toContain('Pin this thread');
  key('Enter');
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(store.openThread?.pinned).toBe(true);

  store.paletteOpen = true;
  flushSync();
  await tick();
  await type('pin this');
  expect(document.body.textContent).toContain('Unpin this thread');
});

test('a load tick leaves the row the keyboard is on where it is', async () => {
  store.paletteOpen = true;
  flushSync();
  await tick();

  key('ArrowDown');
  key('ArrowDown');
  const picked = selectedId();
  expect(picked).toBe(rows()[2]);

  // The core pushes one of these a second for every thread with a live agent.
  client.sampleLoad('t-trace');
  client.sampleLoad('t-bench');
  flushSync();

  expect(rows()[2]).toBe(picked);
  expect(selectedId()).toBe(picked);

  // Typing still starts the walk over: that reset belongs to the query.
  await type('thread');
  expect(selectedId()).toBe(rows()[0]);
});

test('a closed search stops ranking live updates and reopening reads the latest titles', async () => {
  const ranking = vi.spyOn(palette, 'rankItems');
  store.paletteOpen = true;
  flushSync();
  await tick();
  await type('sched');
  expect(rows()).toEqual(['thread:t-scheduler']);
  key('Escape');
  // Keep the result during the exit animation, then leave no live search work.
  expect(rows()).toEqual(['thread:t-scheduler']);
  for (let i = 0; i < 3; i++) { await tick(); flushSync(); }
  expect(document.querySelector('[data-testid=palette]')).toBeNull();
  ranking.mockClear();
  for (let i = 0; i < 20; i++) {
    client.sampleLoad('t-scheduler');
    store.threads.find(thread => thread.id === 't-scheduler')!.status = i % 2 === 0 ? 'running' : 'idle';
    flushSync();
  }
  store.threads = store.threads.map(thread => thread.id === 't-scheduler' ? { ...thread, title: 'Latest scheduler title' } : thread);
  flushSync();
  expect(ranking).not.toHaveBeenCalled();
  store.paletteOpen = true;
  flushSync();
  await tick();
  expect(document.querySelector<HTMLInputElement>('[data-testid=palette-input]')?.value).toBe('');
  expect(document.body.textContent).toContain('Latest scheduler title');
  expect(ranking).toHaveBeenCalled();
});

test('Escape on a row closes, Tab stays in the search field, and closing gives the focus back', async () => {
  const before = document.createElement('button');
  document.body.append(before);
  before.focus();
  store.paletteOpen = true;
  flushSync();
  await tick();

  const input = document.querySelector<HTMLInputElement>('[data-testid=palette-input]')!;
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  input.dispatchEvent(tab);
  flushSync();
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);

  // A row the pointer focused still answers Escape.
  const row = document.querySelector<HTMLElement>('[data-testid=palette-row]')!;
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  flushSync();
  await tick();
  expect(store.paletteOpen).toBe(false);
  expect(document.activeElement).toBe(before);
});
