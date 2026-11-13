import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PluginState } from '@boite/contracts';
import PluginsPage from './PluginsPage.svelte';
import type { Store } from '../lib/store.svelte';
import { FakeClient } from '../lib/fake-client';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient | undefined;
let store: Store | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  client?.close();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const row = (id: string) => q(`[data-testid="plugin-row"][data-plugin="${id}"]`);
const shownIds = () => [...document.querySelectorAll('[data-testid="plugins-grid"] [data-testid="plugin-row"]')].map((el) => el.getAttribute('data-plugin'));
/** The gear dialog, once open for that plugin. */
const dialog = (id: string) => q(`[data-testid="plugin-dialog"][data-plugin="${id}"]`);

async function open(edit?: (rows: PluginState[]) => void, core?: { features: { pluginGrants: true } }): Promise<void> {
  client = new FakeClient({ delayMs: 0 });
  await client.connect();
  if (edit) {
    const call = client.call.bind(client);
    vi.spyOn(client, 'call').mockImplementation((async (method: string, params: unknown) => {
      const result = await call(method as never, params as never);
      if (method === 'plugins.list') edit(result as PluginState[]);
      return result;
    }) as never);
  }
  store = { client, providers: [], core } as unknown as Store;
  mounted = mount(PluginsPage, { target: document.body, props: { store } });
  await vi.waitFor(() => expect(row('bots')).not.toBeNull());
}

/** Opens a card's gear and answers its dialog. */
async function gear(id: string): Promise<HTMLElement> {
  row(id)!.querySelector<HTMLElement>('[data-testid="plugin-open"]')!.click();
  flushSync();
  await vi.waitFor(() => expect(dialog(id)).not.toBeNull());
  return dialog(id)!;
}

/** The URL form sits behind its button. */
function openAdd(): void {
  q('[data-testid="plugins-from-url"]')!.click();
  flushSync();
}

function type(selector: string, value: string): void {
  const input = q(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

test('an update that lands while the list is out is not undone by the older list', async () => {
  client = new FakeClient({ delayMs: 0 });
  await client.connect();
  const call = client.call.bind(client), on = client.on.bind(client);
  const rows = await call('plugins.list', {});
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let update!: (value: PluginState) => void;
  vi.spyOn(client, 'call').mockImplementation((async (method: string, params: unknown) => {
    if (method === 'plugins.list') { await held; return rows; }
    return call(method as never, params as never);
  }) as never);
  vi.spyOn(client, 'on').mockImplementation(((event: string, handler: (value: PluginState) => void) => {
    if (event === 'plugins.updated') update = handler;
    return on(event as never, handler as never);
  }) as never);
  mounted = mount(PluginsPage, { target: document.body, props: { store: { client, providers: [] } as unknown as Store } });
  await vi.waitFor(() => expect(update).toBeDefined());
  update({ ...rows.find(plugin => plugin.id === 'bots')!, availableVersion: '99.0.0', version: '99.0.0' });
  release();
  await vi.waitFor(() => expect(row('bots')).not.toBeNull());
  expect(row('bots')!.textContent).toContain('99.0.0');
});

test('one grid holds every plugin as a card: name, author, chips, switch and gear', async () => {
  await open();
  // What has files first, by the core's order, then nothing left to install: every recommended one is in.
  expect(shownIds()).toEqual(['bots', 'douane', 'grok-seats', 'pool-legacy', 'quiet-hours', 'seat-pool', 'standup']);
  const bots = row('bots')!;
  expect(bots.querySelector('[data-testid="plugin-author"]')?.textContent).toBe('by Skollheim');
  expect(bots.querySelector('[data-testid="plugin-home"]')?.getAttribute('href')).toBe('https://github.com/Skollheim/bots');
  expect(bots.querySelector<HTMLInputElement>('[data-testid="plugin-enabled"]')?.checked).toBe(true);
  expect(bots.textContent).toContain('Desktop app');
  // A URL plugin's source is its author; the dev one wears its tag, and as chips what the owner granted of what it asks for: the board's writes were left out.
  expect(row('seat-pool')?.querySelector('[data-testid="plugin-author"]')?.textContent).toBe('by example');
  expect(row('standup')?.querySelector('[data-testid="plugin-dev"]')?.textContent).toBe('Dev');
  expect([...row('standup')!.querySelectorAll('[data-testid="plugin-permission"]')].map((el) => el.getAttribute('title'))).toEqual(['threads.read', 'todos.read']);
  // Mid-download: its progress and Cancel, no switch yet, no gear.
  expect(row('grok-seats')?.querySelector('[data-testid="plugin-progress"]')?.getAttribute('aria-valuenow')).toBe('45');
  expect(row('grok-seats')?.querySelector('[data-testid="plugin-cancel"]')).not.toBeNull();
  expect(row('grok-seats')?.querySelector('[data-testid="plugin-enabled"]')).toBeNull();
  // Refused: one line on the card, no switch, the file and field behind the gear.
  const refused = row('pool-legacy')!;
  expect(refused.querySelector('[data-testid="plugin-state"]')?.getAttribute('data-field')).toBe('manifest.schema');
  expect(refused.querySelector('[data-testid="plugin-enabled"]')).toBeNull();
  expect(refused.querySelector('[data-testid="plugin-retry"]')).toBeNull();
  // Turned off: the card says so and its switch is off.
  expect(row('quiet-hours')?.getAttribute('data-enabled')).toBe('false');
  expect(row('quiet-hours')?.querySelector('[data-testid="plugin-state"]')?.textContent).toContain('Off');
});

test('search narrows by name, id, description or author, and the filter keeps what is on or off', async () => {
  // A refused install shows under All only, even turned off before it was refused.
  await open((rows) => { rows.find((plugin) => plugin.id === 'pool-legacy')!.enabled = false; });
  type('[data-testid="plugins-search"]', 'pool');
  expect(shownIds()).toEqual(['pool-legacy', 'seat-pool']);
  type('[data-testid="plugins-search"]', 'skollheim');
  expect(shownIds()).toEqual(['bots']);
  type('[data-testid="plugins-search"]', 'nothing like it');
  expect(shownIds()).toEqual([]);
  expect(q('[data-testid="plugins-empty"]')?.textContent).toBe('No plugin matches.');
  type('[data-testid="plugins-search"]', '');

  q('[data-testid="plugins-filter-disabled"]')!.click();
  flushSync();
  expect(shownIds()).toEqual(['quiet-hours']);
  expect(q('[data-testid="plugins-filter-disabled"]')?.getAttribute('aria-pressed')).toBe('true');
  q('[data-testid="plugins-filter-enabled"]')!.click();
  flushSync();
  // A refused install is neither on nor off: All shows it.
  expect(shownIds()).toEqual(['bots', 'douane', 'grok-seats', 'seat-pool', 'standup']);
});

test('the switch turns a plugin off, stopping what it runs, and on again, its card following', async () => {
  await open();
  const calls = vi.spyOn(client!, 'call');
  const toggle = () => row('bots')!.querySelector<HTMLInputElement>('[data-testid="plugin-enabled"]')!;
  toggle().click();
  await vi.waitFor(() => expect(row('bots')?.getAttribute('data-enabled')).toBe('false'));
  expect(calls).toHaveBeenCalledWith('plugins.setEnabled', { id: 'bots', enabled: false });
  expect(toggle().checked).toBe(false);
  expect(row('bots')?.querySelector('[data-testid="plugin-state"]')?.textContent).toContain('Off');
  // Off, the gear says why nothing runs and has no app strip to start.
  const box = await gear('bots');
  expect(box.querySelector('[data-testid="plugin-off-hint"]')?.textContent).toContain('nothing of it runs');
  expect(box.querySelector('[data-testid="plugin-app"]')).toBeNull();
  q('[data-testid="plugin-dialog-close"]')!.click();
  flushSync();

  toggle().click();
  await vi.waitFor(() => expect(row('bots')?.getAttribute('data-enabled')).toBe('true'));
  expect(calls).toHaveBeenCalledWith('plugins.setEnabled', { id: 'bots', enabled: true });
  expect(row('bots')?.querySelector('[data-testid="plugin-state"]')).toBeNull();
  expect((await gear('bots')).querySelector('[data-testid="plugin-app"]')?.getAttribute('data-app-status')).toBe('running');
});

test('a refused switch keeps the card as it was and says why on it', async () => {
  await open();
  const call = client!.call.bind(client);
  vi.spyOn(client!, 'call').mockImplementation((async (method: string, params: unknown) => {
    if (method === 'plugins.setEnabled') throw new Error('Boite is shutting down.');
    return call(method as never, params as never);
  }) as never);
  row('seat-pool')!.querySelector<HTMLInputElement>('[data-testid="plugin-enabled"]')!.click();
  await vi.waitFor(() => expect(row('seat-pool')?.querySelector('[data-testid="plugin-error"]')?.textContent).toContain('shutting down'));
  expect(row('seat-pool')?.querySelector<HTMLInputElement>('[data-testid="plugin-enabled"]')?.checked).toBe(true);
});

test('the gear draws each declared setting and saves a change as soon as it is made', async () => {
  await open();
  const calls = vi.spyOn(client!, 'call');
  const box = await gear('standup');
  const setting = (key: string) => box.querySelector<HTMLElement>(`[data-testid="plugin-setting"][data-key="${key}"]`)!;
  const input = (key: string) => setting(key).querySelector<HTMLInputElement>('[data-testid="plugin-setting-input"]')!;
  expect([...box.querySelectorAll('[data-testid="plugin-setting"]')].map((el) => el.getAttribute('data-type'))).toEqual(['switch', 'slider', 'select', 'number', 'text']);
  expect(setting('includeTodos').textContent).toContain('Lists the todos closed today');
  expect(input('includeTodos').checked).toBe(true);
  expect(setting('lookback').querySelector('[data-testid="plugin-setting-readout"]')?.textContent).toBe('24');
  // The stored choice, not the default.
  expect(setting('tone').querySelector('[data-testid="plugin-setting-menu"]')?.textContent).toContain('Short');

  input('includeTodos').click();
  await vi.waitFor(() => expect(calls).toHaveBeenCalledWith('plugins.settings.set', { id: 'standup', values: { includeTodos: false } }));
  await vi.waitFor(() => expect(input('includeTodos').checked).toBe(false));

  // A choice from the menu, never a native select.
  expect(box.querySelector('select')).toBeNull();
  setting('tone').querySelector<HTMLElement>('[data-testid="plugin-setting-menu"]')!.click();
  flushSync();
  const detailed = [...document.querySelectorAll<HTMLElement>('[data-testid="plugin-setting-menu-menu"] [role^="menuitem"]')].find((el) => el.textContent?.includes('Detailed'))!;
  detailed.click();
  await vi.waitFor(() => expect(calls).toHaveBeenCalledWith('plugins.settings.set', { id: 'standup', values: { tone: 'detailed' } }));
  await vi.waitFor(() => expect(setting('tone').querySelector('[data-testid="plugin-setting-menu"]')?.textContent).toContain('Detailed'));

  input('signature').value = '— sent by standup';
  input('signature').dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(calls).toHaveBeenCalledWith('plugins.settings.set', { id: 'standup', values: { signature: '— sent by standup' } }));
  expect((await client!.call('plugins.settings.get', { id: 'standup' }))).toMatchObject({ includeTodos: false, tone: 'detailed', signature: '— sent by standup', maxThreads: 8 });
});

test('a setting changed while the machine is not connected says it was not saved', async () => {
  await open();
  const box = await gear('standup');
  const setting = box.querySelector<HTMLElement>('[data-testid="plugin-setting"][data-key="includeTodos"]')!;
  (store as { client: unknown }).client = null;
  setting.querySelector<HTMLInputElement>('[data-testid="plugin-setting-input"]')!.click();
  await vi.waitFor(() => expect(setting.textContent).toContain('Not saved: this machine is not connected.'));
  expect(setting.querySelector<HTMLInputElement>('[data-testid="plugin-setting-input"]')!.checked).toBe(true);
});

test('a recommended plugin that runs nothing installs with no download for this machine', async () => {
  await open((rows) => { Object.assign(rows.find((plugin) => plugin.id === 'bots')!, { status: 'not-installed', artifact: null }); });
  await vi.waitFor(() => expect(row('bots')?.querySelector<HTMLButtonElement>('[data-testid="plugin-install"]')).not.toBeNull());
  expect(row('bots')!.querySelector<HTMLButtonElement>('[data-testid="plugin-install"]')!.disabled).toBe(false);
});

test('a value outside the manifest\'s rule is refused on the spot and never sent', async () => {
  await open();
  const calls = vi.spyOn(client!, 'call');
  const box = await gear('standup');
  const setting = box.querySelector<HTMLElement>('[data-testid="plugin-setting"][data-key="maxThreads"]')!;
  const input = setting.querySelector<HTMLInputElement>('[data-testid="plugin-setting-input"]')!;
  input.value = '0';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
  expect(setting.querySelector('[data-testid="plugin-setting-error"]')?.textContent).toBe('Must be a number, at least 1, at most 50.');
  expect(calls.mock.calls.some(([method]) => method === 'plugins.settings.set')).toBe(false);
  input.value = '12';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(calls).toHaveBeenCalledWith('plugins.settings.set', { id: 'standup', values: { maxThreads: 12 } }));
  await vi.waitFor(() => expect(setting.querySelector('[data-testid="plugin-setting-error"]')).toBeNull());
});

test('a core from before the permission domains lists todos as written, on the card and under the gear', async () => {
  await open((rows) => {
    const standup = rows.find((plugin) => plugin.id === 'standup')!;
    delete standup.granted;
    standup.permissions = ['threads.read', 'todos'] as never;
  });
  expect([...row('standup')!.querySelectorAll('[data-testid="plugin-permission"]')].map((el) => el.textContent)).toEqual(['Read your threads', 'todos']);
  const standup = await gear('standup');
  expect([...standup.querySelectorAll('[data-testid="plugin-authorization"]')].map((el) => el.textContent)).toEqual(['Read your threads', 'todos']);
});

test('the gear shows what the plugin\'s token may call, and no settings section when it declares none', async () => {
  await open();
  const standup = await gear('standup');
  const authorizations = standup.querySelector('[data-testid="plugin-authorizations"]')!;
  expect([...authorizations.querySelectorAll('[data-testid="plugin-authorization"]')].map((el) => el.getAttribute('title'))).toEqual(['threads.read', 'todos.read']);
  // An older core keeps no grants: nothing to edit.
  expect(authorizations.querySelector('[data-testid="plugin-grants"]')).toBeNull();
  expect(standup.querySelector('[data-testid="plugin-dev-path"]')?.textContent).toContain('C:\\Users\\you\\plugins\\standup');
  expect([...standup.querySelectorAll('[data-testid="plugin-adds-item"]')].map((el) => el.textContent)).toEqual(['boite standup', '/standup', 'standup-notes', 'Guide lines']);
  q('[data-testid="plugin-dialog-close"]')!.click();
  flushSync();

  // A schema 1 plugin's program gets the owner token: the row says so.
  const seats = await gear('seat-pool');
  expect(seats.querySelector('[data-testid="plugin-settings"]')).toBeNull();
  expect(seats.querySelector('[data-testid="plugin-authorizations"]')?.textContent).toContain('The owner token');
  expect(seats.querySelector('[data-testid="plugin-extras"]')).toBeNull();
  expect(seats.textContent).toContain('github.com/example/seat-pool');
  expect(seats.textContent).toContain('v1.4.0 at 3f9c2a7');
  await vi.waitFor(() => expect(seats.querySelector('[data-testid="plugin-pool"][data-provider="opencode"]')).not.toBeNull());
  // Escape closes it.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  flushSync();
  await vi.waitFor(() => expect(q('[data-testid="plugin-dialog"]')).toBeNull());
});

test('the refused plugin\'s gear names the file, the field and what was expected, and can only uninstall', async () => {
  await open();
  const box = await gear('pool-legacy');
  const refused = box.querySelector('[data-testid="plugin-rejected"]');
  expect(refused?.getAttribute('data-kind')).toBe('manifest.schema');
  expect(refused?.textContent).toContain('installed.json');
  expect(box.querySelector('[data-testid="plugin-uninstall"]')).not.toBeNull();
  expect(box.querySelector('[data-testid="plugin-app"]')).toBeNull();
});

const app = (id: string) => dialog(id)?.querySelector<HTMLElement>('[data-testid="plugin-app"]') ?? null;
const appButton = (id: string, name: 'start' | 'stop' | 'restart') => app(id)?.querySelector<HTMLButtonElement>(`[data-testid="plugin-app-${name}"]`) ?? null;

test('a running desktop app can be stopped, then started again, its state following each step', async () => {
  await open();
  await gear('bots');
  expect(app('bots')?.getAttribute('data-app-status')).toBe('running');
  expect(app('bots')?.textContent).toContain('Desktop app');
  expect(app('bots')?.textContent).toContain('Running');
  expect(appButton('bots', 'start')).toBeNull();
  expect(appButton('bots', 'restart')).not.toBeNull();

  appButton('bots', 'stop')!.click();
  await vi.waitFor(() => expect(app('bots')?.getAttribute('data-app-status')).toBe('stopped'));
  // It still starts with Boite, so the line says no more than stopped.
  expect(app('bots')?.textContent).not.toContain('starts again only when you start it');
  expect(appButton('bots', 'stop')).toBeNull();

  appButton('bots', 'start')!.click();
  await vi.waitFor(() => expect(app('bots')?.getAttribute('data-app-status')).toBe('running'));
  appButton('bots', 'restart')!.click();
  await vi.waitFor(() => expect(appButton('bots', 'restart')?.disabled).toBe(false));
  expect(app('bots')?.getAttribute('data-app-status')).toBe('running');
});

const autostart = (id: string) => dialog(id)?.querySelector<HTMLInputElement>('[data-testid="plugin-autostart"]') ?? null;

test('Start with Boite switches the app and the gateway apart from what runs now, and an older core shows no switch', async () => {
  await open();
  await gear('bots');
  expect(autostart('bots')?.checked).toBe(true);
  expect(autostart('bots')?.closest('label')?.textContent).toContain('Start with Boite');
  autostart('bots')!.click();
  await vi.waitFor(() => expect(autostart('bots')?.checked).toBe(false));
  // The card stays where it was under the pointer.
  expect(shownIds().slice(0, 2)).toEqual(['bots', 'douane']);
  // What runs now is left alone.
  expect(app('bots')?.getAttribute('data-app-status')).toBe('running');
  appButton('bots', 'stop')!.click();
  await vi.waitFor(() => expect(app('bots')?.textContent).toContain('Stopped · starts again only when you start it'));

  // Douane has the same switch on its gateway.
  await gear('douane');
  expect(autostart('douane')?.checked).toBe(true);
  autostart('douane')!.click();
  await vi.waitFor(() => expect(autostart('douane')?.checked).toBe(false));
  expect(dialog('douane')?.querySelector('[data-testid="plugin-gateway"]')?.getAttribute('data-gateway-status')).toBe('running');

  unmount(mounted!); mounted = undefined; client?.close(); document.body.innerHTML = '';
  await open((rows) => { for (const plugin of rows) { if (plugin.app) delete plugin.app.autostart; if (plugin.gateway) delete plugin.gateway.autostart; } });
  await gear('bots');
  expect(autostart('bots')).toBeNull();
  await gear('douane');
  expect(autostart('douane')).toBeNull();
});

test('a crashed desktop app says so on its card, with its exit code and why behind the gear; one with no desktop cannot start', async () => {
  const reason = 'This core has no desktop to show a window on: neither DISPLAY nor WAYLAND_DISPLAY is set.';
  await open((rows) => {
    const bots = rows.find((plugin) => plugin.id === 'bots')!;
    bots.app = { enabled: true, status: 'crashed', pid: null, exitCode: 3, error: 'bots exited with code 3 4 times in 5 minutes; start it again from Settings > Agents > Plugins.', startedAt: null };
    rows.push({ ...structuredClone(bots), id: 'headless', name: 'Headless', app: { enabled: true, status: 'unavailable', pid: null, exitCode: null, error: reason, startedAt: null } });
  });
  await vi.waitFor(() => expect(row('headless')).not.toBeNull());
  expect(row('bots')?.querySelector('[data-testid="plugin-state"]')?.textContent).toContain('Desktop app');
  await gear('bots');
  expect(app('bots')?.textContent).toContain('Crashed with exit code 3');
  expect(app('bots')?.querySelector('[data-testid="plugin-app-error"]')?.textContent).toContain('4 times in 5 minutes');
  expect(appButton('bots', 'start')?.disabled).toBe(false);

  await gear('headless');
  expect(app('headless')?.textContent).toContain('Unavailable');
  expect(app('headless')?.querySelector('[data-testid="plugin-app-error"]')?.textContent).toBe(reason);
  expect(appButton('headless', 'start')?.disabled).toBe(true);
});

test('From a URL opens the form and closes it; a plugin card\'s Preview opens it by itself and reads the repository once', async () => {
  await open();
  expect(q('[data-testid="plugins-add"]')).toBeNull();
  openAdd();
  expect(q('[data-testid="plugins-add"]')?.id).toBe('settings-plugins-add');
  expect(q('[data-testid="plugins-from-url"]')?.getAttribute('aria-expanded')).toBe('true');
  openAdd();
  expect(q('[data-testid="plugins-add"]')).toBeNull();
  unmount(mounted!); mounted = undefined; client?.close(); document.body.innerHTML = '';

  client = new FakeClient({ delayMs: 0 });
  await client.connect();
  const store = { client, providers: [], connection: 'ready', pluginSource: { url: 'https://github.com/example/scoped-standup', ref: 'v1.2.0', request: 1 } } as unknown as Store;
  mounted = mount(PluginsPage, { target: document.body, props: { store } });
  // The settings link scrolls to the form: it is there from the first frame.
  expect(document.getElementById('settings-plugins-add')).not.toBeNull();
  await vi.waitFor(() => expect(q('[data-testid="plugin-preview"]')).not.toBeNull());
  expect(q('[data-testid="plugin-preview"]')!.textContent).toContain('github.com/example/scoped-standup');
  expect(q('[data-testid="plugin-preview"]')!.textContent).toContain('v1.2.0');
  expect(store.pluginSource).toBeNull();
  // Installing stays the owner's click.
  expect(q('[data-testid="plugin-add"]')).not.toBeNull();
  expect(row('scoped-standup')).toBeNull();

  q('[data-testid="plugin-dismiss"]')!.click();
  flushSync();
  type('[data-testid="plugin-url"]', 'example/desktop-pets');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-preview"]')?.textContent).toContain('github.com/example/desktop-pets'));
});

test('a desktop app\'s preview says it opens its own window and holds the owner token', async () => {
  await open();
  openAdd();
  type('[data-testid="plugin-url"]', 'https://github.com/example/desktop-pets');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-preview"]')).not.toBeNull());
  const preview = q('[data-testid="plugin-preview"]')!;
  expect(q('[data-testid="plugin-preview-app"]')?.textContent).toContain('Opens a window of its own and gets full access to Boite through the owner token');
  expect(preview.textContent).toContain('BOITE_TOKEN=<the owner token>');
  expect(preview.textContent).not.toContain('Account pools');

  q('[data-testid="plugin-add"]')!.click();
  await vi.waitFor(() => expect(row('desktop-pets')?.getAttribute('data-status')).toBe('installed'), { timeout: 3000 });
  await gear('desktop-pets');
  await vi.waitFor(() => expect(app('desktop-pets')?.getAttribute('data-app-status')).toBe('running'), { timeout: 3000 });
});

test('a schema 2 preview shows what the plugin adds and what its own token reaches, not the owner token', async () => {
  await open();
  openAdd();
  type('[data-testid="plugin-url"]', 'https://github.com/example/scoped-desktop-waiting');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-preview"]')).not.toBeNull());
  const preview = q('[data-testid="plugin-preview"]')!;
  expect(q('[data-testid="plugin-preview-app"]')?.textContent).toContain('It reaches Boite only through what the plugin may reach');
  expect([...preview.querySelectorAll('[data-testid="plugin-adds-item"]')].map((el) => el.textContent)).toEqual(['/waiting']);
  expect([...preview.querySelectorAll('[data-testid="plugin-permission"]')].map((el) => el.getAttribute('title'))).toEqual(['threads.read', 'ui.reveal']);
  // The list bounds its token, not its program: the preview says so beside it.
  expect(q('[data-testid="plugin-trust"]')?.textContent).toContain('Its permissions limit what it asks Boite, not what it reads or runs there');

  // Installed, its card and gear keep what the preview showed.
  q('[data-testid="plugin-add"]')!.click();
  await vi.waitFor(() => expect(row('scoped-desktop-waiting')?.getAttribute('data-status')).toBe('installed'), { timeout: 3000 });
  expect([...row('scoped-desktop-waiting')!.querySelectorAll('[data-testid="plugin-permission"]')].map((el) => el.getAttribute('title'))).toEqual(['threads.read', 'ui.reveal']);
  const box = await gear('scoped-desktop-waiting');
  expect([...box.querySelectorAll('[data-testid="plugin-adds-item"]')].map((el) => el.textContent)).toEqual(['/waiting']);
  expect([...box.querySelectorAll('[data-testid="plugin-authorization"]')].map((el) => el.getAttribute('title'))).toEqual(['threads.read', 'ui.reveal']);
});

test('a text-only preview says it runs no program and asks about the text instead', async () => {
  await open();
  openAdd();
  type('[data-testid="plugin-url"]', 'example/text-only-review');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-preview"]')).not.toBeNull());
  expect(q('[data-testid="plugin-trust"]')?.textContent).toContain('This plugin runs no program');
});

test('a URL is read first, shown with what it downloads and runs, and installs only on confirm', async () => {
  await open();
  openAdd();
  type('[data-testid="plugin-url"]', 'https://github.com/example/pi-pool');
  type('[data-testid="plugin-ref"]', 'v1.5.0');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-preview"]')).not.toBeNull());
  const preview = q('[data-testid="plugin-preview"]')!;
  expect(preview.getAttribute('data-rejected')).toBe('false');
  expect(q('[data-testid="plugin-artifact"]')?.textContent).toBe('https://github.com/example/pi-pool/releases/download/v1.5.0/pi-pool-win32-x64.exe');
  expect(preview.textContent).toContain('v1.5.0 at e7d1c9a');
  expect(preview.textContent).toContain('pi-pool switch -<pool> -Email <email> -Yes');
  // Nothing is installed until the owner says so.
  expect(row('pi-pool')).toBeNull();

  q('[data-testid="plugin-add"]')!.click();
  await vi.waitFor(() => expect(row('pi-pool')?.getAttribute('data-status')).toBe('installing'));
  expect(q('[data-testid="plugin-preview"]')).toBeNull();
  expect((q('[data-testid="plugin-url"]') as HTMLInputElement).value).toBe('');
  expect(shownIds()).toContain('pi-pool');
  await vi.waitFor(() => expect(row('pi-pool')?.getAttribute('data-status')).toBe('installed'), { timeout: 3000 });
});

test('a refused manifest shows the file, the field and what was expected, with no way to install it', async () => {
  await open();
  openAdd();
  type('[data-testid="plugin-url"]', 'https://github.com/example/broken-pool');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-preview"]')).not.toBeNull());
  expect(q('[data-testid="plugin-preview"]')?.getAttribute('data-rejected')).toBe('true');
  const refused = q('[data-testid="plugin-preview"] [data-testid="plugin-rejected"]');
  expect(refused?.getAttribute('data-kind')).toBe('artifacts.win32-x64.sha256');
  expect(refused?.textContent).toContain('boite-plugin.json');
  expect(refused?.textContent).toContain('64 lowercase hexadecimal characters');
  expect(q('[data-testid="plugin-add"]')).toBeNull();

  // Anything but https is refused before the core fetches.
  type('[data-testid="plugin-url"]', 'http://github.com/example/pi-pool');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-inspect-error"]')?.textContent).toContain('plugin url must be an https URL'));
  expect(q('[data-testid="plugin-preview"]')).toBeNull();
});

test('uninstalling a URL plugin takes its card away; the recommended one becomes a card to install again', async () => {
  await open();
  const { confirm } = await import('../lib/confirm.svelte');
  const ask = vi.spyOn(confirm, 'ask').mockResolvedValue(true);
  (await gear('seat-pool')).querySelector<HTMLElement>('[data-testid="plugin-uninstall"]')!.click();
  await vi.waitFor(() => expect(row('seat-pool')).toBeNull());
  await vi.waitFor(() => expect(q('[data-testid="plugin-dialog"]')).toBeNull());
  row('grok-seats')!.querySelector<HTMLElement>('[data-testid="plugin-cancel"]')!.click();
  await vi.waitFor(() => expect(row('grok-seats')).toBeNull());

  (await gear('bots')).querySelector<HTMLElement>('[data-testid="plugin-uninstall"]')!.click();
  await vi.waitFor(() => expect(row('bots')?.getAttribute('data-status')).toBe('not-installed'));
  await vi.waitFor(() => expect(q('[data-testid="plugin-dialog"]')).toBeNull());
  // Not installed: a Recommended card with Install and no switch, last in the grid; its source check behind the gear.
  expect(shownIds().at(-1)).toBe('bots');
  expect(row('bots')?.textContent).toContain('Recommended');
  expect(row('bots')?.querySelector('[data-testid="plugin-enabled"]')).toBeNull();
  const box = await gear('bots');
  expect(box.querySelector('[data-testid="plugin-updates"]')).not.toBeNull();
  expect(box.querySelector('[data-testid="plugin-check-updates"]')).not.toBeNull();
  expect(box.querySelector('[data-testid="plugin-uninstall"]')).toBeNull();
  q('[data-testid="plugin-dialog-close"]')!.click();
  flushSync();

  row('bots')!.querySelector<HTMLElement>('[data-testid="plugin-install"]')!.click();
  await vi.waitFor(() => expect(row('bots')?.getAttribute('data-status')).toBe('installed'), { timeout: 3000 });
  expect(shownIds()[0]).toBe('bots');
  await gear('bots');
  await vi.waitFor(() => expect(app('bots')?.getAttribute('data-app-status')).toBe('running'));
  expect(ask).toHaveBeenCalledTimes(2);
});

test('a recommended plugin with an update source says what it last found, and a check offers the newer release on its card', async () => {
  await open((rows) => {
    const bots = rows.find((plugin) => plugin.id === 'bots')!;
    bots.updates = { ...bots.updates!, checkedAt: Date.now() - 3 * 3_600_000 };
  });
  const bots = () => row('bots')!;
  const box = await gear('bots');
  const line = () => box.querySelector('[data-testid="plugin-updates-line"]')?.textContent ?? '';
  expect(line()).toBe('Up to date · checked 3h ago');
  expect(bots().querySelector('[data-testid="plugin-update"]')).toBeNull();

  box.querySelector<HTMLElement>('[data-testid="plugin-check-updates"]')!.click();
  await vi.waitFor(() => expect(bots().querySelector('[data-testid="plugin-update"]')?.textContent).toBe('Update to v0.1.10'));
  expect(line()).toBe('Found at github.com/Skollheim/bots, main at 6b2e4d8 · checked now');
  expect(bots().querySelector('[data-testid="plugin-state"]')?.textContent).toContain('v0.1.10 available');

  bots().querySelector<HTMLElement>('[data-testid="plugin-update"]')!.click();
  await vi.waitFor(() => expect(bots().getAttribute('data-status')).toBe('installed'), { timeout: 3000 });
  await vi.waitFor(() => expect(bots().querySelector('h3')?.textContent).toContain('v0.1.10'), { timeout: 3000 });
  expect(bots().querySelector('[data-testid="plugin-update"]')).toBeNull();
});

test('opening recommendations checks their sources without installing or blocking the list', async () => {
  client = new FakeClient({ delayMs: 0 });
  await client.connect();
  const call = client.call.bind(client);
  let finish!: (rows: PluginState[]) => void;
  const latest = new Promise<PluginState[]>((resolve) => { finish = resolve; });
  let recommendation!: PluginState;
  const calls = vi.spyOn(client, 'call').mockImplementation((async (method: string, params: unknown) => {
    if (method === 'plugins.checkUpdates') return latest;
    const result = await call(method as never, params as never);
    if (method === 'plugins.list') {
      recommendation = (result as PluginState[]).find((plugin) => plugin.id === 'bots')!;
      Object.assign(recommendation, { version: null, status: 'not-installed', app: null });
    }
    return result;
  }) as never);
  const store = { client, providers: [] } as unknown as Store;
  mounted = mount(PluginsPage, { target: document.body, props: { store } });

  await vi.waitFor(() => expect(row('bots')?.getAttribute('data-status')).toBe('not-installed'));
  expect(row('bots')?.querySelector('[data-testid="plugin-install"]')).not.toBeNull();
  await vi.waitFor(() => expect(calls).toHaveBeenCalledWith('plugins.checkUpdates', { id: 'bots' }));
  expect(calls.mock.calls.filter(([method]) => method === 'plugins.checkUpdates')).toHaveLength(1);

  finish([{ ...recommendation, availableVersion: '0.1.21', updates: {
    ...recommendation.updates!, checkedAt: Date.now(), available: { version: '0.1.21', commit: 'c'.repeat(40), checkedAt: Date.now() },
  } }]);
  await vi.waitFor(() => expect(row('bots')?.querySelector('h3')?.textContent).toContain('v0.1.21'));
  expect((await gear('bots')).querySelector('[data-testid="plugin-updates-line"]')?.textContent).toContain('Found at github.com/Skollheim/bots');
  expect(calls.mock.calls.some(([method]) => method === 'plugins.install')).toBe(false);
  expect(row('bots')?.getAttribute('data-status')).toBe('not-installed');
});

test('an ignored release and a failed check read as quiet notes, never alarms', async () => {
  await open((rows) => {
    const bots = rows.find((plugin) => plugin.id === 'bots')!;
    bots.updates = { ...bots.updates!, ignored: '0.1.8 found there, older than 0.1.9; Boite never goes back.' };
  });
  const updates = (await gear('bots')).querySelector('[data-testid="plugin-updates"]')!;
  expect(updates.textContent).toContain('Not offered: 0.1.8 found there, older than 0.1.9; Boite never goes back.');
  expect(updates.querySelector('[role="alert"], .bad')).toBeNull();
  expect(row('bots')?.querySelector('[data-testid="plugin-state"]')).toBeNull();
});

test('Douane\'s gear shows its gateway on loopback, stops and starts it, and its uninstall says the sign-ins stay', async () => {
  await open();
  await gear('douane');
  const strip = () => q('[data-testid="plugin-gateway"][data-plugin="douane"]');
  await vi.waitFor(() => expect(strip()?.dataset.gatewayStatus).toBe('running'));
  expect(q('[data-testid="plugin-gateway-state"]')?.textContent).toContain('0.3.0 on 127.0.0.1:8787');
  // The page runs at a loopback address, beside its core: the dashboard opens from here.
  expect(q('[data-testid="plugin-gateway-open"]')?.textContent).toContain('Open Douane');

  q('[data-testid="plugin-gateway-stop"]')!.click();
  await vi.waitFor(() => expect(strip()?.dataset.gatewayStatus).toBe('stopped'));
  // It starts with Boite, so a stop holds only until then and the line says stopped.
  expect(q('[data-testid="plugin-gateway-state"]')?.textContent).toContain('Stopped');
  expect(q('[data-testid="plugin-gateway-state"]')?.textContent).not.toContain('starts again only when you start it');
  q('[data-testid="plugin-gateway-start"]')!.click();
  await vi.waitFor(() => expect(strip()?.dataset.gatewayStatus).toBe('running'));

  const { confirm } = await import('../lib/confirm.svelte');
  const ask = vi.spyOn(confirm, 'ask').mockResolvedValue(false);
  q('[data-testid="plugin-uninstall"][data-plugin="douane"]')!.click();
  await vi.waitFor(() => expect(ask).toHaveBeenCalled());
  expect(ask.mock.calls[0]![0].body).toMatch(/sign-ins, settings and database stay in .*douane/);
  expect(strip()).not.toBeNull();
});

/** A core that takes grants: every install asks first. */
const grantsCore = { features: { pluginGrants: true as const } };
const consentRow = (permission: string) => q(`[data-testid="plugin-consent-row"][data-permission="${permission}"] input`) as HTMLInputElement;
const chips = (id: string) => [...row(id)!.querySelectorAll('[data-testid="plugin-permission"]')].map((el) => el.getAttribute('title'));

test('a schema 2 plugin installs with what the owner ticked, and Cancel installs nothing', async () => {
  await open(undefined, grantsCore);
  const calls = vi.spyOn(client!, 'call');
  openAdd();
  type('[data-testid="plugin-url"]', 'https://github.com/example/scoped-desktop-waiting');
  q('[data-testid="plugin-inspect"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-add"]')).not.toBeNull());

  q('[data-testid="plugin-add"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-consent"]')).not.toBeNull());
  expect(q('#consent-title')?.textContent).toBe('Scoped desktop waiting wants to access your Boite');
  q('[data-testid="plugin-consent-cancel"]')!.click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-consent"]')?.classList.contains('closing') ?? true).toBe(true));
  expect(calls.mock.calls.some(([method]) => method === 'plugins.add')).toBe(false);
  expect(q('[data-testid="plugin-preview"]')).not.toBeNull();

  q('[data-testid="plugin-add"]')!.click();
  await vi.waitFor(() => expect(consentRow('ui.reveal')?.checked).toBe(true));
  expect(q('[data-testid="plugin-consent-program"]')).not.toBeNull();
  consentRow('ui.reveal').click();
  q('[data-testid="plugin-consent-allow"]')!.click();
  await vi.waitFor(() => expect(row('scoped-desktop-waiting')?.getAttribute('data-status')).toBe('installed'), { timeout: 3000 });
  expect(calls.mock.calls.find(([method]) => method === 'plugins.add')?.[1]).toMatchObject({ grants: ['threads.read'] });
  expect(chips('scoped-desktop-waiting')).toEqual(['threads.read']);
});

test('Edit under the gear\'s Authorizations changes the grants through plugins.setGrants', async () => {
  await open(undefined, grantsCore);
  const calls = vi.spyOn(client!, 'call');
  // A schema 1 plugin holds the owner token: nothing to edit.
  const seats = await gear('seat-pool');
  expect(seats.querySelector('[data-testid="plugin-grants"]')).toBeNull();
  q('[data-testid="plugin-dialog-close"]')!.click();
  flushSync();
  await vi.waitFor(() => expect(q('[data-testid="plugin-dialog"]')).toBeNull());
  const standup = await gear('standup');
  (standup.querySelector('[data-testid="plugin-grants"]') as HTMLElement).click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-consent"]')?.dataset.mode).toBe('edit'));
  expect(consentRow('todos.write').checked).toBe(false);
  consentRow('todos.write').click();
  flushSync();
  // Escape belongs to the editor on top: it does not close the gear under it.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  flushSync();
  expect(dialog('standup')).not.toBeNull();
  (standup.querySelector('[data-testid="plugin-grants"]') as HTMLElement).click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-consent"]:not(.closing)')?.dataset.mode).toBe('edit'));
  consentRow('todos.write').click();
  flushSync();
  q('[data-testid="plugin-consent-allow"]')!.click();
  await vi.waitFor(() => expect(chips('standup')).toEqual(['threads.read', 'todos.read', 'todos.write']));
  expect([...dialog('standup')!.querySelectorAll('[data-testid="plugin-authorization"]')].map((el) => el.getAttribute('title'))).toEqual(['threads.read', 'todos.read', 'todos.write']);
  expect(calls.mock.calls.find(([method]) => method === 'plugins.setGrants')?.[1]).toEqual({ id: 'standup', grants: ['threads.read', 'todos.read', 'todos.write'] });
});

test('a recommended schema 1 plugin asks too, saying it gets the owner\'s own access, and sends no grants', async () => {
  await open(undefined, grantsCore);
  const { confirm } = await import('../lib/confirm.svelte');
  const ask = vi.spyOn(confirm, 'ask').mockResolvedValue(true);
  try {
    (await gear('bots')).querySelector<HTMLElement>('[data-testid="plugin-uninstall"]')!.click();
    await vi.waitFor(() => expect(row('bots')?.querySelector('[data-testid="plugin-install"]')).not.toBeNull());
  } finally {
    ask.mockRestore();
  }
  const calls = vi.spyOn(client!, 'call');
  (row('bots')!.querySelector('[data-testid="plugin-install"]') as HTMLElement).click();
  await vi.waitFor(() => expect(q('[data-testid="plugin-consent-owner"]')).not.toBeNull());
  expect(q('[data-testid="plugin-consent-program"]')).not.toBeNull();
  expect(calls.mock.calls.some(([method]) => method === 'plugins.install')).toBe(false);
  q('[data-testid="plugin-consent-allow"]')!.click();
  await vi.waitFor(() => expect(calls.mock.calls.some(([method]) => method === 'plugins.install')).toBe(true));
  expect(calls.mock.calls.find(([method]) => method === 'plugins.install')?.[1]).toEqual({ id: 'bots' });
});
