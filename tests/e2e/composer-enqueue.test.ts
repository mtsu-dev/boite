import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { RpcMethodName, RpcParams, RpcResult } from '../../packages/contracts/src/index.ts';
import { connect } from '../../packages/core/src/client.ts';
import { invalidEnqueue, revivedPrompt, reviveWithEnqueue } from '../contract/composer.ts';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startCore } from './lib/core.ts';
import { startUi } from './lib/ui.ts';

const workspace = 'globalThis.__boiteTest.workspace';

test('the browser client can prompt a retired child again on desktop and phone', async () => {
  const port = await freePort();
  const app = `http://127.0.0.1:${port}`;
  const ui = await startUi(port);
  const core = await startCore();
  const owner = await connect(core.url, core.token);
  try {
    await owner.call('settings.set', { browserOrigins: [app] });
    for (const simulated of [true, false]) {
      const page = await BrowserPage.launch({ url: 'about:blank', windowSize: { width: 1440, height: 844 } });
      try {
        await page.navigate(simulated
          ? `${app}/?fake=1`
          : `${app}/?core=${encodeURIComponent(core.url)}&token=${encodeURIComponent(core.token)}`);
        if (!simulated) await page.click('[data-testid=confirm-ok]');
        await page.waitFor(`${workspace}.primary.booted && ${workspace}.primary.connection === 'ready'`);
        const env = {
          newFolder: async () => simulated ? `C:\\Users\\you\\fixture\\${crypto.randomUUID()}` : mkdtempSync(join(core.dataDir, 'enqueue-')),
          async call<M extends RpcMethodName>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
            const result = await page.evaluate<{ value: RpcResult<M> } | { error: unknown }>(`(async () => {
              try { return { value: await ${workspace}.primary.client.call(${JSON.stringify(method)}, ${JSON.stringify(params)}) }; }
              catch (error) { return { error: { code: error.rpc?.code ?? error.code, message: error.message } }; }
            })()`);
            if ('error' in result) throw Object.assign(new Error(`${method} failed`), result.error);
            return result.value;
          }
        };
        for (const mobile of [false, true]) {
          const width = mobile ? 390 : 1440;
          await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile });
          expect(await page.evaluate('innerWidth')).toBe(width);
          await invalidEnqueue(env);
          const child = await reviveWithEnqueue(env);
          await page.evaluate(`${workspace}.select(${workspace}.primary, ${JSON.stringify(child)})`);
          await page.waitFor(`Array.from(document.querySelectorAll('[data-testid=text-part]')).some(part => part.checkVisibility() && part.textContent === ${JSON.stringify(revivedPrompt)})`);
        }
      } finally { await page.close(); }
    }
  } finally {
    owner.close();
    try { await core.stop(); } finally { await ui.close(); }
  }
}, 60_000);
