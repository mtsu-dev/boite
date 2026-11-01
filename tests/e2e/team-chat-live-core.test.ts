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

const posts = `[...document.querySelectorAll('[data-testid=team-post]')].map(post => [
  post.querySelector('[data-testid=team-post-author]')?.textContent ?? null, post.dataset.audience,
  post.querySelector('[data-testid=team-post-private]')?.textContent ?? null, post.querySelector('[data-testid=team-post-woke]')?.textContent ?? null])`;

test('the owner finds a team in the sidebar and on the phone, reads its posts in French and posts to it with a mention and in private', async () => {
  ensureProductionUi();
  const restore = setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    const id = ctx.emit.startMessage('assistant');
    // Each wake ends quiet: an answer would post, and two bots answering each other never stop.
    ctx.emit.part(id, 0, { type: 'text', text: '[quiet] nothing to add' });
    ctx.emit.complete(id, 'complete');
    return { done: Promise.resolve({ status: 'done', sessionId: `team-chat:${ctx.thread.id}`, usage: null }), stop() {} };
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
    const conversation = async (agentId: string) => {
      const { threadId } = await owner.call('agents.open', { agentId });
      await waitFor(() => harness.core.journal.listTurns(threadId).some(turn => turn.status === 'done'), 10_000);
      return threadId;
    };
    // Names as the owner gave them, with a space and a parenthesis.
    const huginn = await bot('Huginn (Réseaux)');
    const jeux = await bot('Jeux (Producteur)');
    const huginnThread = await conversation(huginn.id);
    const jeuxThread = await conversation(jeux.id);

    page = await BrowserPage.launch({ url: `${harness.url}/?token=${harness.token}`, experiments: ['resident-agents', 'teams'], windowSize: { width: 1440, height: 900 } });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('boite.locale', 'fr'); } catch {}` });
    await page.reload();
    await page.waitFor(`document.documentElement.lang === 'fr'`);
    // The core takes teams once the app has told it the experiment is on.
    await waitFor(() => (harness.core.clients.desktopExperiments() ?? harness.core.clients.current()?.experiments ?? []).includes('teams'), 10_000);

    const team = await owner.call('teams.create', { name: 'Skollheim', brief: 'Les réseaux et les jeux ensemble.', members: [huginn.id, jeux.id] });
    const keyOf = (botId: string) => team.members.find(member => member.botId === botId)!.key;
    const said = await boiteAs(harness, huginnThread, ['team', 'say', 'Skollheim', 'Le brouillon est prêt. @tous relisez-le.']);
    const told = await boiteAs(harness, jeuxThread, ['team', 'dm', 'Skollheim', 'owner', 'Entre nous : le budget est serré.']);
    expect([said.code, said.err, told.code, told.err]).toEqual([0, '', 0, '']);

    // Desktop: the Teams section of the sidebar, the chat unread.
    const row = `[data-testid=sidebar-team][data-team-id="${team.id}"]`;
    await page.waitFor(`document.querySelector('${row}')?.dataset.unread === 'true'`);
    expect(await page.text('[data-testid=sidebar-teams] .title')).toBe('Équipes');
    expect(await page.text(row)).toContain('Skollheim');
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'team-chat-sidebar-desktop.png'));
    await page.click(row);
    await page.waitFor(`document.querySelectorAll('[data-testid=team-post]').length === 2`);
    expect(await page.evaluate(posts)).toEqual([
      ['Huginn (Réseaux)', 'team', null, 'A réveillé toute l\'équipe'],
      ['Jeux (Producteur)', 'private', 'Privé pour vous', null],
    ]);
    expect(await page.text('[data-testid=thread-title]')).toBe('Skollheim');
    // Opened, the chat reads as read.
    await page.waitFor(`document.querySelector('${row}') && !document.querySelector('${row}').dataset.unread`);

    await page.type('[data-testid=team-composer-input]', '@Jeux (Producteur) tu valides le budget ?');
    await page.waitFor(`document.querySelector('[data-testid=team-wakes]')?.textContent === 'Réveille Jeux (Producteur)'`);
    await page.click('[data-testid=team-send]');
    await page.waitFor(`document.querySelectorAll('[data-testid=team-post]').length === 3`);
    const mentioned = (await owner.call('teams.read', { team: team.id })).posts.at(-1);
    expect([mentioned?.author, mentioned?.routedBy, mentioned?.to]).toEqual(['owner', 'mention', [keyOf(jeux.id)]]);
    expect((await page.evaluate<unknown[][]>(posts)).at(-1)).toEqual(['Vous', 'team', null, 'A réveillé Jeux (Producteur)']);
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'team-chat-desktop.png'));

    // Phone: back to the list, the Teams section above the threads, then the chat again.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.click('[data-testid=mobile-back]');
    await page.waitFor(`!!document.querySelector('.mobile-list ${row}')`);
    // The chat is no thread row of the list: its composer is this one.
    expect(await page.evaluate(`!!document.querySelector('.mobile-list [data-thread-id="${team.threadId}"]')`)).toBe(false);
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'team-chat-list-phone.png'));
    await page.click(`.mobile-list ${row}`);
    await page.waitFor(`!document.querySelector('.mobile-list') && document.querySelectorAll('[data-testid=team-post]').length === 3`);
    await page.click('[data-testid=team-audience]');
    await page.click(`[data-testid=team-audience-menu] [data-value="${keyOf(huginn.id)}"]`);
    await page.waitFor(`!document.querySelector('[data-testid=team-mention]')`);
    await page.type('[data-testid=team-composer-input]', 'Tu peux relancer le client demain ?');
    expect(await page.text('[data-testid=team-wakes]')).toContain('Huginn (Réseaux)');
    await page.click('[data-testid=team-send]');
    await page.waitFor(`document.querySelectorAll('[data-testid=team-post]').length === 4`);
    const secret = (await owner.call('teams.read', { team: team.id })).posts.at(-1);
    expect([secret?.audience, secret?.to]).toEqual(['private', [keyOf(huginn.id)]]);
    expect((await page.evaluate<unknown[][]>(posts)).at(-1)).toEqual(['Vous', 'private', 'Privé pour Huginn (Réseaux)', null]);
    // Nothing covers the send button, and nothing runs off the screen.
    expect(await page.evaluate(`(() => { const button = document.querySelector('[data-testid=team-send]'); const box = button.getBoundingClientRect(); return box.width > 0 && box.bottom <= innerHeight && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })()`)).toBe(true);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await page.settleAnimations();
    await page.screenshot(join(import.meta.dir, '.artifacts', 'team-chat-phone.png'));
    expect(page.errors()).toEqual([]);
  } finally { await page?.close(); await harness.stop(); restore(); }
}, 90_000);
