import { expect, vi } from 'vitest';
import type { AgentCreated } from '@boite/contracts';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView, agentOfThread, agentRows, openAgent } from '../../lib/agents.svelte';
import { rightPanel } from '../../lib/right-panel.svelte';
import { strings } from '../../lib/strings';
import { newBot } from '../../lib/agents-view.svelte';
import AgentsPage from './AgentsPage.svelte';
import TitleBar from '../TitleBar.svelte';

test('an agent named on the way in opens alone: the default agent of the visit gives way to it', async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const rows = agentRows(view.snapshot);
    const named = rows.at(-1)!.profile;
    expect(named.id).not.toBe(rows[0]!.profile.id);
    // An ordinary thread is open when a link names the agent.
    expect(store.openThread?.agentSessionId).toBeFalsy();
    const call = vi.spyOn(client, 'call');
    store.showAgents(named.id);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    await vi.waitFor(() => expect(store.openThread?.agentSessionId).toBeTruthy());
    await new Promise(resolve => setTimeout(resolve, 50));
    const opened = call.mock.calls.filter(([method]) => method === 'agents.open').map(([, params]) => (params as { agentId: string }).agentId);
    expect(opened).toEqual([named.id]);
    expect(agentOfThread(view.snapshot, store.openThread!.id)?.id).toBe(named.id);
  } finally {
    if (page) unmount(page);
  }
});

for (const previousBot of [false, true]) test(`a background reload preserves a pending mochi selection (previous mochi: ${previousBot})`, async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  let bar: ReturnType<typeof mount> | null = null;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const rows = agentRows(view.snapshot);
    if (previousBot) await openAgent(store, rows[0]!.profile.id);
    else await store.open('t-trace');
    const named = rows.at(-1)!.profile;
    const call = client.call.bind(client);
    let opening = false;
    vi.spyOn(client, 'call').mockImplementation(async (method, params) => {
      if (method === 'agents.open') { opening = true; await gate; }
      return call(method, params);
    });
    store.showAgents(named.id);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    // On a desktop the bot's name and buttons stand in the window's top bar.
    bar = mount(TitleBar, { target: document.body, props: { store } });
    flushSync();
    await vi.waitFor(() => expect(opening).toBe(true));
    await store.reload();
    release();
    await vi.waitFor(() => expect(agentOfThread(view.snapshot, store.openThread?.id)?.id).toBe(named.id));
    flushSync();
    expect(document.querySelector('[data-testid="agent-header"]')?.textContent).toContain(named.name);
    expect(document.querySelector('.agents-main [data-testid="composer-input"]')).not.toBeNull();
    expect(document.querySelector('.agents-main .agent-empty')).toBeNull();
  } finally {
    release();
    if (bar) await unmount(bar);
    if (page) await unmount(page);
  }
});

test('an open settings sheet stays open while the snapshot and the thread row change under it', async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const agent = agentRows(view.snapshot)[0]!.profile;
    store.showAgents(agent.id, 'settings');
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    const sheet = () => document.querySelector('[data-testid="agent-sheet"]');
    await vi.waitFor(() => expect(sheet()).not.toBeNull());
    // A status tick: the same agent, a new snapshot object.
    const before = view.snapshot;
    await view.refresh();
    expect(view.snapshot).not.toBe(before);
    flushSync();
    expect(sheet()?.classList.contains('closing')).toBe(false);
    // The open thread read again: the same thread, a new object.
    store.openThread = { ...store.openThread! };
    flushSync();
    expect(sheet()?.classList.contains('closing')).toBe(false);
  } finally {
    if (page) unmount(page);
  }
});

test('a desk kept shut by an open panel opens on the next visit: the first visit is not spent', async ({ ready }) => {
  // No desk seen and no panel left by an earlier test.
  localStorage.clear();
  rightPanel.load();
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const agent = agentRows(view.snapshot)[0]!.profile;
    await openAgent(store, agent.id);
    // The thread's panel already holds a surface: the desk does not push it aside.
    store.panel.open('files');
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(store.panel.surfaces.map(s => s.kind)).toEqual(['files']);
    unmount(page); page = null;
    store.panel.closeAll();
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    await vi.waitFor(() => expect(store.panel.surfaces.map(s => s.kind)).toEqual(['desk']));
  } finally {
    if (page) unmount(page);
  }
});

test('a default mochi that cannot be opened offers a retry instead of loading forever', async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
    await AgentsView.of(store).refresh();
    const call = client.call.bind(client);
    let refuse = true;
    vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => method === 'agents.open' && refuse
      ? Promise.reject(new Error('agents.open: the core is busy')) : call(method as never, params as never)) as typeof client.call);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    const retry = () => document.querySelector<HTMLButtonElement>('[data-testid="agents-open-retry"]');
    await vi.waitFor(() => expect(retry()).not.toBeNull());
    expect(document.querySelector('[data-testid="agents-page"]')?.textContent).not.toContain(strings.app.loading);
    refuse = false;
    retry()!.click();
    await vi.waitFor(() => expect(store.openThread?.agentSessionId).toBeTruthy());
  } finally {
    if (page) unmount(page);
  }
});

test("a desktop's column is the open mochi's: who it is, its conversation, its threads; the rail's New mochi opens the form here", async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  let bar: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const nova = view.snapshot!.profiles.find(p => p.name === 'Nova')!;
    store.showAgents(nova.id);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    bar = mount(TitleBar, { target: document.body, props: { store } });
    // The fake core seeds Nova's desk as its thread opens, without the change event the real core sends.
    await vi.waitFor(() => expect(store.openThread?.agentSessionId).toBeTruthy());
    await view.refresh();
    await vi.waitFor(() => { flushSync(); expect(document.querySelector('[data-testid=bot-handling]')).not.toBeNull(); });

    // Its head names it and says what it does; no list of bots, no search, no Teams or Bots heading.
    const head = document.querySelector('[data-testid=bot-column-head]')!;
    expect(head.textContent).toContain('Nova');
    expect(document.querySelector('[data-testid=bot-column-live]')?.textContent).toContain('Run the UI tests');
    expect(document.querySelector('[data-testid^="agent-entry-"]')).toBeNull();
    expect(document.querySelector('[data-testid=agents-search-toggle]')).toBeNull();
    expect(document.querySelectorAll('.agents-rail .section-label')).toHaveLength(0);
    // The window's top bar carries the chat's header in a thread header's pattern: its name, its view menu, the panel's glyph.
    expect(document.querySelector('[data-testid=titlebar] [data-testid=agent-header]')).not.toBeNull();
    const botHead = document.querySelector('[data-testid=agent-header]')!;
    expect(botHead.querySelector('.agent-head-name')?.textContent).toBe(nova.name);
    expect(botHead.querySelector('[data-testid=agent-menu]')).not.toBeNull();
    // One door: the panel glyph, its name in the tooltip, pressed while the panel is open.
    const door = botHead.querySelector<HTMLElement>('[data-testid=agent-desk-toggle]')!;
    expect(door.title).toContain(strings.thread.panelHint);
    expect(door.getAttribute('aria-pressed')).toBe(String(store.panelOpen));
    expect(door.textContent).not.toContain(strings.agents.desk);
    expect(botHead.querySelectorAll('[data-testid=agent-desk-toggle]')).toHaveLength(1);
    expect(document.querySelector('[data-testid=agent-live]')).toBeNull();
    const conversation = document.querySelector<HTMLButtonElement>('[data-testid=bot-conversation]')!;
    expect(conversation.getAttribute('aria-current')).toBe('page');

    // A row opens its thread the way the desk does.
    const row = [...document.querySelectorAll<HTMLElement>('[data-testid=desk-card]')].find(node => node.querySelector('.desk-card-title')?.textContent === 'Fix login redirect loop')!;
    const id = row.dataset.thread!;
    row.querySelector<HTMLButtonElement>('.desk-card-open')!.click();
    await vi.waitFor(() => expect(store.openThread?.id).toBe(id));

    // The window's rail asks for a new bot: the form opens on this page.
    newBot(store);
    await vi.waitFor(() => { flushSync(); expect(document.querySelector('[data-testid=agent-editor]')).not.toBeNull(); });
    expect(store.page).toBe('agents');
  } finally {
    if (bar) unmount(bar);
    if (page) unmount(page);
    document.body.innerHTML = '';
  }
});

test('an empty desk is one centred prompt in the column, the way into its first task', async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    const { id: threadId } = await client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo' });
    const { agent } = await client.call('agents.create', { threadId, name: 'Scribe' }) as AgentCreated;
    await view.refresh();
    store.showAgents(agent.id);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    await vi.waitFor(() => expect(store.openThread?.agentSessionId).toBeTruthy());
    await view.refresh();
    // A new bot already holds its introduction: the prompt is the column's, centred, and nothing covers the chat.
    await vi.waitFor(() => { flushSync(); expect(document.querySelector('[data-testid=desk-work].idle [data-testid=desk-work-start]')).not.toBeNull(); });
    expect(document.querySelector('[data-testid=desk-work]')!.textContent).toContain(strings.agents.deskPanel.workEmpty);
    expect(document.querySelectorAll('[data-testid=desk-work-start]')).toHaveLength(1);
    expect(document.querySelector('[data-testid=bot-first-task]')).toBeNull();
  } finally {
    if (page) unmount(page);
  }
});
