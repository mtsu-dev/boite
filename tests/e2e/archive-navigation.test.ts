import { expect, test } from 'bun:test';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { mobileAction, screensSettled } from './lib/mobile.ts';
import { openDisplayOptions } from './lib/views.ts';
import { startUi } from './lib/ui.ts';

test('the filter and settings search open the same archive and its rows open read-only conversations', async () => {
  const port = await freePort();
  const server = await startUi(port);
  let page: BrowserPage | undefined;
  try {
    page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1` });
    // The archive is Settings > General's card, read at once: the thread list never gives its place to it.
    const archive = '.settings [data-testid=archived-threads]';
    await openDisplayOptions(page);
    await page.click('[data-testid=grouping-options-menu] [data-testid$=archived-entry]');
    await page.waitFor(`document.querySelector('${archive} [data-testid=archived-list] li')`);
    expect(await page.evaluate(`document.querySelector('[data-testid=sidebar] [data-testid=archived-list]')`)).toBeNull();
    await page.click('[data-testid=nav-settings]');
    await page.type('[data-testid=settings-search]', 'Archived threads');
    await page.click('[data-testid=settings-search-result]');
    await page.waitFor(`document.querySelector('${archive} [data-testid=archived-list] li')`);
    const row = `${archive} [data-testid=archived-list] li`;
    const id = await page.evaluate<string>(`document.querySelector('${row}').dataset.threadId`);
    await page.click(`${row}[data-thread-id="${id}"] [data-testid=archived-title]`);
    await page.waitFor(`document.querySelector('[data-testid=done-thread-notice]')`);
    expect(await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.archived`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('[data-testid=composer-input]')`)).toBeNull();

    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.navigate(`http://127.0.0.1:${port}/?fake=1&open=recent&machines=1`);
    const openPhoneArchive = async () => {
      await mobileAction(page!, 'mobile-settings');
      await page!.click('[data-testid=mobile-settings-home] [data-testid=settings-tab-general]');
      await page!.waitFor(screensSettled);
      await page!.click('[data-testid=mobile-settings-archived]');
      await page!.waitFor(screensSettled);
      await page!.waitFor(`document.querySelector('.settings-screen:not([inert]) [data-testid=mobile-settings-header] h1')?.textContent.includes('Archived threads')`);
    };
    await openPhoneArchive();
    expect(await page.text('[data-testid=mobile-settings-page-scope]')).toContain('Threads archived on');
    expect(await page.evaluate(`!!document.querySelector('[data-testid=mobile-settings-page-scope] [data-testid=settings-machine]')`)).toBe(true);
    const phoneRow = await page.evaluate<string>(`document.querySelector('[data-testid=archived-list] li').dataset.threadId`);
    await page.click('[data-testid=archived-list] [data-testid=archived-title]');
    await page.waitFor(`!document.querySelector('[data-testid=mobile-settings-header]') && document.querySelector('[data-testid=done-thread-notice]')`);
    expect(await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.archived`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('[data-testid=composer-input]')`)).toBeNull();

    await openPhoneArchive();
    const restoredRow = `[data-testid=archived-list] li[data-thread-id="${phoneRow}"]`;
    await page.click(`${restoredRow} [data-testid=archived-restore]`);
    await page.waitFor(`document.querySelector('${restoredRow} [data-testid=archived-open]') && !document.querySelector('${restoredRow} [data-testid=archived-restore]')`);
    await page.click(`${restoredRow} [data-testid=archived-open]`);
    await page.waitFor(`!document.querySelector('[data-testid=mobile-settings-header]') && document.querySelector('[data-testid=composer-input]')`);
    expect(await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.id`)).toBe(phoneRow);
    expect(await page.evaluate(`globalThis.__boiteTest.workspace.active.openThread.archived`)).toBe(false);
  } finally {
    try { await page?.close(); } finally { await server.close(); }
  }
}, 90_000);
