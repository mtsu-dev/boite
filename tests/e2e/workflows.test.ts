import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startDevUi } from './lib/ui.ts';

// The fake client seeds a paused-in-place run on `t-trace` with `team=1`:
// scan done, review fanned out over three files with one done, fix and tests
// side by side after it, report waiting on both.
let server: { close(): Promise<void> };
let page: BrowserPage;
const id = (name: string) => `[data-testid="${name}"]`;
async function capture(name: string) {
  await page.evaluate(`document.fonts.ready`);
  // The panel fades in: wait for the finite animations, not the live dots that pulse forever.
  await page.waitFor(`document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)`);
  await page.screenshot(join(import.meta.dir, '.artifacts', name));
}
beforeAll(async () => {
  const port = await freePort();
  server = await startDevUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&team=1`, windowSize: { width: 1680, height: 1000 } });
  await page.waitFor(`document.querySelector('${id('thread-row')}[data-thread-id="t-trace"]')`);
}, 60_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

test('the chat card opens the run top to bottom, an arrow per dependency, in the panel at its default width', async () => {
  await page.click(`${id('thread-row')}[data-thread-id="t-trace"]`);
  await page.waitFor(`document.querySelector('${id('workflow-activity')}')`);
  expect(await page.text(id('workflow-activity'))).toContain('1/5 steps');
  await page.waitFor(`document.querySelector('${id('active-subagents')}')?.textContent.includes('1 workflow')`);
  // The running subagent, and the one at rest on its own background work.
  expect(await page.text(id('active-subagents'))).toContain('2 active subagents');
  await capture('workflow-card.png');
  await page.click(id('workflow-activity'));
  await page.waitFor(`document.querySelector('${id('workflow-graph')}')?.dataset.layout === 'rows'`);
  await page.waitFor(`document.querySelectorAll('${id('workflow-edge')}').length === 5`);
  expect(await page.evaluate(`[...document.querySelectorAll('${id('workflow-node')}')].map(node => node.dataset.status)`)).toEqual(['done', 'running', 'waiting', 'waiting', 'waiting']);
  expect(await page.text('[data-node-id="review"] [data-testid="workflow-effort"]')).toBe('High');
  expect(await page.text('[data-node-id="review"] [data-testid="workflow-node-tokens"]')).toBe('4.3K tokens');
  expect(await page.text(id('workflow-meta'))).toContain('8.6K tokens');
  // Each phase sits under the one before it.
  expect(await page.evaluate(`[...document.querySelectorAll('${id('workflow-phase')}')].every((phase, i, all) => i === 0 || phase.getBoundingClientRect().top >= all[i - 1].getBoundingClientRect().bottom)`)).toBe(true);
  await capture('workflow-rows.png');
  await page.evaluate(`localStorage.setItem('boite:right-panel-width', '900')`);
  await page.reload();
  await page.waitFor(`document.querySelector('${id('thread-row')}[data-thread-id="t-trace"]')`);
  await page.click(`${id('thread-row')}[data-thread-id="t-trace"]`);
  await page.waitFor(`document.querySelector('${id('workflow-activity')}')`);
  await page.click(id('workflow-activity'));
  await page.waitFor(`document.querySelectorAll('${id('workflow-edge')}').length === 5`);
  await capture('workflow-rows-wide.png');
  await page.evaluate(`document.querySelectorAll('${id('workflow-node')}')[1].click()`);
  await page.waitFor(`document.querySelectorAll('${id('workflow-instance')}').length === 3`);
  await page.waitFor(`document.querySelector('${id('workflow-output')}') || document.querySelector('${id('workflow-open-thread')}')`);
  await capture('workflow-step.png');
  await page.click(id('workflow-back'));
  expect(page.errors()).toEqual([]);
}, 40_000);

test('on a phone the same run keeps its rows and arrows without scrolling sideways', async () => {
  // Opened here too, so the test holds when it runs alone.
  await page.click(`${id('thread-row')}[data-thread-id="t-trace"]`);
  await page.waitFor(`document.querySelector('${id('workflow-activity')}')`);
  await page.click(id('workflow-activity'));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.waitFor(`document.querySelector('${id('workflow-graph')}')?.dataset.layout === 'rows'`);
  await page.waitFor(`document.querySelectorAll('${id('workflow-edge')}').length === 5`);
  expect(await page.evaluate(`document.querySelectorAll('${id('workflow-phase')}').length`)).toBe(4);
  // The arrows once drawn for the wide panel must not hold the graph at that width.
  expect(await page.evaluate(`(g => g.scrollWidth <= g.clientWidth)(document.querySelector('${id('workflow-graph')}'))`)).toBe(true);
  expect(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`)).toBe(true);
  expect(await page.text('[data-node-id="review"] [data-testid="workflow-effort"]')).toBe('High');
  expect(await page.text(id('workflow-meta'))).toContain('8.6K tokens');
  await capture('workflow-phone.png');
  expect(page.errors()).toEqual([]);
}, 30_000);

test('a loop draws its arc from the closing step back to the first, live while its second round runs', async () => {
  await page.send('Emulation.clearDeviceMetricsOverride', {});
  // At the panel's default width, where two steps side by side leave the arc the least room.
  await page.evaluate(`localStorage.removeItem('boite:right-panel-width')`);
  await page.navigate(`${new URL(await page.evaluate<string>('location.href')).origin}/?fake=1&team=1&loop=1`);
  await page.waitFor(`document.querySelector('${id('thread-row')}[data-thread-id="t-trace"]')`);
  await page.click(`${id('thread-row')}[data-thread-id="t-trace"]`);
  await page.waitFor(`document.querySelector('${id('workflow-activity')}')`);
  await page.click(id('workflow-activity'));
  await page.waitFor(`document.querySelector('${id('workflow-graph')}')?.dataset.layout === 'rows' && document.querySelector('${id('workflow-loop')}')`);
  expect(await page.evaluate(`document.querySelector('${id('workflow-loop')}').dataset.state`)).toBe('live');
  expect(await page.text('[data-node-id="review"] [data-testid="workflow-round"]')).toBe('2/3');
  // The arc runs right of every card it passes, inside the graph.
  expect(await page.evaluate(`(() => {
    const arc = document.querySelector('${id('workflow-loop')}').getBoundingClientRect();
    const cards = ['tests', 'fix', 'review'].map(id => document.querySelector('${id('workflow-node')}[data-node-id="' + id + '"]').getBoundingClientRect());
    const graph = document.querySelector('${id('workflow-graph')}');
    return arc.right > Math.max(...cards.map(c => c.right)) && arc.right <= graph.getBoundingClientRect().right && graph.scrollWidth <= graph.clientWidth;
  })()`)).toBe(true);
  await capture('workflow-loop.png');
  // The closing step waits on its second round: its detail says where the loop goes back to and until what.
  await page.evaluate(`document.querySelector('${id('workflow-node')}[data-node-id="review"]').click()`);
  await page.waitFor(`document.querySelector('${id('workflow-detail-round')}')`);
  expect(await page.text(id('workflow-detail'))).toContain('Repeats from Fix the lexer until review.verdict = "APPROVE", 3 rounds at most');
  expect(await page.text(id('workflow-detail-round'))).toBe('Round 2 of 3');
  await capture('workflow-loop-step.png');
  await page.click(id('workflow-back'));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.waitFor(`document.querySelector('${id('workflow-loop')}')`);
  expect(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`)).toBe(true);
  await capture('workflow-loop-phone.png');
  expect(page.errors()).toEqual([]);
}, 40_000);
