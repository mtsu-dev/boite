import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { DEFAULT_DELEGATION_CONFIG } from '../../packages/contracts/src/index.ts';
import { connect } from '../../packages/core/src/client.ts';
import { BrowserPage } from './lib/cdp.ts';
import { mintPairing, pairingUrlOf, startCore } from './lib/core.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

test('chatbar alerts open the child and written answers reach only that child on desktop and paired phone', async () => {
  ensureProductionUi();
  const core = await startCore();
  const client = await connect(core.url, core.token);
  let page: BrowserPage | undefined;
  try {
    await client.call('brain.configure', { path: null, enabled: false, boiteGuide: false });
    await client.call('settings.set', { asyncQuestions: false });
    const project = await client.call('projects.add', { path: core.dataDir, name: 'Parser' });
    const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
    const parent = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Review the parser' });
    await client.call('delegation.configure', { threadId: parent.id, config: { ...DEFAULT_DELEGATION_CONFIG, enabled: true } });
    // Keep the parent working so Echo does not parse notification wording as a new question.
    await client.call('turns.start', { threadId: parent.id, prompt: 'Review the parser. [sleep:120000]' });
    for (const mobile of [false, true]) {
      page = await BrowserPage.launch({ url: mobile ? await mintPairing(core) : pairingUrlOf(core), windowSize: { width: 1280, height: 900 } });
      await page.waitFor('document.querySelector("[data-testid=status-connection]")?.dataset.state === "ready"');
      await page.click(`[data-testid=thread-row][data-thread-id="${parent.id}"]`);
      if (mobile) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      }
      for (const async of [false, true]) {
        const child = await client.call('delegation.spawn', { threadId: parent.id, task: async ? '[sleep:120000] Inspect the parser' : '[question]', title: 'Check parser options', requestId: `ask-${mobile}-${async}` });
        await client.call('threads.subscribe', { threadId: child.thread.id });
        if (async) {
          await client.call('questions.ask', { threadId: child.thread.id, text: 'Which parser should we use?', options: ['Built-in', 'Custom'] });
        }
        const alert = `[data-testid=composer] [data-testid=subagent-question-alert][data-child-id="${child.thread.id}"]`;
        await page.waitFor(`document.querySelector('${alert}')`);
        expect(await page.evaluate(`!!document.querySelector('[data-testid=activity-question][data-thread="${child.thread.id}"]')`)).toBe(false);
        expect(await page.evaluate('!!document.querySelector("[data-testid=composer-reply]")')).toBe(false);
        expect(await page.evaluate('Array.from(document.querySelectorAll("[data-testid=subagent-question-alert]")).every(alert => alert.closest("[data-testid=composer]"))')).toBe(true);
        await page.waitFor(`document.querySelector('${alert}').getBoundingClientRect().x >= 0`);
        await page.evaluate('Promise.all([document.fonts.ready, ...document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))])');
        if (!async) await page.screenshot(join(import.meta.dir, `.artifacts/subagent-alert-${mobile ? 'phone' : 'desktop'}.png`));
        await page.click(alert);
        await page.waitFor('document.querySelector("[data-testid=delegation-back-parent]") && document.querySelector("[data-testid=composer-reply]")');
        const answer = `Use the custom parser ${mobile ? 'on phone' : 'on desktop'} ${async ? 'async' : 'blocking'}`;
        await page.type('[data-testid=composer-input]', answer);
        await page.click('[data-testid=composer-send]');
        await page.waitFor('!document.querySelector("[data-testid=composer-reply]")');
        const childThread = await client.call('threads.get', { threadId: child.thread.id });
        expect(childThread.messages.some(message => message.parts.some(part => part.type === 'question' && part.answer?.text === answer))).toBe(true);
        const parentThread = await client.call('threads.get', { threadId: parent.id });
        expect(parentThread.messages.some(message => message.role === 'user' && message.parts.some(part => part.type === 'text' && part.text === answer))).toBe(false);
        if (!async) {
          await page.waitFor(`document.querySelector('[data-testid=timeline]')?.textContent.includes(${JSON.stringify(`answered ${answer}`)})`);
          await page.screenshot(join(import.meta.dir, `.artifacts/subagent-answer-${mobile ? 'phone' : 'desktop'}.png`));
        }
        await page.click('[data-testid=delegation-back-parent]');
        await page.waitFor(`!document.querySelector('[data-testid=delegation-back-parent]') && !document.querySelector('${alert}')`);
      }
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      expect(page.errors()).toEqual([]);
      await page.close(); page = undefined;
    }
  } finally {
    await page?.close(); client.close(); await core.stop();
  }
}, 90_000);
