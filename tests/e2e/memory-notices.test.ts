import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startDevUi } from './lib/ui';

let server: { close(): Promise<void> };
let page: BrowserPage;
const id = (name: string) => `[data-testid="${name}"]`;

beforeAll(async () => {
  const port = await freePort();
  server = await startDevUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent`, windowSize: { width: 1280, height: 900 } });
  await page.waitFor(`document.querySelector('[data-thread-id="t-trace"]')`);
  await page.click('[data-thread-id="t-trace"]');
  await page.waitFor('globalThis.__boiteTest.workspace.active.openThread?.id === "t-trace"');
}, 90000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

async function escape() {
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

async function capture(name: string) {
  await page.evaluate('Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])');
  await page.screenshot(join(import.meta.dir, '.artifacts', `memory-${name}.png`));
}

test('memory stops arrive together in the notification corner and link to a working switch on desktop and phone', async () => {
  await page.evaluate("__boiteTest.setTheme('dark')");
  await page.evaluate(`(async () => {
    const { setLocaleSetting } = await import('/src/lib/i18n.svelte.ts');
    await setLocaleSetting('fr');
    const store = __boiteTest.workspace.active;
    const thread = store.openThread;
    const message = thread.messages.at(-1);
    const at = Date.now();
    thread.messages = [thread.messages[0], message];
    message.parts = [
      { type: 'text', text: 'Checking the build before retrying.' },
      { type: 'tool', toolId: 'first', name: 'Bash', input: { command: 'cargo check' }, output: 'Checked', status: 'done', startedAt: at - 10000 },
      { type: 'tool', toolId: 'build', name: 'Bash', input: { command: 'cargo build' }, output: 'Process stopped', status: 'error', startedAt: at - 5000 },
      { type: 'text', text: 'Retrying the build with two workers.' },
      { type: 'tool', toolId: 'retry', name: 'Bash', input: { command: 'cargo build -j 2' }, output: 'Build completed', status: 'done', startedAt: at + 20000 },
    ];
    // A thread opened with no stops: every one that lands now is news.
    thread.memoryEvents = [];
  })()`);
  for (const width of [1280, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 720 });
    // Each width gets stops of its own: the corner shows a group once, and the way to the settings puts it away.
    await page.evaluate(`(() => {
      const thread = __boiteTest.workspace.active.openThread;
      const message = thread.messages.at(-1);
      // In the past, so a later stop of the next test is still news to a corner remounted after the settings.
      const at = Date.now() - 100;
      thread.memoryEvents = [...thread.memoryEvents, ...['uvx.exe', 'bunx.exe', 'uv.exe', 'node.exe'].map((exe, index) => ({
        threadId: thread.id, kind: 'killed', reason: 'machine', limitBytes: 3072 * 1048576,
        exe, bytes: [456 * 1024, 284 * 1048576, 116 * 1048576, 66 * 1048576][index],
        state: 'critical', at: at + index, anchor: { messageId: message.id, partIndex: 3 },
      }))];
    })()`);
    // The four stops that read the same fold into one notice.
    await page.waitFor(`document.querySelector('${id('memory-row')}')?.textContent.includes('4 processus')`);
    expect(await page.evaluate(`document.querySelectorAll('${id('memory-row')}').length`)).toBe(1);
    // News about the machine, not part of the conversation: in the corner, out of the timeline.
    expect(await page.evaluate(`(() => { const row = document.querySelector('${id('memory-row')}'); return !!row.closest('${id('memory-corner')}') && !document.querySelector('${id('timeline')}').contains(row); })()`)).toBe(true);
    await capture(width < 720 ? 'phone' : 'desktop');
    const row = await page.evaluate<{ height: number; fits: boolean; inside: boolean }>(`(() => { const e = document.querySelector('${id('memory-row')}'); const r = e.getBoundingClientRect(); return { height: r.height, fits: e.scrollWidth <= e.clientWidth, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; })()`);
    expect(row.height).toBeLessThan(width < 720 ? 250 : 180);
    expect(row.fits).toBe(true);
    expect(row.inside).toBe(true);
    // Every stopped process and its size sit behind the "i".
    await page.click(id('memory-row-info'));
    await page.waitFor(`document.querySelector('${id('memory-row-info-text')}')`);
    const info = await page.text(id('memory-row-info-text'));
    for (const name of ['uvx.exe', 'bunx.exe', 'uv.exe', 'node.exe']) expect(info).toContain(name);
    await capture(width < 720 ? 'phone-expanded' : 'desktop-expanded');
    await escape();
    await page.click(`${id('memory-row')} .configure`);
    await page.waitFor(`document.querySelector('${id('setting-memory-protection')}')`);
    await capture(width < 720 ? 'settings-phone' : 'settings-desktop');
    await page.click(id('setting-memory-protection'));
    await page.waitFor(`__boiteTest.workspace.active.settings.memoryProtection === false && __boiteTest.workspace.active.memory.limits.budgetMb === 0`);
    expect(await page.evaluate(`document.querySelector('${id('memory-cap')}').disabled`)).toBe(true);
    expect(await page.text(id('memory-status'))).toContain('Protection mémoire désactivée');
    await capture(width < 720 ? 'settings-phone-off' : 'settings-desktop-off');
    await page.click(id('setting-memory-protection'));
    await page.waitFor(`__boiteTest.workspace.active.settings.memoryProtection === true && __boiteTest.workspace.active.memory.limits.budgetMb > 0`);
    await page.evaluate('__boiteTest.workspace.active.showChat()');
    await page.waitFor(`document.querySelector('${id('timeline')}') && !document.querySelector('${id('memory-row')}')`);
  }
  expect(page.errors()).toEqual([]);
}, 60000);

test('a single stopped process fits both themes and narrow screens, including long executable names', async () => {
  await page.evaluate(`(async () => {
    const { setLocaleSetting } = await import('/src/lib/i18n.svelte.ts');
    await setLocaleSetting('en');
    const thread = __boiteTest.workspace.active.openThread;
    thread.memoryEvents = [{
      threadId: thread.id, kind: 'killed', reason: 'machine', limitBytes: 3277 * 1048576,
      exe: 'C:\\\\tools\\\\python.exe', bytes: 334 * 1048576, state: 'critical', at: Date.now(),
      anchor: { messageId: thread.messages.at(-1).id, partIndex: 3 },
    }];
  })()`);
  await page.evaluate('__boiteTest.workspace.active.showChat()');
  // One stop names its process, without its folder, and its size under the title.
  await page.waitFor(`document.querySelector('${id('memory-row')} .detail')?.textContent === 'python.exe, 334 MB'`);
  for (const width of [1280, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 720 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(`__boiteTest.setTheme('${theme}')`);
      await capture(`single-${width < 720 ? 'phone' : 'desktop'}-${theme}`);
      expect(await page.text(`${id('memory-row')} .detail`)).toBe('python.exe, 334 MB');
      expect(await page.evaluate(`(() => {
        const row = document.querySelector('${id('memory-row')}');
        const r = row.getBoundingClientRect();
        const button = row.querySelector('.configure').getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && row.scrollWidth <= row.clientWidth
          && button.right <= r.right && button.bottom <= r.bottom;
      })()`)).toBe(true);
    }
  }
  await page.evaluate(`__boiteTest.workspace.active.openThread.memoryEvents[0].exe = '/bin/' + 'long-build-worker-'.repeat(12) + '.exe'`);
  await page.waitFor(`document.querySelector('${id('memory-row')} .detail')?.textContent.startsWith('long-build-worker-')`);
  expect(await page.evaluate(`(() => {
    const row = document.querySelector('${id('memory-row')}');
    const process = row.querySelector('.detail');
    const r = row.getBoundingClientRect();
    return row.scrollWidth <= row.clientWidth && process.scrollWidth <= process.clientWidth && r.left >= 0 && r.right <= innerWidth;
  })()`)).toBe(true);
  expect(page.errors()).toEqual([]);
}, 30000);

test('a throttling notice shows its whole sentence in the corner, apart from the conversation, on desktop and phone', async () => {
  const limit = 5120 * 1048576;
  const row = id('memory-row');
  await page.evaluate("__boiteTest.setTheme('dark')");
  await page.evaluate('__boiteTest.workspace.active.showChat()');
  for (const locale of ['en', 'fr']) {
    const size = locale === 'fr' ? '5,0 Go' : '5.0 GB';
    // Its own conversation, so the test reads the same alone or after the others.
    await page.evaluate(`(async () => {
      const { setLocaleSetting } = await import('/src/lib/i18n.svelte.ts');
      await setLocaleSetting('${locale}');
      const thread = __boiteTest.workspace.active.openThread;
      const message = thread.messages.findLast(item => item.role === 'assistant');
      const at = Date.now();
      thread.messages = [thread.messages[0], message];
      message.parts = [
        { type: 'text', text: 'Building the release binary.' },
        { type: 'tool', toolId: 'throttle-check', name: 'Bash', input: { command: 'cargo check' }, output: 'Checked', status: 'done', startedAt: at - 10000 },
        { type: 'tool', toolId: 'throttle-build', name: 'Bash', input: { command: 'cargo build --release' }, output: 'Finished', status: 'done', startedAt: at - 5000 },
        { type: 'text', text: 'The build went through with two workers.' },
        { type: 'tool', toolId: 'throttle-test', name: 'Bash', input: { command: 'cargo test -j 2' }, output: 'Passed', status: 'done', startedAt: at + 20000 },
      ];
      thread.memoryEvents = [{
        threadId: thread.id, kind: 'throttled', limitBytes: ${limit}, bytes: ${limit} + 1073741824, state: 'ok', at,
        anchor: { messageId: message.id, partIndex: 3 },
      }];
    })()`);
    await page.waitFor(`document.querySelector('${row}')?.dataset.kind === 'throttled' && document.querySelector('${row} .detail')?.textContent.includes('${size}')`);
    // The page's texts come back here and are compared in this process, never spliced into page code.
    const shown = await page.evaluate<{ expected: string; row: string; corner: string; timeline: string }>(`(async () => {
      const { strings } = await import('/src/lib/strings.ts');
      const { bytes } = await import('/src/lib/format.ts');
      return {
        expected: strings.resources.throttled(bytes(${limit})),
        row: document.querySelector('${row} .detail').textContent,
        corner: document.querySelector('${id('memory-corner')}').textContent,
        timeline: document.querySelector('${id('timeline')}').textContent,
      };
    })()`);
    expect(shown.expected).toContain(size);
    expect(shown.row).toBe(shown.expected);
    // The sentence is the corner's, not a line of the conversation, and names the limit, never the size it reached.
    expect(shown.timeline).not.toContain(shown.expected);
    expect(shown.timeline).toContain('The build went through');
    expect(shown.corner).not.toContain('6.0 GB');
    expect(shown.corner).not.toContain('6,0 Go');
    expect(await page.evaluate(`document.querySelectorAll('${row}').length`)).toBe(1);
    // The whole sentence is the notice: no title over it, nothing behind an "i".
    expect(await page.evaluate(`document.querySelectorAll('${row} .title, ${row} .sub .detail, ${id('memory-row-info')}').length`)).toBe(0);
    for (const [width, height] of [[1280, 900], [390, 844]] as const) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 720 });
      // French is the longer sentence, so it is the one kept as the capture.
      if (locale === 'fr') await capture(width < 720 ? 'throttled-phone' : 'throttled-desktop');
      // Every line of the sentence lies inside the row and the row inside the screen: nothing is clipped.
      expect(await page.evaluate(`(() => {
        const row = document.querySelector('${row}');
        const text = row.querySelector('.detail');
        const r = row.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(text);
        const lines = [...range.getClientRects()];
        const button = row.querySelector('.configure').getBoundingClientRect();
        return lines.length > 0 && lines.every(line => line.left >= r.left && line.right <= r.right && line.top >= r.top && line.bottom <= r.bottom)
          && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
          && row.scrollWidth <= row.clientWidth && text.scrollWidth <= text.clientWidth && text.scrollHeight <= text.clientHeight
          && button.right <= r.right && button.bottom <= r.bottom;
      })()`)).toBe(true);
    }
  }
  expect(page.errors()).toEqual([]);
}, 30000);
