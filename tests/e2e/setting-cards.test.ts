import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

const ARTIFACTS = join(import.meta.dir, '.artifacts', 'setting-cards');
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };

let page: BrowserPage;
let server: { close(): Promise<void> };
beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1`, experiments: [] });
  await page.evaluate(`localStorage.setItem('boite.locale', 'fr')`);
  await page.navigate(`http://127.0.0.1:${port}/?fake=1`);
  await page.waitFor(`document.documentElement.lang === 'fr' && window.__boiteTest?.workspace.active.connection === 'ready'`);
}, 60000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function capture(name: string) {
  await page.settleAnimations();
  await page.screenshot(join(ARTIFACTS, name));
}

const DOCKED = '[data-testid="activity-question"] [data-testid="setting-card"][data-state="pending"]';

test('an agent reads the app\'s language and no experiment, and a sensitive card shows its switch in the chat', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', DESKTOP);
  const thread = await page.evaluate(`(async () => {
    const store = window.__boiteTest.workspace.active;
    const thread = await store.client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo' });
    await window.__boiteTest.workspace.select(store, thread.id);
    return thread.id;
  })()`) as string;
  // What \`boite settings\` reads: French, and no experiment, since every feature is finished.
  const read = await page.evaluate(`window.__boiteTest.workspace.active.client.call('agent.settings', { threadId: ${JSON.stringify(thread)} })`) as { app: { language: string }; settings: { key: string; value: unknown; label?: string }[] };
  expect(read.app.language).toBe('fr');
  // A finished feature is on in every build: it is not a setting an agent reads or asks for.
  expect(read.settings.filter(reading => reading.key.startsWith('experiment'))).toEqual([]);
  expect(read.settings.find(reading => reading.key === 'experiments')).toBeUndefined();

  // A sensitive switch shows in the card too, beside its warning, once the agent has read the card's report.
  await page.waitFor(`window.__boiteTest.workspace.active.openThread.status === 'idle'`);
  await page.evaluate(`window.__boiteTest.workspace.active.client.call('turns.start', { threadId: ${JSON.stringify(thread)}, prompt: 'pair my phone [settings-lan]' })`);
  await page.waitFor(`document.querySelector('${DOCKED} [data-testid="setting-sensitive-hint"]') && document.querySelector('${DOCKED} [data-testid="setting-switch"]')`);
  await capture('sensitive-desktop.png');
}, 60000);
