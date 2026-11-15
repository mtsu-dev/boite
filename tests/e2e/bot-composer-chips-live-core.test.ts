import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { echoThread, quietAgent, startTestCore, waitFor } from '../../packages/core/test/harness.ts';
import { setDriver } from '../../packages/core/src/drivers/index.ts';
import { BrowserPage } from './lib/cdp.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';
import { openRailBot } from './lib/bots.ts';

/*
 * A mochi's conversation on a real core: its composer's model, effort and mode
 * chips open the menus of any thread, each pick is the mochi's own setting
 * (`agents.runtime.configure`, as its settings page writes it), and the next
 * turn runs on it. Captures of each menu open, desktop and phone.
 */
test("a mochi's composer chips change its settings, and its next turn runs on them", async () => {
  ensureProductionUi();
  const restore = setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    const id = ctx.emit.startMessage('assistant');
    ctx.emit.part(id, 0, { type: 'text', text: 'Done.' });
    ctx.emit.complete(id, 'complete');
    return { done: Promise.resolve({ status: 'done', sessionId: 'bot-chips', usage: null }), stop() {} };
  } });
  const harness = await startTestCore();
  let page: BrowserPage | undefined;
  const shot = (name: string) => join(import.meta.dir, '.artifacts', `bot-chips-${name}.png`);
  try {
    // A second model to pick, on the echo provider's own effort scale.
    const models = harness.core.providers.require('echo').models!;
    const echo = models.find(model => model.id === 'echo')!;
    models.push({ ...echo, id: 'echo-2', name: 'Echo Two', default: false });
    const owner = await harness.connect();
    const { accountId } = await echoThread(harness, owner);
    const agent = await quietAgent(owner, await owner.call('agents.profile.save', { value: {
      name: 'Mira', domain: 'Builds', instructions: '', avatar: '', status: 'active', projectIds: [],
      selection: { providerId: 'echo', accountId, model: 'echo', effort: null, permissionMode: 'default' }
    } }));
    const { threadId } = await owner.call('agents.open', { agentId: agent.id });
    await waitFor(() => harness.core.journal.listTurns(threadId).some(turn => turn.status === 'done'), 10_000);
    const profile = () => harness.core.workforce.records.get('profile', agent.id)!;
    page = await BrowserPage.launch({ url: `${harness.url}/?token=${harness.token}`, windowSize: { width: 1440, height: 900 } });
    await openRailBot(page, agent.id, 30_000);
    const chip = (testid: string) => `.agents-main [data-testid=composer] [data-testid=${testid}]`;
    await page.waitFor(`document.querySelector('${chip('composer-picker')}')?.getAttribute('aria-haspopup') === 'menu'`, 30_000);

    // Model: the thread's own menu.
    await page.click(chip('composer-picker'));
    await page.waitFor(`document.querySelector('[data-testid=composer-picker-menu] [data-model="echo-2"]')`);
    await page.settleAnimations();
    await page.screenshot(shot('model-desktop'));
    await page.click('[data-testid=composer-picker-menu] [data-model="echo-2"]');
    await waitFor(() => profile().selection.model === 'echo-2', 10_000);

    // Effort: its slider.
    await page.click(chip('composer-effort'));
    await page.waitFor(`document.querySelector('[data-testid=composer-effort-menu] [data-dot=low]')`);
    await page.settleAnimations();
    await page.screenshot(shot('effort-desktop'));
    await page.click('[data-testid=composer-effort-menu] [data-dot=low]');
    await waitFor(() => profile().selection.effort === 'low', 10_000);
    // `page.click` is a script click with no pointerdown: a press outside closes the slider.
    await page.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await page.waitFor(`!document.querySelector('[data-testid=composer-effort-menu]')`);

    // Mode: its list.
    await page.waitFor(`!document.querySelector('${chip('composer-mode')}')?.disabled`);
    await page.click(chip('composer-mode'));
    const row = '[data-testid=composer-mode-menu] [data-row][aria-checked=false]';
    await page.waitFor(`document.querySelector('${row}')`);
    const mode = await page.evaluate(`document.querySelector('${row}').dataset.value`) as string;
    await page.settleAnimations();
    await page.screenshot(shot('mode-desktop'));
    await page.click(`${row}[data-value="${mode}"]`);
    await waitFor(() => profile().selection.permissionMode === mode, 10_000);

    // The settings hold each pick, and the core moved the bot's thread onto them.
    const route = { providerId: 'echo', accountId, model: 'echo-2', effort: 'low', permissionMode: mode };
    expect(profile().selection).toMatchObject(route);
    expect(harness.core.workforce.resident.config(agent.id).defaultRoute).toMatchObject(route);
    expect(harness.core.journal.getThread(threadId)).toMatchObject({ model: 'echo-2', effort: 'low', permissionMode: mode });

    // The next turn runs there.
    const before = harness.core.journal.listTurns(threadId).length;
    await page.type('.agents-main [data-testid=composer-input]', 'Build it.');
    await page.waitFor(`!document.querySelector('.agents-main [data-testid=composer-send]')?.disabled`);
    await page.click('.agents-main [data-testid=composer-send]');
    await waitFor(() => harness.core.journal.listTurns(threadId).length > before && harness.core.journal.listTurns(threadId).at(-1)!.status === 'done', 15_000);
    expect(harness.core.journal.listTurns(threadId).at(-1)!.execution).toMatchObject({ providerId: 'echo', accountId, model: 'echo-2', effort: 'low', permissionMode: mode });

    // A phone opens the same menus, as sheets, over the conversation.
    await page.evaluate(`document.querySelector('[data-testid=right-panel] [data-testid=panel-close]')?.click()`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.waitFor(`document.querySelector('${chip('composer-picker')}')?.getBoundingClientRect().width > 0 && !(document.querySelector('[data-testid=right-panel]')?.getBoundingClientRect().width > 0)`);
    await page.click(chip('composer-picker'));
    await page.waitFor(`document.querySelector('[data-testid=composer-picker-menu] [data-model="echo"]')`);
    await page.settleAnimations();
    await page.screenshot(shot('model-phone'));
    await page.click('[data-testid=composer-picker-menu] [data-model="echo"]');
    await waitFor(() => profile().selection.model === 'echo', 10_000);
    await page.waitFor(`!document.querySelector('${chip('composer-mode')}')?.disabled && !document.querySelector('[data-testid=composer-picker-menu]')`);
    await page.click(chip('composer-mode'));
    await page.waitFor(`document.querySelector('[data-testid=composer-mode-menu] [data-row]')`);
    await page.settleAnimations();
    await page.screenshot(shot('mode-phone'));
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    expect(harness.core.journal.getThread(threadId)?.model).toBe('echo');
    expect(page.errors()).toEqual([]);
  } finally { await page?.close(); await harness.stop(); restore(); }
}, 90_000);
