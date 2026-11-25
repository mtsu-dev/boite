import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startUi } from './lib/ui';

/**
 * A project card's rows sit in a disclosure fold (app.css), a grid. Its column
 * once sized to the widest line that does not wrap, such as a done thread's
 * title, cut with an ellipsis, so one long title scrolled the whole thread list
 * sideways under a horizontal scrollbar. The line here stands for that title.
 */
test('a long line that does not wrap inside a project card leaves the thread list without a sideways scroll', async () => {
  const port = await freePort();
  const server = await startUi(port);
  let page: BrowserPage | undefined;
  try {
    page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1`, windowSize: { width: 1300, height: 850 } });
    await page.waitFor(`document.querySelector('[data-testid=project] .disclosure-fold > div')`);
    await page.evaluate(`(() => {
      const line = document.createElement('div');
      line.style.cssText = 'display: flex';
      line.innerHTML = '<span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' + 'Automatiser la recherche '.repeat(20) + '</span>';
      document.querySelector('[data-testid=project] .disclosure-fold > div').prepend(line);
    })()`);
    const list = await page.evaluate<{ client: number; scroll: number }>(`(() => {
      const scroll = document.querySelector('[data-testid=sidebar] .scroll');
      return { client: scroll.clientWidth, scroll: scroll.scrollWidth };
    })()`);
    await page.screenshot(join(import.meta.dir, '.artifacts', 'sidebar-overflow.png'));
    expect(list.scroll).toBe(list.client);
  } finally {
    await page?.close();
    await server.close();
  }
});

test('overflow fades the mochis at the hidden edges and scroll leaves the thread header clear', async () => {
  const port = await freePort();
  const server = await startUi(port);
  let page: BrowserPage | undefined;
  try {
    page = await BrowserPage.launch({ url: 'about:blank', windowSize: { width: 1100, height: 520 } });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('boite.mochi-layout', '1');` });
    await page.navigate(`http://127.0.0.1:${port}/?fake=1&agents=1&working=20`);
    const bots = `document.querySelector('[data-testid=app-rail] .bots')`;
    const threads = `document.querySelector('[data-testid=sidebar] .scroll')`;
    const header = `document.querySelector('[data-testid=sidebar] .views')`;
    const fades = `['::before', '::after'].map(edge => {
      const style = getComputedStyle(${bots}, edge);
      return style.content !== 'none' && Number(style.opacity) > 0;
    })`;
    await page.waitFor(`${bots}?.scrollHeight > ${bots}?.clientHeight && ${threads}?.scrollHeight > ${threads}?.clientHeight`);
    await page.evaluate(`globalThis.__boiteTest.setTheme('dark')`);
    await page.evaluate(`${threads}.scrollTop = 140`);
    await page.waitFor(`${threads}.classList.contains('scrolled')`);
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'sidebar-scroll-top.png'));
    expect(await page.evaluate(`({ line: getComputedStyle(${header}).borderBottomColor, fades: ${fades} })`)).toEqual({
      line: 'rgba(0, 0, 0, 0)', fades: [false, true],
    });

    await page.evaluate(`${bots}.scrollTop = (${bots}.scrollHeight - ${bots}.clientHeight) / 2`);
    await page.waitFor(`${fades}.every(Boolean)`);
    await page.screenshot(join(import.meta.dir, '.artifacts', 'sidebar-scroll-middle.png'));

    await page.evaluate(`${bots}.scrollTop = ${bots}.scrollHeight`);
    await page.waitFor(`${fades}.join() === 'true,false'`);

    // A small overflow still cuts across a picture. The edge needs its full fade even here.
    const fitHeight = await page.evaluate<number>(`innerHeight + ${bots}.scrollHeight - ${bots}.clientHeight`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: fitHeight - 9, deviceScaleFactor: 1, mobile: false });
    await page.evaluate(`${bots}.scrollTop = 0`);
    await page.waitFor(`${bots}.scrollHeight - ${bots}.clientHeight === 9`);
    await page.waitFor(`Number(getComputedStyle(${bots}, '::after').opacity) === 1`, 2000);

    await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: fitHeight + 1, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`${bots}.scrollHeight === ${bots}.clientHeight && ${fades}.every(fade => !fade)`);
  } finally {
    await page?.close();
    await server.close();
  }
}, 60_000);
