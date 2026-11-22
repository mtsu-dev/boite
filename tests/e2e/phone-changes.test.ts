import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from '../../packages/core/src/client.ts';
import { BrowserPage } from './lib/cdp.ts';
import { mintPairing, pairingUrlOf, startCore } from './lib/core.ts';
import { mobileAction, openMobilePanel, screensSettled } from './lib/mobile.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

const id = (name: string) => `[data-testid="${name}"]`;

test('Changes keeps Git errors in the panel after a repository disappears on desktop and a paired phone', async () => {
  ensureProductionUi();
  const core = await startCore();
  try {
    const owner = await connect(core.url, core.token);
    const path = join(core.dataDir, 'plain-folder');
    mkdirSync(path);
    const thread = await (async () => {
      try {
        const project = await owner.call('projects.add', { path });
        const account = (await owner.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
        return await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Plain folder' });
      } finally { owner.close(); }
    })();

    for (const mobile of [false, true]) {
      const git = Bun.spawnSync(['git', 'init'], { cwd: path });
      expect(git.exitCode).toBe(0);
      writeFileSync(join(path, 'note.txt'), 'Review this change\n');
      const page = await BrowserPage.launch({ url: 'about:blank', locale: mobile ? 'fr' : 'en', windowSize: { width: 1440, height: 900 } });
      try {
        if (mobile) {
          await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile });
          await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        }
        await page.navigate(mobile ? await mintPairing(core) : pairingUrlOf(core));
        await page.waitFor(`document.querySelector('${id('status-connection')}')?.dataset.state === 'ready'`);
        if (mobile) await mobileAction(page, 'mobile-conversations');
        await page.waitFor(screensSettled);
        await page.click(mobile ? id(`mobile-thread-${thread.id}`) : `${id('thread-row')}[data-thread-id="${thread.id}"]`);
        await page.waitFor(screensSettled);
        await openMobilePanel(page);
        await page.click(id('launch-changes'));

        const row = `${id('changes-row')}[data-path="note.txt"]`;
        await page.waitFor(`document.querySelector('${row}')?.parentElement.querySelector('${id('diff-view')}')`);
        // Keep this path selected when reopening the panel, even after status fails.
        await page.click(row);
        rmSync(join(path, '.git'), { recursive: true });
        await page.click(id('changes-refresh'));

        // Refresh becomes available when the status request has settled.
        await page.waitFor(`document.querySelector('${id('changes-refresh')}')?.disabled === false`);
        expect(await page.text(id('changes-error'))).toBe(mobile ? 'Ce dossier se trouve hors d’un dépôt Git.' : 'This folder is outside a Git repository.');
        const captures = process.env['BOITE_E2E_CAPTURES'];
        if (captures) await page.screenshot(join(captures, `changes-${mobile ? 'phone' : 'desktop'}.png`));
        await page.click(id('panel-close'));
        await page.waitFor(`!document.querySelector('${id('changes-panel')}')`);
        expect(await page.evaluate('!document.body.textContent.includes("is not inside a git repository")')).toBe(true);
        await openMobilePanel(page);
        await page.waitFor(`document.querySelector('${id('changes-error')}')`);
        expect(await page.evaluate('!document.body.textContent.includes("is not inside a git repository")')).toBe(true);
      } finally { await page.close(); }
    }
  } finally { await core.stop(); }
}, 60_000);
