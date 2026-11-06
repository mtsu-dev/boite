import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';
import { openRailBot } from './lib/bots.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
const id = (name: string) => `[data-testid="${name}"]`;
const visible = (name: string) => `document.querySelector('${id(name)}')?.checkVisibility()`;
const capture = async (name: string) => {
  await page.settleAnimations();
  await page.screenshot(join(import.meta.dir, '.artifacts', `bot-desk-${name}.png`));
};

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&agents=1`, experiments: ['resident-agents'], windowSize: { width: 1440, height: 900 } });
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready'`);
  const agentId = await page.evaluate<string>(`(async () => {
    window.__boiteTest.setTheme('dark');
    const store = window.__boiteTest.workspace.active;
    const nova = (await store.client.call('agents.snapshot', {})).profiles.find(p => p.name === 'Nova');
    store.showAgents();
    return nova.id;
  })()`);
  await openRailBot(page, agentId, 30_000);
  await page.waitFor(visible('desk-work'));
}, 120_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 60_000);

test('the bot desk shows who it is, Now, routines and memory in one column without overflowing on desktop or phone', async () => {
  for (const width of [1440, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    // A first visit on a wide window opens the desk by itself: read the toggle's state once the
    // panel has settled, so the click never closes a desk that is still sliding in.
    await page.waitFor(`document.querySelector('${id('agent-desk-toggle')}')`);
    await page.settleAnimations();
    if (await page.evaluate(`document.querySelector('${id('agent-desk-toggle')}').getAttribute('aria-pressed')`) !== 'true') await page.click(id('agent-desk-toggle'));
    await page.waitFor(`document.querySelector('${id('agent-desk-toggle')}')?.getAttribute('aria-pressed') === 'true' && ${visible('agent-desk')}`);
    await page.settleAnimations();
    // One column, no tabs: who it is, then its routines and memory.
    for (const part of ['desk-ident', 'desk-schedule', 'desk-memory']) expect(await page.evaluate(visible(part))).toBe(true);
    // The threads it handles: in the Bots page's column on a desktop, in the desk on a phone.
    await page.waitFor(visible('desk-work'));
    expect(await page.evaluate(`!!document.querySelector('${id(width === 390 ? 'agent-desk' : 'bot-column')} ${id('desk-work')}')`)).toBe(true);
    expect(await page.evaluate(visible('bot-handling'))).toBe(true);
    expect(await page.evaluate(`document.querySelector('${id('agent-desk')} [role=tab]')`)).toBeNull();
    expect(await page.evaluate(visible('desk-steps'))).toBe(false);
    await capture(`desk-${width}`);
    // The desk and every card stay inside the panel, including their text.
    const layout = await page.evaluate<{ inside: boolean; overflow: number; cards: number[] }>(`(() => {
      const desk = document.querySelector('${id('agent-desk')}');
      const box = desk.getBoundingClientRect();
      return { inside: box.width > 0 && box.left >= 0 && box.right <= innerWidth + 1,
        overflow: desk.scrollWidth - desk.clientWidth,
        cards: [...desk.querySelectorAll('.desk-card')].map(card => card.scrollWidth - card.clientWidth) };
    })()`);
    expect(layout.inside).toBe(true);
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.cards.length).toBeGreaterThan(1);
    expect(layout.cards.every(overflow => overflow <= 0)).toBe(true);

    await page.click(`${id('desk-activity')} > summary`);
    await page.waitFor(visible('desk-steps'));
    await capture(`desk-steps-${width}`);
    await page.click(`${id('desk-activity')} > summary`);
    await page.waitFor(`!(${visible('desk-steps')})`);
  }
}, 60_000);
