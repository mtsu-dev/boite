import { expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { store } from '../lib/store.svelte';
import { mountOnFake, query, test, waitFor } from '../test/app';
import { openUrl } from '../test/opener';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

/** The worktree switch is an item of the composer's "+": open it, then find the switch. Undefined while the
 * sheet has not opened (its open is async), null once it is open without the switch: a missing "+" throws. */
function worktreeSwitch(): HTMLButtonElement | null | undefined {
  if (!document.querySelector('[data-testid=composer-options-sheet]')) {
    query<HTMLElement>('[data-testid=composer-options]').click();
    flushSync();
  }
  if (!document.querySelector('[data-testid=composer-options-sheet]')) return undefined;
  return document.querySelector<HTMLButtonElement>('[data-testid=composer-worktree]');
}

test('the draft worktree chip puts the first send on its own branch, and the header names it', async ({ app: _app }) => {

  // A thread keeps its directory: no chip while one is open.
  expect(worktreeSwitch()).toBeNull();

  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);
  const chip = worktreeSwitch()!;
  expect(chip.getAttribute('aria-checked')).toBe('false');
  chip.click();
  await waitFor(() => store.draft?.worktree === true);
  expect(worktreeSwitch()!.getAttribute('aria-checked')).toBe('true');

  // A worktree belongs to the project even before a provider is configured.
  const providers = store.providers;
  const draftChoice = store.draftChoice;
  try {
    store.providers = [];
    store.draftChoice = null;
    flushSync();
    expect(store.defaultChoice()).toBeNull();
    // The chip says it; the heading no longer repeats the chips' facts.
    expect(worktreeSwitch()!.getAttribute('aria-checked')).toBe('true');
    expect(query('[data-testid=draft-sentence]').textContent).not.toContain('in a worktree');
  } finally {
    store.providers = providers;
    store.draftChoice = draftChoice;
    flushSync();
  }

  const input = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  input.value = 'Fix the login';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !query<HTMLButtonElement>('[data-testid=composer-send]').disabled);
  query<HTMLButtonElement>('[data-testid=composer-send]').click();

  await waitFor(() => store.openThread !== null && store.draft === null);
  const branch = store.openThread!.branch!;
  expect(branch).toMatch(/^boite\/wt-[a-z0-9]{8}$/);
  expect(store.openThread?.cwd).toBe(`C:\\src\\notes\\.boite\\worktrees\\${branch.slice(6)}`);
  // The branch is a line of the title menu's named group, under the chip's id.
  const branchItem = async () => {
    const item = '[data-testid=thread-menu-trigger-menu] [data-value=thread-branch]';
    query<HTMLButtonElement>('[data-testid=thread-menu-trigger]').click();
    await waitFor(() => document.querySelector('[data-testid=thread-menu-trigger-menu] [data-value=more]') !== null);
    query<HTMLButtonElement>('[data-testid=thread-menu-trigger-menu] [data-value=more]').click();
    await waitFor(() => document.querySelector(item) !== null);
    // The fake turn may rename the branch while the menu opens, and the row redraws a frame after the store: wait until they agree.
    await waitFor(() => query(item).textContent?.trim() === store.openThread!.branch);
    const read ={ text: query(item).textContent?.trim(), title: query(item).title, branch: store.openThread!.branch! };
    query<HTMLButtonElement>('[data-testid=thread-menu-trigger]').click();
    return read;
  };
  const shown = await branchItem();
  expect([branch, 'boite/fix-the-login']).toContain(shown.branch);
  expect(shown.text).toBe(shown.branch);
  expect(shown.title).toContain(shown.branch.slice(6));
  // The chip went with the draft.
  expect(worktreeSwitch()).toBeNull();
  const cwd = store.openThread!.cwd;
  await waitFor(() => store.openThread?.turns.some(turn => turn.status === 'done') === true);
  await waitFor(() => store.openThread?.branch === 'boite/fix-the-login');
  expect((await branchItem()).text).toBe('boite/fix-the-login');
  expect(store.openThread?.cwd).toBe(cwd);
});

test('a draft offers the worktree switch only on a folder where git was found', async ({ app: _app }) => {
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => !!worktreeSwitch());
  const project = store.projects.find((one) => one.id === store.draft?.projectId);
  if (!project) throw new Error('the draft has no project');
  project.repository = false;
  await waitFor(() => worktreeSwitch() === null);
  // No answer yet, or a core older than the field: no `.git` was found, so no switch either.
  delete project.repository;
  flushSync();
  expect(worktreeSwitch()).toBeNull();
  project.repository = true;
  await waitFor(() => !!worktreeSwitch());
});

test('a machine with no AI shows one action, Connect an AI, and the draft opens on the AI it connected', async () => {
  await mountOnFake('/?fake=1&uninstalled=1');
  if (!store.draft) query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => document.querySelector('[data-testid=first-run-connect]') !== null);
  // One action: the folder, the drafts and the composer come after it.
  for (const id of ['composer', 'draft-project', 'draft-open-folder']) expect(document.querySelector(`[data-testid=${id}]`)).toBeNull();

  query<HTMLButtonElement>('[data-testid=first-run-connect]').click();
  await waitFor(() => document.querySelector('[data-testid=connect-dialog]') !== null);
  // The two services most people already pay for come first, each saying which plan it uses.
  const services = Array.from(document.querySelectorAll('[data-testid=connect-service]')).map((row) => row.getAttribute('data-provider'));
  expect(services.slice(0, 2)).toEqual(['claude', 'codex']);
  expect(query('[data-testid=connect-dialog]').textContent).toContain('Uses a Claude Pro or Max plan');

  query<HTMLButtonElement>('[data-testid=connect-service][data-provider=claude]').click();
  await waitFor(() => document.querySelector('[data-testid=connect-install]') !== null);
  query<HTMLButtonElement>('[data-testid=connect-install]').click();
  // The download chains into the sign-in, which hands over a page to open and a field for its code.
  await waitFor(() => document.querySelector('[data-testid=connect-login-url]') !== null, 20_000);
  // The dialog renders beside the app root; its link still reaches the shell's system browser.
  const link = query<HTMLAnchorElement>('[data-testid=connect-login-url]');
  window.__TAURI_INTERNALS__ = { invoke: vi.fn() } as unknown as typeof window.__TAURI_INTERNALS__;
  try {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(link.getAttribute('href')));
  } finally { delete window.__TAURI_INTERNALS__; }
  const code = query<HTMLInputElement>('[data-testid=connect-login-input]');
  code.value = 'fake-code';
  code.dispatchEvent(new Event('input', { bubbles: true }));
  code.closest('form')!.requestSubmit();
  await waitFor(() => document.querySelector('[data-testid=connect-use]') !== null, 20_000);
  await store.reloadProviders();
  expect(store.accountsOf('claude')).toEqual([
    expect.objectContaining({ label: 'Claude', status: 'ok', isolationDir: expect.any(String) })
  ]);
  query<HTMLButtonElement>('[data-testid=connect-use]').click();

  await waitFor(() => document.querySelector('[data-testid=connect-dialog]') === null);
  await waitFor(() => document.querySelector('[data-testid=first-run]') === null && document.querySelector('[data-testid=composer-input]') !== null);
  expect(document.querySelector('[data-testid=composer-connect]')).toBeNull();
  expect(query('[data-testid=composer-picker]').textContent).not.toContain('No AI connected');
  expect(document.querySelector('[data-testid=draft-project]')).not.toBeNull();
});

test('a first launch draws no list column on a desktop: no fold toggle, the card on the rail, and the list back with the first project', async () => {
  await mountOnFake('/?fake=1&uninstalled=1');
  expect(store.projects).toHaveLength(0);
  const body = query('.body');
  // Folded with nothing to unfold: the main card starts one frame gap right of the rail.
  await waitFor(() => body.classList.contains('sidebar-folded'));
  expect(document.querySelector('[data-testid=sidebar-toggle]')).toBeNull();
  expect(query('.app').style.getPropertyValue('--bar-left')).toBe('var(--frame-gap)');
  expect(store.sidebarCollapsed).toBe(false);

  await store.addProject('C:/Dev/First', { navigate: false });
  await waitFor(() => !body.classList.contains('sidebar-folded'));
  expect(document.querySelector('[data-testid=sidebar-toggle]')).not.toBeNull();
  expect(query('.app').style.getPropertyValue('--bar-left')).not.toBe('var(--frame-gap)');
});

test('the keyboard stays in the connect dialog while its steps replace the button it pressed', async () => {
  await mountOnFake('/?fake=1&uninstalled=1');
  if (!store.draft) query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => document.querySelector('[data-testid=first-run-connect]') !== null);
  query<HTMLButtonElement>('[data-testid=first-run-connect]').click();
  await waitFor(() => document.querySelector('[data-testid=connect-service]') !== null);
  query<HTMLButtonElement>('[data-testid=connect-service][data-provider=claude]').click();
  await waitFor(() => document.querySelector('[data-testid=connect-install]') !== null);
  const install = query<HTMLButtonElement>('[data-testid=connect-install]');
  install.focus();
  install.click();
  const dialog = () => query('[data-testid=connect-dialog]');
  await waitFor(() => document.querySelector('[data-testid=connect-step]')?.getAttribute('data-step') === 'installing');
  await waitFor(() => dialog().contains(document.activeElement));
  await waitFor(() => document.querySelector('[data-testid=connect-login-url]') !== null, 20_000);
  await waitFor(() => dialog().contains(document.activeElement));
  const code = query<HTMLInputElement>('[data-testid=connect-login-input]');
  code.focus();
  code.value = 'fake-code';
  code.dispatchEvent(new Event('input', { bubbles: true }));
  code.closest('form')!.requestSubmit();
  await waitFor(() => document.querySelector('[data-testid=connect-use]') !== null, 20_000);
  await waitFor(() => document.activeElement === document.querySelector('[data-testid=connect-use]'));
  query<HTMLButtonElement>('[data-testid=connect-use]').click();
  await waitFor(() => document.querySelector('[data-testid=connect-dialog]') === null);
}, 30_000);

test('the sidebar draft row hands the keyboard back to the composer', async ({ app: _app }) => {

  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);
  // The row appears with the first typed text.
  store.editComposerText('draft', 'Half a thought');
  await waitFor(() => document.querySelector('[data-testid=draft-row]') !== null);

  // Something else in the page holds the keyboard, the way it does after a click.
  const gear = query<HTMLButtonElement>('[data-testid=nav-settings]');
  gear.focus();
  expect(document.activeElement).toBe(gear);

  query<HTMLButtonElement>('[data-testid=draft-row]').click();
  await waitFor(
    () => document.activeElement === document.querySelector('[data-testid=composer-input]')
  );
  expect(store.draft).not.toBeNull();

  // The store is the singleton every test shares: the draft goes back out.
  store.editComposerText('draft', '');
  store.draft = null;
});

test('a draft names its project in the heading and the dropdown moves it to another one', async ({ app: _app }) => {

  // The one plus left says where it will open the draft, and a project row has none.
  expect(query<HTMLButtonElement>('[data-testid=new-thread]').title).toBe('New thread in notes (Ctrl+N)');
  expect(document.querySelector('[data-testid=project-new-thread]')).toBeNull();

  // The draft opens in the project of the thread that was open, `notes`.
  query<HTMLButtonElement>('[data-testid=new-thread]').click();
  await waitFor(() => store.draft !== null);

  const heading = query('[data-testid=draft-sentence]');
  // The mode, the model and the effort are the chips' to say, once.
  expect(heading.textContent).not.toContain('with approval requests');
  expect(heading.querySelector('h1')?.textContent).toContain('notes');
  // Where it runs, in full over the composer: the folder's whole path and the machine, which is plain words, not a picker.
  const notesPath = store.projects.find((project) => project.id === 'p-notes')!.path;
  expect(query('[data-testid=draft-hint]').textContent).toContain(notesPath);
  const machine = document.querySelector('[data-testid=draft-machine]');
  if (machine) expect([machine.querySelector('svg'), machine.closest('button')]).toEqual([null, null]);
  // The heading says the project, so the header chip no longer repeats it.
  expect(query('[data-testid=thread-header]').textContent).not.toContain('notes');

  query<HTMLButtonElement>('[data-testid=draft-project]').click();
  await waitFor(() => document.querySelector('[data-testid=draft-project-menu]') !== null);
  const rows = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-testid=draft-project-menu] [data-row]')
  );
  // The drafts lead, made or not, and opening a folder closes the list.
  const places = rows.filter((row) => row.dataset['value']!.startsWith('['));
  expect(places.map((row) => JSON.parse(row.dataset['value']!)[1])).toEqual([null, 'p-boite', 'p-notes']);
  expect(rows.at(-1)?.dataset['value']).toBe('open-folder');

  // The search narrows the list by name or path, says when nothing matches,
  // and Enter takes the first row left.
  const search = query<HTMLInputElement>('[data-testid=draft-project-search]');
  const typeQuery = (text: string) => { search.value = text; search.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };
  const shownValues = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid=draft-project-list] [data-row]')).map((row) => row.dataset['value']);
  typeQuery('zzz');
  expect(shownValues()).toEqual([]);
  expect(query('[data-testid=draft-project-empty]').textContent).toContain('zzz');
  // Enter on a query nothing answers takes nothing: the folder row is not its fallback.
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
  expect(store.projectPickerOpen).toBe(false);
  expect(document.querySelector('[data-testid=draft-project-menu]')).not.toBeNull();
  typeQuery('BOI');
  expect(shownValues().map((value) => JSON.parse(value!)[1])).toEqual(['p-boite']);

  // Enter that confirms an input method's candidate picks nothing.
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  flushSync();
  expect(document.querySelector('[data-testid=draft-project-menu]')).not.toBeNull();
  expect(store.draft?.projectId).toBe('p-notes');

  store.editComposerText('draft', 'Move me along');
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => store.draft?.projectId === 'p-boite');
  await waitFor(() => document.querySelector('[data-testid=draft-project-menu]') === null);
  await waitFor(() => (query('[data-testid=draft-empty]').textContent ?? '').includes('boite'));
  // The draft row moved with it, and the composer took the keyboard back.
  await waitFor(() => query('[data-testid=project][data-project-id=p-boite]').querySelector('[data-testid=draft-row]') !== null);
  expect(query('[data-testid=project][data-project-id=p-notes]').querySelector('[data-testid=draft-row]')).toBeNull();
  await waitFor(() => document.activeElement === document.querySelector('[data-testid=composer-input]'));

  // The find chord opens the list from the composer, one word per field
  // finds the row, and Escape twice gives the keyboard back to the composer.
  const composer = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => document.activeElement === document.querySelector('[data-testid=draft-project-search]'));
  const again = query<HTMLInputElement>('[data-testid=draft-project-search]');
  // The list is modal: Tab stays in its search instead of reaching the page behind the scrim.
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  again.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(again);
  again.value = 'note src';
  again.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(shownValues().map((value) => JSON.parse(value!)[1])).toEqual(['p-notes']);
  again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
  expect(again.value).toBe('');
  again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => document.querySelector('[data-testid=draft-project-menu]') === null);
  expect(document.activeElement).toBe(composer);

  // Focus back on the trigger, Escape still closes the list.
  const trigger = query<HTMLButtonElement>('[data-testid=draft-project]');
  trigger.click();
  await waitFor(() => document.querySelector('[data-testid=draft-project-menu]') !== null);
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => document.querySelector('[data-testid=draft-project-menu]') === null);

  // The store is the singleton every test shares: the draft goes back out.
  store.editComposerText('draft', '');
  store.draft = null;
});
