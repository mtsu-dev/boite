import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { press, query, test, type, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('the theme setting stamps the light palette and remembers the choice', async ({ app: _app }) => {
  query<HTMLButtonElement>('[data-testid=nav-settings]').click();
  // The theme lives on its own tab now, not on General.
  await waitFor(() => document.querySelector('[data-testid=settings-tab-appearance]') !== null);
  query<HTMLButtonElement>('[data-testid=settings-tab-appearance]').click();
  await waitFor(() => document.querySelector('[data-testid=theme-light]') !== null);
  expect(query('[data-testid=theme-system]').getAttribute('aria-pressed')).toBe('true');

  query<HTMLButtonElement>('[data-testid=theme-light]').click();
  await waitFor(() => document.documentElement.dataset.theme === 'light');
  expect(window.localStorage.getItem('boite.theme')).toBe('light');
  expect(query('[data-testid=theme-light]').getAttribute('aria-pressed')).toBe('true');

  query<HTMLButtonElement>('[data-testid=theme-dark]').click();
  await waitFor(() => document.documentElement.dataset.theme === undefined);
  expect(window.localStorage.getItem('boite.theme')).toBe('dark');
  expect(query('[data-testid=theme-dark]').getAttribute('aria-pressed')).toBe('true');

  // The store is one module-level singleton: leave the next test on the chat,
  // through the settings column's title, which leads back to the threads as the bots column's does.
  expect(query('[data-testid=settings-back]').textContent?.trim()).toBe('Settings');
  query<HTMLButtonElement>('[data-testid=settings-back]').click();
  await waitFor(() => document.querySelector('[data-testid=settings]') === null);
  expect(store.page).toBe('chat');
});

test('the keybindings file moves a chord, takes one away, and the Keyboard page says so', async ({ app: _app }) => {
  await waitFor(() => store.keybindings !== null);

  // The fake's file binds the light theme to Ctrl+Shift+L and unbinds the panel.
  const light = new KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  expect(document.body.dispatchEvent(light)).toBe(false);
  await waitFor(() => document.documentElement.dataset.theme === 'light');

  await waitFor(() => store.openThread !== null);
  const panel = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
  expect(document.body.dispatchEvent(panel)).toBe(true);
  expect(store.panelOpen).toBe(false);

  // A default still stands, and the rail's name card, the button's description and the palette hint read the table too.
  const gear = query<HTMLButtonElement>('[data-testid=nav-settings]');
  expect(gear.getAttribute('aria-label')).toBe('Settings');
  expect(gear.title).toBe('');
  const card = gear.parentElement!.querySelector('.rail-name')!;
  expect(card.textContent).toBe('SettingsCtrl+,');
  expect(document.getElementById(gear.getAttribute('aria-describedby')!)?.textContent).toBe('Ctrl+,');
  const settings = new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true, cancelable: true });
  expect(document.body.dispatchEvent(settings)).toBe(false);
  await waitFor(() => document.querySelector('[data-testid=settings-tab-general]') !== null);

  // Keyboard is a page of General: the nav names the group, the card's tabs its pages.
  query<HTMLButtonElement>('[data-testid=settings-tab-general]').click();
  await waitFor(() => document.querySelector('[data-testid=settings-tab-keyboard]') !== null);
  query<HTMLButtonElement>('[data-testid=settings-tab-keyboard]').click();
  await waitFor(() => document.querySelector('[data-testid=keyboard-page]') !== null);
  const keyOf = (id: string) =>
    query(`[data-testid=keybinding-row][data-command=${id}] [data-testid=keybinding-key]`).textContent?.trim();
  expect(keyOf('theme-light')).toBe('Ctrl+Shift+L');
  expect(keyOf('panel')).toBe('Not set');
  expect(keyOf('new-thread')).toBe('Ctrl+N');
  expect(query('[data-testid=keybinding-row][data-command=theme-light]').classList.contains('custom')).toBe(true);
  expect(query('[data-testid=keybinding-row][data-command=new-thread]').classList.contains('custom')).toBe(false);
  expect(query('[data-testid=keybindings-path]').textContent).toBe('C:\\Users\\you\\AppData\\Local\\boite2\\keybindings.json');
  expect(query('[data-testid=keybinding-error]').textContent).toContain('"trace": "t" has no modifier');

  query<HTMLButtonElement>('[data-testid=view-threads]').click();
  await waitFor(() => document.querySelector('[data-testid=settings]') === null);
});

test('a shortcut is recorded from the keys pressed, a taken one asks first, and reset puts the defaults back', async ({ app: _app }) => {
  store.showSettings('keyboard');
  await waitFor(() => document.querySelector('[data-testid=keyboard-page]') !== null);
  const row = (id: string) => `[data-testid=keybinding-row][data-command=${id}]`;
  const keyOf = (id: string) => query(`${row(id)} [data-testid=keybinding-key]`).textContent?.replace(/\s+/g, '');
  const press = (init: KeyboardEventInit) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  query<HTMLButtonElement>(`${row('pin')} [data-testid=keybinding-edit]`).click();
  await waitFor(() => document.querySelector(`${row('pin')} [data-testid=keybinding-capture]`) !== null);
  // Modifiers alone wait; a bare letter is typing and is refused on the row.
  press({ key: 'Control', ctrlKey: true });
  await waitFor(() => document.querySelector(`${row('pin')} [data-testid=keybinding-capture]`)?.textContent?.includes('Ctrl') === true);
  press({ key: 'p' });
  await waitFor(() => document.querySelector(`${row('pin')} [role=alert]`) !== null);
  press({ key: 'p', ctrlKey: true, altKey: true });
  await waitFor(() => store.bindings.pin.text === 'mod+alt+p');
  await waitFor(() => keyOf('pin') === 'Ctrl+Alt+P');
  expect(query(row('pin')).classList.contains('custom')).toBe(true);
  // The recorded chord ran nothing on its way in.
  expect(store.page).toBe('settings');

  query<HTMLButtonElement>(`${row('pin')} [data-testid=keybinding-edit]`).click();
  await waitFor(() => document.querySelector(`${row('pin')} [data-testid=keybinding-capture]`) !== null);
  press({ key: 'k', ctrlKey: true });
  await waitFor(() => document.querySelector(`${row('pin')} [data-testid=keybinding-conflict]`) !== null);
  expect(store.bindings.palette.text).toBe('mod+k');
  query<HTMLButtonElement>('[data-testid=keybinding-replace]').click();
  await waitFor(() => store.bindings.pin.text === 'mod+k' && store.bindings.palette.text === null);

  query<HTMLButtonElement>(`${row('pin')} [data-testid=keybinding-reset]`).click();
  await waitFor(() => store.bindings.pin.text === null && !store.bindings.pin.custom);
  query<HTMLButtonElement>('[data-testid=keybindings-reset-all]').click();
  await waitFor(() => store.bindings.palette.text === 'mod+k' && store.bindings['theme-light'].text === null);
  expect(document.querySelector('[data-testid=keybindings-reset-all]')).toBeNull();

  // Moving to the filter ends the recording, so its keys type instead of binding.
  query<HTMLButtonElement>(`${row('pin')} [data-testid=keybinding-edit]`).click();
  await waitFor(() => document.querySelector(`${row('pin')} [data-testid=keybinding-capture]`) !== null);
  query('[data-testid=keybindings-filter]').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await waitFor(() => document.querySelector(`${row('pin')} [data-testid=keybinding-capture]`) === null);
  expect(press({ key: 'p', ctrlKey: true, altKey: true })).toBe(true);
  expect(store.bindings.pin.text).toBe(null);
});

test('the checklist model sits with how agents answer on General, with no experiment on', async ({ app: _app }) => {
  expect(window.localStorage.getItem('boite.experiments')).toBeNull();
  query<HTMLButtonElement>('[data-testid=nav-settings]').click();
  await waitFor(() => document.querySelector('[data-testid=settings-tab-general]') !== null);
  query<HTMLButtonElement>('[data-testid=settings-tab-general]').click();
  await waitFor(() => document.querySelector('[data-testid=goal-tracker]') !== null);
  const tracker = query('[data-testid=goal-tracker]');
  expect(tracker.closest('#settings-agent-replies')?.querySelector('[data-testid=setting-title-model]')).not.toBeNull();
  // Each card says where it applies at its head: this device's switches apart from the machine's.
  expect(query('#settings-conversations > h2 [data-testid=card-scope]').dataset.kind).toBe('device');
  expect(query('#settings-agent-replies > h2 [data-testid=card-scope]').dataset.kind).toBe('machine');
  expect(document.querySelector('#settings-conversations [data-testid=setting-async-questions]')).toBeNull();
  expect(query('[data-testid=goal-tracker-model]').textContent).toContain('Automatic');
  query<HTMLButtonElement>('[data-testid=view-threads]').click();
  await waitFor(() => document.querySelector('[data-testid=settings]') === null);
});

test('a desktop has two levels: the gear opens the nav, its search and the first page, a typed word lists its results in the page and Enter opens one', async ({ app: _app }) => {
  query<HTMLButtonElement>('[data-testid=nav-settings]').click();
  await waitFor(() => document.querySelector('[data-testid=settings-search]') !== null);
  // No grid of tiles between the nav and a page: Home shows General beside the nav, the search heads the nav.
  expect(query('[data-testid=settings-home]').closest('nav')).not.toBeNull();
  expect(document.querySelector('[data-testid^=settings-home-]')).toBeNull();
  await waitFor(() => document.querySelector('[data-testid=settings-tab-general]')?.getAttribute('aria-current') === 'page');
  expect(query('[data-testid=settings-crumb] h1').textContent?.trim()).toBe('General');
  // The entries stand under four family heads, Advanced named like the others.
  expect([...document.querySelectorAll<HTMLElement>('nav [data-testid=settings-family]')].map((family) => [family.dataset.family, family.querySelector('.family-head')?.textContent ?? null])).toEqual([
    ['app', 'App'], ['agents', 'Agents'], ['connections', 'Connections'], ['advanced', 'Advanced']
  ]);
  expect(query('[data-family=connections] [data-testid=settings-tab-browser]')).toBeTruthy();
  // Every page is a peer in its family, none indented under another: Keyboard is one click from anywhere.
  expect(query('[data-family=app] [data-testid=settings-tab-keyboard]')).toBeTruthy();
  expect(document.querySelector('nav [data-testid^=settings-tab-].sub')).toBeNull();
  expect(document.querySelector('[data-testid=settings-pages]')).toBeNull();

  const field = query<HTMLInputElement>('[data-testid=settings-search]');
  // A word that is also its section's name lists once: "updates" broke the list with two results of one key.
  field.value = 'updates';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => document.querySelector('[data-testid=settings-search-results]') !== null);
  const updates = [...document.querySelectorAll('[data-testid=settings-search-result] .label')].map((label) => label.textContent).filter((label) => label === 'Updates');
  expect(updates).toHaveLength(1);
  // A family's name finds its entries: "connections" lists the browser's page.
  field.value = 'connections';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => [...document.querySelectorAll('[data-testid=settings-search-result]')].some((result) => result.textContent?.includes('Browser profiles')));
  field.value = 'font';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => document.querySelector('[data-testid=settings-search-results]') !== null);
  expect(document.querySelector('[data-testid=settings-crumb]')).toBeNull();
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => store.settingsTab === 'appearance');
  await waitFor(() => document.querySelector('[data-testid=settings-search-results]') === null);
  expect(field.value).toBe('');
  expect(query('[data-testid=settings-tab-appearance]').getAttribute('aria-current')).toBe('page');

  query<HTMLButtonElement>('[data-testid=settings-back]').click();
  await waitFor(() => document.querySelector('[data-testid=settings]') === null);
});

test('Voice is a peer of General in the App family on a desktop: its nav entry opens its own page and lights', async ({ app: _app }) => {
  query<HTMLButtonElement>('[data-testid=nav-settings]').click();
  await waitFor(() => document.querySelector('[data-testid=settings-tab-voice]') !== null);
  expect(query('[data-family=app] [data-testid=settings-tab-voice]')).toBeTruthy();
  query<HTMLButtonElement>('[data-testid=settings-tab-voice]').click();
  await waitFor(() => document.querySelector('[data-testid=voice-settings]') !== null);
  // Its own page: the crumb names it, General's cards stay on General.
  expect(query('[data-testid=settings-crumb] h1').textContent?.trim()).toBe('Voice');
  expect(document.querySelector('#settings-conversations')).toBeNull();
  expect(query('[data-testid=settings-tab-voice]').getAttribute('aria-current')).toBe('page');
  expect(query('[data-testid=settings-tab-general]').getAttribute('aria-current')).toBeNull();
  query<HTMLButtonElement>('[data-testid=settings-back]').click();
  await waitFor(() => document.querySelector('[data-testid=settings]') === null);
});
