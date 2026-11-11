import { mobileAction } from './lib/mobile.ts';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startUi } from './lib/ui';

let server: { close(): Promise<void> };
let page: BrowserPage;
const branch = 'feature/' + 'very-long-existing-branch-'.repeat(20);
const state = 'globalThis.__boiteTest.workspace.active';

beforeAll(async () => {
  const port = await freePort();
  server = await startUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: { width: 1000, height: 850 } });
  await page.waitFor(`document.querySelector('[data-thread-id="t-trace"]')`);
  await page.click('[data-thread-id="t-trace"]');
  await page.evaluate(`(() => {
    const store = ${state};
    const thread = store.threads.find(t => t.id === 't-trace');
    const updated = { ...thread, branch: ${JSON.stringify(branch)} };
    store.threads = store.threads.map(t => t.id === thread.id ? updated : t);
    store.openThread = { ...store.openThread, branch: updated.branch };
  })()`);
  // A row keeps its branch in its tooltip; the header's menu names it in the folder group (ThreadHeader.svelte).
  await page.waitFor(`document.querySelector('[data-testid="thread-row"][data-thread-id="t-trace"]')?.title.includes(${JSON.stringify(branch)})`);
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

test('existing long branches truncate without pushing header controls or sidebar metadata out of view', async () => {
  expect(await fits('[data-testid="panel-toggle"]')).toBe(true);
  // The header's branch is a row of its menu's folder group: one line, cut with an ellipsis, inside the window, whole in its tooltip.
  await page.click('[data-testid="thread-menu-trigger"]');
  const menu = '[role=menu]:not(.closing)';
  await page.waitFor(`document.querySelector('${menu} [data-value=thread-branch], ${menu} [data-value=more]')`);
  if (!await page.evaluate<boolean>(`!!document.querySelector('${menu} [data-value=thread-branch]')`)) await page.click(`${menu} [data-value=more]`);
  await page.waitFor(`document.querySelector('${menu} [data-value=thread-branch]')`);
  await page.settleAnimations();
  expect(await page.evaluate(`(() => {
    const row = document.querySelector('${menu} [data-value=thread-branch]');
    const text = row.querySelector('.ui-label');
    const box = document.querySelector('${menu}').getBoundingClientRect();
    return text.textContent.includes(${JSON.stringify(branch)}) && text.scrollWidth > text.clientWidth && getComputedStyle(text).textOverflow === 'ellipsis' && row.title.includes(${JSON.stringify(branch)}) &&
      box.left >= 0 && box.right <= innerWidth && text.getClientRects().length === 1;
  })()`)).toBe(true);
  await capture('header-menu');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor(`!document.querySelector('${menu}')`);
  await page.evaluate(`${state}.setSidebarWidth(208)`);
  await page.waitFor(`document.querySelector('[data-testid="sidebar"]').getBoundingClientRect().width <= 210`);
  // The sidebar row is one line at rest; the branch sits in its tooltip and pushes nothing out of the row.
  expect(await page.evaluate(`(() => {
    const row = document.querySelector('[data-testid="thread-row"][data-thread-id="t-trace"]');
    const card = row.closest('.thread');
    const sidebar = document.querySelector('[data-testid="sidebar"]').getBoundingClientRect();
    const box = card.getBoundingClientRect();
    return row.title.includes(${JSON.stringify(branch)}) && row.scrollWidth <= row.clientWidth && box.right <= sidebar.right && card.querySelector('[data-testid="thread-menu"]').getBoundingClientRect().right <= sidebar.right;
  })()`)).toBe(true);
  await capture('desktop');
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
});

test('changes panel and phone conversation list stay within the viewport with an existing long branch', async () => {
  // Report the same branch from the fake Git status as from the thread summary.
  await page.evaluate(`(() => { const client = ${state}.client; const call = client.call.bind(client); client.call = async (method, params) => { const result = await call(method, params); return method === 'git.status' ? { ...result, branch: ${JSON.stringify(branch)} } : result; }; })()`);
  await page.evaluate(`${state}.panel.open('changes')`);
  // On a desktop the panel's head lives in its strip (SurfaceHead.svelte); the branch is a row of the view menu.
  await page.waitFor(`document.querySelector('[data-testid="panel-surface-head"] [data-testid="changes-count"]')`);
  expect(await page.evaluate(`(() => {
    const head = document.querySelector('[data-testid="panel-surface-head"]');
    return head.scrollWidth <= head.clientWidth;
  })()`)).toBe(true);
  await page.click('[data-testid="diff-options"]');
  await page.waitFor(`document.querySelector('[data-testid="diff-branch"]')?.textContent.includes(${JSON.stringify(branch)})`);
  expect(await page.evaluate(`(() => {
    const row = document.querySelector('[data-testid="diff-branch"]').getBoundingClientRect();
    return row.left >= 0 && row.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  })()`)).toBe(true);
  await capture('changes');
  await page.click('[data-testid="diff-options"]');
  // The panel's own close: with a panel open, the header's door lives in the panel's strip.
  await page.click('[data-testid="panel-close"]');
  await page.waitFor(`!document.querySelector('[data-testid="right-panel"]')`);
  for (const width of [390, 320]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    // A phone's header is Back and the title's menu, which holds the panel.
    expect(await fits('[data-testid="thread-menu-trigger"]')).toBe(true);
    await mobileAction(page, 'mobile-conversations');
    await page.waitFor(`document.querySelector('[data-testid="mobile-list"] .thread')`);
    // A phone's row is its title first: the branch rides in the row's tooltip, and no row runs past the screen.
    expect(await page.evaluate(`(() => {
      const list = document.querySelector('[data-testid="mobile-list"]');
      const row = list.querySelector('[data-testid="mobile-thread-t-trace"]');
      const rows = [...list.querySelectorAll('[data-testid="mobile-row"]')];
      return document.documentElement.scrollWidth <= innerWidth && list.scrollWidth <= list.clientWidth && !!row && row.title.includes(${JSON.stringify(branch)}) && row.scrollWidth <= row.clientWidth && rows.every(el => el.getBoundingClientRect().right <= innerWidth);
    })()`)).toBe(true);
    await capture(`phone-${width}`);
    await page.click('[data-testid="mobile-list"] .thread');
  }
});
