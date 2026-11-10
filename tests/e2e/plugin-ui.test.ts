import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startDevUi } from './lib/ui.ts';

/*
 * The example plugin's interface (examples/plugins/hello/ui), end to end on the
 * fake client: added from its URL, its script imported from a blob URL in the
 * page, its header button opening its panel tab, its message action, its card
 * line, then gone on uninstall. Safe mode keeps every script off.
 */

const artifacts = join(import.meta.dir, '.artifacts', 'plugin-ui');
let server: { close(): Promise<void> };
let page: BrowserPage;
let url: string;
const id = (name: string) => `[data-testid="${name}"]`;
const button = `${id('plugin-button')}[data-plugin="hello"][data-slot="thread-header"]`;
const tab = `${id('plugin-tab')}[data-plugin-tab="hello/recent"]`;

async function capture(name: string) {
  await page.settleAnimations();
  await page.screenshot(join(artifacts, name));
}
const client = `(await import('/src/lib/workspace.svelte.ts')).workspace.primary.client`;

beforeAll(async () => {
  const port = await freePort();
  server = await startDevUi(port);
  url = `http://127.0.0.1:${port}/?fake=1&open=recent`;
  page = await BrowserPage.launch({ url, windowSize: { width: 1280, height: 800 } });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.waitFor(`document.querySelector('${id('timeline')}')`);
}, 60_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

test('the example plugin adds a header button that opens its panel tab, a message action and a card line, and leaves on uninstall', async () => {
  expect(await page.evaluate(`document.querySelector('${id('plugin-button')}') === null`)).toBe(true);
  await page.evaluate(`(async () => {
    const c = ${client};
    const preview = await c.call('plugins.inspect', { url: 'https://github.com/example/hello' });
    await c.call('plugins.add', { previewId: preview.previewId });
  })()`);
  // Installed, the core announces new interfaces and the window imports the script.
  await page.waitFor(`document.querySelector('${button}')`);
  expect(await page.evaluate(`document.querySelector('style[data-boite-plugin="hello"]') !== null`)).toBe(true);
  expect(await page.evaluate(`document.querySelector('${button}').title`)).toBe('Recent conversations · From Hello');

  await page.click(button);
  await page.waitFor(`document.querySelectorAll('${tab} .hello-recent li').length > 0`);
  const rows = await page.evaluate<number>(`document.querySelectorAll('${tab} .hello-recent li').length`);
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThanOrEqual(5);
  // The tab reads as the script titled it.
  expect(await page.evaluate(`[...document.querySelectorAll('[role="tab"]')].some(el => el.textContent.trim() === 'Recent')`)).toBe(true);
  await capture('plugin-tab-desktop.png');

  // A message's menu: the plugins' actions behind one button.
  await page.waitFor(`document.querySelector('${id('message-plugins')}')`);
  await page.click(id('message-plugins'));
  await page.waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some(el => el.textContent.includes('Count words'))`);
  await page.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.includes('Count words')).click()`);
  await page.waitFor(`/^\\d+ words$/.test(document.querySelector('.hello-toast')?.textContent ?? '')`);

  // A phone-wide window keeps the header button, the panel closed so the header shows.
  await page.click(id('panel-toggle'));
  await page.waitFor(`document.querySelector('${tab}') === null`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.waitFor(`document.querySelector('${button}')?.getBoundingClientRect().width > 0`);
  await capture('plugin-header-phone.png');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // Its card says the interface is loaded.
  await page.click(id('nav-settings'));
  await page.click(id('settings-tab-plugins'));
  const state = `${id('plugin-ui-state')}[data-plugin="hello"]`;
  await page.waitFor(`document.querySelector('${state}')?.dataset.uiState === 'running'`);
  await page.evaluate(`document.querySelector('[data-testid="plugin-row"][data-plugin="hello"]').scrollIntoView({ block: 'center' })`);
  await capture('plugin-card-desktop.png');

  await page.evaluate(`(async () => { await (${client}).call('plugins.uninstall', { id: 'hello' }); })()`);
  await page.waitFor(`document.querySelector('${button}') === null && document.querySelector('style[data-boite-plugin="hello"]') === null`);
}, 60_000);

test('safe mode keeps plugin interfaces off and says so, until asked to load them', async () => {
  await page.navigate(`${url}&safe=1`);
  await page.waitFor(`document.querySelector('${id('plugin-safe-mode')}')?.dataset.reason === 'flag'`);
  await page.evaluate(`(async () => {
    const c = ${client};
    const preview = await c.call('plugins.inspect', { url: 'https://github.com/example/hello' });
    await c.call('plugins.add', { previewId: preview.previewId });
  })()`);
  await page.waitFor(`(async () => (await import('/src/lib/plugin-ui.svelte.ts')).pluginUi.status.hello?.state === 'skipped')()`);
  expect(await page.evaluate(`document.querySelector('${id('plugin-button')}') === null`)).toBe(true);
  await capture('plugin-safe-mode-desktop.png');
  await page.click(id('plugin-safe-load'));
  await page.waitFor(`document.querySelector('${button}') !== null && document.querySelector('${id('plugin-safe-mode')}') === null`);
}, 60_000);
