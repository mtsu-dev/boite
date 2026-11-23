import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startDevUi } from './lib/ui.ts';

// `team=1` seeds a running workflow and its subagents on `t-trace`: the
// "Waiting on" line that counts and names them stands above the composer card, outside
// it, and the band of tasks floats inside the card.
let server: { close(): Promise<void> };
let page: BrowserPage;
const id = (name: string) => `[data-testid="${name}"]`;
async function size(phone: boolean) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: phone ? 390 : 1280, height: phone ? 844 : 900, deviceScaleFactor: 1, mobile: phone
  });
  await page.waitFor(`innerWidth === ${phone ? 390 : 1280}`);
}
async function settle() {
  // Each animation is awaited until its own end. One whose subtree turns `content-visibility: hidden` before it ends
  // (a fold closing over its rows, the phone's covered page) stops updating: Chrome never settles its `finished` and
  // drops it from getAnimations(), so the wait stops at the end time the animation declared, plus two frames.
  await page.evaluate(`Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => Promise.race([
    a.finished.catch(() => {}),
    new Promise(resolve => setTimeout(resolve, Math.max(0, (a.effect.getComputedTiming().endTime - (a.currentTime ?? 0)) / Math.abs(a.playbackRate || 1)) + 34)),
  ]))])`);
  // The band measures itself on the next frame; the timeline's reserve follows.
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}
beforeAll(async () => {
  const port = await freePort();
  server = await startDevUi(port);
  // `contactNotice=0`: the demo contact notice would cover the line on a phone once the tasks open.
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&team=1&contactNotice=0` });
  await page.waitFor(`document.querySelector('${id('thread-row')}[data-thread-id="t-trace"]')`);
  await size(false);
}, 60_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

test('subagent rows drop effort and then model as the conversation narrows', async () => {
  await page.evaluate(`globalThis.__boiteTest.workspace.active.open('t-trace')`);
  await page.waitFor(`!!document.querySelector('${id('composer-foot-fold')}')`);
  await page.click(id('composer-foot-fold'));
  const row = `${id('agent-dock-row')}[title="Audit subscription flow"]`;
  await page.waitFor(`!!document.querySelector('${row}')`);
  const read = `(() => {
    const row = document.querySelector('${row}');
    function visibleText(selector) {
      const node = row.querySelector(selector);
      if (!node) return null;
      const bounds = (node.closest('.details') ?? row).getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.top >= bounds.bottom || rect.bottom <= bounds.top) return null;
      if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom) {
        throw new Error('Partially visible text: ' + node.textContent);
      }
      return node.textContent;
    }
    return {
      name: visibleText('.words'), model: visibleText('${id('agent-dock-model')}'),
      effort: visibleText('${id('agent-dock-effort')}'), duration: Boolean(visibleText('.since'))
    };
  })()`;
  const strip = `document.querySelector('${id('composer-strip-lines')}').style`;
  try {
    for (const [width, model, effort] of [[460, 'Sonnet 5.5', 'High'], [355, 'Sonnet 5.5', null], [290, null, null], [460, 'Sonnet 5.5', 'High']] as const) {
      await page.evaluate(`${strip}.maxWidth = '${width}px'`);
      await settle();
      expect(await page.evaluate(read)).toEqual({ name: 'Audit subscription flow', model, effort, duration: true });
    }
  } finally {
    await page.evaluate(`${strip}.maxWidth = ''`);
    await page.click(id('composer-foot-fold'));
  }
}, 30_000);

test('the waiting line stands above the card that holds the task band, folded and open, on desktop and phone', async () => {
  await page.evaluate(`import('/src/lib/store.svelte.ts').then(({store}) => store.open('t-trace'))`);
  await page.waitFor(`document.querySelector('${id('agent-dock')}')?.dataset.runs === '1'`);
  // Enough to scroll, so the last message has to clear the band at the bottom.
  await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.messages.at(-1).parts.push({ type: 'text', text: 'Earlier conversation context.\\n'.repeat(80) })`);
  await page.evaluate(`import('/src/lib/store.svelte.ts').then(({store}) => { store.openThread.activity = {goal:null,loop:null,tasks:[
    {id:'read',text:'Read the review findings',status:'completed'},
    {id:'wait',text:'Wait for the reviewer subagent',status:'in_progress'}
  ]}; })`);
  await page.waitFor(`document.querySelector('${id('activity-tasks-toggle')}')`);
  const layout = `(() => {
    const band = document.querySelector('${id('thread-activity')}').getBoundingClientRect();
    const bar = document.querySelector('${id('agent-dock')}').getBoundingClientRect();
    const covering = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
    const messages = document.querySelectorAll('[data-mid]');
    return { gap: band.top - bar.bottom, barOnTop: !!covering?.closest('${id('agent-dock')}'), lastClear: messages[messages.length - 1].getBoundingClientRect().bottom <= bar.top };
  })()`;
  for (const phone of [false, true]) {
    await size(phone);
    for (const open of [false, true]) {
      if (await page.evaluate(`document.querySelector('${id('activity-tasks-toggle')}').getAttribute('aria-expanded') === 'true'`) !== open) await page.click(id('activity-tasks-toggle'));
      await page.evaluate(`document.querySelector('${id('timeline')}').scrollTop = document.querySelector('${id('timeline')}').scrollHeight`);
      await settle();
      const at = await page.evaluate<{ gap: number; barOnTop: boolean; lastClear: boolean }>(layout);
      await page.screenshot(join(import.meta.dir, '.artifacts', `activity-agent-dock-${open ? 'open' : 'folded'}-${phone ? 'phone' : 'desktop'}.png`));
      expect(at.gap).toBeGreaterThanOrEqual(0);
      expect(at.barOnTop).toBe(true);
      // Open details overlay the timeline by design; the folded band keeps the latest message in view.
      if (!open) expect(at.lastClear).toBe(true);
    }
  }
  // A notice standing in the same column leaves the line above the card.
  await size(false);
  await page.evaluate(`import('/src/lib/store.svelte.ts').then(({store}) => { store.openThread.retry = { kind: 'capacity', turnId: 'turn-retry', at: Date.now() + 600_000, attempt: 1, attempts: 3 }; })`);
  await page.waitFor(`document.querySelector('${id('thread-retry')}')`);
  await settle();
  const withNotice = await page.evaluate<{ gap: number; barOnTop: boolean }>(layout);
  expect(withNotice.gap).toBeGreaterThanOrEqual(0);
  expect(withNotice.barOnTop).toBe(true);
  await page.evaluate(`import('/src/lib/store.svelte.ts').then(({store}) => { store.openThread.retry = null; })`);
  // Queued prompts stand as bubbles under the waiting line, above the card, with nothing to unfold; the band stays inside the card.
  await page.evaluate(`globalThis.__boiteTest.workspace.active.composerStates['t-trace'] = { text: '', attachments: [], queued: [{ text: 'Check the review once the subagent is back', attachments: [] }], paused: true, sending: false }`);
  await page.waitFor(`document.querySelector('${id('composer-queued')}') && document.querySelector('${id('thread-activity')}').offsetHeight > 0`);
  expect(await page.evaluate(`document.querySelector('${id('agent-dock-queued')}') === null`)).toBe(true);
  await settle();
  const stack = await page.evaluate<{ order: boolean; barOnTop: boolean }>(`(() => {
    const [bar, queue, band, composer] = ['${id('agent-dock')}', '${id('composer-queued')}', '${id('thread-activity')}', '${id('composer')}'].map(selector => document.querySelector(selector).getBoundingClientRect());
    const covering = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
    return { order: bar.bottom <= queue.top && queue.bottom <= composer.top && band.top >= composer.top && band.bottom <= composer.bottom, barOnTop: !!covering?.closest('${id('agent-dock')}') };
  })()`);
  await page.screenshot(join(import.meta.dir, '.artifacts', 'activity-agent-dock-queued-desktop.png'));
  expect(stack).toEqual({ order: true, barOnTop: true });
  expect(page.errors()).toEqual([]);
}, 60_000);
