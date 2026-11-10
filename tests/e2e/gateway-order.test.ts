import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startDevUi } from './lib/ui.ts';

/**
 * The Limits panel's order mode against the in-memory Douane: the glance of a
 * desktop window, and the tray's narrow panel under a finger. A phone has no
 * such panel: its limits are a settings page.
 */
let server: { close(): Promise<void> };
let origin: string;
beforeAll(async () => { const port = await freePort(); server = await startDevUi(port); origin = `http://127.0.0.1:${port}`; }, 60_000);
afterAll(async () => { await server?.close(); }, 30_000);

const claude = '[data-testid=quota-order-provider][data-provider=claude]';
const order = `[...document.querySelectorAll('${claude} [data-testid=quota-order-account]')].map(row => row.dataset.account).join()`;

async function orderMode(width: number, height: number, name: string) {
  const tray = width < 720;
  const prefix = tray ? 'quota' : 'limits-glance';
  const mode = `[data-testid=${prefix}-order-mode]`;
  const page = await BrowserPage.launch({ url: `${origin}/?fake=1&open=recent&gateway=douane-on${tray ? '&view=quotas' : ''}`, windowSize: { width, height } });
  const capture = async (file: string) => {
    await page.evaluate('Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])');
    await page.screenshot(join(process.env.BOITE_CAPTURE_DIR ?? join(import.meta.dir, '.artifacts'), file));
  };
  try {
    if (tray) await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await page.waitFor(`document.querySelector("[data-testid=${tray ? 'quota-popup' : 'nav-limits'}]")`);
    // Captures for a reader of another language: BOITE_CAPTURE_LOCALE=fr.
    if (process.env.BOITE_CAPTURE_LOCALE) await page.evaluate(`globalThis.__boiteTest?.setLocaleSetting(${JSON.stringify(process.env.BOITE_CAPTURE_LOCALE)})`);
    if (!tray) await page.click('[data-testid=nav-limits]');
    await page.waitFor(`document.querySelector("[data-testid=${prefix}-order]")`);
    await page.click(`[data-testid=${prefix}-order]`);
    await page.waitFor(`document.querySelector('${claude}')`);
    // Douane picks the week that ends soonest until the owner takes the order.
    expect(await page.evaluate(`document.querySelector('${claude} [data-testid=quota-order-reset]').getAttribute('aria-pressed')`)).toBe('true');
    expect(await page.evaluate(order)).toBe('claude-2,claude-1');
    await capture(`boite-usage-order-reset-${name}.png`);
    await page.click(`${claude} [data-testid=quota-order-mine]`);
    await page.waitFor(`document.querySelectorAll('${claude} [data-testid=quota-order-down]').length === 2`);
    expect(await page.evaluate(order)).toBe('claude-1,claude-2');
    await page.click(`${claude} [data-testid=quota-order-down]`);
    await page.waitFor(`${order} === 'claude-2,claude-1'`);
    await page.click(`${claude} [data-testid=quota-order-spare]`);
    await page.waitFor(`document.querySelector('${claude} [data-testid=quota-order-spare]').checked`);
    // A finger reaches both arrows, and nothing is wider than the panel.
    if (tray) expect(await page.evaluate(`[...document.querySelectorAll('${claude} [data-testid=quota-order-up]')].every(button => button.getBoundingClientRect().height >= 32)`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('${mode}').scrollWidth <= document.querySelector('${mode}').clientWidth`)).toBe(true);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await capture(`boite-usage-order-mine-${name}.png`);
    await page.click(`[data-testid=${prefix}-order]`);
    await page.waitFor(`!document.querySelector('${mode}')`);
    expect(page.errors()).toEqual([]);
  } finally { await page.close(); }
}

test('the Limits panel puts the Douane accounts in the owner\'s order from a desktop window', () => orderMode(1280, 900, 'desktop'), 60_000);
test('the Limits panel puts the Douane accounts in the owner\'s order from the narrow tray panel, by touch', () => orderMode(390, 844, 'phone'), 60_000);
