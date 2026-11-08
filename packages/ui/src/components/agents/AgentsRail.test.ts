import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { phoneWidth } from '../../test/phone-width';
import { AgentsView, agentRows } from '../../lib/agents.svelte';
import { workspace } from '../../lib/workspace.svelte';
import AgentsRail from './AgentsRail.svelte';

test("a bot row's picture is grey at rest and lit while the bot needs the owner", async ({ ready }) => {
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
