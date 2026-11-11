import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Turn } from '../../packages/contracts/src/index.ts';
import type { CoreClient } from '../../packages/core/src/client.ts';
import { quietAgent, startTestCore, waitFor, type TestCore } from '../../packages/core/test/harness.ts';
import { BrowserPage } from './lib/cdp.ts';
import { mintPairing } from './lib/core.ts';
import { screensSettled } from './lib/mobile.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

/*
 * The composer's Stop, touched on a paired phone in a bot's thread: real touch
 * events on a real core, at two phone sizes. A bot gathers facts while it works
 * (its threads' turns ending, outside events); one that waited past the batch
 * delay used to start the next turn half a second after Stop, so the square
 * stayed and Stop seemed to do nothing.
 */

const ARTIFACTS = join(import.meta.dir, '.artifacts');
const id = (name: string) => `[data-testid="${name}"]`;
let harness: TestCore;
let owner: CoreClient;
let accountId = '';

const turns = (threadId: string): Turn[] => harness.core.journal.listTurns(threadId);
const free = (threadId: string) => turns(threadId).every(t => t.status !== 'queued' && t.status !== 'running') && !harness.core.threads.runner.handles.has(threadId);

async function tap(page: BrowserPage, selector: string): Promise<void> {
  await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`);
  const point = await page.evaluate<{ x: number; y: number }>(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

beforeAll(async () => {
  ensureProductionUi();
  harness = await startTestCore();
  owner = await harness.connect();
  accountId = (await owner.call('accounts.list', {})).find(account => account.providerId === 'echo')!.id;
}, 120_000);

afterAll(async () => {
  owner?.close();
  await harness?.stop();
}, 30_000);

for (const [width, height] of [[390, 844], [360, 760]] as const) {
  test(`a tap on Stop ends a bot's turn and keeps it stopped on a ${width}×${height} phone`, async () => {
    let agent = await owner.call('agents.profile.save', { value: { name: `Watcher ${width}`, domain: 'Watches the deploys', instructions: 'Watch the deploys.', avatar: '', status: 'active', projectIds: [],
      selection: { providerId: 'echo', accountId, model: 'echo', effort: null, permissionMode: 'default' } } });
    agent = await quietAgent(owner, agent);
    const { threadId } = await owner.call('agents.open', { agentId: agent.id });
    await waitFor(() => turns(threadId).length > 0 && free(threadId), 15_000);

    const page = await BrowserPage.launch({ url: 'about:blank', experiments: ['resident-agents'], windowSize: { width: 1280, height: 900 } });
    try {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await page.navigate(await mintPairing(harness));
      await page.waitFor(`document.querySelector('${id('status-connection')}')?.dataset.state === 'ready'`, 30_000);
      expect(await page.evaluate(`matchMedia('(pointer: coarse)').matches`)).toBe(true);
      if (!await page.evaluate(`!!document.querySelector('${id('mobile-tabs')}')`)) await tap(page, id('mobile-back'));
      await page.waitFor(screensSettled);
      await tap(page, id('mobile-agents'));
      await tap(page, id(`agent-entry-${agent.id}`));
      await page.waitFor(screensSettled);
      const composer = (name: string) => `.agents-main ${id(name)}`;

      // Written and sent by touch, the way the bug was met: the box keeps the keyboard.
      await tap(page, composer('composer-input'));
      await page.send('Input.insertText', { text: 'Watch the deploy [sleep:60000]' });
      await tap(page, composer('composer-send'));
      await waitFor(() => turns(threadId).at(-1)?.status === 'running', 15_000);
      // A thread of the bot's finished while it worked, long enough ago to wake it at once.
      expect(harness.core.agentRuntime.fact(agent.id, { urgent: true, key: `turn:deploy-${width}`, text: 'The deploy thread finished. [sleep:60000]', delay: 0 })).toBe(true);
      await page.waitFor(`document.querySelector('${composer('composer-stop')}')`);
      await page.screenshot(join(ARTIFACTS, `phone-stop-${width}-running.png`));

      await tap(page, composer('composer-stop'));
      await waitFor(() => turns(threadId).at(-1)?.status === 'stopped' && free(threadId), 10_000);
      // Three ticks of the bot's runtime: the fact would have started its turn in the first.
      await Bun.sleep(1_500);
      expect(turns(threadId).map(t => t.status).at(-1)).toBe('stopped');
      expect(free(threadId)).toBe(true);
      await page.waitFor(`!document.querySelector('${composer('composer-stop')}')`, 10_000);
      await page.screenshot(join(ARTIFACTS, `phone-stop-${width}-stopped.png`));
      // The fact waits for the user's next message instead of being lost.
      expect(harness.core.agentRuntime.facts(agent.id).map(fact => fact.key)).toEqual([`turn:deploy-${width}`]);
      expect(page.errors()).toEqual([]);
    } finally {
      await page.close();
    }
  }, 90_000);
}
