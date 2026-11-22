import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { newMobileThread, toMobileList } from './lib/mobile';
import { startDevUi } from './lib/ui';

const id = (name: string) => `[data-testid="${name}"]`;
const CANVAS = `document.querySelector('${id('draft-backdrop')}')`;
const shot = (name: string) => join(import.meta.dir, '.artifacts', `backdrop-${name}.png`);
const SCENES = ['glyphs', 'crates', 'tunnel'] as const;

interface Pace { rate: number; cost: number }

/** Frames a second and the page's own time in a frame, read from the renderer over a second and a half. */
const PACE = `import('/src/lib/backdrop/engine.ts').then(async ({ stats }) => {
  const from = stats.frames, began = performance.now();
  let cost = 0, samples = 0;
  await new Promise((done) => {
    const timer = setInterval(() => { cost += stats.milliseconds; samples++; }, 16);
    setTimeout(() => { clearInterval(timer); done(null); }, 1500);
  });
  return { rate: ((stats.frames - from) / (performance.now() - began)) * 1000, cost: cost / samples };
})`;

async function settings(page: BrowserPage, tab: string, control: string) {
  await page.click(id('nav-settings'));
  await page.click(id(`settings-tab-${tab}`));
  await page.click(id(control));
  await page.click(id('settings-back'));
  await page.waitFor(`document.querySelector('${id('draft-empty')}')`);
}

test('the new thread background rides its experiment, follows the pick in Appearance and holds still under reduced motion or a cover', async () => {
  const port = await freePort();
  // The page reads the renderer's own counters, by its source URL.
  const server = await startDevUi(port);
  let page: BrowserPage | undefined;
  try {
    page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1` });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`document.querySelector('${id('draft-empty')}')`);
    expect(await page.evaluate(`${CANVAS} === null`)).toBe(true);
    await page.screenshot(shot('off-desktop'));

    // A runner without a graphics card has no WebGL 2: the canvas is then there and stays empty.
    // `BOITE_E2E_ANGLE` names a backend that draws on a machine whose default one does not.
    const drawn = await page.evaluate<boolean>(`!!document.createElement('canvas').getContext('webgl2')`);

    await settings(page, 'experiments', 'experiment-draft-backdrop');
    // Nothing picked yet: one of the three, drawn for this screen.
    await page.waitFor(CANVAS);
    expect(SCENES as readonly string[]).toContain(await page.evaluate<string>(`${CANVAS}.dataset.scene`));

    for (const scene of SCENES) {
      await settings(page, 'appearance', `backdrop-${scene}`);
      await page.waitFor(`${CANVAS}?.dataset.scene === '${scene}'`);
      // Behind the whole column, and never over a control of it.
      expect(await page.evaluate(`(() => {
        const canvas = ${CANVAS}.getBoundingClientRect(), chat = document.querySelector('${id('chat')}').getBoundingClientRect();
        const input = document.querySelector('${id('composer-input')}').getBoundingClientRect();
        const top = document.elementFromPoint(input.left + input.width / 2, input.top + input.height / 2);
        return canvas.width === chat.width && canvas.height === chat.height && !!top?.closest('.composer');
      })()`)).toBe(true);
      if (!drawn) {
        await page.evaluate(`import('/src/lib/backdrop/engine.ts').then(() => new Promise((done) => setTimeout(done, 200)))`);
        expect(await page.evaluate(`${CANVAS}.hasAttribute('data-ready')`)).toBe(false);
        continue;
      }
      await page.waitFor(`${CANVAS}.hasAttribute('data-ready')`);
      const pace = await page.evaluate<Pace>(PACE);
      console.log(`backdrop ${scene}: ${pace.rate.toFixed(0)} frames a second, ${pace.cost.toFixed(2)} ms of the page's time each, canvas ${await page.evaluate<string>(`${CANVAS}.width + 'x' + ${CANVAS}.height`)}`);
      expect(pace.rate).toBeGreaterThan(10);
      await page.screenshot(shot(`${scene}-desktop`));
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await Bun.sleep(400);
      await page.screenshot(shot(`${scene}-phone`));
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.waitFor(`document.querySelector('${id('nav-settings')}')`);
    }

    if (drawn) {
      // A device that asks for reduced motion gets one still frame, and the motion back when it stops asking.
      const frames = () => page!.evaluate<number>(`import('/src/lib/backdrop/engine.ts').then(({ stats }) => stats.frames)`);
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await Bun.sleep(300);
      const held = await frames();
      await Bun.sleep(500);
      expect(await frames()).toBe(held);
      await page.send('Emulation.setEmulatedMedia', { features: [] });
      await Bun.sleep(500);
      expect(await frames()).toBeGreaterThan(held);

      // A phone keeps the draft mounted under its list: nothing is drawn there, and the scene is back with the draft.
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await page.waitFor(`document.querySelector('${id('mobile-back')}')`);
      await toMobileList(page);
      // The cover skips the chat once its own exits have ended.
      await Bun.sleep(800);
      const covered = await frames();
      await Bun.sleep(500);
      expect(await frames()).toBe(covered);
      await newMobileThread(page);
      await page.waitFor(`${CANVAS}?.hasAttribute('data-ready') && ${CANVAS}.checkVisibility({ visibilityProperty: true })`);
      await Bun.sleep(500);
      expect(await frames()).toBeGreaterThan(covered);
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.waitFor(`document.querySelector('${id('nav-settings')}')`);
    }

    await settings(page, 'appearance', 'backdrop-off');
    expect(await page.evaluate(`${CANVAS} === null`)).toBe(true);
    await settings(page, 'appearance', 'backdrop-tunnel');
    await page.waitFor(CANVAS);
    await settings(page, 'experiments', 'experiment-draft-backdrop');
    expect(await page.evaluate(`${CANVAS} === null`)).toBe(true);
  } finally {
    await page?.close();
    await server.close();
  }
}, 120_000);
