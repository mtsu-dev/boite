import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
const id = (name: string) => `[data-testid="${name}"]`;

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&machines=1&agents=1`, windowSize: { width: 1440, height: 1000 } });
}, 60_000);

afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

test('bot settings save local and remote projects separately on desktop and phone', async () => {
  await page.waitFor(`window.__boiteTest?.workspace.machines.length === 2 && window.__boiteTest.workspace.primary.group?.cores.length === 2`);
  const grant = await page.evaluate<string>(`(async () => {
    window.__boiteTest.setTheme('dark');
    const w = window.__boiteTest.workspace;
    const host = w.machines.find(m => m.store === w.primary), remote = w.machines.find(m => m.store !== w.primary);
    host.label = 'Workstation'; remote.label = 'Build server';
    await remote.store.saveSettings({ groupBots: true });
    const snapshot = await host.store.client.call('agents.snapshot', {});
    const bot = snapshot.profiles.find(p => p.name === 'Mira');
    window.__projectBot = bot.id;
    w.showAgents(host.store, bot.id, 'settings');
    return remote.store.group.self + '/' + host.store.projects.find(p => p.kind !== 'drafts').id;
  })()`);
  const remote = id(`agent-project-${grant}`);
  const local = id(`agent-project-${grant.slice(grant.indexOf('/') + 1)}`);
  await page.waitFor(`document.querySelector('${remote}') && document.querySelector('${local}')?.checked`);
  await page.click(remote);
  const saved = `(async () => {
    const snapshot = await window.__boiteTest.workspace.primary.client.call('agents.snapshot', {});
    return snapshot.profiles.find(p => p.id === window.__projectBot).projectIds;
  })()`;
  await page.waitFor(`(async () => (await ${saved}).includes(${JSON.stringify(grant)}))()`);
  expect(await page.evaluate<string[]>(saved)).toEqual([grant.slice(grant.indexOf('/') + 1), grant]);
  await page.settleAnimations();
  await page.screenshot(join(import.meta.dir, '.artifacts', 'bot-projects-desktop.png'));

  // Permission is the destination's and reacts while the form remains open.
  await page.evaluate(`window.__boiteTest.workspace.machines.find(m => m.store !== window.__boiteTest.workspace.primary).store.saveSettings({ groupBots: false })`);
  await page.waitFor(`document.querySelector('${id('agent-project-machine-fake-builder')}')?.textContent.includes('Bots from the other machines')`);
  expect(await page.evaluate(`document.querySelector('${remote}').checked && !document.querySelector('${remote}').disabled`)).toBe(true);
  await page.click(remote);
  await page.waitFor(`document.querySelector('${remote}')?.disabled`);
  await page.waitFor(`(async () => !(await ${saved}).includes(${JSON.stringify(grant)}))()`);
  await page.evaluate(`window.__boiteTest.workspace.machines.find(m => m.store !== window.__boiteTest.workspace.primary).store.saveSettings({ groupBots: true })`);
  await page.waitFor(`!document.querySelector('${remote}').disabled`);

  // The desk open beside the settings closes (its door names it while it shows; the panel's close shuts it),
  // so the phone shows the settings and not the desk's panel over them.
  await page.waitFor(`document.querySelector('${id('agent-desk')}')`);
  await page.click(`${id('right-panel')} ${id('panel-close')}`);
  await page.waitFor(`!document.querySelector('${id('agent-desk')}')`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.click(remote);
  await page.waitFor(`(async () => (await ${saved}).includes(${JSON.stringify(grant)}))()`);
  await page.evaluate(`document.querySelector('${id('agent-projects')}').scrollIntoView({ block: 'center' })`);
  await page.settleAnimations();
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  const bounds = await page.evaluate<{ right: number; left: number }>(`(() => { const r = document.querySelector('${remote}').getBoundingClientRect(); return { left: r.left, right: r.right }; })()`);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  expect(await page.evaluate(`(() => { const e = document.querySelector('${remote}'), r = e.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; })()`)).toBe(true);
  await page.screenshot(join(import.meta.dir, '.artifacts', 'bot-projects-phone.png'));
}, 30_000);
