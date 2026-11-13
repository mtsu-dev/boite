import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView, statusOf } from '../../lib/agents.svelte';
import { strings } from '../../lib/strings';
import AgentHeader from './AgentHeader.svelte';
import BotColumnHead from './BotColumnHead.svelte';

// A bot whose account was removed read "Its last turn failed" under its name, a cause the banner
// beside it contradicted: the line now says what it needs.
test('a bot whose account is gone says it needs an account, not that its last turn failed', async ({ ready }) => {
  let head: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const bolt = view.snapshot!.profiles.find(profile => profile.name === 'Bolt')!;
    const status = statusOf(view.snapshot, bolt.id);
    head = mount(AgentHeader, { target: document.body, props: { store, view, agent: bolt, status, thread: null, onpane: () => {}, onback: () => {} } });
    flushSync();
    const line = document.querySelector<HTMLElement>('[data-testid=agent-live-error]');
    expect(line?.textContent).toBe(strings.agents.needsAccount);
    expect(document.querySelector('[data-testid=agent-live]')?.textContent).not.toContain(strings.agents.state.error);
    // The bot column's head says the same, not the core's long sentence the banner already carries.
    const column = mount(BotColumnHead, { target: document.body, props: { view, agent: bolt, status, onopen: () => {}, onpane: () => {}, onengine: () => {} } });
    flushSync();
    expect(document.querySelector('[data-testid=bot-column-live] .bot-head-line')?.textContent).toBe(strings.agents.needsAccount);
    unmount(column);
  } finally {
    if (head) unmount(head);
  }
});

// With the bot column folded on a desktop, the header held only the name: no visible way back to the bots.
test('a desktop header offers the way back to the bot list only while the column is folded', async ({ ready }) => {
  let head: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const nova = view.snapshot!.profiles.find(profile => profile.name === 'Nova')!;
    store.sidebarCollapsed = false;
    head = mount(AgentHeader, { target: document.body, props: { store, view, agent: nova, status: null, thread: null, onpane: () => {} } });
    flushSync();
    const crumb = () => document.querySelector<HTMLButtonElement>('[data-testid=agent-list-crumb]');
    expect(crumb()).toBeNull();
    store.sidebarCollapsed = true;
    flushSync();
    expect(crumb()?.textContent?.trim()).toBe(strings.agents.heading);
    expect(crumb()?.title).toBe(strings.agents.backToList);
    crumb()!.click();
    await vi.waitFor(() => expect(store.sidebarCollapsed).toBe(false));
    flushSync();
    expect(crumb()).toBeNull();
  } finally {
    if (head) unmount(head);
  }
});
