import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let port: number;
beforeAll(async () => { port = await freePort(); server = await startUi(port); }, 60_000);
afterAll(async () => { await server?.close(); }, 30_000);

test('a hovered sidebar row keeps its whole provider mark inside the fade that makes room for its buttons', async () => {
  const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: { width: 1280, height: 900 } });
  try {
    await page.waitFor('globalThis.__boiteTest?.workspace.active?.connection === "ready"');
    const row = `[...document.querySelectorAll('[data-testid=sidebar] .thread.classic:not(.open)')].find(row => row.querySelector('[data-testid=thread-provider]'))`;
    await page.waitFor(`!!(${row})`);
    const point = await page.evaluate<{ x: number; y: number }>(`(() => { const box = (${row}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + 12 }; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await page.waitFor(`(${row}).matches(':hover') && getComputedStyle((${row}).querySelector('.headline')).maskImage !== 'none'`);
    await page.settleAnimations();
    // The mask paints the headline's own box: a mark drawn past its edge is cut off while the row is hovered.
    const edges = await page.evaluate<{ mark: number; mask: number }>(`(() => {
      const row = ${row};
      return { mark: row.querySelector('[data-testid=thread-provider]').getBoundingClientRect().left, mask: row.querySelector('.headline').getBoundingClientRect().left };
    })()`);
    expect(edges.mark).toBeGreaterThanOrEqual(edges.mask);
    await page.screenshot(join(import.meta.dir, '.artifacts', 'thread-row-hover.png'));
  } finally { await page.close(); }
}, 30_000);
