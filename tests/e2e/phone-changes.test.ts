import { expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from '../../packages/core/src/client.ts';
import { BrowserPage } from './lib/cdp.ts';
import { mintPairing, startCore } from './lib/core.ts';
import { mobileAction, openMobilePanel, screensSettled } from './lib/mobile.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

const id = (name: string) => `[data-testid="${name}"]`;

test('Changes leaves its loading state in a folder without Git on a paired phone', async () => {
  ensureProductionUi();
  const core = await startCore();
  try {
    const owner = await connect(core.url, core.token);
    const thread = await (async () => {
      try {
        const path = join(core.dataDir, 'plain-folder');
        mkdirSync(path);
        const project = await owner.call('projects.add', { path });
        const account = (await owner.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
        return await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Plain folder' });
      } finally { owner.close(); }
    })();

    const page = await BrowserPage.launch({ url: 'about:blank', locale: 'en' });
    try {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await page.navigate(await mintPairing(core));
      await page.waitFor(`document.querySelector('${id('status-connection')}')?.dataset.state === 'ready'`);
      await mobileAction(page, 'mobile-conversations');
      await page.waitFor(screensSettled);
      await page.click(id(`mobile-thread-${thread.id}`));
      await page.waitFor(screensSettled);
      await openMobilePanel(page);
      await page.click(id('launch-changes'));

      // Refresh becomes available when the status request has settled.
      await page.waitFor(`document.querySelector('${id('changes-refresh')}')?.disabled === false`);
      expect(await page.text(id('changes-panel'))).not.toContain('Reading the working tree');
    } finally { await page.close(); }
  } finally { await core.stop(); }
}, 60_000);
