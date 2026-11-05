import { mobileAction } from './lib/mobile.ts';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startUi } from './lib/ui';
import { revealThreadRow } from './lib/views.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
const branch = 'feature/' + 'very-long-existing-branch-'.repeat(20);
const state = 'globalThis.__boiteTest.workspace.active';

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: { width: 1000, height: 850 } });
  await revealThreadRow(page, 't-trace');
  await page.click('[data-thread-id="t-trace"]');
  await page.evaluate(`(() => {
    const store = ${state};
    const thread = store.threads.find(t => t.id === 't-trace');
    const updated = { ...thread, branch: ${JSON.stringify(branch)} };
    store.threads = store.threads.map(t => t.id === thread.id ? updated : t);
    store.openThread = { ...store.openThread, branch: updated.branch };
  })()`);
  await page.waitFor(`document.querySelector('.thread-header [data-testid="thread-branch"]')?.textContent.includes(${JSON.stringify(branch)})`);
}, 90_000);

afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function capture(name: string) {
  await page.settleAnimations();
  await page.screenshot(join(import.meta.dir, '.artifacts', `branch-names-${name}.png`));
}

function fits(selector: string) {
  return page.evaluate<boolean>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const rect = el?.getBoundingClientRect();
    return !!rect && rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
  })()`);
}

test('existing long branches truncate without pushing header controls out of view or stretching a sidebar row', async () => {
  expect(await fits('[data-testid="panel-toggle"]')).toBe(true);
  expect(await page.evaluate(`(() => {
    const badge = document.querySelector('.thread-header [data-testid="thread-branch"]');
    const text = badge.querySelector('.branch-name');
    return !!text && text.scrollWidth > text.clientWidth && getComputedStyle(text).textOverflow === 'ellipsis' && badge.title.includes(${JSON.stringify(branch)});
  })()`)).toBe(true);
  await page.evaluate(`${state}.setSidebarWidth(208)`);
  await page.waitFor(`document.querySelector('[data-testid="sidebar"]').getBoundingClientRect().width <= 210`);
  // A row is one line at any width: the branch is not drawn, its headline does not overflow, and its tooltip holds the branch.
  expect(await page.evaluate(`(() => {
    const row = document.querySelector('.thread:has([data-thread-id="t-trace"])');
    const button = row.querySelector('[data-testid="thread-row"]');
    const headline = row.querySelector('.headline');
    return !row.querySelector('.metadata, [data-testid="thread-branch"], [data-testid="thread-pr"]')
      && !!headline && headline.scrollWidth <= headline.clientWidth
      && row.getBoundingClientRect().right <= document.querySelector('[data-testid="sidebar"]').getBoundingClientRect().right
      && button.title.split('\\n')[1] === ${JSON.stringify(branch)};
  })()`)).toBe(true);
  await capture('desktop');
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
});

test('changes panel and phone conversation list stay within the viewport with an existing long branch', async () => {
  // Report the same branch from the fake Git status as from the thread summary.
  await page.evaluate(`(() => { const client = ${state}.client; const call = client.call.bind(client); client.call = async (method, params) => { const result = await call(method, params); return method === 'git.status' ? { ...result, branch: ${JSON.stringify(branch)} } : result; }; })()`);
  await page.evaluate(`${state}.panel.open('changes')`);
  await page.waitFor(`document.querySelector('[data-testid="changes-panel"] .branch')?.textContent.includes(${JSON.stringify(branch)})`);
  expect(await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="changes-panel"]');
    const bar = panel.querySelector('.panel-toolbar');
    const text = bar.querySelector('.branch-name');
    return !!text && text.scrollWidth > text.clientWidth && bar.scrollWidth <= bar.clientWidth;
  })()`)).toBe(true);
  await capture('changes');
  await page.click('[data-testid="panel-toggle"]');
  for (const width of [390, 320]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    // A phone's header is Back and the title's menu, which holds the panel.
    expect(await fits('[data-testid="thread-menu-trigger"]')).toBe(true);
    await mobileAction(page, 'mobile-conversations');
    await page.waitFor(`document.querySelector('[data-testid="mobile-list"] .thread')`);
    // A phone row draws no branch: the list stays inside the viewport and no row names the branch.
    expect(await page.evaluate(`(() => {
      const list = document.querySelector('[data-testid="mobile-list"]');
      const rows = [...list.querySelectorAll('[data-testid="mobile-row"]')];
      return document.documentElement.scrollWidth <= innerWidth && rows.length > 0
        && rows.every(row => row.getBoundingClientRect().right <= innerWidth && !row.textContent.includes('very-long-existing-branch') && !row.querySelector('[data-testid="thread-branch"]'));
    })()`)).toBe(true);
    await capture(`phone-${width}`);
    await page.click('[data-testid="mobile-list"] .thread');
  }
});
