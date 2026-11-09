import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startUi } from './lib/ui.ts';

// `?fake=1&council=1` seeds `t-council`: a council with two finished rounds, one
// under way in its second round with a post of the owner's to one member, and a debate
// from before the council.
const ARTIFACTS = join(import.meta.dir, '.artifacts', 'council');
const DESKTOP = { width: 816, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 330, height: 720, deviceScaleFactor: 1, mobile: true };
const STORE = 'window.__boiteTest.workspace.active';
const id = (name: string) => `[data-testid="${name}"]`;
const open = (councilId: string) => `${id('council-card')}[data-council-id="${councilId}"] ${id('council-card-open')}`;
const visible = (selector: string) => `(() => { const box = document.querySelector('${selector}')?.getBoundingClientRect(); return !!box && box.width > 0 && box.height > 0; })()`;
// Nothing in the page or the salon scrolls sideways.
const fits = `document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('${id('council-salon')}, ${id('council-posts')}')].every(node => node.scrollWidth <= node.clientWidth + 1)`;

let server: { close(): Promise<void> };
let url = '';
let page: BrowserPage | undefined;
beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const port = await freePort();
  server = await startUi(port);
  url = `http://127.0.0.1:${port}/?fake=1&council=1`;
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
  await page.evaluate(`window.__boiteTest.workspace.select(${STORE}, 't-council')`);
  await page.waitFor(`document.body.textContent.includes('Three AIs reviewed the cache plan')`);
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
    await current.waitFor(`document.querySelectorAll('${id('council-card')}[data-status]').length === 3`);
    expect(await current.text(`${id('council-card')}[data-council-id="cnl_demo_live"] ${id('council-card-status')}`)).toBe('Round 2');
    await current.evaluate(`document.querySelector('${id('council-card')}[data-council-id="cnl_demo_live"]').scrollIntoView({ block: 'end' })`);
    await capture(current, `cards-${label}.png`);

    await current.click(open('cnl_demo_live'));
    await current.waitFor(`document.querySelectorAll('${id('council-post')}').length === 7`);
    await current.waitFor(visible(id('council-input')));
    expect(await current.text(id('council-round'))).toBe('Round 2');
    await capture(current, `salon-live-${label}.png`);
    // A desktop keeps the thread beside the salon; a phone gives the salon the whole screen.
    const salon = await current.evaluate<{ left: number; width: number }>(`(() => { const box = document.querySelector('${id('council-salon')}').getBoundingClientRect(); return { left: Math.round(box.left), width: Math.round(box.width) }; })()`);
    if (label === 'phone') expect(salon).toEqual({ left: 0, width: PHONE.width });
    else expect(salon.left).toBeGreaterThan(DESKTOP.width / 3);
    expect(await current.evaluate<boolean>(fits)).toBe(true);

    // `click()` does not focus: the chat's own composer would take the letters.
    await current.evaluate(`document.querySelector('${id('council-input')}').focus()`);
    await current.send('Input.insertText', { text: '@G' });
    // The chat's composer has an `@` menu of its own, with the same test ids.
    await current.waitFor(`document.querySelectorAll('${id('council-composer')} ${id('mention-row')}').length === 2`);
    expect(await current.evaluate(`[...document.querySelectorAll('${id('council-composer')} ${id('mention-row')}')].map(row => row.textContent.includes('@Gemini') || row.textContent.includes('@GPT'))`)).toEqual([true, true]);
    await capture(current, `salon-mention-${label}.png`);
    await current.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await current.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await current.waitFor(`!document.querySelector('${id('council-composer')} ${id('mention-menu')}:not(.closing)')`);
    expect(await current.evaluate(`document.querySelector('${id('council-input')}').value`)).toBe('@G');

    if (label === 'phone') {
      await current.evaluate(`history.back()`);
      await current.waitFor(visible(open('cnl_demo_done')));
    }
    await current.click(open('cnl_demo_done'));
    // The heading and the three members of the table of rounds, under the answers with their scores.
    await current.waitFor(`document.querySelectorAll('${id('council-table')} tr').length === 4`);
    expect(await current.evaluate<number>(`document.querySelectorAll('${id('council-post-score')}').length`)).toBeGreaterThan(0);
    await current.evaluate(`document.querySelector('${id('council-table')}').scrollIntoView({ block: 'end' })`);
    expect(await current.evaluate<boolean>(fits)).toBe(true);
    await capture(current, `salon-done-${label}.png`);
    expect(current.errors()).toEqual([]);
  }, 90_000);
}

test('with the experiment off the thread keeps its text and draws no card', async () => {
  const current = await launch([], DESKTOP);
  expect(await current.evaluate<number>(`document.querySelectorAll('${id('council-card')}').length`)).toBe(0);
  await capture(current, 'off-desktop.png');
  expect(current.errors()).toEqual([]);
}, 60_000);
