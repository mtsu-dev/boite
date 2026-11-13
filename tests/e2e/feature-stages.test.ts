import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { toMobileList } from './lib/mobile.ts';
import { startDevUi } from './lib/ui.ts';

/*
 * The stages of `EXPERIMENT_STAGES` as a person meets them: a Nightly lists
 * the five experiments, a Release has no Experiments page, and Bots are there
 * on a profile that stored nothing. The in-memory core says its version
 * (`?fake=1&version=`), the way a real hello does.
 */
const ARTIFACTS = join(import.meta.dir, '.artifacts', 'stages');
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const EXPERIMENTS = ['whip', 'contacts', 'auto-goal', 'teams', 'debates'];

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
  await page.evaluate(`Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])`);
  await page.screenshot(join(ARTIFACTS, name));
}

const switches = `[...document.querySelectorAll('[data-testid="experiments-page"] [data-testid^="experiment-"]')].map(node => node.dataset.testid.slice('experiment-'.length))`;

for (const [name, size] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`${name}: a Nightly lists the five experiments on its Experiments page, with nothing stored`, async () => {
    await open('', size);
    expect(await page.evaluate(`localStorage.getItem('boite.experiments')`)).toBeNull();
    expect(await page.evaluate(`window.__boiteTest.workspace.active.core.version`)).toBe('2.0.0-beta.1');
    await page.evaluate(`window.__boiteTest.workspace.active.showSettings('experiments')`);
    await page.waitFor(`document.querySelector('[data-testid="experiment-whip"]')?.getBoundingClientRect().width > 0`);
    expect(await page.evaluate(switches)).toEqual(EXPERIMENTS);
    await capture(`nightly-experiments-${name}.png`);
  }, 60000);

  test(`${name}: a Release has no Experiments page, and an experiment stored before is off and kept`, async () => {
    await page.evaluate(`localStorage.setItem('boite.experiments', JSON.stringify(['whip']))`);
    await open('&version=2.0.0', size);
    await page.waitFor(`localStorage.getItem('boite.experiments.build') === '2.0.0'`);
    // A route to the section that is gone lands on Version, where it stood, from the top: its updates card, not an empty page.
    await page.evaluate(`window.__boiteTest.workspace.active.showSettings('experiments')`);
    await page.waitFor(`document.querySelector('[data-testid="settings-page"][data-page="version"] [data-testid="app-updates-card"]')?.getBoundingClientRect().width > 0`);
    expect(await page.evaluate(`document.querySelector('[data-testid="settings-tab-experiments"]')`)).toBeNull();
    expect(await page.evaluate(`document.querySelector('[data-testid="experiments-page"]')`)).toBeNull();
    expect(await page.evaluate(`import('/src/lib/experiments.ts').then(({ isExperimentEnabled }) => [isExperimentEnabled('whip'), isExperimentEnabled('resident-agents')])`)).toEqual([false, true]);
    expect(await page.evaluate(`JSON.parse(localStorage.getItem('boite.experiments'))`)).toEqual(['whip']);
    await capture(`release-settings-${name}.png`);
    await page.evaluate(`localStorage.removeItem('boite.experiments'); localStorage.removeItem('boite.experiments.build')`);
  }, 60000);

  test(`${name}: Mochis are in the ${name === 'desktop' ? 'app rail' : 'bottom bar'} on a fresh profile`, async () => {
    await open('&agents=1', size);
    expect(await page.evaluate(`localStorage.getItem('boite.experiments')`)).toBeNull();
    // A phone opens on the conversation: its bar is on the list.
    if (name === 'phone') await toMobileList(page);
    await page.waitFor(`document.querySelector('${name === 'desktop' ? '[data-testid="app-rail"] [data-testid="rail-add"]' : '[data-testid="mobile-tabs"] [data-testid="mobile-agents"]'}')?.getBoundingClientRect().width > 0`);
    await capture(`bots-launcher-${name}.png`);
  }, 60000);
}
