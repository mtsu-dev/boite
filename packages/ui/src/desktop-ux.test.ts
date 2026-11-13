import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import App from './App.svelte';
import { store } from './lib/store.svelte';
import { machineName, workspace } from './lib/workspace.svelte';
import { writeExperiments } from './lib/experiments';
import { closeTour } from './lib/onboarding.svelte';
import { work } from './lib/work-prefs.svelte';
import { archiveThread } from './lib/archive';
import { runCommand } from './lib/commands.svelte';
import { undo } from './lib/undo.svelte';
import { confirm } from './lib/confirm.svelte';
import { fill, strings } from './lib/strings';
import { clampPanel, rightPanel } from './lib/right-panel.svelte';
import { contactsRail } from './lib/contacts-rail.svelte';
import { AgentsView, openAgent } from './lib/agents.svelte';

/**
 * The desktop behaviours the UX audit found broken, on the whole app over the
 * in-memory fake: Escape that closed a popover also stopped the turn, machine
 * removal went through at one click, a failed Settings save said
 * "Saved", and the sidebar neither floated live threads nor stopped repeating
 * the project under its own header.
 */

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn(async (_url: string) => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

let running: Record<string, unknown> | null = null;

afterEach(() => {
  confirm.answer(false);
  vi.restoreAllMocks();
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  writeExperiments([]);
  window.localStorage.clear();
  // A panel a test opened stays in memory: the next test starts with none, its thread list in place.
  rightPanel.threads = {};
  work.load();
  workspace.view = 'projects';
  undo.dismiss();
});

test('a maximized panel stays with its thread: the Contacts page beside the list is not squeezed to nothing', async () => {
  writeExperiments(['contacts']);
  await mountOnFake();
  try {
    if (!store.panelOpen) store.togglePanel();
    rightPanel.maximized = true;
    await waitFor(() => query('.body').classList.contains('panel-maximized'));
    store.showHome();
    await waitFor(() => document.querySelector('[data-testid=home-page]') !== null);
    expect(query('.body').classList.contains('panel-maximized')).toBe(false);
    // Back on the chat, the thread finds its panel as it left it.
    store.showChat();
    await waitFor(() => query('.body').classList.contains('panel-maximized'));
  } finally {
    rightPanel.maximized = false;
  }
});

test('contacts are the Bots column\'s other side: its head folds the column on the right, a row opens a contact', async () => {
  writeExperiments(['resident-agents', 'contacts']);
  await mountOnFake();
  try {
    // A first start finds the column folded, and no contacts button on the rail: Activity counts what they ask.
    // The Bots page draws no such column: read it afresh each time.
    const rail = () => query('[data-testid=contacts-rail]');
    // The column is fetched after the shell (`lib/contacts-entry.ts`).
    await waitFor(() => document.querySelector('[data-testid=contacts-rail]') !== null);
    expect(rail().classList.contains('collapsed')).toBe(true);
    expect(query('main').compareDocumentPosition(rail()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-testid=rail-contacts]')).toBeNull();
    expect(document.querySelector('[data-testid=contacts-toggle]')).toBeNull();

    // The Bots column's switch turns it to Contacts, the Contacts page in the main card.
    workspace.showAgents(store);
    await waitFor(() => document.querySelector('[data-testid=side-contacts]') !== null);
    query<HTMLButtonElement>('[data-testid=side-contacts]').click();
    await waitFor(() => document.querySelector('[data-testid=home-add]') !== null);
    expect([store.page, store.contact]).toEqual(['home', null]);
    await waitFor(() => document.querySelector('[data-testid=sidebar] [data-testid=rail-contact]') !== null);
    expect(query('[data-testid=sidebar] [data-testid=side-switch]').dataset['view']).toBe('home');

    // Its head folds the right column, which is not drawn while this side lists the same rows.
    query<HTMLButtonElement>('[data-testid=contacts-toggle]').click();
    flushSync();
    expect(query('[data-testid=contacts-toggle]').getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('boite.contacts-rail-folded')).toBe('0');
    expect(document.querySelector('[data-testid=contacts-rail]')).toBeNull();
    query<HTMLButtonElement>('[data-testid=sidebar] [data-testid=rail-contact]').click();
    await waitFor(() => document.querySelector('[data-testid=contact-remove]') !== null);
    expect([store.page, store.contact]).toEqual(['home', 'core-chris']);
    flushSync();
    expect(query('[data-testid=sidebar] [data-testid=rail-contact]').getAttribute('aria-current')).toBe('page');

    // The title leads back to the threads, the column unfolded beside them; its own title opens the Contacts page.
    query<HTMLButtonElement>('[data-testid=side-back]').click();
    flushSync();
    expect(store.page).toBe('chat');
    expect(rail().classList.contains('collapsed')).toBe(false);
    await waitFor(() => document.querySelector('[data-testid=contacts-rail] [data-testid=rail-contact]') !== null);
    query<HTMLButtonElement>('[data-testid=contacts-rail-home]').click();
    await waitFor(() => store.page === 'home');

  } finally {
    if (!contactsRail.folded) contactsRail.toggle();
    store.showChat();
  }
});

test('a panel widened while the contacts column was folded gives the chat its room back when the column unfolds', async () => {
  writeExperiments(['contacts']);
  expect(contactsRail.folded).toBe(true);
  const stored = rightPanel.width;
  rightPanel.width = 700;
  // Wide enough that list, contacts and a docked panel all fit beside the chat.
  window.innerWidth = 1600;
  await mountOnFake();
  try {
    if (!store.panelOpen) store.togglePanel();
    await waitFor(() => document.querySelector('[data-testid=right-panel]') !== null);
    const width = () => query('[data-testid=right-panel]').style.getPropertyValue('--panel-width');
    const list = store.sidebarCollapsed ? 0 : store.sidebarWidth;
    const folded = clampPanel(700, window.innerWidth, list);
    expect(width()).toBe(`${folded}px`);
    // The Contacts side's head unfolds it (the test above); the room is the same either way.
    contactsRail.toggle();
    flushSync();
    const unfolded = clampPanel(700, window.innerWidth, list + 240);
    expect(unfolded).toBeLessThan(folded);
    expect(width()).toBe(`${unfolded}px`);
    // The width asked for stays, for the day the room comes back.
    expect(rightPanel.width).toBe(700);
  } finally {
    window.innerWidth = 1024;
    if (!contactsRail.folded) contactsRail.toggle();
    rightPanel.width = stored;
  }
});

test('a docked side panel leaves the list column alone: the thread list beside a chat panel, the bot column beside a Desk card', async () => {
  writeExperiments(['resident-agents']);
  await mountOnFake('/?fake=1&agents=1');
  const folded = () => query('.body').classList.contains('sidebar-folded');
  const stays = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync();
    expect(store.sidebarCollapsed).toBe(false);
    expect(folded()).toBe(false);
  };
  try {
    await waitFor(() => store.openThread !== null);
    expect(store.sidebarCollapsed).toBe(false);
    store.togglePanel();
    await waitFor(() => store.panelOpen);
    await stays();
    store.togglePanel();
    await stays();

    workspace.showAgents(store);
    const view = AgentsView.of(store);
    await view.refresh();
    await openAgent(store, view.snapshot!.profiles[0]!.id);
    await waitFor(() => store.page === 'agents' && !!store.openThread?.agentSessionId);
    store.panel.closeAll();
    flushSync();
    store.panel.open('desk');
    await waitFor(() => store.panelOpen);
    await stays();
    store.panel.closeAll();
  } finally {
    store.showChat();
  }
});

test('the rail puts teams first, and a picture moved with the keyboard keeps its new place on this device', async () => {
  writeExperiments(['resident-agents', 'teams']);
  localStorage.removeItem('boite.rail.order');
  await mountOnFake('/?fake=1&agents=1');
  try {
    const view = AgentsView.of(store);
    await view.refresh();
    const [first] = view.snapshot!.profiles;
    await store.client!.call('teams.create', { name: 'Release crew', members: [first!.id] });
    const order = () => [...document.querySelectorAll<HTMLElement>('.app-rail .bots > .slot')].map(slot => slot.dataset['railId']!.split(':').slice(1).join(':'));
    await waitFor(() => order().some(key => key.startsWith('team:')) && order().filter(key => key.startsWith('bot:')).length >= 2);
    // Untouched, the team leads.
    expect(order()[0]).toMatch(/^team:/);
    const bots = order().filter(key => key.startsWith('bot:'));
    // ArrowUp on the second bot moves it above the first; the device keeps the order.
    const second = query<HTMLButtonElement>(`[data-testid=rail-bot][data-agent-id="${bots[1]!.slice(4)}"]`);
    second.focus();
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await waitFor(() => order().indexOf(bots[1]!) < order().indexOf(bots[0]!));
    const saved = JSON.parse(localStorage.getItem('boite.rail.order') ?? '[]') as string[];
    expect(saved.map(key => key.split(':').slice(1).join(':')).slice(0, order().length)).toEqual(order());
  } finally {
    localStorage.removeItem('boite.rail.order');
    store.showChat();
  }
});

test('typed confirmation supports Enter and cancellation restores focus', async () => {
  await mountOnFake();
  const request = { title: 'Archive Mira?', confirmLabel: 'Archive', cancelLabel: 'Cancel', danger: true, requiredText: 'Mira', inputLabel: 'Agent name' };
  const previous = query<HTMLButtonElement>('[data-testid=thread-title]');
  previous.focus();
  const cancelled = confirm.ask(request);
  await waitFor(() => document.activeElement?.getAttribute('data-testid') === 'confirm-name');
  expect(query<HTMLButtonElement>('[data-testid=confirm-ok]').disabled).toBe(true);
  press(query('[data-testid=confirm-name]'), 'Escape');
  expect(await cancelled).toBe(false);
  await waitFor(() => document.activeElement === previous);
  const deletion = confirm.ask(request);
  await waitFor(() => document.activeElement?.getAttribute('data-testid') === 'confirm-name');
  const field = query<HTMLInputElement>('[data-testid=confirm-name]');
  expect(field.getAttribute('autocapitalize')).toBe('off');
  expect(field.getAttribute('autocorrect')).toBe('off');
  field.value = 'Mirax';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  press(field, 'Enter');
  expect(confirm.current).not.toBeNull();
  expect(query<HTMLButtonElement>('[data-testid=confirm-ok]').disabled).toBe(true);
  field.value = 'Mira';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(query<HTMLButtonElement>('[data-testid=confirm-ok]').disabled).toBe(false);
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
  expect(confirm.current).not.toBeNull();
  press(field, 'Enter');
  expect(await deletion).toBe(true);
});

/** No question or permission open in the project: a row's state is then its status alone. */
function quiet(projectId: string) {
  const ids = new Set(store.threadsOf(projectId).map((thread) => thread.id));
  store.pendingQuestions = store.pendingQuestions.filter((request) => !ids.has(request.threadId));
  store.pendingPermissions = store.pendingPermissions.filter((request) => !ids.has(request.threadId));
}

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

function press(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

async function mountOnFake(search = '/?fake=1'): Promise<void> {
  window.history.replaceState(null, '', search.includes('open=') ? search : `${search}&open=recent`);
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
}

test('Escape on an open context popover closes it and leaves a busy turn running', async () => {
  await mountOnFake();
  // From its threshold the context is an item of the composer's row.
  store.openThread!.context = { tokens: 150_000, window: 200_000, at: Date.now() };
  await waitFor(() => document.querySelector('[data-testid=context-trigger]') !== null);
  query<HTMLButtonElement>('[data-testid=context-trigger]').click();
  await waitFor(() => document.querySelector('[data-testid=context-popup]') !== null);
  vi.spyOn(store, 'busy', 'get').mockReturnValue(true);
  const stop = vi.spyOn(store, 'stop').mockResolvedValue(undefined as never);
  press(document.body, 'Escape');
  flushSync();
  expect(stop).not.toHaveBeenCalled();
  await waitFor(() => document.querySelector('[data-testid=context-popup]') === null);
});

test('leaving a header rename with Escape hands the focus back to the title, not the page', async () => {
  await mountOnFake();
  query<HTMLButtonElement>('[data-testid=thread-title]').click();
  await waitFor(() => document.querySelector('[data-testid=thread-rename-input]') !== null);
  press(query('[data-testid=thread-rename-input]'), 'Escape');
  await waitFor(() => document.activeElement?.getAttribute('data-testid') === 'thread-title');
});

test('archiving a thread that waits on the user goes at once, with no dialog, and Undo brings it back', async () => {
  await mountOnFake();
  await waitFor(() => store.pendingPermissions.some((p) => p.threadId === 't-bench'));
  expect(await archiveThread(store, 't-bench')).toBe(true);
  expect(document.querySelector('[data-testid=confirm-dialog]')).toBeNull();
  expect(store.threads.some((t) => t.id === 't-bench' && !t.archived)).toBe(false);
  await undo.take();
  await waitFor(() => store.threads.find((t) => t.id === 't-bench')?.archived === false);
});

test('a thread row menu closed with Escape hands the keyboard back to its button', async () => {
  await mountOnFake();
  await waitFor(() => store.pendingPermissions.some((p) => p.threadId === 't-bench'));
  await waitFor(() => document.querySelector('[data-testid=thread-row][data-thread-id=t-bench]') !== null);
  const button = query('[data-testid=thread-row][data-thread-id=t-bench]').parentElement!.querySelector<HTMLButtonElement>('[data-testid=thread-menu]')!;
  const firstRow = () => document.querySelector<HTMLElement>('[data-testid=context-menu] [data-row]');
  button.focus();
  button.click();
  await waitFor(() => firstRow() !== null && firstRow() === document.activeElement);
  vi.spyOn(store, 'busy', 'get').mockReturnValue(true);
  const stop = vi.spyOn(store, 'stop').mockResolvedValue(undefined as never);
  press(document.activeElement!, 'Escape');
  await waitFor(() => document.activeElement === button);
  flushSync();
  expect(stop).not.toHaveBeenCalled();
});

test('an archived thread comes back from Settings > General', async () => {
  await mountOnFake();
  expect(await archiveThread(store, 't-trace')).toBe(true);
  await waitFor(() => !store.threads.some((t) => t.id === 't-trace' && !t.archived));
  store.showSettings('general');
  // The first Settings of the file loads its lazy chunk, which a loaded runner transforms slowly.
  await waitFor(() => document.querySelector('[data-testid=archived-show]') !== null, 10_000);
  query<HTMLButtonElement>('[data-testid=archived-show]').click();
  await waitFor(() => document.querySelector('[data-testid=archived-restore]') !== null);
  expect(query('[data-testid=archived-list]').textContent).toContain('Finish the trace tab');
  query<HTMLButtonElement>('[data-testid=archived-restore]').click();
  await waitFor(() => store.threads.find((t) => t.id === 't-trace')?.archived === false);
  // The row stays, its button now Open, which lands in the thread.
  await waitFor(() => document.querySelector('[data-testid=archived-open]') !== null);
  query<HTMLButtonElement>('[data-testid=archived-open]').click();
  await waitFor(() => store.page === 'chat' && store.openThread?.id === 't-trace');
});

test('the palette and the project menu reach the archive, its list already read', async () => {
  // A jump to a card scrolls it into view, which jsdom does not draw.
  Element.prototype.scrollIntoView ??= vi.fn();
  await mountOnFake();
  expect(await archiveThread(store, 't-trace')).toBe(true);
  await waitFor(() => !store.threads.some((t) => t.id === 't-trace' && !t.archived));
  runCommand(store, 'archived', false);
  await waitFor(() => document.querySelector('[data-testid=archived-list]') !== null);
  expect(document.querySelector('[data-testid=archived-show]')).toBeNull();
  expect(query('[data-testid=archived-list]').textContent).toContain('Finish the trace tab');

  store.showChat();
  await waitFor(() => document.querySelector('[data-testid=project-menu]') !== null);
  query<HTMLButtonElement>('[data-testid=project-menu]').click();
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=archived]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=archived]').click();
  // A card's menu opens the archive on its project; All projects widens it back to every one.
  await waitFor(() => store.page === 'settings' && document.querySelector('[data-testid=archived-focus]') !== null);
  query<HTMLButtonElement>('[data-testid=archived-all]').click();
  await waitFor(() => document.querySelector('[data-testid=archived-list]')?.textContent?.includes('Finish the trace tab') === true);
});

test('Ctrl+Shift+T brings back the thread archived last on the machine, from this window or another, and opens it', async () => {
  await mountOnFake();
  expect(await archiveThread(store, 't-trace')).toBe(true);
  expect(await archiveThread(store, 't-descriptors')).toBe(true);
  await waitFor(() => !store.threads.some((t) => (t.id === 't-trace' || t.id === 't-descriptors') && !t.archived));

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => store.openThread?.id === 't-descriptors');
  expect(store.threads.find((t) => t.id === 't-descriptors')?.archived).toBe(false);

  runCommand(store, 'reopen-thread', false);
  await waitFor(() => store.openThread?.id === 't-trace');
  expect(store.threads.find((t) => t.id === 't-trace')?.archived).toBe(false);

  // Archived here, then another computer archives a thread later: that one is the last.
  expect(await archiveThread(store, 't-trace')).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.client!.call('threads.archive', { threadId: 't-descriptors', archived: true });
  await waitFor(() => !store.threads.some((t) => t.id === 't-descriptors' && !t.archived));
  runCommand(store, 'reopen-thread', false);
  await waitFor(() => store.openThread?.id === 't-descriptors');
  expect(store.threads.find((t) => t.id === 't-trace')).toBeUndefined();
});

test('the scheduler saves a valid value by itself, never sends an out-of-range one and never says Saved after a refusal', async () => {
  await mountOnFake();
  store.showSettings('advanced');
  await waitFor(() => document.querySelector('[data-testid=setting-warmProcessMinutes]') !== null);
  const status = () => document.querySelector<HTMLElement>('[data-testid=scheduler-settings] [data-testid=save-status]');
  const field = query<HTMLInputElement>('[data-testid=setting-warmProcessMinutes]');
  const call = store.client!.call.bind(store.client!);
  const spy = vi.spyOn(store.client!, 'call');
  field.value = '-1';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('[data-testid=setting-error-warmProcessMinutes]') !== null);
  await waitFor(() => status()?.dataset.state === 'invalid');
  expect(spy.mock.calls.some(([method]) => method === 'settings.set')).toBe(false);

  field.value = '7';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => status()?.dataset.state === 'saved');
  expect(store.settings?.warmProcessMinutes).toBe(7);

  spy.mockImplementation((async (method: string, params: never) => {
    if (method === 'settings.set') throw new Error('settings.set refused');
    return call(method as never, params);
  }) as never);
  field.value = '9';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => status()?.dataset.state === 'error');
  expect(status()!.textContent).not.toContain(strings.settings.autosave.saved);
  expect(store.settings?.warmProcessMinutes).toBe(7);
});

test('the LAN switch saves when it flips, like every other switch in Settings', async () => {
  await mountOnFake();
  store.showSettings('advanced', 'phone');
  await waitFor(() => document.querySelector('[data-testid=setting-listen-on-lan]') !== null);
  const before = store.settings?.listenOnLan ?? false;
  query<HTMLInputElement>('[data-testid=setting-listen-on-lan]').click();
  await waitFor(() => store.settings?.listenOnLan === !before);
});

test('removing a machine asks first, and cancel keeps its card', async () => {
  await mountOnFake('/?fake=1&machines=1');
  await waitFor(() => workspace.machines.length === 2);
  store.showSettings('machines');
  await waitFor(() => document.querySelectorAll('[data-testid=machine-card]').length === 2);
  // The removal sits in the machine's menu: cancelling gives the keyboard back to that menu's button.
  const remote = workspace.machines.find(machine => machine.store !== store)!;
  const menu = query<HTMLButtonElement>(`[data-machine-id="${remote.id}"] [data-testid=machine-menu]`);
  menu.focus();
  menu.click();
  await waitFor(() => document.querySelector('[data-testid=machine-remove]') !== null);
  query<HTMLButtonElement>('[data-testid=machine-remove]').click();
  await waitFor(() => document.activeElement?.getAttribute('data-testid') === 'confirm-cancel');
  query<HTMLButtonElement>('[data-testid=confirm-cancel]').click();
  await waitFor(() => document.activeElement === menu);
  expect(workspace.machines).toHaveLength(2);
  expect(document.querySelectorAll('[data-testid=machine-card]')).toHaveLength(2);
});

test('the project cards float a thread that waits on the user, Recent keeps strict time order with its mark, and each row to one line', async () => {
  await mountOnFake();
  workspace.view = 'projects';
  await waitFor(() => document.querySelectorAll('[data-testid=thread-row]').length >= 2);
  const rows = () => Array.from(document.querySelectorAll('[data-testid=thread-row]')).map((row) => row.getAttribute('data-thread-id'));
  const project = store.projects.find((p) => store.threadsOf(p.id).length >= 2)!;
  const rowsOf = () => rows().filter((id) => store.threads.find((t) => t.id === id)?.projectId === project.id);
  // The fake seeds threads that already wait on a question; start from a quiet project. An open question
  // says Needs you by itself, whatever the status, so the questions go too.
  for (const thread of store.threadsOf(project.id)) thread.status = 'idle';
  quiet(project.id);
  await waitFor(() => rowsOf().length >= 2);
  const last = rowsOf().at(-1)!;
  expect(rowsOf()[0]).not.toBe(last);
  store.threads.find((t) => t.id === last)!.status = 'waiting';
  await waitFor(() => rowsOf()[0] === last);
  expect(document.querySelector('[data-testid=thread-project]')).toBeNull();
  // The card from before the redraw, each title led by its provider's mark: a thread without a pull request
  // keeps one line, its branch in the row's tooltip; a thread with one shows its number and branch on a second
  // line, no hover needed.
  const branched = store.threadsOf(project.id).find((t) => !t.pullRequest)!;
  branched.branch = 'boite/port-the-scheduler';
  const row = () => document.querySelector<HTMLElement>(`[data-testid=thread-row][data-thread-id="${branched.id}"]`)!;
  await waitFor(() => { const lines = row()?.title.split('\n') ?? []; return lines[0] === branched.title && lines.includes('boite/port-the-scheduler'); });
  expect(document.querySelectorAll('[data-testid=thread-provider]')).toHaveLength(document.querySelectorAll('[data-testid=thread-row]').length);
  expect(row().closest('.thread')!.querySelector('[data-testid=thread-branch], [data-testid=thread-pr]')).toBeNull();
  const pulled = store.threads.find((t) => t.pullRequest && t.branch && document.querySelector(`[data-testid=thread-row][data-thread-id="${t.id}"]`))!;
  const card = () => document.querySelector(`[data-testid=thread-row][data-thread-id="${pulled.id}"]`)!.closest('.thread')!;
  await waitFor(() => card().querySelector('[data-testid=thread-where] [data-testid=thread-pr]')?.textContent === `#${pulled.pullRequest!.number}`);
  expect(card().querySelector('[data-testid=thread-where] [data-testid=thread-branch]')?.textContent).toBe(pulled.branch);

  workspace.view = 'recent';
  // Recent is a history: under its pins, strictly newest first; the waiting thread keeps its place by
  // time and says it needs the user by its mark, so no row sits out of time order.
  const time = (id: string | null) => { const t = store.threads.find((thread) => thread.id === id)!; return t.lastUserMessageAt ?? t.createdAt; };
  await waitFor(() => rowsOf().includes(last) && document.querySelector('.thread.classic [data-testid=thread-where]') !== null);
  const unpinned = rowsOf().filter((id) => !store.threads.find((t) => t.id === id)?.pinned);
  expect(unpinned.map(time)).toEqual(unpinned.map(time).sort((a, b) => b - a));
  // Recent keeps its card from before the redraw: no tile, and under the title the project's folder and name,
  // then the branch at the line's end.
  const cards = () => Array.from(document.querySelectorAll('.thread.classic'));
  await waitFor(() => cards().length > 0 && cards().every((card) => card.querySelector('[data-testid=thread-project]') !== null));
  expect(document.querySelector('.thread.classic [data-testid=project-tile]')).toBeNull();
  await waitFor(() => row().closest('.thread')!.querySelector('[data-testid=thread-branch]')?.textContent === 'boite/port-the-scheduler');
  expect(document.querySelectorAll('[data-testid=thread-provider]')).toHaveLength(document.querySelectorAll('[data-testid=thread-row]').length);
  expect(document.querySelector(`[data-thread-id="${last}"] [data-testid=thread-state]`)?.getAttribute('data-state')).toBe('waiting');
});

test('an archive offers its way back for a moment: the toast button, or Ctrl+Z outside a field', async () => {
  await mountOnFake();
  expect(await archiveThread(store, 't-trace')).toBe(true);
  await waitFor(() => document.querySelector('[data-testid=undo-toast]') !== null);
  expect(query('[data-testid=undo-toast]').textContent).toContain('Finish the trace tab');
  query<HTMLButtonElement>('[data-testid=undo-action]').click();
  await waitFor(() => store.threads.find((t) => t.id === 't-trace')?.archived === false);
  await waitFor(() => document.querySelector('[data-testid=undo-toast]') === null);

  expect(await archiveThread(store, 't-trace')).toBe(true);
  await waitFor(() => !store.threads.some((t) => t.id === 't-trace'));
  // In the composer, Ctrl+Z is the text's own undo.
  const box = document.querySelector('textarea');
  if (box) {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.threads.some((t) => t.id === 't-trace')).toBe(false);
  }
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => store.threads.find((t) => t.id === 't-trace')?.archived === false);
});

test('a thread left with words in its box carries a draft mark on its row, the open one none', async () => {
  await mountOnFake();
  await waitFor(() => document.querySelectorAll('[data-testid=thread-row]').length >= 2);
  const first = store.openThread!.id;
  store.composerStates[first] = { text: 'half a thought', attachments: [], queued: [], sending: false, paused: false };
  flushSync();
  const rowOf = (id: string) => query(`[data-testid=thread-row][data-thread-id="${id}"]`);
  expect(rowOf(first).querySelector('[data-testid=thread-draft]')).toBeNull();
  const other = store.threads.find((t) => t.id !== first && document.querySelector(`[data-testid=thread-row][data-thread-id="${t.id}"]`))!;
  await workspace.select(store, other.id);
  await waitFor(() => rowOf(first).querySelector('[data-testid=thread-draft]') !== null);
  expect(rowOf(first).querySelector('[data-testid=thread-draft]')!.getAttribute('title')).toBe('Unsent draft');
  // Only words count: a box emptied back to spaces is no draft.
  store.composerStates[first]!.text = '   ';
  await waitFor(() => rowOf(first).querySelector('[data-testid=thread-draft]') === null);
});

test('a folded project keeps saying what its hidden threads do, and the mark goes when it unfolds', async () => {
  await mountOnFake();
  workspace.view = 'projects';
  const project = store.projects.find((p) => store.threadsOf(p.id).length >= 2)!;
  for (const thread of store.threadsOf(project.id)) { thread.status = 'idle'; thread.unread = false; }
  quiet(project.id);
  const head = () => query(`[data-testid=project-row][data-project-id="${project.id}"]`);
  await waitFor(() => document.querySelector(`[data-testid=project-row][data-project-id="${project.id}"]`) !== null);
  if (!store.isCollapsed(project.id)) store.toggleProject(project.id);
  flushSync();
  expect(head().querySelector('[data-testid=project-rollup]')).toBeNull();
  const [first, second] = store.threadsOf(project.id);
  first!.status = 'running';
  second!.status = 'waiting';
  // Needs you is the header's own count, folded or not, so the rollup gives way to it; folded, no row says it, so the head says it in words.
  await waitFor(() => head().parentElement!.querySelector('[data-testid=project-waiting-count]')?.getAttribute('data-count') === '1');
  expect(head().querySelector('[data-testid=project-rollup]')).toBeNull();
  expect(head().parentElement!.querySelector('[data-testid=project-waiting-count] .word')!.classList.contains('spare')).toBe(false);
  // One count per header: Needs you stands alone while the working thread waits its turn to be counted.
  expect(head().parentElement!.querySelector('[data-testid=project-working-toggle]')).toBeNull();
  second!.status = 'idle';
  await waitFor(() => head().parentElement!.querySelector('[data-testid=project-working-toggle]')?.getAttribute('data-count') === '1');
  expect(head().parentElement!.querySelector('[data-testid=project-waiting-count]')).toBeNull();
  // The working count already says it: the folded header draws no second mark for the same thread.
  expect(head().querySelector('[data-testid=project-rollup]')).toBeNull();
  store.toggleProject(project.id);
  await waitFor(() => head().querySelector('[data-testid=project-rollup]') === null);
  // Open, the rows show their own work: the header counts only what needs the user, and counts nothing else.
  flushSync();
  expect(head().parentElement!.querySelector('[data-testid=project-working-toggle]')).toBeNull();
  second!.status = 'waiting';
  await waitFor(() => head().parentElement!.querySelector('[data-testid=project-waiting-count]')?.getAttribute('data-count') === '1');
  expect(head().parentElement!.querySelector('[data-testid=project-working-toggle]')).toBeNull();
  // Open, the row that needs the user says it: the head keeps its dot and count, the words only in its name.
  expect(head().parentElement!.querySelector('[data-testid=project-waiting-count] .word')!.classList.contains('spare')).toBe(true);
});

async function openIdleThread(): Promise<string> {
  await mountOnFake();
  await workspace.select(store, 't-descriptors');
  await waitFor(() => store.openThread?.id === 't-descriptors' && !store.busy && document.querySelectorAll('[data-testid=message][data-role=user]').length > 0);
  return 't-descriptors';
}

function userTexts(): string[] {
  return (store.openThread?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''));
}

test('Edit on a sent prompt fills the box in edit mode; sending replaces it and what followed', async () => {
  await openIdleThread();
  const before = userTexts();
  const first = query('[data-testid=message][data-role=user]');
  query<HTMLButtonElement>('[data-testid=message][data-role=user] [data-testid=message-edit]').click();
  flushSync();
  const box = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  await waitFor(() => box.value === before[0]);
  expect(first).toBeTruthy();
  expect(query('[data-testid=composer-editing]').textContent).toContain('Editing a sent message');
  box.value = 'Does an unknown field refuse the file, and say which?';
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  press(box, 'Enter');
  await waitFor(() => userTexts()[0] === 'Does an unknown field refuse the file, and say which?');
  // The edited prompt took the place of the first one: nothing of the old thread follows it.
  expect(userTexts().filter((text) => before.includes(text))).toEqual([]);
  await waitFor(() => document.querySelector('[data-testid=composer-editing]') === null);
});

test('ArrowUp in an empty box of a thread at rest recalls the last prompt to edit, Escape leaves it untouched', async () => {
  await openIdleThread();
  const before = userTexts();
  const box = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  box.focus();
  press(box, 'ArrowUp');
  flushSync();
  await waitFor(() => document.querySelector('[data-testid=composer-editing]') !== null);
  expect(box.value).toBe(before.at(-1));
  press(box, 'Escape');
  flushSync();
  await waitFor(() => document.querySelector('[data-testid=composer-editing]') === null);
  expect(box.value).toBe('');
  expect(userTexts()).toEqual(before);
});

test('Ctrl+Shift+S on a recalled prompt sets the text aside and leaves edit mode, so the next prompt is new', async () => {
  await openIdleThread();
  const before = userTexts();
  const box = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  box.focus();
  press(box, 'ArrowUp');
  flushSync();
  await waitFor(() => document.querySelector('[data-testid=composer-editing]') !== null);
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  flushSync();
  await waitFor(() => document.querySelector('[data-testid=composer-editing]') === null);
  expect(box.value).toBe('');
  expect(store.composerStates['t-descriptors']?.editing ?? null).toBeNull();
  expect(userTexts()).toEqual(before);
});

test('a prompt left in a paused queue takes Edit and Retry away until it is sent or removed', async () => {
  await openIdleThread();
  expect(document.querySelector('[data-testid=message-edit]')).not.toBeNull();
  const state = store.composerStates['t-descriptors']!;
  state.queued.push({ text: 'waiting', attachments: [] });
  state.paused = true;
  flushSync();
  await waitFor(() => document.querySelector('[data-testid=message-edit]') === null);
  expect(document.querySelector('[data-testid=message-retry]')).toBeNull();
  state.queued.splice(0);
  state.paused = false;
  flushSync();
  await waitFor(() => document.querySelector('[data-testid=message-edit]') !== null);
});

test('fork from an answer opens a new thread holding the history, the source untouched', async () => {
  await openIdleThread();
  const before = userTexts();
  query<HTMLButtonElement>('[data-testid=turn-summary] [data-testid=message-fork]').click();
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=here]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=here]').click();
  await waitFor(() => store.openThread !== null && store.openThread.id !== 't-descriptors');
  expect(store.openThread!.title).toMatch(/\(fork\)$/);
  expect(userTexts()).toEqual(before.slice(0, 1));
  expect(store.threads.some((t) => t.id === 't-descriptors')).toBe(true);
});

test('retry sits on the last finished turn only and sends its prompt again in place of the answer', async () => {
  await openIdleThread();
  const box = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  box.value = 'And the roots entry outside the folder?';
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  press(box, 'Enter');
  await waitFor(() => document.querySelectorAll('[data-testid=turn-summary][data-status=done]').length >= 2 && !store.busy);
  const before = userTexts();
  const answered = store.openThread!.turns.at(-1)!.id;
  const summaries = document.querySelectorAll('[data-testid=turn-summary]');
  expect(summaries[0]!.querySelector('[data-testid=message-retry]')).toBeNull();
  (summaries[summaries.length - 1]!.querySelector('[data-testid=message-retry]') as HTMLButtonElement).click();
  // A new turn in place of the old one, on the same prompt.
  await waitFor(() => store.openThread?.turns.at(-1)?.id !== answered && store.openThread?.turns.at(-1)?.status === 'done');
  expect(userTexts()).toEqual(before);
  expect(store.openThread!.turns.some((turn) => turn.id === answered)).toBe(false);
});

test('a retry takes the answer off screen before the core rewinds', async () => {
  await openIdleThread();
  const before = userTexts();
  const answers = document.querySelectorAll('[data-testid=turn-summary]').length;
  const client = store.client!;
  const call = client.call.bind(client);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockImplementation(async (method, params) => {
    if (method === 'threads.rewind') await gate;
    return call(method, params);
  });
  const summaries = document.querySelectorAll('[data-testid=turn-summary]');
  (summaries[summaries.length - 1]!.querySelector('[data-testid=message-retry]') as HTMLButtonElement).click();
  const bubbles = () => Array.from(document.querySelectorAll('[data-testid=message][data-role=user] [data-testid=text-part]')).map(part => part.textContent);
  // Nothing back from the core yet: the last answer is gone and its prompt shows once, as sent again.
  await waitFor(() => document.querySelectorAll('[data-testid=turn-summary]').length === answers - 1);
  expect(bubbles().filter(text => text === before.at(-1))).toHaveLength(1);
  expect(bubbles().at(-1)).toBe(before.at(-1));
  release();
  await waitFor(() => document.querySelectorAll('[data-testid=turn-summary][data-status=done]').length === answers && !store.busy);
  expect(userTexts()).toEqual(before);
});

test('a retry whose resend fails leaves its prompt in the box', async () => {
  await openIdleThread();
  const before = userTexts();
  const sending = vi.spyOn(store, 'send').mockResolvedValue(false);
  const summaries = document.querySelectorAll('[data-testid=turn-summary]');
  (summaries[summaries.length - 1]!.querySelector('[data-testid=message-retry]') as HTMLButtonElement).click();
  const box = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  await waitFor(() => sending.mock.calls.length === 1 && box.value === before.at(-1));
  expect(userTexts()).toEqual(before.slice(0, -1));
  expect(document.querySelector('[data-testid=composer-editing]')).toBeNull();
});

test('the settings bar picks the machine a page changes without moving the window, Plugins opening on this PC', async () => {
  await mountOnFake('/?fake=1&machines=1');
  await waitFor(() => workspace.machines.length === 2 && workspace.machines.every((machine) => machine.store.connection === 'ready'));
  const remote = workspace.machines.find((machine) => machine.store !== store)!;
  store.localCore = true;
  await workspace.select(remote.store);
  const thread = remote.store.openThread;
  // Plugins run where they were installed: the page opens on this PC, not on the machine the chat is on.
  remote.store.showSettings('plugins');
  await waitFor(() => document.querySelector('[data-testid=settings-machine]') !== null && document.querySelector('[data-testid=plugins-page]') !== null);
  expect(query('[data-testid=settings-machine]').textContent).toContain(`${store.core!.hostname} (you)`);
  // The picker is the machine's name in the title's scope line.
  expect(query('[data-testid=settings-scope]').contains(query('[data-testid=settings-machine]'))).toBe(true);
  expect(query('[data-testid=settings-scope]').textContent).toContain(strings.settingsMap.scope.machine.split('{machine}')[0]!.trim());
  expect(document.querySelectorAll('[data-testid=settings-machine]')).toHaveLength(1);
  // Every other page opens on the window's machine. Safeguards is the machine's: the line under its title holds the picker.
  remote.store.showSettings('safeguards', 'quiet');
  await waitFor(() => query('[data-testid=settings-machine]').textContent?.includes(remote.label) === true && document.querySelector('[data-testid=setting-mute-agents]') !== null);
  await remote.store.client!.call('settings.set', { muteAgents: true });
  await store.client!.call('settings.set', { muteAgents: true });
  query<HTMLButtonElement>('[data-testid=settings-machine]').click();
  await waitFor(() => document.querySelector('[data-testid=settings-machine-menu]') !== null);
  query<HTMLElement>(`[data-testid=settings-machine-menu] [data-value="${workspace.machines[0]!.id}"]`).click();
  await waitFor(() => query('[data-testid=settings-machine]').textContent?.includes(strings.machines.youTag) === true);
  query<HTMLInputElement>('[data-testid=setting-mute-agents]').click();
  await waitFor(() => store.settings?.muteAgents === false);
  expect(remote.store.settings?.muteAgents).toBe(true);
  // The window never moved: same machine, same conversation, still on the page it showed.
  expect([workspace.active, remote.store.openThread, remote.store.settingsTab]).toEqual([remote.store, thread, 'safeguards']);
  expect(query('[data-testid=settings-scope]').dataset.scope).toBe('machine');
  expect(query('[data-testid=settings-scope]').contains(query('[data-testid=settings-machine]'))).toBe(true);
  expect(document.querySelectorAll('[data-testid=settings-machine]')).toHaveLength(1);
  // Conversations is mostly this device's cards: the line says so once, and its first machine card's phrase holds the picker.
  remote.store.showSettings('conversations');
  await waitFor(() => document.querySelector('#settings-agent-replies [data-testid=card-scope]') !== null);
  expect(query('[data-testid=settings-scope]').dataset.scope).toBe('device');
  expect(query('#settings-agent-replies [data-testid=card-scope]').contains(query('[data-testid=settings-machine]'))).toBe(true);
  expect(document.querySelectorAll('[data-testid=settings-machine]')).toHaveLength(1);
  // A page of this device says so once under its title, with no picker; Devices says it holds for every machine.
  remote.store.showSettings('appearance');
  await waitFor(() => remote.store.settingsTab === 'appearance' && document.querySelector('[data-testid=settings-machine]') === null);
  expect(query('[data-testid=settings-scope]').textContent?.trim()).toBe(strings.settingsMap.scope.device);
  remote.store.showSettings('devices');
  await waitFor(() => document.querySelector('[data-testid=settings-scope][data-scope=group]') !== null);
  expect(query('[data-testid=settings-scope]').textContent?.trim()).toBe(strings.settingsMap.scope.group);
});

test('a page says where it applies once: one line for most of its cards, a tag only on a card that differs', async () => {
  await mountOnFake('/?fake=1');
  await waitFor(() => workspace.machines.length === 1 && store.connection === 'ready');
  const machine = workspace.machines[0]!;
  // Conversations is this device's cards first, then three of the machine: the line says "This device" once, each machine card its own.
  store.showSettings('conversations');
  await waitFor(() => document.querySelector('#settings-agent-replies [data-testid=card-scope]') !== null);
  expect(query('[data-testid=settings-scope]').textContent?.trim()).toBe(strings.settingsMap.scope.device);
  expect([...document.querySelectorAll<HTMLElement>('[data-testid=card-scope]')].map((tag) => tag.dataset.kind)).toEqual(['machine', 'machine', 'machine']);
  expect(document.body.textContent?.split(strings.settings.cardDevice)).toHaveLength(1);
  expect(query('#settings-agent-replies [data-testid=card-scope]').textContent?.trim()).toBe(fill(strings.settings.cardMachine, { machine: machineName(machine) }));
  // Appearance holds this device's settings alone: no card carries a tag, the line under the title says it once.
  store.showSettings('appearance');
  await waitFor(() => document.querySelector('[data-testid=settings-page][data-page=appearance]') !== null);
  expect(query('[data-testid=settings-scope]').dataset.scope).toBe('device');
  expect(query('[data-testid=settings-scope]').textContent?.trim()).toBe(strings.settingsMap.scope.device);
  expect(document.querySelectorAll('[data-testid=card-scope]')).toHaveLength(0);
  // Safeguards is the machine's, and its browser card alone is this device's: one tag, on that card.
  store.showSettings('browser');
  await waitFor(() => document.querySelector('[data-testid=browser-profiles-card]') !== null);
  expect(query('[data-testid=settings-scope]').dataset.scope).toBe('machine');
  expect([...document.querySelectorAll<HTMLElement>('[data-testid=card-scope]')].map((tag) => tag.dataset.kind)).toEqual(['device']);
  // A page of one machine: "This machine: studio", the name plain text with nothing to pick.
  store.showSettings('voice');
  await waitFor(() => document.querySelector('[data-testid=settings-page][data-page=input]') !== null);
  expect(query('[data-testid=settings-scope]').textContent?.trim()).toBe(fill(strings.settingsMap.scope.machine, { machine: machineName(machine) }));
  expect(document.querySelector('[data-testid=settings-scope] [data-testid=settings-machine]')).toBeNull();
  expect(document.querySelectorAll('[data-testid=card-scope]')).toHaveLength(0);
});
