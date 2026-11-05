import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';
import { mobileAction } from './lib/mobile.ts';

let server: { close(): Promise<void> }, port: number;
beforeAll(async () => { port = await freePort(); server = await startUi(port); }, 60_000);
afterAll(async () => { await server?.close(); }, 30_000);

for (const width of [1280, 390]) {
  test(`done retention defaults to three days and saves validated settings at ${width}px`, async () => {
    const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: { width, height: 900 } });
    try {
      await page.waitFor(`globalThis.__boiteTest?.workspace.active.openThread`);
      await page.evaluate(`globalThis.__boiteTest.setTheme('dark')`);
      const threadId = await page.evaluate<string>(`(async () => {
        const client = globalThis.__boiteTest.workspace.active.client;
        const source = await client.call('threads.get', {threadId: 't-parser'});
        const thread = await client.call('threads.create', {projectId: source.projectId, providerId: source.providerId, accountId: source.accountId, model: source.model, title: 'A finished conversation'});
        await client.call('threads.archive', {threadId: thread.id, onlyIfIdle: true});
        return thread.id;
      })()`);
      const phone = width < 720;
      // How long done threads stay is set in Settings, on the card that leads to the Archived filter.
      const openRetention = async () => {
        if (phone) {
          await mobileAction(page, 'mobile-settings');
          // The phone's Archived row opens the list; the card is the route a project menu or a search lands on.
          await page.evaluate(`globalThis.__boiteTest.workspace.active.showSettings('general', 'archived')`);
        } else {
          await page.click('[data-testid=nav-settings]');
          await page.click('[data-testid=settings-tab-general]');
        }
        await page.waitFor(`document.querySelector('[data-testid=done-retention-days]')`);
      };
      // The finished thread is a row of the list's Done filter, reached from the card's link.
      const row = `[data-testid=done-thread][data-thread-id="${threadId}"]`;
      const openDone = async () => {
        await page.click('[data-testid=archived-show-list]');
        await page.click(`[data-testid=${phone ? 'mobile-' : ''}lifecycle-done]`);
        await page.waitFor(`document.querySelector('${row}')`);
      };
      await openRetention();
      expect(await page.evaluate(`document.querySelector('[data-testid=done-retention-days]').value`)).toBe('3');
      await page.evaluate(`document.querySelector('[data-testid=done-retention-days]').scrollIntoView({block:'center'})`);
      await page.evaluate(`Promise.all([document.fonts.ready, ...document.querySelector('[data-testid=archived-threads]').getAnimations({subtree:true}).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])`);
      await page.screenshot(join(import.meta.dir, '.artifacts', `done-retention-${width}.png`));
      expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      await page.choose('[data-testid=done-retention-days]', '0.5');
      expect(await page.evaluate(`document.querySelector('[data-testid=done-retention-save]').disabled`)).toBe(true);
      await page.choose('[data-testid=done-retention-days]', '7');
      await page.click('[data-testid=done-retention-save]');
      await page.waitFor(`globalThis.__boiteTest.workspace.active.settings.threadDoneRetentionDays === 7`);
      const doneAt = await page.evaluate<number>(`globalThis.__boiteTest.workspace.active.client.call('threads.get', {threadId: ${JSON.stringify(threadId)}}).then(t => t.doneAt)`);
      await openDone();
      // A done row is one line: the exact deletion time is the last line of its tooltip.
      const exact = `new Intl.DateTimeFormat(document.documentElement.lang || undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).format(${doneAt + 7 * 86_400_000})`;
      const lastLine = `document.querySelector('${row} [data-testid=done-thread-open]').title.split('\\n').at(-1)`;
      await page.waitFor(`${lastLine}.startsWith('Deletion: ') && ${lastLine}.includes(${exact})`);
      expect(await page.evaluate(`!document.querySelector('${row} [data-testid=done-expires]')`)).toBe(true);
      await openRetention();
      await page.choose('[data-testid=done-retention-days]', '0');
      await page.click('[data-testid=done-retention-save]');
      await page.waitFor(`globalThis.__boiteTest.workspace.active.settings.threadDoneRetentionDays === 0`);
      await openDone();
      // Kept for good: no deletion line in the tooltip.
      expect(await page.evaluate(`!document.querySelector('${row} [data-testid=done-thread-open]').title.includes('Deletion:')`)).toBe(true);
      await page.click(`${row} [data-testid=done-thread-restore]`);
      await page.waitFor(`!document.querySelector('${row}')`);
      expect(await page.evaluate(`globalThis.__boiteTest.workspace.active.client.call('threads.get', {threadId: ${JSON.stringify(threadId)}}).then(t => t.doneAt)`)).toBeNull();
    } finally { await page.close(); }
  }, 60_000);
}
