import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startDevUi } from './lib/ui';

test('local launch links and file actions use the owning desktop, with browser and phone fallbacks', async () => {
  const port = await freePort();
  const server = await startDevUi(port);
  let page: BrowserPage | undefined;
  try {
    page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&open=recent&machines=1`, windowSize: { width: 1300, height: 850 } });
    await page.waitFor('document.querySelector("[data-thread-id=t-trace]")');
    await page.click('[data-thread-id=t-trace]');
    await page.evaluate(`(async () => {
      const { workspace } = await import('/src/lib/workspace.svelte.ts');
      const store = workspace.active;
      const thread = store.openThread;
      await store.client.call('files.write', { threadId: thread.id, path: 'game.exe', text: 'Inert game fixture' });
      thread.messages.at(-1).parts = [{ type: 'text', text: 'The game is ready.\\n\\n[Launch game](game.exe) · [Instructions](README.md) · [Manual](missing.pdf)' }];
      window.__fileOpens = []; window.__chatOpens = [];
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => { if (command === 'open_local_file') window.__fileOpens.push(args); if (command === 'open_chat_file') window.__chatOpens.push(args); } };
      store.localCore = true;
    })()`);
    await page.waitFor('document.querySelector("a[data-file-path=\\"game.exe\\"]")');
    expect(await page.evaluate('window.__fileOpens.length')).toBe(0);
    // A program link shows its preview first; only the preview's Open hands it to the opener.
    await page.click('a[data-file-path="game.exe"]');
    await page.waitFor('document.querySelector("[data-testid=chat-file] [data-testid=artifact-open]")');
    await page.settleAnimations();
    expect(await page.evaluate('window.__fileOpens.length')).toBe(0);
    await page.screenshot(join(import.meta.dir, '.artifacts', 'local-file-program-preview-desktop.png'));
    // The program's name beside Open is not a launcher.
    await page.click('[data-testid=chat-file] [data-testid=artifact-launch]');
    await Bun.sleep(300);
    expect(await page.evaluate('window.__fileOpens.length')).toBe(0);
    await page.click('[data-testid=artifact-open]');
    await page.waitFor('window.__fileOpens.length === 1');
    expect(await page.evaluate('window.__fileOpens[0].path')).toBe('game.exe');
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'local-file-launch-desktop.png'));

    await page.click('a[data-file-path="README.md"]');
    await page.waitFor('document.querySelector("[data-testid=artifact-open]")');
    // A document's name opens it as a direct click would, through the shell's own document check.
    await page.click('[data-testid=chat-file] [data-testid=artifact-launch]');
    await page.waitFor('window.__chatOpens.length === 1');
    expect(await page.evaluate('window.__chatOpens[0].path')).toBe('README.md');
    expect(await page.evaluate('window.__fileOpens.length')).toBe(1);
    await page.click('[data-testid=artifact-open]');
    await page.waitFor('window.__fileOpens.length === 2');
    expect(await page.evaluate('window.__fileOpens[1].path')).toBe('README.md');
    await page.screenshot(join(import.meta.dir, '.artifacts', 'local-file-open-desktop.png'));

    await page.click('a[data-file-path="missing.pdf"]');
    await page.waitFor('document.querySelector("[data-testid=chat-file] [role=alert]")');
    expect(await page.evaluate('document.querySelector("[data-testid=artifact-download]")')).toBeNull();
    await page.click('[data-testid=artifact-open]');
    await page.waitFor('window.__fileOpens.length === 3');
    expect(await page.evaluate('window.__fileOpens[2].path')).toBe('missing.pdf');
    await page.screenshot(join(import.meta.dir, '.artifacts', 'local-file-preview-error-desktop.png'));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'local-file-preview-error-phone.png'));

    // A remote core must never hand its paths to this computer's opener.
    await page.evaluate(`(async () => { const { workspace } = await import('/src/lib/workspace.svelte.ts'); workspace.active.localCore = false; })()`);
    await page.click('a[data-file-path="game.exe"]');
    await page.waitFor('document.querySelector("[data-testid=artifact-download]")?.download === "game.exe"');
    expect(await page.evaluate('document.querySelector("[data-testid=artifact-open]")')).toBeNull();
    expect(await page.evaluate('window.__fileOpens.length')).toBe(3);
    // The browser/phone keeps the same download path, with no native opener.
    await page.evaluate('delete window.__TAURI_INTERNALS__');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'local-file-phone.png'));
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  } finally { await page?.close(); await server.close(); }
}, 90_000);
