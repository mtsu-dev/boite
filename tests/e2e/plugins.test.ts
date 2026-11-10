import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

const artifacts = join(import.meta.dir, '.artifacts', 'plugins');
let server: { close(): Promise<void> };
let page: BrowserPage;
const id = (name: string) => `[data-testid="${name}"]`;
const row = (plugin: string) => `${id('plugin-row')}[data-plugin="${plugin}"]`;

async function settled() {
  await page.evaluate(`Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])`);
}
async function capture(name: string) { await settled(); await page.screenshot(join(artifacts, name)); }
/** The left 390 pixels of the viewport: the page laid out in a phone-wide column. */
async function captureColumn(name: string) {
  await settled();
  const raw = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }) as { data?: string };
  if (typeof raw.data !== 'string') throw new Error('the screenshot came back empty');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, name), Buffer.from(raw.data, 'base64'));
}
/** Opens a card's gear and waits for its dialog. */
async function gear(plugin: string) {
  await page.click(`${id('plugin-open')}[data-plugin="${plugin}"]`);
  await page.waitFor(`document.querySelector('${id('plugin-dialog')}[data-plugin="${plugin}"]')`);
}
async function closeGear() {
  await page.click(id('plugin-dialog-close'));
  await page.waitFor(`document.querySelector('${id('plugin-dialog')}') === null`);
}
const shown = () => page.evaluate<string[]>(`[...document.querySelectorAll('${id('plugins-grid')} ${id('plugin-row')}')].map((el) => el.dataset.plugin)`);
async function scrollTo(selector: string) {
  await page.evaluate(`document.querySelector('${selector}').scrollIntoView({ block: 'start' })`);
}
/** The URL form sits behind its button. */
async function openAdd() {
  if (await page.evaluate<boolean>(`document.querySelector('${id('plugins-add')}') === null`)) await page.click(id('plugins-from-url'));
  await page.waitFor(`document.querySelector('${id('plugin-url')}')`);
}
async function inspect(url: string) {
  await openAdd();
  await page.type(id('plugin-url'), url);
  await page.click(id('plugin-inspect'));
  await page.waitFor(`document.querySelector('${id('plugin-preview')}')`);
}

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1`, windowSize: { width: 1280, height: 800 } });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.waitFor(`document.querySelector('${id('nav-settings')}')`);
  await page.click(id('nav-settings'));
  await page.click(id('settings-tab-plugins'));
  await page.waitFor(`document.querySelector('${row('pool-legacy')}')`);
}, 60_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

test('the page is one grid of cards, every state on its card and the details behind its gear', async () => {
  expect(await shown()).toEqual(['bots', 'douane', 'grok-seats', 'pool-legacy', 'quiet-hours', 'seat-pool', 'standup']);
  expect(await page.evaluate(`document.querySelector('${row('grok-seats')} ${id('plugin-progress')}').getAttribute('aria-valuenow')`)).toBe('45');
  expect(await page.evaluate(`document.querySelector('${row('pool-legacy')} ${id('plugin-state')}').dataset.field`)).toBe('manifest.schema');
  expect(await page.evaluate(`document.querySelector('${row('quiet-hours')}').dataset.enabled`)).toBe('false');
  // The URL form waits behind its button.
  expect(await page.evaluate(`document.querySelector('${id('plugins-add')}') === null`)).toBe(true);
  await capture('plugins-desktop.png');

  await gear('standup');
  expect(await page.evaluate(`[...document.querySelectorAll('${id('plugin-setting')}')].map((el) => el.dataset.type).join()`)).toBe('switch,slider,select,number,text');
  expect(await page.evaluate(`[...document.querySelectorAll('${id('plugin-authorization')}')].map((el) => el.title).join()`)).toBe('threads.read,todos');
  await capture('plugins-dialog-desktop.png');
  await closeGear();

  await gear('pool-legacy');
  expect(await page.evaluate(`document.querySelector('${id('plugin-dialog')} ${id('plugin-rejected')}').dataset.field`)).toBe('manifest.schema');
  await closeGear();
}, 30_000);

test('the switch turns a plugin off and on, and a setting saves as soon as it changes', async () => {
  const toggle = `${row('bots')} ${id('plugin-enabled')}`;
  await page.click(toggle);
  await page.waitFor(`document.querySelector('${row('bots')}').dataset.enabled === 'false'`);
  await page.click(`${id('plugins-filter-disabled')}`);
  expect(await shown()).toEqual(['bots', 'quiet-hours']);
  await capture('plugins-off-desktop.png');
  await page.click(`${id('plugins-filter-all')}`);
  await page.click(toggle);
  await page.waitFor(`document.querySelector('${row('bots')}').dataset.enabled === 'true'`);

  await gear('standup');
  const field = (key: string) => `${id('plugin-setting')}[data-key="${key}"] ${id('plugin-setting-input')}`;
  await page.click(field('includeTodos'));
  await page.waitFor(`document.querySelector('${field('includeTodos')}').checked === false`);
  // A number outside the manifest's range is refused on the spot.
  await page.evaluate(`(() => { const input = document.querySelector('${field('maxThreads')}'); input.value = '99'; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.waitFor(`document.querySelector('${id('plugin-setting')}[data-key="maxThreads"] ${id('plugin-setting-error')}')`);
  expect(await page.text(`${id('plugin-setting')}[data-key="maxThreads"] ${id('plugin-setting-error')}`)).toBe('Must be a number, at least 1, at most 50.');
  await capture('plugins-setting-refused-desktop.png');
  await closeGear();
}, 30_000);

test('a URL shows its manifest before anything installs, and a refused one says why', async () => {
  await inspect('https://github.com/example/pi-pool');
  expect(await page.text(id('plugin-artifact'))).toBe('https://github.com/example/pi-pool/releases/download/v1.5.0/pi-pool-win32-x64.exe');
  expect(await page.evaluate(`document.querySelector('${row('pi-pool')}') === null`)).toBe(true);
  await scrollTo(id('plugins-add'));
  await capture('plugins-preview-desktop.png');

  await inspect('https://github.com/example/broken-pool');
  await page.waitFor(`document.querySelector('${id('plugin-preview')}').dataset.rejected === 'true'`);
  expect(await page.evaluate(`document.querySelector('${id('plugin-preview')} ${id('plugin-rejected')}').dataset.field`)).toBe('artifacts.win32-x64.sha256');
  expect(await page.evaluate(`document.querySelector('${id('plugin-add')}') === null`)).toBe(true);
  await scrollTo(id('plugins-add'));
  await capture('plugins-refused-desktop.png');

  await inspect('https://github.com/example/pi-pool');
  await page.click(id('plugin-add'));
  await page.waitFor(`document.querySelector('${row('pi-pool')}')?.dataset.status === 'installed'`);
  await gear('pi-pool');
  await page.click(`${id('plugin-uninstall')}[data-plugin="pi-pool"]`);
  await page.waitFor(`document.querySelector('${id('confirm-ok')}')`); await page.click(id('confirm-ok'));
  await page.waitFor(`document.querySelector('${row('pi-pool')}') === null && document.querySelector('${id('plugin-dialog')}') === null`);
  await page.click(id('plugins-from-url'));
}, 30_000);

test('a pool switches its login, and the recommended plugin uninstalls back to Recommended and installs again', async () => {
  await gear('seat-pool');
  const account = `${id('plugin-dialog')} ${id('plugin-pool')}[data-provider="opencode"] ${id('plugin-account')}[data-email="side@example.com"]`;
  await page.waitFor(`document.querySelector('${account}')`);
  await page.click(`${account} ${id('plugin-switch')}`);
  await page.waitFor(`document.querySelector('${id('confirm-ok')}')`); await page.click(id('confirm-ok'));
  // The active login says so and has nothing to switch to.
  await page.waitFor(`document.querySelector('${account} ${id('plugin-account-active')}') !== null && document.querySelector('${account} ${id('plugin-switch')}') === null`);
  await capture('plugins-installed-desktop.png');
  await closeGear();

  await gear('bots');
  await page.click(`${id('plugin-uninstall')}[data-plugin="bots"]`);
  await page.waitFor(`document.querySelector('${id('confirm-ok')}')`); await page.click(id('confirm-ok'));
  await page.waitFor(`document.querySelector('${row('bots')}')?.dataset.status === 'not-installed' && document.querySelector('${id('plugin-dialog')}') === null`);
  await page.click(id('settings-tab-general'));
  await page.click(id('settings-tab-plugins'));
  await page.waitFor(`document.querySelector('${row('bots')} h3')?.textContent.includes('v0.1.10')`);
  expect((await shown()).at(-1)).toBe('bots');
  await gear('bots');
  expect(await page.evaluate(`document.querySelector('${id('plugin-dialog')} ${id('plugin-check-updates')}') !== null`)).toBe(true);
  await closeGear();
  await scrollTo(row('bots'));
  await capture('plugins-recommended-desktop.png');
  await page.click(`${row('bots')} ${id('plugin-install')}`);
  await page.waitFor(`document.querySelector('${row('bots')}')?.dataset.status === 'installed'`);
  expect((await shown())[0]).toBe('bots');
}, 30_000);

test('in a 390 pixel column the page wraps instead of scrolling sideways', async () => {
  // A narrow desktop window: the nav hidden, the page 390 pixels wide. The
  // section's frame edge goes too, or its two pixels come off the 390.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 844, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'plugins-column';
    style.textContent = '.settings > nav { display: none !important; } .settings > section { flex: 0 0 390px !important; max-width: 390px; border: none !important; }';
    document.head.append(style);
  })()`);
  const fits = `(() => { const el = document.querySelector('${id('plugins-page')}'); return el.getBoundingClientRect().width === 390 && el.scrollWidth <= el.clientWidth; })()`;
  await page.evaluate(`document.querySelector('${id('plugins-page')}').scrollTop = 0`);
  expect(await page.evaluate(fits)).toBe(true);
  await captureColumn('plugins-390-column.png');
  await inspect('https://github.com/example/pi-pool');
  await scrollTo(id('plugins-add'));
  expect(await page.evaluate(fits)).toBe(true);
  await captureColumn('plugins-390-preview.png');
  await page.click(id('plugin-dismiss'));
  await page.click(id('plugins-from-url'));
  await page.evaluate(`document.getElementById('plugins-column').remove()`);
}, 30_000);

test('a phone gets the plugins page too: one card per row, the gear a bottom sheet', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // The phone shell first: the desktop page is still in the DOM until the layout switches.
  await page.waitFor(`document.querySelector('${id('mobile-header')}')`);
  if (await page.evaluate<boolean>(`document.querySelector('${id('plugins-page')}') === null`)) await page.click(id('settings-tab-plugins'));
  await page.waitFor(`document.querySelector('${id('plugins-grid')}')`);
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  // One column: every card as wide as the grid.
  expect(await page.evaluate(`(() => { const grid = document.querySelector('${id('plugins-grid')}').getBoundingClientRect().width; return [...document.querySelectorAll('${id('plugin-row')}')].every((el) => Math.abs(el.getBoundingClientRect().width - grid) < 1); })()`)).toBe(true);
  await capture('plugins-390.png');
  await gear('standup');
  await capture('plugins-390-dialog.png');
  // A bottom sheet: its foot on the screen's, once it has risen.
  expect(await page.evaluate<number>(`Math.abs(document.querySelector('${id('plugin-dialog')}').getBoundingClientRect().bottom - 844)`)).toBeLessThanOrEqual(1);
  await closeGear();
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
}, 30_000);
