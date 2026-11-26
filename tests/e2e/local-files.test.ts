import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp';
import { startDevUi } from './lib/ui';

const shot = (name: string) => join(import.meta.dir, '.artifacts', name);

test('file chips open on the owning desktop, a program only once confirmed, and a missing file says where it was looked for', async () => {
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
      thread.messages.at(-1).parts = [{ type: 'text', text: 'The game is ready.\\n\\n[Launch game](game.exe) · [Instructions](README.md) · \`docs/missing.pdf\`' }];
      window.__shell = [];
      // A simulated shell: what it finds on disk, and the opener's calls recorded, never run.
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
        window.__shell.push([command, args]);
        if (command === 'client_path_info') return args.path.endsWith('game.exe') ? 'program' : args.path.endsWith('README.md') ? 'document' : 'missing';
      } };
      store.localCore = true;
    })()`);
    const calls = (command: string) => page!.evaluate<unknown[]>(`window.__shell.filter(([name]) => name === ${JSON.stringify(command)}).map(([, args]) => args)`);
    await page.waitFor('document.querySelector("a.file-chip[data-file-path=\\"game.exe\\"]")');
    // The fake seed's contact request sits in the top-right corner, where the file notice goes.
    await page.evaluate(`document.querySelector('[data-testid="contact-request-dismiss"]')?.click()`);
    // The missing file greys out on its own, before any click.
    await page.waitFor('document.querySelector("a.file-chip[data-file-path=\\"docs/missing.pdf\\"]")?.hasAttribute("data-missing")');
    expect(await page.evaluate(`document.querySelector('a.file-chip[data-file-path="docs/missing.pdf"]').innerText`)).toBe('missing.pdf');
    await page.settleAnimations();
    await page.screenshot(shot('file-chips-desktop.png'));

    // A program asks first; nothing opens until Launch.
    await page.click('a[data-file-path="game.exe"]');
    await page.waitFor('document.querySelector("[data-testid=confirm-ok]")');
    expect(await page.text('[data-testid=confirm-ok]')).toBe('Launch');
    expect(await calls('open_client_path')).toEqual([]);
    await page.settleAnimations();
    await page.screenshot(shot('file-chip-launch-confirm-desktop.png'));
    await page.click('[data-testid=confirm-ok]');
    await page.waitFor('window.__shell.some(([name]) => name === "open_client_path")');
    const [opened] = await calls('open_client_path') as Array<{ path: string; confirmed: boolean }>;
    expect(opened?.path.endsWith('game.exe')).toBe(true);
    expect(opened?.confirmed).toBe(true);
    // Its second choice shows the program in its folder, and runs nothing.
    await page.click('a[data-file-path="game.exe"]');
    await page.waitFor('document.querySelector("[data-testid=confirm-alt]")');
    await page.click('[data-testid=confirm-alt]');
    await page.waitFor('window.__shell.some(([name]) => name === "reveal_client_path")');
    expect((await calls('open_client_path')).length).toBe(1);

    // A document of the project opens in the panel's Files tab.
    await page.click('a[data-file-path="README.md"]');
    await page.waitFor('document.querySelector("[data-testid=file-panel]")');
    expect((await calls('open_client_path')).length).toBe(1);

    // A missing file gives a notice with its whole path, never an empty card.
    await page.click('a[data-file-path="docs/missing.pdf"]');
    await page.waitFor('document.querySelector("[data-testid=file-link-toast]")');
    expect(await page.text('[data-testid=file-link-toast-title]')).toBe('Not found on this computer');
    expect(await page.text('[data-testid=file-link-toast-path]')).toContain('missing.pdf');
    expect(await page.evaluate('document.querySelector("[data-testid=chat-file]")')).toBeNull();
    await page.settleAnimations();
    await page.screenshot(shot('file-chip-missing-desktop.png'));

    // A remote core's program stays on its machine: the panel shows it, the opener never sees it.
    await page.evaluate(`(async () => { const { workspace } = await import('/src/lib/workspace.svelte.ts'); workspace.active.localCore = false; })()`);
    const before = (await calls('open_client_path')).length + (await calls('client_path_info')).length;
    await page.click('a[data-file-path="game.exe"]');
    await page.waitFor('document.querySelector("[data-testid=file-path]")?.textContent.includes("game.exe")');
    expect(await page.evaluate('document.querySelector("[data-testid=confirm-ok]")')).toBeNull();
    expect((await calls('open_client_path')).length + (await calls('client_path_info')).length).toBe(before);

    // The reported case: an agent on a Linux machine names a drive of this PC. The chip asks this computer, not the thread's.
    await page.evaluate(`(async () => {
      const { workspace } = await import('/src/lib/workspace.svelte.ts');
      const store = workspace.active;
      store.core = { ...store.core, os: 'linux' };
      store.openThread.messages.at(-1).parts = [{ type: 'text', text: 'The installer is built: **\`N:\\\\builds\\\\orbitkit\\\\orbitkit-setup.exe\`**' }];
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        window.__shell.push([command, args]);
        if (command === 'client_path_info') return args.path === 'N:\\\\builds\\\\orbitkit\\\\orbitkit-setup.exe' ? 'program' : 'missing';
      };
    })()`);
    const installer = 'a.file-chip[data-kind=program]';
    await page.waitFor(`document.querySelector('${installer}')?.innerText === 'orbitkit-setup.exe'`);
    await page.click(installer);
    await page.waitFor('document.querySelector("[data-testid=confirm-ok]")');
    expect(await page.text('[data-testid=confirm-dialog], [role=dialog]')).toContain('N:\\builds\\orbitkit\\orbitkit-setup.exe');
    await page.evaluate(`(async () => {
      (await import('/src/lib/file-open.svelte.ts')).fileNotice.dismiss();
      document.querySelector('[data-testid="contact-request-dismiss"]')?.click();
    })()`);
    await page.settleAnimations();
    await page.screenshot(shot('file-chip-pc-drive-confirm-desktop.png'));
    await page.click('[data-testid=confirm-cancel]');
    await page.waitFor('!document.querySelector("[data-testid=confirm-ok]")');

    // A phone has no opener: the same chips, and the notice for a missing file.
    await page.evaluate('delete window.__TAURI_INTERNALS__');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.click('[data-testid=panel-close]').catch(() => {});
    await page.settleAnimations();
    await page.screenshot(shot('file-chips-phone.png'));
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  } finally { await page?.close(); await server.close(); }
}, 90_000);
