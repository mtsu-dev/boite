import { expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { store } from '../lib/store.svelte';
import { work } from '../lib/work-prefs.svelte';
import { rightPanel } from '../lib/right-panel.svelte';
import { count } from '../lib/format';
import { mountOnFake, query, test, type, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('a floating panel can dock after leaving or closing its browser tab and changing threads', async ({ app: _app }) => {
  // Dock is a row of the panel switcher on the header's door: the head holds the tabs and the close only.
  const dockRow = () => {
    if (!document.querySelector('[data-testid=panel-add-menu]')) { document.querySelector<HTMLButtonElement>('[data-testid=panel-add]')?.click(); flushSync(); }
    return document.querySelector<HTMLButtonElement>('[data-testid=panel-add-menu] [data-testid=panel-dock]');
  };
  await waitFor(() => document.querySelector('[data-thread-id="t-trace"]') !== null);
  query<HTMLButtonElement>('[data-thread-id="t-trace"]').click();
  await waitFor(() => store.openThread?.id === 't-trace');
  store.panel.open('browser', 'https://example.test');
  const browser = store.panel.active!.id;
  rightPanel.floating = true;
  store.panel.openTasks();
  await waitFor(() => document.querySelector('[data-testid=panel-add]') !== null);
  expect(document.querySelector('[data-testid=panel-titlebar] > [data-testid=panel-dock]')).toBeNull();
  store.panel.close(browser);
  flushSync();
  expect(document.querySelector('[data-testid=browser-slot]')).toBeNull();
  dockRow()!.click();
  flushSync();
  expect(rightPanel.floating).toBe(false);
  expect(dockRow()).toBeNull();
  rightPanel.floating = true;
  const other = store.threads.find(thread => thread.id !== 't-trace' && !thread.archived)!;
  await store.open(other.id);
  store.panel.openTasks();
  await waitFor(() => dockRow() !== null);
  rightPanel.maximized = true;
  dockRow()!.click();
  expect(rightPanel.floating).toBe(false);
  expect(rightPanel.maximized).toBe(false);
});

test("the panel selector lists the terminal, and a control's right click leads to the Appearance page that hides it and brings it back", async () => {
  work.showPreset('developer');
  // With a team on the thread, since Team shows only where there is one.
  await mountOnFake('/?fake=1&team=1');
  await waitFor(() => document.querySelector('[data-thread-id="t-trace"]') !== null);
  query<HTMLButtonElement>('[data-thread-id="t-trace"]').click();
  // The terminal moved from its own header button into the panel selector, under the button's id.
  await waitFor(() => document.querySelector('[data-testid=panel-toggle]') !== null);
  const wasOpen = store.panelOpen;
  if (!wasOpen) query<HTMLButtonElement>('[data-testid=panel-toggle]').click();
  await waitFor(() => document.querySelector('[data-testid=panel-add]') !== null);
  query<HTMLButtonElement>('[data-testid=panel-add]').click();
  // A hidden terminal is listed by name with every other panel, behind no door.
  await waitFor(() => document.querySelector('[data-testid=panel-add-menu] [data-value=terminal-toggle]') !== null);
  query<HTMLButtonElement>('[data-testid=panel-add]').click();
  // Open, the door is the switcher: the head's close shuts the panel.
  if (!wasOpen) query<HTMLButtonElement>('[data-testid=panel-close]').click();

  // The context's number sits beside the model chip once the context matters (ComposerBar's CONTEXT_SHOWN_FROM).
  store.openThread!.context = { tokens: 150_000, window: 200_000, at: Date.now() };
  await waitFor(() => document.querySelector('.context-control') !== null);
  query('.context-control').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 30 }));
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=customize]') !== null);
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=customize]').click();
  await waitFor(() => document.querySelector('[data-testid=settings-buttons]') !== null);
  expect(store.settingsTab).toBe('appearance');
  query<HTMLInputElement>('[data-testid="control-header.terminal"]').click();
  expect(work.current.hidden).toEqual(['header.terminal']);
  const terminal = query<HTMLInputElement>('[data-testid="control-header.terminal"]');
  expect(terminal.checked).toBe(false);
  // Neither preset is lit once the buttons are the device's own.
  await waitFor(() => query('[data-testid=controls-preset-developer]').getAttribute('aria-pressed') === 'false');
  terminal.click();
  expect(work.current.hidden).toEqual([]);
  await waitFor(() => query('[data-testid=controls-preset-developer]').getAttribute('aria-pressed') === 'true');
  query<HTMLButtonElement>('[data-testid=controls-preset-everyday]').click();
  expect(work.current.hidden).toEqual(['header.terminal', 'panel.trace']);
  await waitFor(() => !query<HTMLInputElement>('[data-testid="control-header.terminal"]').checked);
});

test('the header button opens the panel on its launcher, which opens the changes surface', async ({ app: _app }) => {
  await waitFor(() => document.querySelector('[data-thread-id="t-trace"]') !== null);
  query<HTMLButtonElement>('[data-thread-id="t-trace"]').click();
  await waitFor(() => store.openThread?.id === 't-trace');

  // The panel's layout is a module singleton: this test starts on an empty strip.
  store.panel.closeAll();
  expect(store.panelOpen).toBe(false);
  query<HTMLButtonElement>('[data-testid=panel-toggle]').click();
  // An empty panel opens on its cards rather than forcing one surface.
  await waitFor(() => document.querySelector('[data-testid=panel-launcher]') !== null);
  // Open, the door turns into the switcher, named Panels while no panel shows.
  await waitFor(() => document.querySelector('[data-testid=panel-add]') !== null);
  expect(query('[data-testid=panel-add]').textContent?.trim()).toBe('Panels');
  expect(document.querySelector('[data-testid=panel-toggle]')).toBeNull();
  expect(document.querySelector('[data-testid=trace-panel]')).toBeNull();
  for (const kind of ['agent-browser', 'changes', 'files', 'tasks', 'trace']) {
    expect(document.querySelector(`[data-testid=launch-${kind}]`)).not.toBeNull();
  }

  query<HTMLButtonElement>('[data-testid=launch-changes]').click();
  await waitFor(() => document.querySelectorAll('[data-testid=changes-row]').length === 7);
  expect(query('[data-testid=changes-count]').textContent).toContain('7');
  // Every status of the contract has a row, so every badge is drawn once.
  expect(
    Array.from(document.querySelectorAll('[data-testid=changes-row]')).map((row) => row.getAttribute('data-status'))
  ).toEqual(['modified', 'added', 'deleted', 'renamed', 'copied', 'untracked', 'conflict']);

  // A pick in the file chip selects, and the selection rides the tab rather than the component.
  query<HTMLButtonElement>('[data-testid=changes-pager]').click();
  await waitFor(() => document.querySelector('[data-testid=changes-outline-file][data-value="src/components/RightPanel.svelte"]') !== null);
  query<HTMLButtonElement>('[data-testid=changes-outline-file][data-value="src/components/RightPanel.svelte"]').click();
  await waitFor(() => store.panel.active?.path === 'src/components/RightPanel.svelte');
  await waitFor(() => document.querySelector('[data-testid=diff-view]') !== null);

  // A second surface joins the strip rather than replacing the first.
  store.panel.openTasks();
  await waitFor(() => document.querySelector('[data-testid=tasks-panel]') !== null);
  expect(document.querySelectorAll('[data-testid=panel-tab]').length).toBe(2);

  // A finger held on a tab opens the menu a right click opens, so a phone can close the others.
  const first = query('[data-testid=panel-tab][data-kind=changes]');
  first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 }));
  await waitFor(() => document.querySelector('[data-testid=context-menu] [data-value=others]') !== null);
  first.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 1, pointerType: 'touch' }));
  query<HTMLButtonElement>('[data-testid=context-menu] [data-value=others]').click();
  await waitFor(() => document.querySelectorAll('[data-testid=panel-tab]').length === 1);
  expect(store.panel.active?.kind).toBe('changes');

  query<HTMLButtonElement>('[data-testid=panel-close]').click();
  await waitFor(() => !store.panelOpen);
  // The panel plays its exit before it unmounts, so the button is what answers here.
  expect(query('[data-testid=panel-toggle]').getAttribute('aria-pressed')).toBe('false');
});

test('the tasks surface lists the project todos and adds, claims and drops one', async ({ app: _app }) => {
  await waitFor(() => document.querySelector('[data-thread-id="t-trace"]') !== null);
  query<HTMLButtonElement>('[data-thread-id="t-trace"]').click();
  await waitFor(() => store.openThread?.id === 't-trace');

  store.panel.closeAll();
  store.panel.openTasks();
  await waitFor(() => document.querySelectorAll('[data-testid=todo-row]').length === 3);
  // The card the agent finished waits on the user, ahead of the one already done.
  expect(
    Array.from(document.querySelectorAll('[data-testid=todo-row]')).map((row) => row.getAttribute('data-status'))
  ).toEqual(['claimed', 'open', 'done']);
  expect(query('[data-testid=todo-awaiting]').textContent).toContain('Awaiting you');

  const field = query<HTMLInputElement>('[data-testid=todo-input]');
  await type(field, 'Capture the phone layout');
  query<HTMLButtonElement>('[data-testid=todo-add]').click();
  await waitFor(() => document.querySelectorAll('[data-testid=todo-row]').length === 4);
  expect(document.body.textContent).toContain('Capture the phone layout');
  // The whole list travels on `todos.updated`, keyed by the project.
  expect(store.todos['p-boite']?.length).toBe(4);

  const added = Array.from(document.querySelectorAll('[data-testid=todo-row]')).find((row) =>
    row.textContent?.includes('Capture the phone layout')
  ) as HTMLElement;
  expect(added.getAttribute('data-status')).toBe('open');
  added.querySelector<HTMLButtonElement>('[data-testid=todo-claim]')!.click();
  await waitFor(() => store.todos['p-boite']?.some((todo) => todo.text === 'Capture the phone layout' && todo.status === 'claimed') === true);

  added.querySelector<HTMLButtonElement>('[data-testid=todo-remove]')!.click();
  await waitFor(() => document.querySelectorAll('[data-testid=todo-row]').length === 3);
  expect(document.body.textContent).not.toContain('Capture the phone layout');
});

test('the panel query switch opens that surface on the thread the page lands on', async () => {
  // `&panel=<kind>` is the capture path: the surface is there with no clicks.
  await mountOnFake('/?fake=1&panel=tasks');
  await waitFor(() => document.querySelector('[data-testid=tasks-panel]') !== null);
  expect(store.panel.active?.kind).toBe('tasks');
  store.panel.closeAll();
});

test('the panel query switch also names a directory to open the tree on and a file to read', async () => {
  await mountOnFake('/?fake=1&panel=file:docs/guide/editor.md');
  await waitFor(() => document.querySelector('[data-testid=file-panel]') !== null);
  expect(store.panel.active?.path).toBe('docs/guide/editor.md');
  await waitFor(() => query<HTMLTextAreaElement>('[data-testid=file-text]').value.includes('# The editor'));
  store.panel.closeAll();
});

test('what the agent asks for through panel.open opens on the thread it named', async ({ app: _app }) => {
  await waitFor(() => document.querySelector('[data-thread-id="t-trace"]') !== null);
  query<HTMLButtonElement>('[data-thread-id="t-trace"]').click();
  await waitFor(() => store.openThread?.id === 't-trace');
  store.panel.closeAll();
  expect(store.panelOpen).toBe(false);

  const shown = await store.client!.call('panel.open', {
    threadId: 't-trace',
    surface: { kind: 'diff', path: 'docs/panel.md' }
  });
  expect(shown).toEqual({ shown: true });
  await waitFor(() => document.querySelector('[data-testid=changes-panel]') !== null);
  expect(store.panel.active?.path).toBe('docs/panel.md');

  // A file lands on its own tab, named after the file and holding the line.
  await store.client!.call('panel.open', {
    threadId: 't-trace',
    surface: { kind: 'file', path: 'src/lib/store.svelte.ts', line: 42 }
  });
  await waitFor(() => document.querySelector('[data-testid=file-panel]') !== null);
  expect(store.panel.active?.line).toBe(42);
  // Showing, its name is on the header's door, the switcher, which carries the path.
  expect(query('[data-testid=panel-add]').getAttribute('title')).toContain('src/lib/store.svelte.ts');
  expect(query('[data-testid=panel-door-name]').textContent).toBe('store.svelte.ts');
  expect(query('[data-testid=panel-tab][data-kind=file]').getAttribute('title')).toBe('src/lib/store.svelte.ts');
});
