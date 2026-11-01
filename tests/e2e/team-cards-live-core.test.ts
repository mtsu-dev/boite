import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { AGENT_ENV } from '../../packages/contracts/src/index.ts';
import { runCli } from '../../packages/core/src/cli.ts';
import { echoThread, quietAgent, startTestCore, waitFor, type TestCore } from '../../packages/core/test/harness.ts';
import { setDriver } from '../../packages/core/src/drivers/index.ts';
import { BrowserPage } from './lib/cdp.ts';
import { ensureProductionUi } from './lib/prod-ui.ts';

/** `boite <args>` from a bot's thread, with its agent token, as the bot runs it. */
async function boiteAs(harness: TestCore, threadId: string, args: string[]) {
  let out = '';
  let err = '';
  const env = { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: harness.url, [AGENT_ENV.token]: harness.core.agents.tokenFor(threadId) };
  const code = await runCli(args, { out: text => { out += text; }, err: text => { err += text; }, env, cwd: process.cwd() });
  return { code, out, err };
}

test('a bot\'s boite team propose card offers Create the team in French, and accepting it creates the team on desktop and phone', async () => {
  ensureProductionUi();
  const restore = setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    const id = ctx.emit.startMessage('assistant');
    ctx.emit.part(id, 0, { type: 'text', text: 'Noted.' });
    ctx.emit.complete(id, 'complete');
    return { done: Promise.resolve({ status: 'done', sessionId: `team-card:${ctx.thread.id}`, usage: null }), stop() {} };
  } });
  const harness = await startTestCore();
  let page: BrowserPage | undefined;
  try {
    const owner = await harness.connect();
    const { accountId } = await echoThread(harness, owner);
    const bot = async (name: string) => quietAgent(owner, await owner.call('agents.profile.save', { value: {
      name, domain: '', instructions: '', avatar: '', status: 'active', projectIds: [],
      selection: { providerId: 'echo', accountId, model: 'echo', effort: null, permissionMode: 'default' }
    } }));
    // Names as the owner gave them, with a space and a parenthesis.
    const huginn = await bot('Huginn (Réseaux)');
    const jeux = await bot('Jeux (Producteur)');
    const { threadId } = await owner.call('agents.open', { agentId: huginn.id });
    await waitFor(() => harness.core.journal.listTurns(threadId).some(turn => turn.status === 'done'), 10_000);
    page = await BrowserPage.launch({ url: `${harness.url}/?token=${harness.token}`, experiments: ['resident-agents', 'teams'], windowSize: { width: 1440, height: 900 } });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('boite.locale', 'fr'); } catch {}` });
    await page.reload();
    await page.waitFor(`document.documentElement.lang === 'fr'`);
    await page.click('[data-testid=view-agents]');
    await page.click(`[data-testid="agent-entry-${huginn.id}"]`);
    await page.waitFor('document.querySelector(".agents-main [data-testid=agent-header]")?.textContent.includes("Huginn")');

    const pending = '.agents-main [data-testid=team-card][data-state=pending]';
    for (const [phone, name] of [[false, 'Skollheim'], [true, 'Skollheim Mobile']] as const) {
      if (phone) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        // A phone shows the bot's desk over its conversation: back to the conversation.
        await page.waitFor(`!!document.querySelector('[data-testid=panel-close]')`);
        await page.click('[data-testid=panel-close]');
      }
      const proposed = await boiteAs(harness, threadId, ['team', 'propose', '--name', name, '--members', 'Huginn (Réseaux),Jeux (Producteur)', '--brief', 'Les réseaux et les jeux ensemble.']);
      expect([proposed.code, proposed.err]).toEqual([0, '']);
      await page.waitFor(`!!document.querySelector('${pending} [data-testid=team-card-apply]')`);
      // The card the bug drew offered only the core's Refuse, beside Skip and Reply.
      expect(await page.evaluate(`!!document.querySelector('.agents-main [data-testid=question-card]')`)).toBe(false);
      expect(await page.text(`${pending} [data-testid=team-card-apply]`)).toBe("Créer l'équipe");
      expect(await page.text(`${pending} [data-testid=team-card-refuse]`)).toBe('Refuser');
      await page.evaluate(`document.querySelector('${pending}').scrollIntoView({ block: "center" })`);
      await page.settleAnimations();
      // Nothing covers the button: a tap at its centre reaches it.
      expect(await page.evaluate(`(() => { const button = document.querySelector('${pending} [data-testid=team-card-apply]'); const box = button.getBoundingClientRect(); return box.width > 0 && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })()`)).toBe(true);
      await page.screenshot(join(import.meta.dir, '.artifacts', `team-card-${phone ? 'phone' : 'desktop'}.png`));
      await page.click(`${pending} [data-testid=team-card-apply]`);
      await page.waitFor(`!document.querySelector('${pending}')`);
      const created = (await owner.call('teams.list', {})).teams.find(team => team.name === name);
      expect(created?.members.map(member => member.botId)).toEqual([huginn.id, jeux.id]);
      expect(harness.core.threads.listQuestions(threadId)).toEqual([]);
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      await page.settleAnimations();
      await page.screenshot(join(import.meta.dir, '.artifacts', `team-card-applied-${phone ? 'phone' : 'desktop'}.png`));
    }
    // Both cards read applied in the bot's conversation.
    expect(await page.evaluate(`[...document.querySelectorAll('.agents-main [data-testid=team-card][data-outcome]')].map(card => [card.dataset.outcome, card.querySelector('[data-testid=team-card-verdict]').textContent])`))
      .toEqual([['applied', 'Équipe créée'], ['applied', 'Équipe créée']]);
    expect(page.errors()).toEqual([]);
  } finally { await page?.close(); await harness.stop(); restore(); }
}, 90_000);
