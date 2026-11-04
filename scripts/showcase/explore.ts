/**
 * Opens the showcase app once and runs page scripts given on stdin, one per
 * line as `<name> <js>`, saving `<name>.png` and `<name>.txt` after each.
 * A tool for writing steps: `bun scripts/showcase/explore.ts --out <dir> [--phone] [--query <q>]`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION } from '../../packages/ui/src/lib/onboarding';
import { assertHardware, launchBrowser, startServer, waitForMemory } from './server';

const arg = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : Bun.argv[index + 1] ?? fallback;
};
const out = resolve(arg('out', 'showcase-explore'));
const phone = Bun.argv.includes('--phone');
const query = arg('query', 'fake=1&team=1&agents=1&subagents=1&board=1&debates=1&windows=1&machines=1');
mkdirSync(out, { recursive: true });
await waitForMemory(3.5e9);
const rig = await startServer();
let browser: any;
try {
  browser = await launchBrowser('/usr/bin/google-chrome');
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });
  await context.addInitScript(({ key, version }: any) => {
    localStorage.setItem('boite.locale', 'en');
    localStorage.setItem(key, JSON.stringify({ version, at: 0 }));
  }, { key: ONBOARDING_STORAGE_KEY, version: ONBOARDING_VERSION });
  const page = await context.newPage();
  page.on('pageerror', (e: Error) => console.log('pageerror', e.message));
  await page.goto(`${rig.base}/?${query}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => (globalThis as any).__boiteTest?.workspace.active.booted, null, { timeout: 120000 });
  console.log('renderer', await assertHardware(page));
  const lines = (await Bun.stdin.text()).split('\n').filter(l => l.trim());
  for (const line of lines) {
    const [name, ...rest] = line.split(' ');
    try {
      const fn = new Function('page', 'store', `return (async () => { ${rest.join(' ')} })()`);
      const store = { eval: (js: string) => page.evaluate(js) };
      const value = await fn(page, store);
      if (value !== undefined) console.log(name, '=>', typeof value === 'string' ? value : JSON.stringify(value).slice(0, 4000));
    } catch (error) { console.log(name, 'ERROR', (error as Error).message.split('\n')[0]); }
    await Bun.sleep(400);
    await page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled', caret: 'hide' });
    writeFileSync(join(out, `${name}.txt`), await page.locator('body').ariaSnapshot().catch((e: Error) => e.message));
  }
} finally {
  await browser?.close();
  await rig.close();
}
