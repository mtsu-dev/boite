import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { toMobileList } from './lib/mobile.ts';
import { startDevUi } from './lib/ui.ts';

/*
 * The stages of `EXPERIMENT_STAGES` as a person meets them: a Dev build has
 * an Experiments page with the one experiment, off until chosen, a Release
 * has no such page, the five features that were experiments have no gate
 * left, and Bots are there on a profile that stored nothing. The in-memory
 * core says its version (`?fake=1&version=`), the way a real hello does.
 */
const ARTIFACTS = join(import.meta.dir, '.artifacts', 'stages');
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };

let page: BrowserPage;
let server: { close(): Promise<void> };
let base: string;
beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const port = await freePort();
  // The page imports `/src/...`, which only the dev server answers.
  server = await startDevUi(port);
  base = `http://127.0.0.1:${port}`;
  // A fresh profile: no experiment was ever stored.
  page = await BrowserPage.launch({ url: `${base}/?fake=1` });
  await ready();
}, 60000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function ready() {
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready'`);
}

async function open(query: string, size: typeof DESKTOP) {
  await page.send('Emulation.setDeviceMetricsOverride', size);
  await page.navigate(`${base}/?fake=1${query}`);
  await ready();
}

async function capture(name: string) {
  // The shared wait leaves out what is not drawn: a phone's chat under the list holds animations that never end (lib/cdp.ts).
  await page.settleAnimations();
  await page.screenshot(join(ARTIFACTS, name));
}

for (const [name, size] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`${name}: a Dev build lists the one experiment, off with nothing stored`, async () => {
    await open('', size);
    expect(await page.evaluate(`localStorage.getItem('boite.experiments')`)).toBeNull();
    await page.evaluate(`window.__boiteTest.workspace.active.showSettings('experiments')`);
    await page.waitFor(`document.querySelector('[data-testid="experiments-page"] [data-testid="experiment-draft-backdrop"]')?.getBoundingClientRect().width > 0`);
    expect(await page.evaluate(`[...document.querySelectorAll('[data-testid="experiments-page"] input[data-testid^="experiment-"]')].map((node) => [node.dataset.testid, node.checked])`)).toEqual([['experiment-draft-backdrop', false]]);
    await capture(`dev-settings-${name}.png`);
    await page.evaluate(`localStorage.removeItem('boite.experiments.build')`);
  }, 60000);

  for (const [build, query] of [['Release', '&version=2.0.0']] as const) {
    test(`${name}: a ${build} has no Experiments page, with nothing stored`, async () => {
      await open(query, size);
      expect(await page.evaluate(`localStorage.getItem('boite.experiments')`)).toBeNull();
      // A route to the page that is gone lands on Settings' first page, not on an empty one.
      await page.evaluate(`window.__boiteTest.workspace.active.showSettings('experiments')`);
      await page.waitFor(`document.querySelector('[data-testid="settings-tab-general"], [data-testid="settings-family"]')?.getBoundingClientRect().width > 0`);
      expect(await page.evaluate(`document.querySelector('[data-testid="settings-tab-experiments"]')`)).toBeNull();
      expect(await page.evaluate(`document.querySelector('[data-testid="experiments-page"]')`)).toBeNull();
      // The phone's list is taller than the screen: show the whole Advanced family, where the row was.
      if (name === 'phone') {
        await page.evaluate(`document.querySelector('[data-testid="settings-family"][data-family="advanced"]').scrollIntoView({ block: 'end' })`);
        await page.waitFor(`(() => { const box = document.querySelector('[data-testid="settings-family"][data-family="advanced"]').getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })()`);
      }
      await capture(`${build.toLowerCase()}-settings-${name}.png`);
      await page.evaluate(`localStorage.removeItem('boite.experiments.build')`);
    }, 60000);
  }

  test(`${name}: Mochis are in the ${name === 'desktop' ? 'sidebar foot' : 'bottom bar'} on a fresh profile`, async () => {
    await open('&agents=1', size);
    expect(await page.evaluate(`localStorage.getItem('boite.experiments')`)).toBeNull();
    // A phone opens on the conversation: its bar is on the list.
    if (name === 'phone') await toMobileList(page);
    await page.waitFor(`document.querySelector('${name === 'desktop' ? '[data-testid="sidebar-foot"] [data-testid="nav-agents"]' : '[data-testid="mobile-tabs"] [data-testid="mobile-agents"]'}')?.getBoundingClientRect().width > 0`);
    await capture(`bots-launcher-${name}.png`);
  }, 60000);
}
