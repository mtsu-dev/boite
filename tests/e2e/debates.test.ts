import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

// `?fake=1&debates=1` seeds `t-debate`: a finished debate whose summary came
// back, then a live one in round 2 of 3 with a post of the owner's to one AI.
const ARTIFACTS = join(import.meta.dir, '.artifacts', 'debates');
const DESKTOP = { width: 816, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 330, height: 720, deviceScaleFactor: 1, mobile: true };
const STORE = 'window.__boiteTest.workspace.active';
const id = (name: string) => `[data-testid="${name}"]`;
const open = (debateId: string) => `${id('debate-card')}[data-debate-id="${debateId}"] ${id('debate-card-open')}`;
const visible = (selector: string) => `(() => { const box = document.querySelector('${selector}')?.getBoundingClientRect(); return !!box && box.width > 0 && box.height > 0; })()`;
// Nothing in the page or the salon scrolls sideways.
const fits = `document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('${id('debate-salon')}, ${id('debate-posts')}')].every(node => node.scrollWidth <= node.clientWidth + 1)`;

let server: { close(): Promise<void> };
let url = '';
let page: BrowserPage | undefined;
beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const port = await freePort();
  server = await startUi(port);
  url = `http://127.0.0.1:${port}/?fake=1&debates=1`;
}, 60_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function launch(experiments: string[], viewport: typeof DESKTOP): Promise<BrowserPage> {
  await page?.close();
  page = await BrowserPage.launch({ url, experiments });
  await page.send('Emulation.setDeviceMetricsOverride', viewport);
  // A hidden browser has no focused window: the `@` menu opens on a focused composer only.
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.navigate(url);
  await page.waitFor(`${STORE}?.connection === 'ready'`);
  await page.evaluate(`window.__boiteTest.workspace.select(${STORE}, 't-debate')`);
  await page.waitFor(`document.body.textContent.includes('Three AIs debated the cache')`);
  return page;
}

async function capture(current: BrowserPage, name: string) {
  await current.evaluate(`document.fonts.ready`);
  // Panels slide in: wait for the finite animations, not the dots that pulse while an AI writes.
  await current.waitFor(`document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)`);
  await current.screenshot(join(ARTIFACTS, name));
}

for (const [label, viewport] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`the cards open the salon, live and finished, with the experiment on (${label})`, async () => {
    const current = await launch(['debates'], viewport);
    await current.waitFor(`document.querySelectorAll('${id('debate-card')}[data-status]').length === 2`);
    expect(await current.text(`${id('debate-card')}[data-debate-id="dbt_demo_live"] ${id('debate-card-status')}`)).toBe('Round 2 of 3');
    expect(await current.text(id('debate-card-summary'))).toContain('Summary by Opus 5.5');
    await current.evaluate(`document.querySelector('${id('debate-card')}[data-debate-id="dbt_demo_live"]').scrollIntoView({ block: 'end' })`);
    await capture(current, `cards-${label}.png`);

    await current.click(open('dbt_demo_live'));
    await current.waitFor(`document.querySelectorAll('${id('debate-post')}').length === 6`);
    await current.waitFor(visible(id('debate-input')));
    expect(await current.text(id('debate-round'))).toBe('Round 2 / 3');
    expect(await current.evaluate(`[...document.querySelectorAll('${id('debate-angle')}')].map(node => node.textContent.trim())`)).toEqual(['Battery first', 'Latency first', 'Simplicity first']);
    await capture(current, `salon-live-${label}.png`);
    // A desktop keeps the thread beside the salon; a phone gives the salon the whole screen.
    const salon = await current.evaluate<{ left: number; width: number }>(`(() => { const box = document.querySelector('${id('debate-salon')}').getBoundingClientRect(); return { left: Math.round(box.left), width: Math.round(box.width) }; })()`);
    if (label === 'phone') expect(salon).toEqual({ left: 0, width: PHONE.width });
    else expect(salon.left).toBeGreaterThan(DESKTOP.width / 3);
    expect(await current.evaluate<boolean>(fits)).toBe(true);

    // `click()` does not focus: the chat's own composer would take the letters.
    await current.evaluate(`document.querySelector('${id('debate-input')}').focus()`);
    await current.send('Input.insertText', { text: '@G' });
    // The chat's composer has an `@` menu of its own, with the same test ids.
    await current.waitFor(`document.querySelectorAll('${id('debate-composer')} ${id('mention-row')}').length === 2`);
    expect(await current.evaluate(`[...document.querySelectorAll('${id('debate-composer')} ${id('mention-row')}')].map(row => row.textContent.includes('@Gemini') || row.textContent.includes('@GPT'))`)).toEqual([true, true]);
    await capture(current, `salon-mention-${label}.png`);
    await current.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await current.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await current.waitFor(`!document.querySelector('${id('debate-composer')} ${id('mention-menu')}:not(.closing)')`);
    expect(await current.evaluate(`document.querySelector('${id('debate-input')}').value`)).toBe('@G');

    if (label === 'phone') {
      await current.evaluate(`history.back()`);
      await current.waitFor(visible(open('dbt_demo_done')));
    }
    await current.click(open('dbt_demo_done'));
    await current.waitFor(`document.querySelectorAll('${id('debate-tally-row')}').length === 1`);
    await current.evaluate(`document.querySelector('${id('debate-verdict')}').scrollIntoView({ block: 'end' })`);
    expect(await current.evaluate<boolean>(fits)).toBe(true);
    await capture(current, `salon-done-${label}.png`);
    expect(current.errors()).toEqual([]);
  }, 90_000);
}

test('with the experiment off the thread keeps its text and draws no card', async () => {
  const current = await launch([], DESKTOP);
  expect(await current.evaluate<number>(`document.querySelectorAll('${id('debate-card')}').length`)).toBe(0);
  await capture(current, 'off-desktop.png');
  expect(current.errors()).toEqual([]);
}, 60_000);
