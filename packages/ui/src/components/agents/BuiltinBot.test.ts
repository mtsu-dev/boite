import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView } from '../../lib/agents.svelte';
import { confirm } from '../../lib/confirm.svelte';
import { setExperiment } from '../../lib/experiments';
import { strings } from '../../lib/strings';
import AgentsPage from './AgentsPage.svelte';

const one = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);

/*
 * The Operator, the bot Boite ships for Contacts, on the Bots page: a badge
 * says it is Boite's, its role and instructions are shown but locked, and
 * Reset, confirmed in the app's dialog, stands where Archive was.
 */
test('a built-in bot carries its badge, locks its texts and resets after the app asks', async ({ ready }) => {
  setExperiment('resident-agents', true);
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
    const made = await client.call('agents.builtin.ensure', { kind: 'contacts', name: strings.agents.builtin.name.contacts });
    // Its name, robot and route stay the owner's: a rename is saved like any bot's.
    const renamed = await client.call('agents.profile.save', { id: made.id, expectedRevision: made.revision, value: { name: 'Switchboard', domain: made.domain, instructions: made.instructions, avatar: '', selection: made.selection, status: made.status, projectIds: [] } });
    expect([renamed.name, renamed.builtin]).toEqual(['Switchboard', 'contacts']);
    const view = AgentsView.of(store);
    await view.refresh();
    store.showAgents(made.id, 'settings');
    page = mount(AgentsPage, { target: document.body, props: { store } });
    await vi.waitFor(() => { flushSync(); expect(one('[data-testid="agent-sheet"] [data-testid="agent-editor"]')).not.toBeNull(); });

    // The badge in its rail row and in its header; an owner's bot has none.
    expect(one(`[data-testid="agent-entry-${made.id}"] [data-testid="agent-builtin-badge"]`)?.getAttribute('title')).toBe(strings.agents.builtin.badgeTip);
    expect(one('[data-testid="agent-header"] [data-testid="agent-builtin-badge"]')?.textContent).toContain(strings.agents.builtin.badge);
    expect(document.querySelectorAll('[data-testid="agent-builtin-badge"]')).toHaveLength(2);

    // Role and instructions read, never typed into; the name stays editable.
    expect(one<HTMLInputElement>('[data-testid="agent-domain"]')!.readOnly).toBe(true);
    expect(one<HTMLTextAreaElement>('[data-testid="agent-instructions"]')!.readOnly).toBe(true);
    expect(one('[data-testid="agent-locked"]')!.textContent).toContain(strings.agents.builtin.locked);
    expect(one<HTMLInputElement>('[data-testid="agent-editor"] input:not([readonly])')).not.toBeNull();
    // Its status pauses, never archives.
    one<HTMLButtonElement>('[data-testid="agent-status"]')!.click();
    await vi.waitFor(() => { flushSync(); expect(one('[data-testid="agent-status-menu"]')).not.toBeNull(); });
    const statuses = [...document.querySelectorAll('[data-testid="agent-status-menu"] button')].map(item => item.textContent?.trim());
    expect(statuses).toEqual([strings.agents.active, strings.agents.paused]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // Reset asks in the app's own dialog first: a refusal changes nothing.
    const before = (await view.refresh(), view.snapshot!.sessions.find(session => session.agentId === made.id)!.threadId);
    one<HTMLButtonElement>('[data-testid="agent-reset"]')!.click();
    await vi.waitFor(() => expect(confirm.current?.danger).toBe(true));
    expect(confirm.current!.title).toContain('Switchboard');
    expect(confirm.current!.body).toBe(strings.agents.builtin.resetBody);
    confirm.answer(false);
    await new Promise(resolve => setTimeout(resolve, 20));
    await view.refresh();
    expect(view.snapshot!.profiles.find(profile => profile.id === made.id)!.name).toBe('Switchboard');

    const call = vi.spyOn(client, 'call');
    one<HTMLButtonElement>('[data-testid="agent-reset"]')!.click();
    await vi.waitFor(() => expect(confirm.current).not.toBeNull());
    confirm.answer(true);
    await vi.waitFor(() => expect(call.mock.calls.some(([method]) => method === 'agents.builtin.reset')).toBe(true));
    // The default name in the app's language, and no route: the core puts its own back.
    expect(call.mock.calls.find(([method]) => method === 'agents.builtin.reset')![1]).toEqual({ agentId: made.id, name: strings.agents.builtin.name.contacts });
    await vi.waitFor(() => expect(view.snapshot?.profiles.find(profile => profile.id === made.id)?.name).toBe(strings.agents.builtin.name.contacts));
    // A new conversation, the old one archived.
    const after = view.snapshot!.sessions.find(session => session.agentId === made.id)!.threadId;
    expect(after).not.toBe(before);
    expect((await client.call('threads.get', { threadId: before })).archived).toBe(true);
  } finally {
    if (page) await unmount(page);
    confirm.answer(false);
    setExperiment('resident-agents', false);
  }
});
