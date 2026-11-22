import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startUi } from './lib/ui';

/** What the timeline ends on: its last message, or the closing line under a finished turn. */
const LAST = `'[data-testid="message"], [data-testid="thread-closing"]'`;

/**
 * Resize to `width` can lazily mount `MobileNavigation`'s header (61 px) after
 * `setDeviceMetricsOverride` returns, shifting `.timeline` down until its
 * `ResizeObserver` follows before the next paint. Wait for the viewport size,
 * that header's state, animations, and two animation frames after scrolling so
 * rects are read on a settled frame.
 */
async function scrollToSettledBottom(page: BrowserPage, width: number, height: number): Promise<void> {
  const headerReady = width === 390
    ? `(document.querySelector('[data-testid="mobile-header"]')?.offsetHeight ?? 0) > 0`
    : `(document.querySelector('[data-testid="mobile-header"]')?.offsetHeight ?? 0) === 0`;
  await page.waitFor(`innerWidth === ${width} && innerHeight === ${height} && ${headerReady}`);
  await page.settleAnimations();
  await page.evaluate(`new Promise((resolve) => {
    const timeline = document.querySelector('[data-testid="timeline"]');
    timeline.scrollTop = timeline.scrollHeight;
    // Give the virtual list a rendered frame to apply its measured row heights.
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
}

test('queued prompts sit above the activity dock attached to the input', async () => {
  const port = await freePort();
  const server = await startUi(port);
  let page: BrowserPage | undefined;
  try {
    page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1&contactNotice=0`, windowSize: { width: 1300, height: 850 } });
    await page.click('[data-thread-id="t-trace"]');
    await page.waitFor(`globalThis.__boiteTest.workspace.active.openThread?.id === 't-trace'`);
    await page.evaluate(`(() => {
      const store = globalThis.__boiteTest.workspace.active;
      store.openThread.activity = null;
      store.composerStates['t-trace'] = { text: '', attachments: [], queued: [
        { text: 'First follow-up waiting for the current reply', attachments: [] },
        { text: 'Second follow-up', attachments: [] }
      ], paused: true, sending: false };
    })()`);
    await page.waitFor(`document.querySelector('[data-testid="composer-queued"]')`);
    // Answers lost their bubbles in the redesign: at 850 px the history no longer fills the list,
    // and the gap would measure the empty room under it, so the window is short enough to overflow.
    const HISTORY_FULL = 640;
    for (const width of [1300, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: HISTORY_FULL, deviceScaleFactor: 1, mobile: width === 390 });
      await scrollToSettledBottom(page, width, HISTORY_FULL);
      await page.screenshot(join(import.meta.dir, '.artifacts', `queued-spacing-${process.env.BOITE_QUEUE_CAPTURE ?? 'after'}-${width}.png`));
      const gap = await page.evaluate<number>(`(() => {
        const last = [...document.querySelectorAll(${LAST})].at(-1);
        return document.querySelector('[data-testid="composer-queued"]').getBoundingClientRect().top - last.getBoundingClientRect().bottom;
      })()`);
      expect(gap).toBeGreaterThanOrEqual(16);
      expect(gap).toBeLessThanOrEqual(40);
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    }
    // Going out, the queue has no Send now: its foot keeps the button's height so
    // the label's ink room does not overflow the list into a scrollbar, and a
    // long prompt's bubble shows three whole lines, not a sliver of the next.
    await page.evaluate(`(() => {
      const state = globalThis.__boiteTest.workspace.active.composerStates['t-trace'];
      state.queued[0].text = 'A follow-up long enough to need more than three lines in the bubble. '.repeat(8);
      state.sending = true;
    })()`);
    await page.waitFor(`!document.querySelector('[data-testid="composer-send-now"]')`);
    for (const width of [1300, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width === 390 });
      const fit = await page.evaluate<{ overflow: number; lines: number }>(`(() => {
        const queue = document.querySelector('[data-testid="composer-queued"]');
        // clientHeight is whole pixels: a tenth of a line is rounding, a sliver is more.
        const text = queue.querySelector('.queued-text');
        return { overflow: queue.scrollHeight - queue.clientHeight, lines: Math.round(text.clientHeight / parseFloat(getComputedStyle(text).lineHeight) * 10) / 10 };
      })()`);
      expect(fit).toEqual({ overflow: 0, lines: 3 });
    }
    await page.evaluate(`globalThis.__boiteTest.workspace.active.composerStates['t-trace'].sending = false`);
    await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.activity = { goal: null, loop: null, tasks: [{ id: 'work', text: 'Keep the latest answer visible', status: 'in_progress' }] }`);
    for (const width of [1300, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: HISTORY_FULL, deviceScaleFactor: 1, mobile: width === 390 });
      // The dock is the composer card's top row: the queue above the card clears it without a lift of its own.
      await page.waitFor(`(() => { const dock = document.querySelector('[data-testid="thread-activity"]'); return dock?.offsetHeight > 0 && dock.closest('[data-testid="composer"]') !== null; })()`);
      await scrollToSettledBottom(page, width, HISTORY_FULL);
      const gap = await page.evaluate<number>(`document.querySelector('[data-testid="composer-queued"]').getBoundingClientRect().top - [...document.querySelectorAll(${LAST})].at(-1).getBoundingClientRect().bottom`);
      expect(gap).toBeGreaterThanOrEqual(12);
      expect(gap).toBeLessThanOrEqual(40);
      await page.screenshot(join(import.meta.dir, '.artifacts', `queued-spacing-dock-${process.env.BOITE_QUEUE_CAPTURE ?? 'after'}-${width}.png`));
      const placement = await page.evaluate<{ gap: number; queueBottom: number; dockTop: number }>(`(() => {
        const dock = document.querySelector('[data-testid="thread-activity"]').getBoundingClientRect();
        const composer = document.querySelector('[data-testid="composer"]').getBoundingClientRect();
        return { gap: dock.top - composer.top, queueBottom: document.querySelector('[data-testid="composer-queued"]').getBoundingClientRect().bottom, dockTop: dock.top };
      })()`);
      expect(placement.gap).toBeGreaterThanOrEqual(0);
      expect(placement.gap).toBeLessThanOrEqual(4);
      expect(placement.queueBottom).toBeLessThanOrEqual(placement.dockTop);
      await page.click('[data-testid="activity-tasks-toggle"]');
      await page.settleAnimations();
      await page.waitFor(`document.querySelector('[data-testid="composer-queued"]').getBoundingClientRect().bottom <= document.querySelector('[data-testid="thread-activity"]').getBoundingClientRect().top`);
      await page.click('[data-testid="activity-tasks-toggle"]');
      await page.settleAnimations();
    }
    // A short pinned history starts at zero, but a new dock can make it overflow.
    await page.evaluate(`(() => {
      const store = globalThis.__boiteTest.workspace.active;
      store.openThread.activity = null;
      store.composerStates['t-trace'].queued = [];
    })()`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false });
    // At rest: no queue and no dock left above the box.
    await page.waitFor(`!document.querySelector('[data-testid="composer-queued"]') && !document.querySelector('[data-testid="thread-activity"]')`);
    await page.settleAnimations();
    // The window that leaves the history 20 px of room under its end, whether it overflows now or ends short of the box.
    const fittedHeight = await page.evaluate<number>(`(() => {
      const t = document.querySelector('[data-testid="timeline"]'), last = [...document.querySelectorAll(${LAST})].at(-1);
      const spare = t.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom - (t.scrollHeight - t.clientHeight - t.scrollTop) - parseFloat(getComputedStyle(t).paddingBottom);
      return Math.round(innerHeight - spare + 20);
    })()`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: fittedHeight, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`document.querySelector('[data-testid="timeline"]').scrollTop === 0`);
    await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.activity = { goal: null, loop: null, tasks: [{ id: 'short', text: 'Keep this short reply visible', status: 'in_progress' }] }`);
    await page.waitFor(`(() => {
      const last = [...document.querySelectorAll(${LAST})].at(-1);
      const dock = document.querySelector('[data-testid="thread-activity"]');
      return dock && last.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top;
    })()`);
    expect(await page.evaluate(`document.querySelector('[data-testid="timeline"]').scrollTop`)).toBeGreaterThan(0);
  } finally { await page?.close(); await server.close(); }
}, 90_000);
