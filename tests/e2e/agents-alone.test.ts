import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { mobileAction } from './lib/mobile.ts';
import { startUi } from './lib/ui.ts';

const ARTIFACTS = join(import.meta.dir, '.artifacts', 'agents-alone');
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const id = (name: string) => `[data-testid="${name}"]`;

let page: BrowserPage;
let server: { close(): Promise<void> };
beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const port = await freePort();
  server = await startUi(port);
  // `agents=closed`: the two settings as a new install holds them.
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&agents=closed` });
  await page.waitFor(`document.querySelector('${id('nav-settings')}, ${id('mobile-tabs')}')`);
}, 60000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function capture(name: string) {
  await page.settleAnimations();
  expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
  await page.screenshot(join(ARTIFACTS, name));
}
const card = id('settings-agents-alone');
const show = () => page.evaluate(`document.querySelector('${card}').scrollIntoView({ block: 'center' })`);

test('an agent asking for a mochi draws a card with its name, role, projects, model and the full access line; Approve creates it', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', DESKTOP);
  const DOCKED = `${id('activity-question')} ${id('bot-request-card')}[data-state="pending"]`;
  const threadId = await page.evaluate(`(async () => {
    const store = window.__boiteTest.workspace.active;
    const thread = await store.client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo' });
    await window.__boiteTest.workspace.select(store, thread.id);
    await store.client.call('turns.start', { threadId: thread.id, prompt: 'set up a mochi for my notes' });
    await store.client.call('agents.create', { threadId: thread.id, name: 'Scribe', domain: 'Keeps the notes in order', projects: ['notes'] });
    return thread.id;
  })()`) as string;
  await page.waitFor(`document.querySelector('${DOCKED}')?.getBoundingClientRect().width > 0`);
  expect(await page.text(`${DOCKED} ${id('bot-request-name')}`)).toBe('Scribe');
  expect(await page.text(`${DOCKED} ${id('bot-request-role')}`)).toBe('Keeps the notes in order');
  expect(await page.text(`${DOCKED} ${id('bot-request-access')}`)).toBe('This mochi runs with full access to this machine.');
  await capture('bot-card-desktop.png');

  await page.send('Emulation.setDeviceMetricsOverride', PHONE);
  await page.evaluate(`window.__boiteTest.workspace.select(window.__boiteTest.workspace.active, ${JSON.stringify(threadId)})`);
  await page.waitFor(`(() => { const box = document.querySelector('${DOCKED}')?.getBoundingClientRect(); return box && box.width > 0 && box.left >= 0 && box.right <= innerWidth && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('[data-testid="bot-request-card"]') !== null; })()`);
  expect(await page.evaluate(`(() => { const box = document.querySelector('${DOCKED}').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })()`)).toBe(true);
  await capture('bot-card-phone.png');
  await page.send('Emulation.setDeviceMetricsOverride', DESKTOP);

  await page.waitFor(`document.querySelector('${DOCKED} ${id('bot-request-approve')}')?.getBoundingClientRect().width > 0`);
  await page.click(`${DOCKED} ${id('bot-request-approve')}`);
  await page.waitFor(`document.querySelector('${id('bot-request-card')}[data-outcome="applied"]')`);
  expect(await page.evaluate(`window.__boiteTest.workspace.active.client.call('agents.snapshot', {}).then(s => s.profiles.some(p => p.name === 'Scribe'))`)).toBe(true);
  await capture('bot-card-approved-desktop.png');
}, 120_000);

test('a new install shows the reach on This project and mochi creation off; each step explains itself, desktop and phone', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', DESKTOP);
  await page.click(id('nav-settings'));
  await page.click(id('settings-tab-general'));
  await page.waitFor(`document.querySelector('${card}')`);
  expect(await page.text(`${card} h2`)).toContain('What agents may do alone');
  expect(await page.evaluate(`document.querySelector('${id('coordination-reach-project')}').getAttribute('aria-pressed')`)).toBe('true');
  expect(await page.text(id('coordination-reach-effect'))).toContain('its own project only');
  expect(await page.evaluate(`document.querySelector('${id('setting-agent-bot-creation')}').checked`)).toBe(false);
  expect(await page.text(card)).toContain('A mochi created this way has full access to this machine');
  await show();
  await capture('settings-desktop-closed.png');

  await page.click(id('coordination-reach-group'));
  await page.waitFor(`document.querySelector('${id('coordination-reach-effect')}').textContent.includes('machines you trust')`);
  await page.click(id('setting-agent-bot-creation'));
  await page.waitFor(`document.querySelector('${id('setting-agent-bot-creation')}').checked`);
  await capture('settings-desktop-open.png');
  // Back to closed for what follows.
  await page.click(id('coordination-reach-project'));
  await page.click(id('setting-agent-bot-creation'));
  await page.waitFor(`!document.querySelector('${id('setting-agent-bot-creation')}').checked`);

  await page.send('Emulation.setDeviceMetricsOverride', PHONE);
  await mobileAction(page, 'mobile-settings');
  await page.waitFor(`document.querySelector('${id('settings-tab-general')}')`);
  await page.click(id('settings-tab-general'));
  await page.waitFor(`document.querySelector('${id('mobile-settings-conversations')}')`);
  await page.click(id('mobile-settings-conversations'));
  await page.waitFor(`document.querySelector('${card}')`);
  await show();
  // The three steps stay inside the card's own padding.
  expect(await page.evaluate(`(() => { const box = document.querySelector('${card}').getBoundingClientRect(); const steps = document.querySelector('${id('setting-coordination-reach')}').getBoundingClientRect(); const last = document.querySelector('${id('coordination-reach-group')}'); return box.left >= 0 && box.right <= innerWidth && steps.left >= box.left + 8 && steps.right <= box.right - 8 && last.scrollWidth <= last.clientWidth; })()`)).toBe(true);
  await capture('settings-phone-closed.png');
  await page.send('Emulation.setDeviceMetricsOverride', DESKTOP);
}, 120_000);
