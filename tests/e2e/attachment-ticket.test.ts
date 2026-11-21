import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from '../../packages/core/src/client.ts';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startCore } from './lib/core.ts';
import { mobileAction } from './lib/mobile.ts';
import { startUi } from './lib/ui.ts';

test('the attachment viewer reads an original URL on desktop and phone with either client', async () => {
  const port = await freePort();
  const app = `http://127.0.0.1:${port}`;
  const ui = await startUi(port);
  const core = await startCore();
  const owner = await connect(core.url, core.token);
  try {
    await owner.call('settings.set', { browserOrigins: [app] });
    await owner.call('projects.add', { path: core.dataDir, name: 'Ticketed photo' });
    const icon = readFileSync(join(import.meta.dir, '../../packages/ui/public/icons/icon-192.png'));
    const picture = Buffer.concat([icon, Buffer.alloc(128 * 1024)]);
    const attachment = { kind: 'image', mimeType: 'image/png', name: 'photo.png', data: picture.toString('base64') };
    for (const simulated of [true, false]) {
      const page = await BrowserPage.launch({ url: 'about:blank', windowSize: { width: 1440, height: 844 } });
      try {
        await page.navigate(simulated
          ? `${app}/?fake=1`
          : `${app}/?core=${encodeURIComponent(core.url)}&token=${encodeURIComponent(core.token)}`);
        if (!simulated) await page.click('[data-testid=confirm-ok]');
        const store = 'globalThis.__boiteTest.workspace.primary';
        await page.waitFor(`${store}.connection === 'ready' && ${store}.projects.length > 0`);
        const thread = await page.evaluate<string>(`(async () => {
          const { workspace } = globalThis.__boiteTest, owner = workspace.primary, client = owner.client;
          const account = (await client.call('accounts.list', {})).find(account => account.providerId === 'echo');
          const thread = await client.call('threads.create', { projectId: owner.projects[0].id, providerId: account.providerId, accountId: account.id, title: 'Open the original' });
          const turn = await client.call('turns.start', { threadId: thread.id, prompt: 'Review the photo', attachments: [${JSON.stringify(attachment)}] });
          globalThis.photoTurn = turn.id;
          return thread.id;
        })()`);
        await page.waitFor(`${store}.client.call('threads.get', { threadId: '${thread}', compactFiles: true }).then(result => result.turns.some(turn => turn.id === globalThis.photoTurn && turn.status === 'done'))`);
        await page.evaluate(`globalThis.__boiteTest.workspace.select(${store}, '${thread}')`);
        for (const mobile of [false, true]) {
          const width = mobile ? 390 : 1440;
          await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile });
          if (mobile && !await page.evaluate(`document.querySelector('[data-testid=image-open]')?.checkVisibility()`)) {
            await mobileAction(page, 'mobile-conversations');
            await page.click(`[data-testid="mobile-thread-${thread}"]`);
          }
          await page.click('[data-testid=image-open]');
          const viewer = '[data-testid=image-viewer] img';
          await page.waitFor(`document.querySelector('${viewer}')?.naturalWidth === 192`);
          const original = await page.evaluate<string>(`document.querySelector('${viewer}').src`);
          expect(original).toStartWith(simulated ? 'blob:' : `${core.url}/file/`);
          if (simulated) expect(await page.evaluate(`fetch(${JSON.stringify(original)}).then(response => response.arrayBuffer()).then(buffer => buffer.byteLength)`)).toBe(picture.length);
          else expect(Buffer.from(await (await fetch(original)).arrayBuffer())).toEqual(picture);
          const captureDir = process.env.BOITE_E2E_CAPTURES;
          if (captureDir) {
            await page.settleAnimations();
            await page.screenshot(join(captureDir, `attachment-${simulated ? 'fake' : 'core'}-${width}.png`));
          }
          await page.click('[data-testid=image-viewer-close]');
          await page.waitFor(`!document.querySelector('${viewer}')`);
        }
      } finally { await page.close(); }
    }
  } finally {
    owner.close();
    try { await core.stop(); } finally { await ui.close(); }
  }
}, 60_000);
