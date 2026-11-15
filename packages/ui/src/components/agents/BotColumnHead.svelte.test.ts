import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView, statusOf } from '../../lib/agents.svelte';
import BotColumnHead from './BotColumnHead.svelte';

// The day tip kept the budget of the bot shown before until the new bot's settings were read, so a bot with no
// budget said for a moment that it had the previous one's.
test('the day tip never shows the budget of the bot shown before', async ({ ready }) => {
  let column: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const by = (name: string) => view.snapshot!.profiles.find(profile => profile.name === name)!;
    const nova = by('Nova'), mira = by('Mira');
    const props = $state({ view, agent: nova, status: statusOf(view.snapshot, nova.id), onopen: () => {}, onpane: () => {}, onengine: () => {} });
    column = mount(BotColumnHead, { target: document.body, props });
    flushSync();
    const tip = () => document.querySelector<HTMLButtonElement>('[data-testid=bot-column-day]')?.dataset.tipText ?? '';
    await vi.waitFor(() => { flushSync(); expect(tip()).toContain('$2.00'); });
    props.agent = mira;
    props.status = statusOf(view.snapshot, mira.id);
    flushSync();
    expect(tip()).not.toContain('$2.00');
  } finally {
    if (column) unmount(column);
  }
});
