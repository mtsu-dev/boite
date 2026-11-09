import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView, statusOf } from '../../lib/agents.svelte';
import { setExperiment } from '../../lib/experiments';
import { fill, strings } from '../../lib/strings';
import AgentsPage from './AgentsPage.svelte';

test('a bot whose account is gone offers its other accounts in place, and one pick puts it back to work', async ({ ready }) => {
  setExperiment('resident-agents', true);
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const bolt = view.snapshot!.profiles.find(profile => profile.name === 'Bolt')!;
    expect(store.accounts.some(account => account.id === bolt.selection.accountId)).toBe(false);
    store.showAgents(bolt.id);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    const banner = () => document.querySelector<HTMLElement>('[data-testid="agent-problem"]');
    await vi.waitFor(() => expect(banner()).not.toBeNull());
    // The bot's read-only chips point at the same remedy, not at the settings.
    const effort = () => document.querySelector<HTMLElement>('[data-testid="composer-effort"]');
    await vi.waitFor(() => expect(effort()?.title).toBe(fill(strings.composer.botAccountGone, { name: 'Bolt' })));
    // The remedy is the accounts themselves, not a trip to the settings that hold them.
    const trigger = banner()!.querySelector<HTMLButtonElement>('[data-testid="agent-problem-account"]')!;
    expect(trigger.textContent).toContain(strings.agents.pickAccount);
    // The composer names the state and the same remedy at the field, and opens that menu.
    const gone = () => document.querySelector<HTMLButtonElement>('[data-testid="composer-bot-gone"]');
    expect(gone()?.textContent).toContain(strings.accounts.removed);
    expect(gone()?.textContent).toContain(strings.agents.pickAccount);
    gone()!.click();
    flushSync();
    const account = store.accounts.find(entry => store.providerOf(entry.providerId) && entry.status !== 'unauthenticated')!;
    const row = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>(`[data-testid="agent-problem-account-menu"] [data-value="${account.id}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    row.click();
    await vi.waitFor(() => {
      const saved = view.snapshot!.profiles.find(profile => profile.id === bolt.id)!;
      expect(saved.selection.accountId).not.toBe(bolt.selection.accountId);
      expect(statusOf(view.snapshot, bolt.id)?.problem ?? null).toBeNull();
    });
    flushSync();
    expect(banner()).toBeNull();
    expect(gone()).toBeNull();
    await vi.waitFor(() => expect(effort()?.title).toBe(fill(strings.composer.botSettings, { name: 'Bolt' })));
  } finally {
    if (page) unmount(page);
    setExperiment('resident-agents', false);
  }
});
