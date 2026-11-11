import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startUi } from './lib/ui';

/** What the timeline ends on: its last message, or the closing line under a finished turn. */
const LAST = `'[data-testid="message"], [data-testid="thread-closing"]'`;

test('queued prompts sit above the activity dock attached to the input', async () => {
  const port = await freePort();
  const server = await startUi(port);
  let page: BrowserPage | undefined;
  try {
    page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1`, windowSize: { width: 1300, height: 850 } });
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
    for (const width of [1300, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width === 390 });
      await page.evaluate(`Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])`);
      await page.evaluate(`(() => { const timeline = document.querySelector('[data-testid="timeline"]'); timeline.scrollTop = timeline.scrollHeight; })()`);
      const gap = await page.evaluate<number>(`(() => {
        const last = [...document.querySelectorAll(${LAST})].at(-1);
        return document.querySelector('[data-testid="composer-queued"]').getBoundingClientRect().top - last.getBoundingClientRect().bottom;
      })()`);
      await page.screenshot(join(import.meta.dir, '.artifacts', `queued-spacing-${process.env.BOITE_QUEUE_CAPTURE ?? 'after'}-${width}.png`));
      expect(gap).toBeGreaterThanOrEqual(16);
      expect(gap).toBeLessThanOrEqual(40);
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    }
    // Going out, the queue has no Send now: its foot keeps the button's height so
    // the label's ink room does not overflow the list into a scrollbar, and a
    // long prompt shows whole lines (one on a desktop, two on a phone), not a sliver of the next.
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
        // clientHeight is whole pixels and the line 1.4 of the font: a tenth of a line is rounding, a sliver is more.
        const text = queue.querySelector('[data-testid="composer-queued-text"] .words');
        return { overflow: queue.scrollHeight - queue.clientHeight, lines: Math.round(text.clientHeight / parseFloat(getComputedStyle(text).lineHeight) * 10) / 10 };
      })()`);
      expect(fit).toEqual({ overflow: 0, lines: width === 390 ? 2 : 1 });
    }
    await page.evaluate(`globalThis.__boiteTest.workspace.active.composerStates['t-trace'].sending = false`);
    await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.activity = { goal: null, loop: null, tasks: [{ id: 'work', text: 'Keep the latest answer visible', status: 'in_progress' }] }`);
    for (const width of [1300, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width === 390 });
      // The dock is the composer card's top row: the queue above the card clears it without a lift of its own.
      await page.waitFor(`(() => { const dock = document.querySelector('[data-testid="thread-activity"]'); return dock?.offsetHeight > 0 && dock.closest('[data-testid="composer"]') !== null; })()`);
      await page.evaluate(`(() => { const timeline = document.querySelector('[data-testid="timeline"]'); timeline.scrollTop = timeline.scrollHeight; })()`);
      await page.evaluate(`Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`);
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
      await page.evaluate(`Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`);
      await page.waitFor(`document.querySelector('[data-testid="composer-queued"]').getBoundingClientRect().bottom <= document.querySelector('[data-testid="thread-activity"]').getBoundingClientRect().top`);
      await page.click('[data-testid="activity-tasks-toggle"]');
      await page.evaluate(`Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`);
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
    await page.evaluate(`Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`);
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
