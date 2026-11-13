import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startUi } from './lib/ui.ts';

/*
 * A change of model, effort or account drawn in the timeline, on the fake
 * UI: the dashed line under the last message while it is only picked, then
 * the divider above the turn that first ran on it, at desktop and phone
 * widths. `model-switch.test.ts` checks the same line over the real core.
 */

let server: { close(): Promise<void> };
let port = 0;
const pages: BrowserPage[] = [];

beforeAll(async () => {
  port = await freePort();
  server = await startUi(port);
}, 90_000);
afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.close()));
}, 15_000);
afterAll(async () => {
  await server?.close();
}, 30_000);

const STORE = `globalThis.__boiteTest.workspace.active`;
const settle = `Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])`;
const testid = (name: string) => `[data-testid="${name}"]`;
/** The line as read: the shared model, each side, then what follows, without the agents' marks. */
const line = (name: string) => `Array.from(document.querySelectorAll('${testid(name)} :is(.lead, [data-testid="switch-from"], [data-testid="switch-to"], .said)'), part => part.textContent).join(' | ')`;
/** One line of text, inside the column, its words on one row. */
const box = (name: string) => `(() => { const row = document.querySelector('${testid(name)}'); const column = row.parentElement.getBoundingClientRect(); const own = row.getBoundingClientRect(); const tops = new Set(Array.from(row.querySelectorAll('.lead, [data-testid="switch-from"], [data-testid="switch-to"]'), part => Math.round(part.getBoundingClientRect().top + part.getBoundingClientRect().height / 2))); return { inside: own.left >= column.left - 1 && own.right <= column.right + 1, wide: Math.round(own.width) >= Math.round(column.width) - 80, height: Math.round(own.height), rows: tops.size }; })()`;

async function shot(page: BrowserPage, name: string): Promise<void> {
  await page.evaluate(settle);
  await page.screenshot(join(import.meta.dir, '.artifacts', `${name}.png`));
}

/** The seeded echo thread with one turn run on it, so the transcript states a selection. */
async function conversation(size: { width: number; height: number }): Promise<BrowserPage> {
  const page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: size });
  pages.push(page);
  await page.waitFor(`document.querySelector('${testid('composer-picker')}')`);
  await page.evaluate(`(async () => {
    const store = ${STORE};
    window.__thread = store.openThread.id;
    await store.client.call('turns.start', { threadId: window.__thread, prompt: 'Name the case that is still silent.' });
  })()`);
  await page.waitFor(`${STORE}.openThread.turns.length === 2 && ${STORE}.openThread.status === 'idle'`);
  return page;
}

const say = (page: BrowserPage, prompt: string, turns: number) => page.evaluate(`${STORE}.client.call('turns.start', { threadId: window.__thread, prompt: ${JSON.stringify(prompt)} })`)
  .then(() => page.waitFor(`${STORE}.openThread.turns.length === ${turns} && ${STORE}.openThread.status === 'idle'`));

for (const [name, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
  test(`${name}: a picked change stands dashed under the last message, then stays above the turn that ran on it`, async () => {
    const page = await conversation(size);
    await shot(page, `switch-marker-before-${name}`);

    // The effort alone: the model once, then the two efforts.
    await page.evaluate(`${STORE}.update(window.__thread, { effort: 'low' })`);
    await page.waitFor(`document.querySelector('${testid('switch-pending')}')`);
    expect(await page.evaluate(line('switch-pending'))).toBe('Echo | default | low');
    expect(await page.evaluate(box('switch-pending'))).toEqual({ inside: true, wide: true, height: expect.any(Number), rows: 1 });
    // The thread was at its end: the row came into view above the composer by itself.
    expect(await page.evaluate(`document.querySelector('${testid('switch-pending')}').getBoundingClientRect().bottom <= document.querySelector('${testid('composer-input')}').getBoundingClientRect().top`)).toBe(true);
    await shot(page, `switch-marker-pending-effort-${name}`);

    // Another agent: both models, each behind its own mark.
    await page.evaluate(`${STORE}.update(window.__thread, { accountId: 'a-claude-main', model: 'claude-opus-5-5', effort: 'medium' })`);
    await page.waitFor(`document.querySelector('${testid('switch-to')}')?.textContent === 'Opus 5.5 medium'`);
    expect(await page.evaluate(line('switch-pending'))).toBe('Echo | Opus 5.5 medium');
    expect(await page.evaluate(box('switch-pending'))).toMatchObject({ inside: true, rows: 1 });
    await shot(page, `switch-marker-pending-${name}`);

    await say(page, 'Carry on from there.', 3);
    await page.waitFor(`document.querySelector('${testid('switch-marker-toggle')}') && !document.querySelector('${testid('switch-pending')}')`);
    expect(await page.evaluate(line('switch-marker'))).toBe('Echo | Opus 5.5 medium | context handed over');
    expect(await page.evaluate(box('switch-marker'))).toMatchObject({ inside: true });
    await page.evaluate(`document.querySelector('${testid('switch-marker')}').scrollIntoView({ block: 'center' })`);
    await shot(page, `switch-marker-divider-${name}`);

    await page.click(testid('switch-marker-toggle'));
    await page.waitFor(`document.querySelector('${testid('switch-marker-toggle')}').getAttribute('aria-expanded') === 'true'`);
    await page.waitFor(`document.querySelector('${testid('switch-handover')}').getBoundingClientRect().height > 20`);
    expect(await page.evaluate(`document.querySelector('${testid('switch-handover')} .counts').textContent`)).toMatch(/^4 messages in full · [\d,]+ characters$/);
    await shot(page, `switch-marker-handover-${name}`);
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  }, 60_000);
}
