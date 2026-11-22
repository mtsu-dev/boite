import { afterAll, beforeAll, expect, test } from 'bun:test';
import { BrowserPage } from './lib/cdp.ts';
import { mintPairing, startCore, type RunningCore } from './lib/core.ts';

// A phone that opened Boite once, online, then opens it with the core gone and
// nothing left in its HTTP cache: the service worker stores the shell on
// install, then saves the phone's navigation and conversation assets after pairing.
const TIMEOUT = 90_000;

let core: RunningCore | undefined;
let page: BrowserPage | undefined;

beforeAll(async () => {
  core = await startCore();
  page = await BrowserPage.launch({ url: 'about:blank', windowSize: { width: 390, height: 844 } });
}, TIMEOUT);

afterAll(async () => {
  await page?.close();
  // Stopped once already by the test, which kept its data directory: this removes it.
  await core?.stop();
}, 30_000);

test('an installed phone opens offline on its header and recovery screen', async () => {
  const browser = page!;
  const running = core!;
  await browser.navigate(`${running.url}/`);
  await browser.waitFor(`!!document.querySelector('[data-testid=machine-paste-open]') && navigator.serviceWorker.controller !== null`, 30_000);
  const cachedConversations = `(async () => {
    const cacheNames = (await caches.keys()).filter(name => name.startsWith('boite-ui-'));
    const files = (await Promise.all(cacheNames.map(async name => (await caches.open(name)).keys()))).flat();
    return files.filter(file => new URL(file.url).pathname.startsWith('/assets/conversations-')).length;
  })()`;
  expect(await browser.evaluate(cachedConversations)).toBe(0);
  await browser.navigate(await mintPairing(running));
  await browser.waitFor(`document.querySelector('.app.ready [data-testid=mobile-header]') !== null`, 30_000);
  // The worker installs and takes this page over; no second online load fills its cache.
  await browser.waitFor('navigator.serviceWorker.controller !== null', 30_000);
  await browser.waitFor(`${cachedConversations}.then(count => count === 2)`, 30_000);

  await browser.send('Network.clearBrowserCache', {});
  await running.stop({ keepDataDir: true });
  await browser.navigate(`${running.url}/`);

  await browser.waitFor(`document.querySelector('.app.ready') !== null`, 30_000);
  await browser.waitFor(`document.querySelector('[data-testid=mobile-header]') !== null && document.querySelector('[data-testid=mobile-list]') !== null`, 15_000);
  expect(await browser.evaluate<boolean>(`document.querySelector('[data-testid=mobile-navigation-failed]') === null`)).toBe(true);
  expect(await browser.evaluate(cachedConversations)).toBe(2);
}, TIMEOUT);
