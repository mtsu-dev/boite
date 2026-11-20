import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage } from './lib/cdp.ts';
import { mintPairing, startCore } from './lib/core.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

const id = (name: string) => `[data-testid="${name}"]`;
const has = (name: string) => `!!document.querySelector(${JSON.stringify(id(name))})`;

async function browser(mobile: boolean): Promise<BrowserPage> {
  const width = mobile ? 390 : 1280;
  const page = await BrowserPage.launch({ url: 'about:blank', locale: 'fr', windowSize: { width, height: 844 } });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile });
  return page;
}

test('a fresh browser paints startup with all client files pending', async () => {
  ensureProductionUi();
  const core = await startCore();
  const clientFiles = Promise.withResolvers<void>();
  const proxy = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const { pathname, search } = new URL(request.url);
      if (pathname.startsWith('/assets/')) await clientFiles.promise;
      return fetch(core.url + pathname + search, { headers: { 'accept-encoding': 'identity' } });
    },
  });
  try {
    for (const mobile of [false, true]) {
      const page = await browser(mobile);
      try {
        await page.send('Page.navigate', { url: `http://127.0.0.1:${proxy.port}/` });
        await page.waitFor(`${has('boot-status')} && performance.getEntriesByName('first-contentful-paint').length > 0`);
        expect(await page.evaluate(`document.querySelector('${id('boot-status')}').innerText`)).toBe('Démarrage');
        const preloadsChat = `!!document.querySelector('link[rel=modulepreload][href*="/conversations-"]')`;
        expect(await page.evaluate<boolean>(preloadsChat)).toBe(!mobile);
        const captures = process.env['BOITE_E2E_CAPTURES'];
        if (captures) await page.screenshot(join(captures, `${mobile ? 'phone' : 'desktop'}-startup.png`));
      } finally { await page.close(); }
    }
  } finally {
    clientFiles.resolve();
    await proxy.stop(true);
    await core.stop();
  }
}, 60_000);

test('a fresh phone pairs even when the conversations navigation has not loaded', async () => {
  ensureProductionUi();
  const core = await startCore();
  try {
    const page = await browser(true);
    try {
      await page.send('Network.setBlockedURLs', { urls: ['*/MobileNavigation-*'] });
      await page.navigate(`${core.url}/`);
      await page.waitFor(`${has('machine-scan')} && ${has('machine-paste-open')}`);
      expect(await page.evaluate(has('boot-status'))).toBe(false);
      const captures = process.env['BOITE_E2E_CAPTURES'];
      if (captures) await page.screenshot(join(captures, 'phone-pairing.png'));
      await page.click(id('machine-paste-open'));
      expect(await page.evaluate(has('machine-paste-form'))).toBe(true);
      await page.type(id('machine-link'), await mintPairing(core));
      await page.send('Network.setBlockedURLs', { urls: [] });
      await page.click(id('machine-add'));
      await page.waitFor(`!${has('mobile-connect')} && document.querySelector('${id('status-connection')}')?.dataset.state === 'ready'`);
      await page.waitFor(has('mobile-list'));
    } finally { await page.close(); }
  } finally { await core.stop(); }
}, 60_000);
