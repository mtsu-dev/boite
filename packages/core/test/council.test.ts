import { afterEach, expect, setSystemTime, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ENV, BACKGROUND_WAKE_GRACE_MS, DEFAULT_DELEGATION_CONFIG, councilMention, councilTable, type Council, type ModelInfo, type ThreadSummary } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { runCli } from '../src/cli.ts';
import { Core } from '../src/core.ts';
import { parse } from '../src/cli-args.ts';
import { councilParams } from '../src/council/cli.ts';
import { hasScoreLine, scoreOf } from '../src/council/prompt.ts';
import { prepareMembers } from '../src/council/rpc.ts';
import { readOnlyWarning } from '../src/council/store.ts';
import { setDriver } from '../src/drivers/index.ts';
import type { TurnContext, TurnResult } from '../src/drivers/types.ts';
import { subagentGuide } from '../src/delegation/guide.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

const cores: TestCore[] = [];
const restores: (() => void)[] = [];
afterEach(async () => { setSystemTime(); for (const h of cores.splice(0)) await h.stop(); for (const restore of restores.splice(0).reverse()) restore(); });

interface Run { ctx: TurnContext; threadId: string; model: string | null; prompt: string; finish: (text?: string, status?: TurnResult['status']) => void; status: TurnResult['status'] | null }
/** What a run answers: text at once, `null` to hold it until the test finishes it. */
type Reply = (run: Run) => string | null;

/** Every echo turn, members' and parent's: `reply` decides, and the test can swap it. */
function driver(initial: Reply = () => null) {
  const runs: Run[] = [];
  const state = { reply: initial };
  restores.push(setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    let resolve!: (value: TurnResult) => void;
    const done = new Promise<TurnResult>(r => { resolve = r; });
    const run: Run = {
      ctx, threadId: ctx.thread.id, model: ctx.thread.model, prompt: ctx.prompt, status: null,
      finish(text = '', status = 'done') {
        if (run.status) return;
        run.status = status;
        if (text) {
          const id = ctx.emit.startMessage('assistant');
          ctx.emit.part(id, 0, { type: 'text', text });
          ctx.emit.complete(id, 'complete');
        }
        resolve({ status, sessionId: `session:${ctx.thread.id}`, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent: null } });
      },
    };
    runs.push(run);
    const answer = state.reply(run);
    if (answer !== null) setTimeout(() => run.finish(answer), 0);
    return { done, stop() { run.finish('', 'stopped'); } };
  } }));
  return Object.assign(state, {
    runs,
    /** A member's own prompt, without what Boite adds around a turn. */
    memberPart: (run: Run) => run.prompt.slice(Math.max(0, run.prompt.indexOf('Boite council, round'))),
    round: (round: number) => runs.filter(run => run.prompt.includes(`Boite council, round ${round}.`)),
    /** The parent's turns that carry a round or an end of a council. */
    delivered: () => runs.filter(run => /Council cnl_|Council dbt_/.test(run.prompt)),
  });
}

/** A provider on the echo driver, each model with its own name. */
async function twinProvider(h: TestCore, owner: CoreClient, models: ModelInfo[], id = 'twin', capabilities: Record<string, boolean> = {}): Promise<void> {
  const shipped = JSON.parse(readFileSync(join(import.meta.dir, '../src/providers/shipped/echo.json'), 'utf8')) as Record<string, unknown> & { capabilities: Record<string, unknown> };
  mkdirSync(join(h.dataDir, 'providers'), { recursive: true });
  writeFileSync(join(h.dataDir, 'providers', `${id}.json`), JSON.stringify({ ...shipped, id, name: id, shortName: id, models, capabilities: { ...shipped.capabilities, ...capabilities } }));
  expect((await owner.call('providers.reload', {})).rejected).toEqual([]);
  h.core.accounts.ensureDefaults();
}

async function failure(run: () => unknown): Promise<Error & { rpc: { data?: unknown } }> {
  try { await run(); } catch (error) { return error as Error & { rpc: { data?: unknown } }; }
  throw new Error('expected a failure');
}

const REQUEST = 'Review the cache plan in docs/cache.md.';

async function setup(experiment = true) {
  const h = await startTestCore(); cores.push(h);
  const owner = await h.connect();
  if (experiment) await owner.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: ['debates'], labels: {} });
  const { threadId } = await echoThread(h, owner, 'Parent');
  await twinProvider(h, owner, [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'gamma', name: 'Gamma' }]);
  const start = (extra: Record<string, unknown> = {}) => owner.call('council.start', { threadId, request: REQUEST, models: ['twin/alpha', 'twin/beta', 'twin/gamma'], ...extra });
  const read = async (councilId: string) => owner.call('council.get', { councilId });
  return { h, owner, threadId, start, read };
}

/** `boite <args>` from the parent's thread, with its agent token. */
async function boite(h: TestCore, threadId: string, args: string[], cwd = h.dataDir) {
  let out = '';
  let err = '';
  const env = { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: h.url, [AGENT_ENV.token]: h.core.agents.tokenFor(threadId) };
  const code = await runCli(args, { out: text => { out += text; }, err: text => { err += text; }, env, cwd });
  return { code, out, err };
}

const threadsOf = (council: Council) => council.members.map(member => member.threadId!);
const by = (council: Council, model: string) => council.members.find(member => member.model === model)!;
const childRows = (h: TestCore) => h.core.journal.db.query('SELECT COUNT(*) AS n FROM debate_children').get();
const councilRows = (h: TestCore) => h.core.journal.db.query('SELECT COUNT(*) AS n FROM debates').get();

test('the council is refused with a reason, and left out of the agent guide, while the experiment is off', async () => {
  const d = driver(() => 'Fine.');
  const { h, owner, threadId, start } = await setup(false);
  expect((await failure(() => start())).rpc.data).toMatchObject({ reason: 'experiment-off' });
  expect((await failure(() => owner.call('council.list', {}))).rpc.data).toMatchObject({ reason: 'experiment-off' });
  const cli = await boite(h, threadId, ['delegate', 'council', REQUEST, '--models', 'twin/alpha,twin/beta']);
  expect(cli.code).not.toBe(0);
  expect(cli.err).toContain('Council experiment');
  expect(councilRows(h)).toEqual({ n: 0 });
  expect(subagentGuide(DEFAULT_DELEGATION_CONFIG, false, false)).not.toContain('delegate council');
  expect(subagentGuide(DEFAULT_DELEGATION_CONFIG, false, true)).toContain('delegate council');
  expect(subagentGuide(DEFAULT_DELEGATION_CONFIG, false, true)).toContain('boite-council');
  expect(h.core.delegation.instructions(threadId, 'ask the council about it')).not.toContain('delegate council');
  // The skill is listed only with the experiment on: it names a command that would be refused.
  h.core.threads.startTurn(threadId, 'First');
  await waitFor(() => d.runs.some(run => run.status === 'done'));
  expect(d.runs[0]!.prompt).not.toContain('boite-council');
});

test('a member\'s guide lists neither the council skill nor the one about proving a change; its parent\'s lists both', async () => {
  const d = driver(() => 'Fine.\nScore: 8/10');
  const { h, owner, threadId, start } = await setup();
  await owner.call('brain.configure', { path: null, enabled: false, boiteGuide: true });
  h.core.threads.startTurn(threadId, 'First');
  await waitFor(() => d.runs.some(run => run.status === 'done'));
  for (const skill of ['boite-council: ', 'boite-prove-it: ', 'boite-visual: ']) expect(d.runs[0]!.prompt).toContain(skill);
  await start();
  await waitFor(() => d.round(1).length === 3);
  for (const run of d.round(1)) {
    expect(run.prompt).toContain('boite-visual: ');
    expect(run.prompt).not.toContain('boite-council');
    expect(run.prompt).not.toContain('boite-prove-it');
  }
});

test('boite delegate debate starts nothing and points to the council, with the experiment on or off', async () => {
  driver();
  for (const experiment of [true, false]) {
    const { h, threadId } = await setup(experiment);
    const cli = await boite(h, threadId, ['delegate', 'debate', 'Which cache?', '--models', 'twin/alpha,twin/beta', '--rounds', '3']);
    expect(cli.code).not.toBe(0);
    expect(cli.err).toContain('replaced by boite delegate council');
    expect(councilRows(h)).toEqual({ n: 0 });
  }
});

test('each member reviews alone, in parallel; the parent gets one message; again starts a fresh round on the same threads', async () => {
  const d = driver();
  const { h, owner, threadId, read } = await setup();
  h.core.threads.startTurn(threadId, 'Ask a council about the cache plan');
  await waitFor(() => d.runs.some(run => run.threadId === threadId));
  const cli = await boite(h, threadId, ['delegate', 'council', REQUEST, '--models', 'twin/alpha,twin/beta,twin/gamma']);
  expect(cli.err).toBe('');
  expect(cli.code).toBe(0);
  for (const name of ['Alpha', 'Beta', 'Gamma']) expect(cli.out).toContain(`${name} has no read-only mode: Boite refuses every permission it asks.`);
  const councilId = /council: (cnl_\S+)/.exec(cli.out)![1]!;
  let { council } = await read(councilId);
  expect(council.members.map(member => [member.model, member.effort, member.readOnly])).toEqual([['alpha', null, 'approvals'], ['beta', null, 'approvals'], ['gamma', null, 'approvals']]);
  expect(new Set(threadsOf(council)).size).toBe(3);
  const threads = threadsOf(council);
  expect(h.core.threads.require(council.salonThreadId)).toMatchObject({ projectId: null, councilId });
  expect(() => h.core.threads.startTurn(council.salonThreadId, 'hello')).toThrow('a council\'s salon runs no agent');
  // The card lands on the turn that ran the command.
  expect(h.core.journal.listMessages(threadId).flatMap(message => message.parts)).toContainEqual({ type: 'council', councilId, topic: REQUEST });

  // All three are asked before any has answered, and each reads the request and the rules, no other member.
  await waitFor(() => d.round(1).length === 3);
  expect(d.round(1).every(run => run.status === null)).toBe(true);
  for (const run of d.round(1)) {
    const prompt = d.memberPart(run);
    expect(prompt).toContain(JSON.stringify(REQUEST));
    expect(prompt).toContain('You work alone');
    expect(prompt).toContain('Stay read-only');
    expect(prompt).toContain('`Score: n/10`');
    expect(prompt).toContain('`Score: none`');
    expect(prompt).not.toMatch(/Alpha|Beta|Gamma/);
  }

  // The user writes during round 1: every member, then Beta alone, reads it next round.
  const everyone = await owner.call('council.post', { councilId, text: 'Think about phones too.', id: ' phones ' });
  expect(await owner.call('council.post', { councilId, text: 'Think about phones too.', id: ' phones ' })).toEqual(everyone);
  const toBeta = await owner.call('council.post', { councilId, text: '@Beta why not SQLite?' });
  expect([everyone.id, everyone.to, everyone.round, toBeta.to, toBeta.round]).toEqual(['phones', null, 2, by(council, 'beta').id, 2]);

  const answer: Record<string, string> = { alpha: 'ALPHA-FIRST: the index is missing.\n\nScore: 7/10', beta: 'BETA-FIRST: fine.\n\n**Score: 8/10**', gamma: 'GAMMA-FIRST: I will not grade this.' };
  for (const run of d.round(1)) run.finish(answer[run.model!]!);
  await waitFor(() => h.core.council.get({ councilId }).council.status === 'waiting');
  ({ council } = await read(councilId));
  expect(council.members.map(member => member.scores)).toEqual([[7], [8], [null]]);
  expect([council.round, council.roundsDone, council.delivered]).toEqual([1, 1, false]);
  // The members stay for the next round.
  expect(threads.every(thread => !h.core.threads.require(thread).archived)).toBe(true);

  // The parent has not read them yet: a new round would ask what it cannot have acted on.
  expect((await boite(h, threadId, ['delegate', 'council', 'again', councilId, 'Nothing'])).err).toContain('have not reached');
  d.reply = () => 'Noted.';
  d.runs.find(run => run.threadId === threadId)!.finish('Started a council.');
  await waitFor(() => d.delivered().length === 1);
  const message = d.delivered()[0]!;
  expect(message.threadId).toBe(threadId);
  for (const line of ['### Alpha · 7/10', 'ALPHA-FIRST', '### Beta · 8/10', 'BETA-FIRST', '### Gamma · no score', 'GAMMA-FIRST', '## Council review', 'it grants no approval', `boite delegate council again ${councilId}`]) expect(message.prompt).toContain(line);
  await waitFor(() => h.core.council.get({ councilId }).council.delivered);

  // The section, exactly as a pull request description takes it.
  const table = await boite(h, threadId, ['delegate', 'council', 'table', councilId]);
  expect(table.code).toBe(0);
  expect(table.out.trim()).toBe('## Council review\n\nRounds: 1\n\n| Delegate | Round 1 |\n| --- | --- |\n| Alpha | 7/10 |\n| Beta | 8/10 |\n| Gamma | no score |');
  expect((await boite(h, threadId, ['delegate', 'list'])).out).toContain(`${councilId} council waiting after round 1`);
  // A council between rounds runs nothing: waiting on the team returns.
  expect((await boite(h, threadId, ['delegate', 'wait', '--timeout', '1'])).code).toBe(0);

  // Round 2: same threads, what changed, from zero, the user's messages, and still no other member's answer.
  d.reply = () => null;
  const again = await boite(h, threadId, ['delegate', 'council', 'again', councilId, 'Added the missing index.', '--request-id', 'second']);
  expect(again.err).toBe('');
  await waitFor(() => d.round(2).length === 3);
  expect([...d.round(2).map(run => run.threadId)].sort()).toEqual([...threads].sort());
  for (const run of d.round(2)) {
    const prompt = d.memberPart(run);
    expect(prompt).toContain('Added the missing index.');
    expect(prompt).toContain('Review again from zero');
    expect(prompt).toContain('Do not assume your earlier points are fixed');
    expect(prompt).toContain('Think about phones too.');
    expect(prompt.includes('@Beta why not SQLite?')).toBe(run.model === 'beta');
    expect(prompt).not.toMatch(/ALPHA-FIRST|BETA-FIRST|GAMMA-FIRST/);
  }
  // A retry of that command starts nothing; another request under its id, or during the round, is refused.
  expect((await owner.call('council.again', { councilId, threadId, changes: 'Added the missing index.', requestId: 'second' })).round).toBe(2);
  expect(await failure(() => owner.call('council.again', { councilId, threadId, changes: 'Something else', requestId: 'second' }))).toHaveProperty('message', expect.stringContaining('requestId already used'));
  expect(await failure(() => owner.call('council.again', { councilId, threadId, changes: 'Too early' }))).toHaveProperty('message', expect.stringContaining('still running'));
  expect(d.round(3)).toEqual([]);

  d.reply = () => 'Noted again.';
  const scores: Record<string, string> = { alpha: 'Better.\nScore: 9/10', beta: 'Good.\nScore: 10/10', gamma: 'Good too.\nScore: 9/10' };
  for (const run of d.round(2)) run.finish(scores[run.model!]!);
  await waitFor(() => d.delivered().length === 2);
  expect(d.delivered()[1]!.prompt).toContain('### Alpha · 9/10');
  await waitFor(() => h.core.council.get({ councilId }).council.delivered);
  const longer = '## Council review\n\nRounds: 2\n\n| Delegate | Round 1 | Round 2 |\n| --- | --- | --- |\n| Alpha | 7/10 | 9/10 |\n| Beta | 8/10 | 10/10 |\n| Gamma | no score | 9/10 |';
  expect((await boite(h, threadId, ['delegate', 'council', 'table', councilId])).out.trim()).toBe(longer);
  ({ council } = await read(councilId));
  const posts = (await read(councilId)).posts;
  expect(posts.find(post => post.author === by(council, 'beta').id && post.round === 2)!.inReplyTo).toBe(toBeta.id);
  expect(posts.find(post => post.author === 'author')).toMatchObject({ round: 2, text: 'Added the missing index.' });

  // Closing it puts the members away, wakes nobody and leaves the table.
  expect((await boite(h, threadId, ['delegate', 'stop', councilId])).out).toContain('status: done');
  await waitFor(() => threads.every(thread => h.core.threads.require(thread).archived));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(d.delivered()).toHaveLength(2);
  expect(await failure(() => owner.call('council.again', { councilId, threadId, changes: 'More' }))).toHaveProperty('message', expect.stringContaining('is over'));
  expect((await boite(h, threadId, ['delegate', 'council', 'table', councilId])).out.trim()).toBe(longer);
  expect(h.core.delegation.instructions(threadId, 'ask the council about it')).toContain('delegate council');
}, 20_000);

test('a council needs no git, no pull request and no code', async () => {
  const d = driver(run => (run.prompt.includes('Boite council, round') ? `Keep the free tier.\n\nScore: none` : 'Noted.'));
  const { h, owner, read } = await setup();
  const folder = mkdtempSync(join(h.dataDir, 'plain-'));
  expect(existsSync(join(folder, '.git'))).toBe(false);
  const project = await owner.call('projects.add', { path: folder, name: 'plain' });
  const accounts = await owner.call('accounts.list', {});
  const { id: threadId } = await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: accounts.find(entry => entry.providerId === 'echo')!.id, title: 'A plan' });
  const request = 'Should Skollflix keep a free tier? This is a plan: there is no code to read.';

  const cli = await boite(h, threadId, ['delegate', 'council', request, '--models', 'twin/alpha,twin/beta,twin/gamma'], folder);
  expect(cli.err).toBe('');
  const councilId = /council: (cnl_\S+)/.exec(cli.out)![1]!;
  await waitFor(() => d.delivered().length === 1);
  const { council } = await read(councilId);
  expect(council.members.every(member => h.core.threads.require(member.threadId!).cwd === folder)).toBe(true);
  // Nothing a member reads supposes a repository or a pull request.
  for (const run of d.round(1)) expect(d.memberPart(run)).not.toMatch(/\bgit\b|github|pull request|\bdiff\b|\bbranch\b/i);
  expect(d.delivered()[0]!.prompt).toContain('### Alpha · no score');
  await waitFor(() => h.core.council.get({ councilId }).council.delivered);
  expect((await boite(h, threadId, ['delegate', 'council', 'table', councilId], folder)).out).toContain('| Alpha | no score |');
  expect((await boite(h, threadId, ['delegate', 'council', 'again', councilId, 'Priced the free tier.'], folder)).code).toBe(0);
  await waitFor(() => d.delivered().length === 2);
  expect(existsSync(join(folder, '.git'))).toBe(false);
});

test('after -- the words are the request, flag-like or naming a subcommand', () => {
  const words = (...argv: string[]) => parse(['delegate', 'council', ...argv]).positional.slice(2);
  expect(councilParams(words('--', '--foo', 'bar', '--json')).request).toBe('--foo bar --json');
  expect(words('--', 'table')).toEqual(['--', 'table']);
  expect(councilParams(words('--', 'table')).request).toBe('table');
  expect(councilParams(words('fix it', '--effort', 'high')).effort).toBe('high');
});

test('a member who cannot run refuses the whole council: nobody is replaced', async () => {
  const d = driver();
  const { h, owner, threadId, start } = await setup();
  for (const [models, named] of [[['twin/alpha', 'nobody/model'], 'nobody/model'], [['twin/alpha', 'twin/absent'], 'absent']] as const) {
    const error = await failure(() => start({ models: [...models] }));
    expect(error.message).toContain(named);
    expect(error.message).toContain('never replaced');
  }
  // Without --models, the three flagships: a provider this machine lacks is said, with the way out.
  const missing = await failure(() => owner.call('council.start', { threadId, request: REQUEST }));
  expect(missing.message).toContain('claude/claude-opus-5-5');
  expect(missing.message).toContain('--models');
  expect(missing.message).toContain('never replaced');
  expect(councilRows(h)).toEqual({ n: 0 });
  expect(childRows(h)).toEqual({ n: 0 });
  expect(d.runs).toEqual([]);
  for (const words of [['--models', 'twin/alpha'], ['--rounds', '3'], ['--timeout', '0']]) expect((await boite(h, threadId, ['delegate', 'council', REQUEST, ...words])).code).not.toBe(0);
  expect((await boite(h, threadId, ['delegate', 'council'])).err).toContain('needs a request');
  // A route naming a provider stays on it, though a gateway lists a model of that spelling.
  await twinProvider(h, owner, [{ id: 'gated/beta', name: 'Gated beta' }, { id: 'ghost/beta', name: 'Ghost beta' }], 'gateway');
  await twinProvider(h, owner, [{ id: 'other', name: 'Other' }], 'gated');
  const swapped = await failure(() => start({ models: ['twin/alpha', 'gated/beta'] }));
  expect(swapped.message).toContain('gated/beta');
  expect(swapped.message).toContain('never replaced');
  // A provider that does not exist is no way onto the gateway either.
  const ghost = await failure(() => start({ models: ['twin/alpha', 'ghost/beta'] }));
  expect(ghost.message).toContain('ghost does not offer it; the nearest is gateway/ghost/beta');
  // Nor is it another model of that provider the name is only a part of.
  await twinProvider(h, owner, [{ id: 'delta-next', name: 'Delta next' }], 'gated');
  const near = await failure(() => start({ models: ['twin/alpha', 'gated/delta'] }));
  expect(near.message).toContain('gated does not offer it; the nearest is gated/delta-next');
  expect(near.message).toContain('never replaced');
  // A provider logged in whose list could not be read says that, not that nobody logged in.
  await twinProvider(h, owner, [{ id: 'model', name: 'Model' }], 'unread');
  Object.assign(h.core.providers.require('unread'), { protocol: 'acp', models: [] });
  const unread = await failure(() => h.core.council.start({ threadId, request: REQUEST, models: ['twin/alpha', 'unread/model'] }));
  expect(unread.message).toContain('unread: models not read yet');
  expect(councilRows(h)).toEqual({ n: 0 });
});

test('a read that hangs does not hold the start, and a council refused or retried reads nothing', async () => {
  driver();
  const { h, owner, threadId, start } = await setup();
  const prepare = spyOn(h.core.delegation, 'prepareRoutes').mockResolvedValue(undefined);
  await twinProvider(h, owner, [{ id: 'one', name: 'One' }], 'slow');
  Object.assign(h.core.providers.require('slow'), { protocol: 'acp', models: [] });
  let reads = 0;
  const owed = await prepareMembers(h.core, () => { reads += 1; return new Promise(() => {}); }, threadId, ['twin/alpha', 'slow/one'], 20);
  expect(reads).toBe(1);
  expect([...owed]).toEqual(['slow/one']);
  // A read that failed is not one still owed: the refusal is left to give its own reason.
  expect([...await prepareMembers(h.core, () => Promise.reject(new Error('expired')), threadId, ['twin/alpha', 'slow/one'], 20)]).toEqual([]);
  // A list that holds a default model does not hide it: the refusal says what is owed, not that the model is missing.
  Object.assign(h.core.providers.require('slow'), { models: [{ id: 'default', name: 'Default' }] });
  const params = { threadId, request: REQUEST, models: ['twin/alpha', 'slow/one'] };
  expect((await failure(() => h.core.council.start(params, owed))).message).toContain('slow: models not read yet');
  // Nor does a level go down unsaid when only the scale is owed.
  const low = h.core.council.start({ ...params, models: ['twin/alpha', 'twin/beta'] }, new Set(['twin/beta']));
  expect(low.warnings.join(' ')).toContain('Beta: its effort levels were not read yet, so it runs at its default.');
  h.core.council.stop({ councilId: low.id }, 'owner');
  prepare.mockClear();
  expect((await failure(() => start({ models: ['twin/alpha'] }))).message).toContain('expected 2 to');
  expect(prepare).not.toHaveBeenCalled();
  const first = await start({ requestId: 'same' });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect((await start({ requestId: 'same' })).id).toBe(first.id);
  expect(prepare).toHaveBeenCalledTimes(1);
});

test('a member that ends its turn on background work: a score answers, else the turn that work wakes, and the end of the round keeps what it wrote and stops that work', async () => {
  const d = driver();
  const { h, owner, start, read } = await setup();
  const council = await start();
  const state = () => h.core.council.get({ councilId: council.id }).council;
  const bg = (run: Run) => h.core.threads.agentState.background.get(run.threadId)?.length ?? 0;
  await waitFor(() => d.round(1).length === 3);
  const member = (model: string) => d.round(1).find(run => run.model === model)!;
  const [waker, scored, unwoken] = [member('alpha'), member('beta'), member('gamma')];
  for (const [run, text] of [[waker, 'Started on the logs.'], [scored, 'Fine.\n\nScore: 8/10'], [unwoken, 'Looks thin so far.']] as const) {
    run.ctx.background!([{ id: `bg-${run.model}`, kind: 'shell', description: 'read the logs', toolId: null, startedAt: Date.now() }]);
    run.finish(text);
  }
  await waitFor(() => [waker, unwoken].every(run => h.core.journal.listTurns(run.threadId).at(-1)?.status === 'done'));
  await waitFor(() => !by(state(), 'beta').pending && bg(scored) === 0);
  expect(by(state(), 'beta').scores).toEqual([8]);
  expect(state().status).toBe('running');
  expect([by(state(), 'alpha').pending, by(state(), 'gamma').pending]).toEqual([true, true]);
  waker.ctx.backgroundFinished!('bg-alpha', 'completed');
  const before = d.runs.length;
  waker.ctx.wake!('The logs are read.');
  await waitFor(() => d.runs.length > before);
  d.runs.at(-1)!.finish('The logs are clean.\n\nScore: 9/10');
  await waitFor(() => !by(state(), 'alpha').pending);
  expect(by(state(), 'alpha').scores).toEqual([9]);
  // Nothing wakes the last, as with an ACP command: closing keeps what it wrote and ends its work.
  await owner.call('council.closeRound', { councilId: council.id });
  await waitFor(() => state().status === 'waiting');
  expect(by(state(), 'gamma').absent).toEqual([]);
  expect(by(state(), 'gamma').scores[0] ?? null).toBeNull();
  expect(bg(unwoken)).toBe(0);
  const posts = (await read(council.id)).posts;
  const text = (model: string) => posts.find(post => post.author === by(state(), model).id)?.text;
  expect(text('alpha')).toBe('Started on the logs.\n\nThe logs are clean.\n\nScore: 9/10');
  expect(text('gamma')).toBe('Looks thin so far.');
});

test('a member nothing wakes is asked once its work completes; work or a turn that failed keeps what it wrote and says why; an answer over several turns names each', async () => {
  const d = driver();
  const { h, threadId, start } = await setup();
  const council = await start();
  const state = () => h.core.council.get({ councilId: council.id }).council;
  await waitFor(() => d.round(1).length === 3);
  const member = (model: string) => d.round(1).find(run => run.model === model)!;
  const [quiet, lost, failed] = [member('alpha'), member('beta'), member('gamma')];
  // The grace for a wake runs out on a clock moved on: the store's timer fires soon, with no wake.
  const ended = async (run: Run, id: string, end: 'completed' | 'error', done: () => boolean) => {
    run.ctx.backgroundFinished!(id, end);
    setSystemTime(new Date(Date.now() + BACKGROUND_WAKE_GRACE_MS - 20));
    h.core.bus.emit('thread.updated', h.core.journal.getThread(run.threadId)!);
    setSystemTime(new Date(Date.now() + 40));
    await waitFor(done);
    setSystemTime();
  };
  for (const [run, text] of [[quiet, `${'A long finding. '.repeat(900)}The end of it.`], [lost, 'Half done.'], [failed, 'Started.']] as const) {
    run.ctx.background!([{ id: `bg-${run.model}`, kind: 'shell', description: 'read the logs', toolId: null, startedAt: Date.now() }]);
    run.finish(text);
  }
  await waitFor(() => [quiet, lost, failed].every(run => h.core.journal.listTurns(run.threadId).at(-1)?.status === 'done'));
  await ended(lost, 'bg-beta', 'error', () => !by(state(), 'beta').pending);
  expect(by(state(), 'beta').absent).toEqual([]);
  failed.ctx.backgroundFinished!('bg-gamma', 'completed');
  let before = d.runs.length;
  failed.ctx.wake!('The logs are read.');
  await waitFor(() => d.runs.length > before);
  d.runs.at(-1)!.finish('', 'error');
  await waitFor(() => !by(state(), 'gamma').pending);
  before = d.runs.length;
  await ended(quiet, 'bg-alpha', 'completed', () => d.runs.length > before);
  expect(d.runs.at(-1)!.prompt).toContain('no turn of yours followed it');
  d.runs.at(-1)!.finish('Clean.\n\nScore: 9/10');
  await waitFor(() => state().status === 'waiting');
  expect(by(state(), 'alpha').scores).toEqual([9]);
  await waitFor(() => d.delivered().length === 1);
  const message = d.delivered()[0]!.prompt;
  expect(message).toContain(`${by(state(), 'beta').name} did not finish round 1: its background work ended without waking it.`);
  expect(message).toContain(`${by(state(), 'gamma').name} did not finish round 1: its turn failed`);
  const named = [...message.matchAll(/(?:Whole answer|Then): boite delegate result (\S+) (\S+)/g)];
  expect(named.length).toBe(2);
  expect((await boite(h, threadId, ['delegate', 'result', named[0]![1]!, named[0]![2]!])).out).toContain('The end of it.');
  expect((await boite(h, threadId, ['delegate', 'result', named[1]![1]!, named[1]![2]!])).out).toContain('Clean.');
});

test('a member through with its round leaves no wake, and a council closed between rounds leaves no background work', async () => {
  const d = driver();
  const { h, start } = await setup();
  const council = await start();
  await waitFor(() => d.round(1).length === 3);
  const [first, second, third] = d.round(1) as [Run, Run, Run];
  const wake = spyOn(h.core.wakes, 'of').mockImplementation(id => (id === first.threadId ? { at: Date.now() + 60_000 } as never : null));
  const stopped = spyOn(h.core.threads, 'stopTurn');
  first.finish('Fine.\nScore: 8/10');
  await waitFor(() => stopped.mock.calls.some(([id]) => id === first.threadId));
  wake.mockRestore();
  second.finish('Fine.\nScore: 8/10');
  third.finish('Fine.\nScore: 8/10');
  await waitFor(() => h.core.council.get({ councilId: council.id }).council.status === 'waiting');
  second.ctx.background!([{ id: 'late', kind: 'shell', description: 'late', toolId: null, startedAt: Date.now() }]);
  h.core.council.stop({ councilId: council.id }, 'owner');
  await waitFor(() => (h.core.threads.agentState.background.get(second.threadId)?.length ?? 0) === 0);
});

test('members stay read-only: the plan mode where there is one, every permission refused elsewhere, a warning for neither', async () => {
  const d = driver();
  const { h, owner, start } = await setup();
  await twinProvider(h, owner, [{ id: 'plan', name: 'Planner', effort: { default: 'low', levels: [{ id: 'low', label: 'Low' }, { id: 'xhigh', label: 'Extra high' }] } }], 'planner', { planMode: true });
  await twinProvider(h, owner, [{ id: 'bare', name: 'Bare', effort: { default: 'low', levels: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] } }], 'bare', { planMode: false, approvals: false });
  const council = await start({ models: ['planner/plan', 'twin/alpha', 'bare/bare'] });
  // xhigh where the model has it, its strongest below that said aloud where it has others, nothing to say where it has none.
  expect(council.members.map(member => member.effort)).toEqual(['xhigh', null, 'high']);
  expect(council.warnings).toContain('Bare has no xhigh effort, so it runs at high.');
  expect(council.warnings.some(warning => warning.startsWith('Alpha has no xhigh'))).toBe(false);
  expect(council.members.map(member => member.readOnly)).toEqual(['native', 'approvals', 'none']);
  expect(council.members.map(member => h.core.threads.require(member.threadId!).permissionMode)).toEqual(['plan', 'default', 'default']);
  expect(council.warnings).toEqual(expect.arrayContaining(['Alpha has no read-only mode: Boite refuses every permission it asks.', 'Bare has no read-only mode and asks no permission: it could change files.']));
  await waitFor(() => d.round(1).length === 3);
  const member = d.round(1).find(run => run.threadId === by(council, 'alpha').threadId)!;
  expect(await member.ctx.requestPermission('Bash', { command: 'rm -rf build' }, 'Remove the build')).toBe('deny');
  expect(h.core.threads.listPermissions(member.threadId)).toEqual([]);
  // Nobody is there to answer one either, so it would hold the turn to the round's deadline.
  expect(await member.ctx.askQuestion({ text: 'Which file?', options: [], allowText: true, multiple: false })).toBeNull();
});

test('a restart handoff asks again a member whose turn the last core left open, and calls it no failure', async () => {
  const d = driver();
  const { h, start } = await setup();
  const council = await start();
  await waitFor(() => d.round(1).length === 3);
  await h.core.threads.handoff.begin(0);
  const threadId = council.members[0]!.threadId!;
  // Its stop did not settle before the core went down.
  const cut = h.core.journal.listTurns(threadId).at(-1)!;
  h.core.journal.putTurn({ ...cut, status: 'running', finishedAt: null });
  await h.core.close();
  const restarted = new Core({ dataDir: h.dataDir, token: h.token });
  try {
    const stored = () => JSON.parse((restarted.journal.db.query('SELECT data FROM debates WHERE id = ?').get(council.id) as { data: string }).data) as Council;
    expect(restarted.journal.getTurn(cut.id)?.status).toBe('error');
    expect(stored().members[0]).toMatchObject({ pending: true, absent: [] });
    restarted.council.resumeAfterRestart();
    await waitFor(() => d.round(1).filter(run => run.threadId === threadId).length === 2);
    expect(stored().status).toBe('running');
  } finally { await restarted.close(); }
}, 20_000);

test('OpenCode is warned about what its plan mode leaves open, and a plan mode that closes it is not', () => {
  expect(readOnlyWarning('Oc', 'opencode', 'native')).toContain('allows commands');
  expect(readOnlyWarning('Oc 2', 'opencode-v2', 'native')).toContain('allows commands');
  expect(readOnlyWarning('Opus', 'claude', 'native')).toBeNull();
});

test('only a thread at the top starts a council: not a subagent here, nor one whose parent is on another machine', async () => {
  driver();
  const { h, threadId, start } = await setup();
  const parentOf = spyOn(h.core.delegation.remote, 'parentOf').mockImplementation(id => (id === threadId ? {} as never : undefined));
  restores.push(() => parentOf.mockRestore());
  expect((await failure(() => start())).message).toContain('a subagent cannot start a council');
  expect(councilRows(h)).toEqual({ n: 0 });
});

test('delegate wait holds through a round, and an answer cut from the message reads whole with the command it names', async () => {
  const long = `${'A long finding. '.repeat(900)}The end of it.\nScore: 7/10`;
  const d = driver(run => (run.prompt.includes('Boite council, round') ? (run.model === 'alpha' ? long : run.model === 'gamma' ? null : 'Fine.\nScore: 8/10') : 'Noted.'));
  const { h, owner, threadId, start, read } = await setup();
  const { id: councilId } = await start();
  await waitFor(() => d.round(1).length === 3);
  expect(await owner.call('delegation.wait', { threadId, timeoutMs: 0 })).toMatchObject({ state: 'waiting_for_children', timedOut: true });
  const waited = owner.call('delegation.wait', { threadId });
  d.round(1).find(run => run.model === 'gamma')!.finish('Fine.\nScore: 8/10');
  expect((await waited).state).toBe('settled');
  expect((await read(councilId)).council.status).toBe('waiting');

  await waitFor(() => d.delivered().length === 1);
  const message = d.delivered()[0]!.prompt;
  expect(message).not.toContain('The end of it.');
  const [, member, turn] = /Whole answer: boite delegate result (\S+) (\S+)/.exec(message)!;
  expect((await boite(h, threadId, ['delegate', 'result', member!, turn!])).out).toContain('The end of it.');
  // That reading is the parent's: another thread is no parent of this member.
  const { threadId: stranger } = await echoThread(h, owner, 'Stranger');
  expect((await failure(() => owner.call('delegation.result', { threadId: stranger, agentId: member!, turnId: turn! }))).message).toContain('direct delegated child');
});

test('a member past the round\'s time has no score, and the parent still gets the others; it is asked again next round', async () => {
  const d = driver(run => (run.model === 'gamma' && run.prompt.includes('round 1.') ? null : run.prompt.includes('Boite council, round') ? `From ${run.model}.\nScore: 6/10` : 'Noted.'));
  const { h, threadId, start, read } = await setup();
  h.core.council.minuteMs = 150;
  const { id } = await start({ timeoutMinutes: 1 });
  await waitFor(() => d.delivered().length === 1, 5000);
  const { council, posts } = await read(id);
  const gamma = by(council, 'gamma');
  expect(gamma.absent).toEqual([1]);
  expect(gamma.scores).toEqual([null]);
  expect(posts.map(post => post.text)).toContain('Gamma did not answer round 1: no answer within 1 minute.');
  expect(d.runs.find(run => run.threadId === gamma.threadId)!.status).toBe('stopped');
  const message = d.delivered()[0]!.prompt;
  expect(message).toContain('### Gamma · no score');
  expect(message).toContain('Notes: Gamma did not answer round 1');
  expect(message).toContain('| Gamma | no score |');
  await waitFor(() => h.core.council.get({ councilId: id }).council.delivered);
  await h.core.council.again({ councilId: id, threadId, changes: 'Nothing yet.' }, 'owner');
  await waitFor(() => d.delivered().length === 2, 5000);
  expect(by((await read(id)).council, 'gamma').scores).toEqual([null, 6]);
});

test('a council nobody answers still waits for the parent, with no score', async () => {
  const d = driver(run => (run.prompt.includes('Boite council, round') ? '' : 'Noted.'));
  const { h, start, read } = await setup();
  const { id } = await start();
  await waitFor(() => d.delivered().length === 1);
  const { council } = await read(id);
  expect(council.status).toBe('waiting');
  expect(councilTable(council)).toContain('| Alpha | no score |');
  await waitFor(() => h.core.council.get({ councilId: id }).council.delivered);
});

test('the user closes a round; a stop during one wakes nobody and puts the members away', async () => {
  const d = driver();
  const { h, owner, threadId, start, read } = await setup();
  h.core.threads.startTurn(threadId, 'A turn of its own');
  const { id } = await start();
  await waitFor(() => d.round(1).length === 3);
  for (const run of d.round(1)) if (run.model !== 'gamma') run.finish(`From ${run.model}.\nScore: 5/10`);
  await waitFor(() => h.core.council.get({ councilId: id }).posts.length === 2);
  expect((await boite(h, threadId, ['delegate', 'list'])).out).toContain(`${id} council running round 1`);

  const closed = await owner.call('council.closeRound', { councilId: id });
  expect(closed.status).toBe('waiting');
  expect(by(closed, 'gamma').absent).toEqual([1]);
  expect(d.round(1).find(run => run.model === 'gamma')!.status).toBe('stopped');
  expect(await failure(() => owner.call('council.closeRound', { councilId: id }))).toHaveProperty('message', expect.stringContaining('no round is under way'));
  // The parent's turn has not ended: a stop between rounds still hands it the round that closed.
  expect((await owner.call('council.stop', { councilId: id })).status).toBe('done');
  d.reply = () => 'Noted.';
  d.runs.find(run => run.threadId === threadId)!.finish('Done here.');
  await waitFor(() => d.delivered().length === 1);
  expect(d.delivered()[0]!.prompt).toContain('This council is closed');

  await waitFor(() => !h.core.threads.isBusy(threadId));
  d.reply = () => null;
  const second = await owner.call('council.start', { threadId, request: 'Another look', models: ['twin/alpha', 'twin/beta'] });
  await waitFor(() => second.members.every(member => d.runs.some(run => run.threadId === member.threadId)));
  const stopped = await boite(h, threadId, ['delegate', 'stop', second.id]);
  expect(stopped.code).toBe(0);
  const { council } = await read(second.id);
  expect([council.status, council.note, council.delivered]).toEqual(['stopped', 'Stopped by the agent that started it.', true]);
  await waitFor(() => threadsOf(council).every(thread => h.core.threads.require(thread).archived));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(d.delivered()).toHaveLength(1);
}, 20_000);

test('stopping the thread\'s subagents or archiving it stops a round; a council between rounds stays and can go on', async () => {
  const d = driver();
  const { h, owner, threadId, start, read } = await setup();
  // The owner's Stop on a thread with no other work reaches the round under way.
  const first = await start();
  await waitFor(() => d.round(1).length === 3);
  expect(await owner.call('delegation.stop', { threadId })).toEqual({ stopped: 1 });
  let { council } = await read(first.id);
  expect([council.status, council.note]).toEqual(['stopped', 'Stopped with the subagents of the thread that started it.']);
  await waitFor(() => d.round(1).every(run => run.status === 'stopped'));

  // Between rounds, the same Stop has nothing to stop in the council, and its members answer again.
  const count = d.round(1).length;
  d.reply = run => (run.prompt.includes('Boite council, round') ? 'Answer.\nScore: 8/10' : 'Noted.');
  const second = await start();
  await waitFor(() => d.delivered().some(run => run.prompt.includes(`Council ${second.id}, round 1`)));
  await waitFor(() => h.core.council.get({ councilId: second.id }).council.delivered);
  await waitFor(() => !h.core.threads.isBusy(threadId));
  await owner.call('delegation.stop', { threadId });
  expect((await read(second.id)).council.status).toBe('waiting');
  await owner.call('council.again', { councilId: second.id, threadId, changes: 'Fixed it.' });
  await waitFor(() => d.delivered().some(run => run.prompt.includes(`Council ${second.id}, round 2`)));
  expect(d.round(1).length).toBe(count + 3);
  await waitFor(() => h.core.council.get({ councilId: second.id }).council.delivered);

  d.reply = () => null;
  const third = await start();
  await waitFor(() => d.round(1).length === count + 6);
  await waitFor(() => !h.core.threads.isBusy(threadId));
  await owner.call('threads.archive', { threadId });
  await waitFor(() => h.core.council.get({ councilId: third.id }).council.status === 'stopped');
  ({ council } = await read(third.id));
  expect(council.note).toBe('The thread that started it was archived.');
  await waitFor(() => threadsOf(council).every(thread => h.core.threads.require(thread).archived));
}, 20_000);

test('the score line is read as written and never made up', () => {
  // Only a score or `none` closes a review: anything else would stop a member's work unread.
  expect(['Score: pending', 'Score: none', '**Score:** 8/10', 'No line.'].map(hasScoreLine)).toEqual([false, true, true, false]);
  const cases: [string, number | null][] = [
    ['Good.\n\nScore: 8/10', 8],
    ['**Score: 8/10**', 8],
    ['**Score:** 7.5/10 overall', 7.5],
    ['> score : 9 / 10', 9],
    ['`Score: 8/10`', 8],
    ['Score: 2/10 at first.\nThen fixes.\nScore: 6/10', 6],
    ['Score: none', null],
    ['Score: 8', null],
    ['Score: 11/10', null],
    ['Score: 8/100', null],
    ['I would give it 8/10.', null],
    ['Score: 8/10\nScore: none', null],
    ['', null],
  ];
  for (const [answer, score] of cases) expect([answer, scoreOf(answer)]).toEqual([answer, score]);
  expect(councilTable({ roundsDone: 2, members: [{ name: 'A', scores: [7] } as Council['members'][number]] })).toBe('## Council review\n\nRounds: 2\n\n| Delegate | Round 1 | Round 2 |\n| --- | --- | --- |\n| A | 7/10 | no score |');
});

test('a mention of a dotted name is not found inside a longer one', () => {
  const members = [{ id: 'p1', handle: 'GPT-5.5', name: 'GPT-5.5' }, { id: 'p2', handle: 'GPT-5.5.1', name: 'GPT-5.5.1' }];
  expect(councilMention('@GPT-5.5.1 what do you think?', members)).toBe('p2');
  expect(councilMention('What about you, @GPT-5.5.', members)).toBe('p1');
  expect(councilMention('@GPT-5.5x', members)).toBeNull();
});

/** A debate as this journal stored it before the council: its own names, its votes, its summary. */
function storeDebate(h: TestCore, parent: ThreadSummary, id: string, status: string, delivered = true) {
  const salon: ThreadSummary = { ...parent, id: `thr_salon_${id}`, projectId: null, title: `Debate · ${id}`, councilId: id, parentThreadId: undefined };
  h.core.journal.putThread(salon);
  const participant = (index: number, model: string) => ({ id: `p${index}`, name: model, handle: model, providerId: 'twin', model, effort: null, threadId: null, letter: 'AB'[index - 1], angle: 'cost', readOnly: 'approvals', absent: [], pending: false });
  const debate = {
    id, topic: 'Which cache?', parentThreadId: parent.id, salonThreadId: salon.id, rounds: 2, round: 2, status, concluding: false, participants: [participant(1, 'alpha'), participant(2, 'beta')],
    summarizer: { id: 'summary', name: 'Judge', providerId: 'twin', model: 'judge', effort: null, threadId: null, readOnly: 'approvals', pending: false }, consensus: false, tally: [{ proposal: 'SQLite', votes: 2, of: 2 }],
    summary: 'SQLite won.', timeoutMinutes: 10, note: null, delivered, roundDeadline: null, warnings: [], createdAt: 1, updatedAt: 1, finishedAt: status === 'done' ? 2 : null, version: 3, internal: { turns: {}, roundStartedAt: 0 },
  };
  h.core.journal.db.query('INSERT INTO debates (id, parent_thread_id, salon_thread_id, request_id, fingerprint, status, version, data, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, 3, ?, 1, 1)').run(id, parent.id, salon.id, 'old', status, JSON.stringify(debate));
  const post = h.core.journal.db.query('INSERT INTO debate_posts (debate_id, seq, id, round, author, text, to_id, in_reply_to, vote, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, 1)');
  post.run(id, 1, `${id}_1`, 1, 'p1', 'Position: SQLite', null);
  post.run(id, 2, `${id}_2`, 2, 'p1', 'Position: SQLite\nVote: SQLite', 'SQLite');
  post.run(id, 3, `${id}_3`, 2, 'summary', 'SQLite won.', null);
}

test('a debate stored before the council stays readable; one still running stops and says why', async () => {
  const d = driver(() => 'Noted.');
  const { h, owner, threadId, read } = await setup();
  const parent = h.core.threads.require(threadId);
  storeDebate(h, parent, 'dbt_old', 'done');
  const { council, posts } = await read('dbt_old');
  expect(council).toMatchObject({ id: 'dbt_old', request: 'Which cache?', status: 'done', legacy: true, round: 2, roundsDone: 2, delivered: true });
  expect(council.members.map(member => [member.name, member.scores])).toEqual([['alpha', []], ['beta', []]]);
  expect(council).not.toHaveProperty('tally');
  expect(council.members[0]).not.toHaveProperty('letter');
  expect(posts.map(post => post.author)).toEqual(['p1', 'p1', 'summary']);
  expect((await owner.call('council.list', { threadId })).councils.map(entry => entry.id)).toEqual(['dbt_old']);
  expect(h.core.threads.require(`thr_salon_dbt_old`).councilId).toBe('dbt_old');
  // Nothing more happens in it, and nothing breaks.
  expect((await owner.call('council.stop', { councilId: 'dbt_old' })).status).toBe('done');
  expect(await failure(() => owner.call('council.again', { councilId: 'dbt_old', threadId, changes: 'More' }))).toHaveProperty('message', expect.stringContaining('is over'));
  expect(await failure(() => owner.call('council.post', { councilId: 'dbt_old', text: 'Hello' }))).toHaveProperty('message', expect.stringContaining('is over'));
  expect(await failure(() => owner.call('council.table', { councilId: 'dbt_old' }))).toHaveProperty('message', expect.stringContaining('no table'));
  expect((await boite(h, threadId, ['delegate', 'list'])).out).toContain('dbt_old council done');

  // A debate running at the update: the handoff has nothing to resume it with.
  storeDebate(h, parent, 'dbt_live', 'summarizing', false);
  h.core.council.resumeAfterRestart();
  const live = (await read('dbt_live')).council;
  expect([live.status, live.legacy]).toEqual(['stopped', true]);
  expect(live.note).toContain('replaced by the council');
  await waitFor(() => d.delivered().some(run => run.prompt.includes('Council dbt_live')));
  expect(d.delivered().find(run => run.prompt.includes('Council dbt_live'))!.prompt).toContain('SQLite won.');
});

test('a core that did not hand over stops its rounds and any stored debate still running; a council between rounds stays', async () => {
  const d = driver(run => (run.prompt.includes('Boite council, round') ? 'Answer.\nScore: 8/10' : 'Noted.'));
  const { h, threadId, start } = await setup();
  const waiting = await start();
  await waitFor(() => d.delivered().length === 1);
  await waitFor(() => h.core.council.get({ councilId: waiting.id }).council.delivered);
  await waitFor(() => !h.core.threads.isBusy(threadId));
  d.reply = () => null;
  const running = await start();
  await waitFor(() => d.round(1).length === 6);
  storeDebate(h, h.core.threads.require(threadId), 'dbt_live', 'running', false);
  await h.core.close();
  const restarted = new Core({ dataDir: h.dataDir, token: h.token });
  try {
    const stored = (id: string) => JSON.parse((restarted.journal.db.query('SELECT data FROM debates WHERE id = ?').get(id) as { data: string }).data) as Council;
    expect([stored(running.id).status, stored(running.id).note]).toEqual(['stopped', 'Boite restarted during the round, so it stopped.']);
    expect([stored('dbt_live').status, stored('dbt_live').request, stored('dbt_live').note]).toEqual(['stopped', 'Which cache?', 'Boite restarted during the round, so it stopped.']);
    expect([stored(waiting.id).status, stored(waiting.id).roundsDone]).toEqual(['waiting', 1]);
  } finally { await restarted.close(); }
}, 20_000);
