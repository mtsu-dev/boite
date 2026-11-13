import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { phoneWidth } from '../../test/phone-width';
import { AgentsView, agentRows } from '../../lib/agents.svelte';
import { workspace } from '../../lib/workspace.svelte';
import AgentsRail from './AgentsRail.svelte';

test("a mochi row's picture is grey at rest and lit while the mochi needs the owner", async ({ ready }) => {
  const restore = phoneWidth();
  let rail: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const machine = workspace.machinesOr(store).find(m => m.store === store)!;
    const noop = () => {};
    rail = mount(AgentsRail, { target: document.body, props: { view, lists: [{ machine, view }], active: null, onopen: noop, onteam: noop, oncreate: noop, onengine: noop, onpane: noop } });
    flushSync();
    const idOf = (name: string) => agentRows(view.snapshot).find(row => row.profile.name === name)!.profile.id;
    const picture = (name: string) => document.querySelector(`[data-testid="agent-entry-${idOf(name)}"]`)?.closest('.agent-row')?.querySelector('.agent-avatar');
    // Pixel rests and Nova works: no notification, grey. Iris waits on a sign-in, Bolt failed, Mira has an answer not read.
    await vi.waitFor(() => expect(picture('Iris')).toBeTruthy());
    expect(picture('Pixel')!.hasAttribute('data-lit')).toBe(false);
    expect(picture('Nova')!.hasAttribute('data-lit')).toBe(false);
    expect(picture('Iris')!.hasAttribute('data-lit')).toBe(true);
    expect(picture('Bolt')!.hasAttribute('data-lit')).toBe(true);
    expect(picture('Mira')!.hasAttribute('data-lit')).toBe(true);
  } finally {
    if (rail) unmount(rail);
    restore();
  }
});

test("an offline machine's mochi keeps its missed answers count beside the machine's place", async ({ ready }) => {
  const restore = phoneWidth();
  let rail: ReturnType<typeof mount> | null = null;
  try {
    const here = await ready({ delayMs: 0 });
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    workspace.machines = [{ id: 'here', label: 'Here', store: here.store }, { id: 'builder', label: 'Builder', store }];
    const view = AgentsView.of(store);
    await view.refresh();
    const machine = workspace.machines[1]!;
    const noop = () => {};
    rail = mount(AgentsRail, { target: document.body, props: { view, lists: [{ machine, view }], active: null, onopen: noop, onteam: noop, oncreate: noop, onengine: noop, onpane: noop } });
    flushSync();
    const mira = agentRows(view.snapshot).find(row => row.profile.name === 'Mira')!;
    const row = () => document.querySelector(`[data-testid="agent-entry-${mira.profile.id}"]`)?.closest('.agent-row');
    await vi.waitFor(() => expect(row()?.querySelector('[data-testid="agent-unread-count"]')).toBeTruthy());
    // Its machine drops: the row names the machine as offline and still counts the answers Mira gave that nobody read.
    store.connection = 'closed';
    flushSync();
    expect(row()!.querySelector('[data-testid="agent-row-away"]')).toBeTruthy();
    expect(row()!.querySelector('[data-testid="agent-unread-count"]')?.textContent).toBe(String(mira.status!.unread));
  } finally {
    if (rail) unmount(rail);
    workspace.machines = [];
    restore();
  }
});
