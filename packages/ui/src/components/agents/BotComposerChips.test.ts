import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../../test/fake-client';
import { AgentsView } from '../../lib/agents.svelte';
import { fill, strings } from '../../lib/strings';
import AgentsPage from './AgentsPage.svelte';

/*
 * A mochi's conversation: its composer's model, effort and mode chips open the
 * menus of any thread, and a pick is the mochi's own setting, written as its
 * settings page writes it. The core then moves the mochi's thread, so its next
 * turn runs there, and the settings beside the chat show the same.
 */

const inComposer = <T extends HTMLElement>(testid: string) => document.querySelector<T>(`[data-testid="composer"] [data-testid="${testid}"]`);
const inSettings = <T extends HTMLElement>(testid: string) => document.querySelector<T>(`[data-testid="agent-runtime"] [data-testid="${testid}"]`);
async function found<T extends HTMLElement>(get: () => T | null): Promise<T> {
  return vi.waitFor(() => { const element = get(); expect(element).not.toBeNull(); return element!; });
}

test("a mochi's chips open their menus, and each pick saves its settings and moves its thread", async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store, client } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const pixel = view.snapshot!.profiles.find(profile => profile.name === 'Pixel')!;
    const profile = () => view.snapshot!.profiles.find(entry => entry.id === pixel.id)!;
    const runtime = () => client.call('agents.runtime.get', { agentId: pixel.id });
    const thread = async () => client.call('threads.get', { threadId: (await client.call('agents.open', { agentId: pixel.id })).threadId, limit: 1 });
    store.showAgents(pixel.id, 'settings');
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();

    // Model: the thread's own menu, one pick.
    const picker = await found(() => inComposer<HTMLButtonElement>('composer-picker'));
    expect(picker.getAttribute('aria-haspopup')).toBe('menu');
    expect(picker.title).toBe(fill(strings.composer.botSettings, { name: 'Pixel' }));
    await found(() => inSettings('composer-picker'));
    picker.click();
    flushSync();
    // Another provider altogether, as a thread would move: Echo has one model.
    (await found(() => document.querySelector<HTMLButtonElement>('[data-testid="composer-picker-menu"] [data-provider="claude"]'))).click();
    flushSync();
    const row = await found(() => document.querySelector<HTMLButtonElement>('[data-testid="composer-picker-menu"] [data-model]:not(:disabled)'));
    const model = row.dataset.model!;
    row.click();
    await vi.waitFor(async () => {
      expect(profile().selection).toMatchObject({ providerId: 'claude', model });
      expect((await thread()).providerId).toBe('claude');
      expect(profile().selection.model).toBe(model);
      expect((await runtime()).defaultRoute.model).toBe(model);
      expect((await thread()).model).toBe(model);
    });
    // The settings beside the chat read the new model, without a reload.
    await vi.waitFor(() => expect(inSettings('composer-picker')!.textContent).toContain(store.modelOf(profile().selection)?.name ?? model));

    // Effort: its slider, one level.
    const effort = await found(() => inComposer<HTMLButtonElement>('composer-effort'));
    effort.click();
    flushSync();
    const current = profile().selection.effort ?? store.defaultEffortOf('claude', profile().selection.accountId, model);
    const dot = await found(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="composer-effort-menu"] [data-dot]')].find(entry => entry.dataset.value !== current) ?? null);
    const level = dot.dataset.value!;
    dot.click();
    await vi.waitFor(async () => {
      expect(profile().selection.effort).toBe(level);
      expect((await thread()).effort).toBe(level);
    });
    expect(profile().selection.model).toBe(model);

    // Mode: its list, one row.
    const mode = await found(() => inComposer<HTMLButtonElement>('composer-mode'));
    await vi.waitFor(() => expect(mode.disabled).toBe(false));
    mode.click();
    flushSync();
    const choice = await found(() => document.querySelector<HTMLButtonElement>('[data-testid="composer-mode-menu"] [data-row][aria-checked="false"]'));
    const permissionMode = choice.dataset.value!;
    choice.click();
    await vi.waitFor(async () => {
      expect(profile().selection.permissionMode).toBe(permissionMode);
      expect((await runtime()).defaultRoute.permissionMode).toBe(permissionMode);
      expect((await thread()).permissionMode).toBe(permissionMode);
    });
    expect(profile().selection).toMatchObject({ model, effort: level });
    await vi.waitFor(() => expect(inSettings('composer-effort')!.textContent).toContain(store.modelOf(profile().selection)?.effort?.levels.find(entry => entry.id === level)?.label ?? ''));
  } finally {
    if (page) unmount(page);
  }
});

test("on a paired device a mochi's chips change nothing, and a click says why", async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true, principal: 'session' });
    const view = AgentsView.of(store);
    await view.refresh();
    const pixel = view.snapshot!.profiles.find(profile => profile.name === 'Pixel')!;
    store.showAgents(pixel.id);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    for (const [chip, menu] of [['composer-picker', 'composer-picker-menu'], ['composer-effort', 'composer-effort-menu'], ['composer-mode', 'composer-mode-menu']] as const) {
      const trigger = await found(() => inComposer<HTMLButtonElement>(chip));
      expect(trigger.title).toBe(strings.agentSettingRequest.guestHint);
      trigger.click();
      flushSync();
      const note = await found(() => document.querySelector<HTMLElement>(`[data-testid="${chip}-note"]`));
      expect(note.textContent).toBe(strings.agentSettingRequest.guestHint);
      expect(document.querySelector(`[data-testid="${menu}"]`)).toBeNull();
      trigger.click();
      flushSync();
    }
    await view.refresh();
    expect(view.snapshot!.profiles.find(profile => profile.id === pixel.id)!.revision).toBe(pixel.revision);
  } finally {
    if (page) unmount(page);
  }
});

test("a mochi whose account is gone picks another one from its model chip", async ({ ready }) => {
  let page: ReturnType<typeof mount> | null = null;
  try {
    const { store } = await ready({ delayMs: 0, agentsDemo: true });
    const view = AgentsView.of(store);
    await view.refresh();
    const bolt = view.snapshot!.profiles.find(profile => profile.name === 'Bolt')!;
    store.showAgents(bolt.id);
    page = mount(AgentsPage, { target: document.body, props: { store } });
    flushSync();
    const picker = await found(() => inComposer<HTMLButtonElement>('composer-picker'));
    expect(picker.title).toBe(fill(strings.composer.botAccountGone, { name: 'Bolt' }));
    picker.click();
    flushSync();
    const row = await found(() => document.querySelector<HTMLButtonElement>('[data-testid="composer-picker-menu"] [data-model]:not(:disabled)'));
    row.click();
    await vi.waitFor(() => {
      const saved = view.snapshot!.profiles.find(profile => profile.id === bolt.id)!;
      expect(store.accounts.some(account => account.id === saved.selection.accountId)).toBe(true);
    });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="composer-bot-gone"]')).toBeNull());
  } finally {
    if (page) unmount(page);
  }
});
