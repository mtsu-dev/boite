import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';
import { railBot } from './lib/bots.ts';

let page: BrowserPage;
let server: { close(): Promise<void> };
beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1`, experiments: ['resident-agents'] });
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready'`);
}, 60000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function capture(name: string) {
  await page.evaluate(`Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])`);
  await page.screenshot(join(import.meta.dir, '.artifacts', name));
}

test('an agent entrusted with a project shows on its threads, and opens its conversation', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // The first agent looks after boite: "Looked after by" on a thread there. The project's header no longer carries its robot.
  const ids = await page.evaluate(`(async () => {
    const store = window.__boiteTest.workspace.active;
    const first = (await store.client.call('agents.snapshot', {})).profiles.find(agent => agent.status === 'active');
    const agent = first?.projectIds?.includes('p-boite') ? first
      : await store.client.call('agents.profile.save', { value: first ? { ...first, projectIds: [...(first.projectIds ?? []), 'p-boite'] }
        : { name: 'Mira', domain: 'Looks after boite', instructions: '', avatar: '', status: 'active', projectIds: ['p-boite'],
          selection: { providerId: 'claude', accountId: 'a-claude-main', model: null, effort: null, permissionMode: 'default' } } });
    const thread = store.threads.find(t => t.projectId === 'p-boite' && !t.archived && !t.agentSessionId && !t.parentThreadId);
    await window.__boiteTest.workspace.select(store, thread.id);
    return { agent: agent.id, name: agent.name, thread: thread.id };
  })()`) as { agent: string; name: string; thread: string };
  // The header no longer carries a chip: the bot heads the title menu's named group, its row keeping the chip's id.
  const menu = '[data-testid="thread-menu-trigger-menu"]';
  const chip = `${menu} [data-value="thread-resident-chip"]`;
  const openGroup = async () => {
    await page.waitFor(`document.querySelector('[data-testid="thread-menu-trigger"]')?.getBoundingClientRect().width > 0`);
    await page.click('[data-testid="thread-menu-trigger"]');
    await page.waitFor(`document.querySelector('${menu} [data-value="more"]')`);
    await page.click(`${menu} [data-value="more"]`);
    await page.waitFor(`document.querySelector('${chip}')?.getBoundingClientRect().width > 0`);
  };
  const closeMenu = async () => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.waitFor(`!document.querySelector('${menu}')`);
  };
  // The menu lists the bots the directory read when it opened: wait for its reread after the save, which draws the bot's rail pin.
  await page.waitFor(`document.querySelector('${railBot(ids.agent)}')`, 10_000);
  await openGroup();
  // The row shows what it does, with the bot's name; the sentence stays in its tooltip.
  expect(await page.evaluate(`document.querySelector('${chip}').title`)).toBe(`Looked after by ${ids.name}`);
  expect((await page.text(chip)).trim()).toBe(`Open ${ids.name}`);
  await capture('resident-agent-desktop.png');
  await closeMenu();

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openGroup();
  await capture('resident-agent-header-phone.png');
  expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
  await closeMenu();

  // The row opens the agent's conversation on the Agents page.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await openGroup();
  await page.click(chip);
  await page.waitFor(`window.__boiteTest.workspace.active.page === 'agents' && document.querySelector('[data-testid="agent-header"]')?.textContent.includes(${JSON.stringify(ids.name)})`);
}, 60000);
