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
