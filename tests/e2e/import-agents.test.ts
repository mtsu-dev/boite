import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startDevUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
beforeAll(async () => {
  const port = await freePort();
  server = await startDevUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1`, windowSize: { width: 1300, height: 850 } });
  await page.waitFor(`document.querySelector('[data-testid=project-row]')`);
}, 90000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function capture(name: string) {
  await page.evaluate(`Promise.all(document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`);
  await page.screenshot(join(import.meta.dir, '.artifacts', `${name}.png`));
}

/** The dialog inside the viewport, every row inside the dialog, and no row's title squeezed to nothing. */
const fits = `(() => {
  const box = document.querySelector('[data-testid=import-dialog]').getBoundingClientRect();
  const rows = [...document.querySelectorAll('[data-testid=import-row]')];
  return box.left >= 0 && box.right <= innerWidth
    && rows.every(row => row.getBoundingClientRect().right <= box.right + 0.5 && row.querySelector('.title').getBoundingClientRect().width >= 60);
})()`;

test('the import list names the agent of each session when it holds Claude Code and Codex ones, at desktop and phone widths', async () => {
  await page.evaluate(`(async () => {
    const { workspace } = await import('/src/lib/workspace.svelte.ts');
    await workspace.active.openImports('p-boite');
  })()`);
  await page.waitFor(`document.querySelectorAll('[data-testid=import-row]').length === 3`);
  expect(await page.evaluate(`[...document.querySelectorAll('[data-testid=import-agent]')].map(label => label.textContent)`)).toEqual(['Claude', 'Claude', 'Codex']);
  await capture('import-agents-desktop');
  expect(await page.evaluate(fits)).toBe(true);

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.waitFor(`document.querySelector('[data-testid=import-dialog]').getBoundingClientRect().width <= 390`);
  await capture('import-agents-phone');
  expect(await page.evaluate(fits)).toBe(true);
}, 60000);
