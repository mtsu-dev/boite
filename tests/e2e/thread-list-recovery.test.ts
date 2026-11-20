import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ThreadSummary } from '../../packages/contracts/src/index.ts';
import { connect } from '../../packages/core/src/client.ts';
import { Journal } from '../../packages/core/src/journal.ts';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startCore, type RunningCore } from './lib/core.ts';
import { mobileAction } from './lib/mobile.ts';
import { startUi } from './lib/ui.ts';

const id = (name: string) => `[data-testid="${name}"]`;
const store = 'globalThis.__boiteTest.workspace.primary';
const coreCount = 3004;
let ui: Awaited<ReturnType<typeof startUi>>;
let core: RunningCore;
let url: string;

beforeAll(async () => {
  const port = await freePort();
  ui = await startUi(port);
  url = `http://127.0.0.1:${port}`;
  core = await startCore();
  const owner = await connect(core.url, core.token);
  let sample: ThreadSummary;
  try {
    await owner.call('settings.set', { browserOrigins: [url] });
    const project = await owner.call('projects.add', { path: core.dataDir, name: 'Paged conversations' });
    const account = (await owner.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
    sample = await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Conversation 1' });
  } finally { owner.close(); }
  await core.stop({ keepDataDir: true });
  const journal = new Journal(join(core.dataDir, 'journal.db'));
  try {
    journal.db.transaction(() => {
      for (let i = 1; i < coreCount; i++) {
        journal.putThread({ ...sample, id: `fixture_${String(i).padStart(6, '0')}`, title: `Conversation ${i + 1} about a project and its planned changes` });
      }
    })();
  } finally { journal.close(); }
  core = await startCore({ dataDir: core.dataDir });
  const reader = await connect(core.url, core.token);
  try {
    const first = await reader.call('threads.listChanges', { page: true });
    expect(first.kind === 'full' && first.next).toBeTruthy();
  } finally { reader.close(); }
}, 60_000);

afterAll(async () => {
  try { await core?.stop(); } finally { await ui?.close(); }
}, 60_000);

for (const simulated of [true, false]) {
  test(`an incomplete ${simulated ? 'fake' : 'core'} thread list can be retried on desktop and phone`, async () => {
    const page = await BrowserPage.launch({ url: 'about:blank', locale: 'en-US' });
    try {
      await page.navigate(simulated
        ? `${url}/?fake=1`
        : `${url}/?core=${encodeURIComponent(core.url)}&token=${encodeURIComponent(core.token)}`);
      if (!simulated) {
        await page.waitFor(`document.querySelector('${id('confirm-ok')}')`);
        await page.click(id('confirm-ok'));
      } else {
        await page.waitFor(`${store}.connection === 'ready'`);
        await page.evaluate(`(() => {
          const owner = ${store}, FixtureClient = owner.client.constructor;
          owner.client.close();
          owner.attach(new FixtureClient({ delayMs: 0, idle: 3000 }));
          owner.threads = [];
          void owner.connect();
        })()`);
      }
      const total = simulated ? 3004 : coreCount;
      await page.waitFor(`${store}.threads.length === ${total}`, 25_000);
      for (const mobile of [false, true]) {
        const width = mobile ? 390 : 1440;
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile });
        if (mobile) await mobileAction(page, 'mobile-conversations');
        await page.evaluate(`(() => {
          const owner = ${store}, client = owner.client, call = client.call.bind(client);
          const fault = { fail: true, continuations: 0 };
          globalThis.listFault = fault;
          client.call = (method, params, options) => {
            if (method === 'threads.listChanges' && typeof params.page === 'string') {
              fault.continuations++;
              if (fault.fail) return call(method, params, options).then(() => { throw new Error('Continuation reply lost'); });
            }
            return call(method, params, options);
          };
          owner.attach(client);
          owner.threads = [];
          void owner.connect();
        })()`);
        const list = id(mobile ? 'mobile-header' : 'sidebar');
        const notice = `${list} ${id('thread-list-notice')}`;
        const button = `${notice} ${id('thread-list-retry')}`;
        await page.waitFor(`(() => {
          const control = document.querySelector('${button}');
          if (!control) return false;
          const bounds = control.getBoundingClientRect();
          return control.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
        })()`);
        expect(await page.evaluate(`globalThis.listFault.continuations`)).toBe(2);
        expect(await page.evaluate(`${store}.connection`)).toBe('ready');
        const partial = await page.evaluate<number>(`${store}.threads.length`);
        expect(partial).toBeGreaterThan(0);
        expect(partial).toBeLessThan(total);
        const captureDir = process.env.BOITE_E2E_CAPTURES;
        if (captureDir) {
          await page.settleAnimations();
          await page.screenshot(join(captureDir, `thread-list-${simulated ? 'fake' : 'core'}-${width}.png`));
        }
        await page.evaluate('globalThis.listFault.fail = false');
        await page.click(button);
        await page.waitFor(`${store}.threads.length === ${total} && !document.querySelector('${notice}')`);
      }
    } finally { await page.close(); }
  }, 60_000);
}
