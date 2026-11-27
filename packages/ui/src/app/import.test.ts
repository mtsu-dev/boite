import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { followsDesktop, isExperimentEnabled, setExperiment } from '../lib/experiments';
import type { FakeClient } from '../lib/fake-client';
import { mountOnFake, press, query, test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('the project menu hides session import until the experiment is enabled', async () => {
  store.draft = null;
  expect(window.localStorage.getItem('boite.experiments')).toBeNull();
  await mountOnFake();
  await waitFor(() => document.querySelector('[data-testid=project-row][data-project-id="p-boite"]') !== null);

  const head = query<HTMLElement>('[data-testid=project-row][data-project-id="p-boite"]');
  head.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=manage]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=manage]').click();
  // The submenu is open once its Secrets entry, always there, shows.
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=secrets]') !== null);
  expect(document.querySelector('[data-testid=context-menu] [data-value=import]')).toBeNull();
});

test('Import a session in the project menu lists the transcripts and opens the imported thread', async () => {
  store.draft = null;
  await mountOnFake();
  setExperiment('session-import', true);
  await waitFor(() => document.querySelector('[data-testid=project-row][data-project-id="p-boite"]') !== null);

  const head = query<HTMLElement>('[data-testid=project-row][data-project-id="p-boite"]');
  head.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=manage]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=manage]').click();
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=import]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=import]').click();

  // The dialog opens at once and says it is reading; the rows follow.
  await waitFor(() => document.querySelector('[data-testid=import-dialog]') !== null);
  expect(document.querySelector('[data-testid=import-loading]')).not.toBeNull();
  await waitFor(() => document.querySelectorAll('[data-testid=import-row]').length === 3);
  const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid=import-row]'));
  expect(rows.map((row) => row.querySelector('.title')?.textContent)).toEqual(['Finish the trace tab', 'Where the shell looks for a core', 'Sort the release notes by date']);
  // Two kinds of sessions in one list: each row names the agent that kept it.
  expect(rows.map((row) => row.querySelector('[data-testid=import-agent]')?.textContent)).toEqual(['Claude', 'Claude', 'Codex']);
  // The session that is already the trace thread cannot be taken twice.
  expect(rows[0]?.disabled).toBe(true);
  expect(rows[0]?.querySelector('.hint')?.textContent).toBe('Imported');
  expect(rows[1]?.disabled).toBe(false);

  const before = store.threads.length;
  rows[1]?.click();
  await waitFor(() => document.querySelector('[data-testid=import-dialog]') === null);
  expect(store.threads.length).toBe(before + 1);
  const imported = store.threads.find((thread) => thread.title === 'Where the shell looks for a core');
  expect(imported).toMatchObject({ projectId: 'p-boite', titleSource: 'agent', sessionId: '4c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' });
  await waitFor(() => query('[data-testid=thread-title]').textContent?.trim() === 'Where the shell looks for a core');
  expect(store.openThread?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

  // Escape closes the dialog when it is open again.
  head.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=manage]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=manage]').click();
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=import]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=import]').click();
  await waitFor(() => document.querySelectorAll('[data-testid=import-row]').length === 3);
  expect(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid=import-row]')).map((row) => row.disabled)).toEqual([true, true, false]);
  press('Escape');
  await waitFor(() => document.querySelector('[data-testid=import-dialog]') === null);
});

test('a shared transcript asks for its account, supports menu keys, and imports with the alternative', async () => {
  await mountOnFake();
  setExperiment('session-import', true);
  const alternative = await store.client!.call('accounts.add', { providerId: 'claude', label: 'Alternative login', useDefaultLocation: true });
  await waitFor(() => store.accounts.some(account => account.id === alternative.id));
  const imported = vi.spyOn(store, 'importSession');
  try {
    await store.openImports('p-boite');
    await waitFor(() => document.querySelectorAll('[data-testid=import-row]').length === 3);
    const row = query<HTMLButtonElement>('[data-testid=import-row]:not(:disabled)');
    row.click();
    expect(imported).not.toHaveBeenCalled();
    await waitFor(() => document.querySelector('[data-testid=context-menu]') !== null);
    const menu = query<HTMLElement>('[data-testid=context-menu]');
    expect(Array.from(menu.querySelectorAll('[role=menuitem]')).map(item => item.textContent?.trim())).toEqual(['Default', 'Alternative login']);
    query<HTMLButtonElement>('[data-testid=context-menu] [role=menuitem]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('[data-testid=context-menu]') === null);
    expect(store.imports).not.toBeNull();
    expect(document.activeElement).toBe(row);
    row.click();
    await waitFor(() => document.querySelector('[data-testid=context-menu]') !== null);
    const first = query<HTMLButtonElement>('[data-testid=context-menu] [role=menuitem]');
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect((document.activeElement as HTMLElement).dataset.value).toBe(alternative.id);
    (document.activeElement as HTMLButtonElement).click();
    expect(imported).toHaveBeenCalledExactlyOnceWith(alternative.id, '4c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f');
    await waitFor(() => store.imports !== null && store.imports.running !== null);
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid=import-row]')).every(button => button.disabled)).toBe(true);
    expect(query('[data-testid=import-row]:not(.done) .hint').textContent).toBe('Importing');
    await waitFor(() => store.imports === null);
    expect(store.openThread?.accountId).toBe(alternative.id);
  } finally {
    imported.mockRestore();
  }
});

test('the desktop turning session import off closes its dialog, which then holds no key', async () => {
  await mountOnFake();
  const palette = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, cancelable: true }));
  expect(followsDesktop()).toBe(true);
  const client = store.client as FakeClient;
  client.reportDesktopExperiments(['session-import']);
  await waitFor(() => isExperimentEnabled('session-import'));
  await store.openImports('p-boite');
  await waitFor(() => document.querySelectorAll('[data-testid=import-row]').length === 3);
  palette();
  expect(store.paletteOpen).toBe(false);

  client.reportDesktopExperiments([]);
  await waitFor(() => document.querySelector('[data-testid=import-dialog]') === null);
  expect(store.imports).toBeNull();
  palette();
  expect(store.paletteOpen).toBe(true);
  store.paletteOpen = false;

  // Turned off while an import runs: the dialog stays until the core answers, hidden, and holds no key meanwhile.
  client.reportDesktopExperiments(['session-import']);
  await waitFor(() => isExperimentEnabled('session-import'));
  await store.openImports('p-boite');
  await waitFor(() => document.querySelectorAll('[data-testid=import-row]').length === 3);
  let answer!: () => void;
  const call = client.call.bind(client);
  const held = vi.spyOn(client, 'call').mockImplementation((async (method: string, params: unknown) => {
    if (method === 'imports.run') await new Promise<void>((resolve) => { answer = resolve; });
    return call(method as never, params as never);
  }) as typeof client.call);
  query<HTMLButtonElement>('[data-testid=import-row]:not(:disabled)').click();
  await waitFor(() => store.imports?.running !== null && answer !== undefined);
  client.reportDesktopExperiments([]);
  await waitFor(() => document.querySelector('[data-testid=import-dialog]') === null);
  expect(store.imports?.running).toBeTruthy();
  palette();
  expect(store.paletteOpen).toBe(true);
  store.paletteOpen = false;
  answer();
  await waitFor(() => store.imports === null);
  held.mockRestore();
});
