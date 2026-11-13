import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';
import { openRailBot } from './lib/bots.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
const id = (name: string) => `[data-testid="${name}"]`;
const visible = (name: string) => `document.querySelector('${id(name)}')?.checkVisibility()`;
/** Shown in one place or another: the work list is drawn in the bot column and, when that column is away, in the desk. */
const shownAnywhere = (name: string, within = '') => `[...document.querySelectorAll('${within} ${id(name)}')].some(node => node.checkVisibility())`;
const capture = async (name: string) => {
  await page.settleAnimations();
  await page.screenshot(join(import.meta.dir, '.artifacts', `bot-desk-${name}.png`));
};

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&agents=1`, windowSize: { width: 1440, height: 900 } });
  await page.waitFor(`window.__boiteTest?.workspace.active.connection === 'ready'`);
  const agentId = await page.evaluate<string>(`(async () => {
    window.__boiteTest.setTheme('dark');
    const store = window.__boiteTest.workspace.active;
    const nova = (await store.client.call('agents.snapshot', {})).profiles.find(p => p.name === 'Nova');
    store.showAgents();
    return nova.id;
  })()`);
  await openRailBot(page, agentId, 30_000);
  await page.waitFor(shownAnywhere('desk-work'));
}, 120_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 60_000);

test('the bot desk shows who it is, Now, routines and memory in one column without overflowing on desktop or phone', async () => {
  for (const width of [1440, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    // A first visit on a wide window opens the desk by itself: read its state once the panel has settled,
    // so the click never closes a desk that is still sliding in. Closed, the header's door opens it;
    // open, its tab is the selected one (a phone panel's own head names it).
    await page.waitFor(`document.querySelector('${id('agent-desk-toggle')}') || document.querySelector('${id('agent-desk')}')`);
    await page.settleAnimations();
    if (!await page.evaluate(visible('agent-desk'))) await page.click(id('agent-desk-toggle'));
    await page.waitFor(`${visible('agent-desk')} && ([...document.querySelectorAll('${id('panel-title')}')].some(name => name.checkVisibility() && name.textContent.trim() === 'Desk') || !!document.querySelector('${id('panel-tab')}[data-kind=desk][aria-selected=true]'))`);
    await page.settleAnimations();
    // One column, no tabs: who it is, then its routines and memory.
    for (const part of ['desk-ident', 'desk-schedule', 'desk-memory']) expect(await page.evaluate(visible(part))).toBe(true);
    // The threads it handles: in the Bots page's column on a desktop, which stays beside the desk; in the desk on a phone.
    await page.waitFor(shownAnywhere('desk-work'));
    const columnShown = width !== 390 && await page.evaluate<boolean>(`getComputedStyle(document.querySelector('.agents-rail')).display !== 'none'`);
    expect(columnShown).toBe(width !== 390);
    expect(await page.evaluate(shownAnywhere('desk-work', id(columnShown ? 'bot-column' : 'agent-desk')))).toBe(true);
    expect(await page.evaluate(shownAnywhere('bot-handling'))).toBe(true);
    expect(await page.evaluate(`document.querySelector('${id('agent-desk')} [role=tab]')`)).toBeNull();
    // Now, with the steps of the running turn folded under it, is drawn where no conversation beside the desk says it:
    // on a phone. A desktop keeps the bot's conversation and column beside the desk, so its desk has no Now card.
    expect(await page.evaluate(`!!document.querySelector('${id('desk-now')}')`)).toBe(!columnShown);
    expect(await page.evaluate(`!!document.querySelector('${id('desk-steps')}')`)).toBe(!columnShown);
    if (!columnShown) expect(await page.evaluate(visible('desk-steps'))).toBe(false);
    await capture(`desk-${width}`);
    // The desk and every card stay inside the panel, including their text. The cards are flat sections now:
    // a row's hover ground and a head's icon bleed past a card's text edge on purpose (one inset for the desk),
    // so each card's box is measured against the desk's, and its titles, notes and Now line must not overflow.
    const layout = await page.evaluate<{ inside: boolean; overflow: number; cards: number[] }>(`(() => {
      const desk = document.querySelector('${id('agent-desk')}');
      const box = desk.getBoundingClientRect();
      const left = box.left + desk.clientLeft, right = left + desk.clientWidth;
      const past = card => { const r = card.getBoundingClientRect();
        return Math.max(r.right - right, left - r.left, ...[...card.querySelectorAll('.desk-card-title, .desk-notes li, .desk-now-line')].map(node => node.scrollWidth - node.clientWidth)); };
      return { inside: box.width > 0 && box.left >= 0 && box.right <= innerWidth + 1,
        overflow: desk.scrollWidth - desk.clientWidth,
        cards: [...desk.querySelectorAll('.desk-card')].map(card => Math.ceil(past(card))) };
    })()`);
    expect(layout.inside).toBe(true);
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.cards.length).toBeGreaterThan(1);
    expect(layout.cards.filter(overflow => overflow > 0)).toEqual([]);

    if (columnShown) continue;
    await page.click(`${id('desk-activity')} > summary`);
    await page.waitFor(visible('desk-steps'));
    await capture(`desk-steps-${width}`);
    await page.click(`${id('desk-activity')} > summary`);
    await page.waitFor(`!(${visible('desk-steps')})`);
  }
}, 60_000);
