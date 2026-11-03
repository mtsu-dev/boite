import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ENV, DEFAULT_DELEGATION_CONFIG, type Debate, type DebatePost, type ModelInfo } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { runCli } from '../src/cli.ts';
import { Core } from '../src/core.ts';
import { setDriver } from '../src/drivers/index.ts';
import type { TurnResult } from '../src/drivers/types.ts';
import { subagentGuide } from '../src/delegation/guide.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

const cores: TestCore[] = [];
const restores: (() => void)[] = [];
afterEach(async () => { for (const h of cores.splice(0)) await h.stop(); for (const restore of restores.splice(0).reverse()) restore(); });

interface Run { threadId: string; model: string | null; prompt: string; finish: (text?: string, status?: TurnResult['status']) => void; status: TurnResult['status'] | null }
/** What a run answers: text at once, `null` to hold it until the test finishes it. */
type Reply = (run: Run) => string | null;

/** Every echo turn, debaters and summarizer included: `reply` decides, and the test can swap it. */
function driver(initial: Reply = () => null) {
  const runs: Run[] = [];
  const state = { reply: initial };
  restores.push(setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    let resolve!: (value: TurnResult) => void;
    const done = new Promise<TurnResult>(r => { resolve = r; });
    const run: Run = {
      threadId: ctx.thread.id, model: ctx.thread.model, prompt: ctx.prompt, status: null,
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
    /** The debate's own prompt, without what Boite adds around a turn. */
    debatePart: (run: Run) => run.prompt.slice(Math.max(0, run.prompt.indexOf('Boite debate, round'))),
    round: (round: number, of: number) => runs.filter(run => run.prompt.includes(`Boite debate, round ${round} of ${of}.`)),
    summaries: () => runs.filter(run => run.prompt.includes('You did not take part in this Boite debate')),
  });
}

/** Debaters on the echo driver under another provider, each model with its own name. */
async function twinProvider(h: TestCore, owner: CoreClient, models: ModelInfo[]): Promise<void> {
  const shipped = JSON.parse(readFileSync(join(import.meta.dir, '../src/providers/shipped/echo.json'), 'utf8')) as Record<string, unknown>;
  mkdirSync(join(h.dataDir, 'providers'), { recursive: true });
  writeFileSync(join(h.dataDir, 'providers', 'twin.json'), JSON.stringify({ ...shipped, id: 'twin', name: 'Twin', shortName: 'Twin', models }));
  expect((await owner.call('providers.reload', {})).rejected).toEqual([]);
  h.core.accounts.ensureDefaults();
}

async function failure(run: () => unknown): Promise<Error & { rpc: { data?: unknown } }> {
  try { await run(); } catch (error) { return error as Error & { rpc: { data?: unknown } }; }
  throw new Error('expected a failure');
}

async function setup(experiment = true) {
  const h = await startTestCore(); cores.push(h);
  const owner = await h.connect();
  if (experiment) await owner.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: ['debates'], labels: {} });
  const { threadId } = await echoThread(h, owner, 'Parent');
  await twinProvider(h, owner, [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'gamma', name: 'Gamma' }, { id: 'judge', name: 'Judge' }]);
  const start = (extra: Record<string, unknown> = {}) => owner.call('debates.start', { threadId, topic: 'Which cache should Boite use?', models: ['twin/alpha', 'twin/beta', 'twin/gamma'], summary: 'twin/judge', ...extra });
  const read = async (debateId: string) => owner.call('debates.get', { debateId });
  return { h, owner, threadId, start, read };
}

/** `boite <args>` from the parent's thread, with its agent token. */
async function boite(h: TestCore, threadId: string, args: string[]) {
  let out = '';
  let err = '';
  const env = { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: h.url, [AGENT_ENV.token]: h.core.agents.tokenFor(threadId) };
  const code = await runCli(args, { out: text => { out += text; }, err: text => { err += text; }, env, cwd: h.dataDir });
  return { code, out, err };
}

const threadsOf = (debate: Debate) => [...debate.participants.map(p => p.threadId!), debate.summarizer.threadId!];
const by = (debate: Debate, model: string) => debate.participants.find(p => p.model === model)!;

test('debates are refused with a reason, and left out of the agent guide, while the experiment is off', async () => {
  driver();
  const { h, owner, threadId, start } = await setup(false);
  expect((await failure(() => start())).rpc.data).toMatchObject({ reason: 'experiment-off' });
  expect((await failure(() => owner.call('debates.list', {}))).rpc.data).toMatchObject({ reason: 'experiment-off' });
  const cli = await boite(h, threadId, ['delegate', 'debate', 'Which cache?', '--models', 'twin/alpha,twin/beta']);
  expect(cli.code).not.toBe(0);
  expect(cli.err).toContain('AI debates experiment');
  expect(h.core.journal.db.query('SELECT COUNT(*) AS n FROM debates').get()).toEqual({ n: 0 });
  expect(subagentGuide(DEFAULT_DELEGATION_CONFIG, false, false)).not.toContain('delegate debate');
  expect(subagentGuide(DEFAULT_DELEGATION_CONFIG, false, true)).toContain('delegate debate');
  expect(h.core.delegation.instructions(threadId, 'organise a debate between models')).not.toContain('delegate debate');
});

test('a debate runs blind, anonymous rounds, takes the user\'s messages, counts the votes and hands a fresh summary back', async () => {
  const d = driver();
  const { h, owner, threadId, read } = await setup();
  h.core.threads.startTurn(threadId, 'Ask a few models which cache to use');
  await waitFor(() => d.runs.some(run => run.threadId === threadId));

  const cli = await boite(h, threadId, ['delegate', 'debate', 'Which cache should Boite use?', '--models', 'twin/alpha,twin/beta,twin/gamma', '--rounds', '2', '--angles', 'player,engineer,cost', '--summary', 'twin/judge']);
  expect(cli.err).toBe('');
  expect(cli.code).toBe(0);
  expect(cli.out).toContain('summary: Judge, who does not debate');
  expect(cli.out).toContain('has no read-only mode: Boite refuses every permission it asks.');
  const debateId = /debate: (dbt_\S+)/.exec(cli.out)![1]!;
  let { debate } = await read(debateId);
  expect(debate.participants.map(p => p.letter).sort()).toEqual(['A', 'B', 'C']);
  expect(debate.participants.map(p => [p.model, p.angle, p.readOnly])).toEqual([['alpha', 'player', 'approvals'], ['beta', 'engineer', 'approvals'], ['gamma', 'cost', 'approvals']]);
  expect(new Set(threadsOf(debate)).size).toBe(4);
  expect(h.core.threads.require(debate.salonThreadId)).toMatchObject({ projectId: null, debateId });
  expect(() => h.core.threads.startTurn(debate.salonThreadId, 'hello')).toThrow('a debate\'s salon runs no agent');
  // The card lands on the turn that ran the command.
  expect(h.core.journal.listMessages(threadId).flatMap(message => message.parts)).toContainEqual({ type: 'debate', debateId, topic: 'Which cache should Boite use?' });

  // Round 1 is blind and anonymous: each debater reads its letter and angle, no name and no other opinion.
  await waitFor(() => d.round(1, 2).length === 3);
  for (const run of d.round(1, 2)) {
    const prompt = d.debatePart(run);
    const me = debate.participants.find(p => p.threadId === run.threadId)!;
    expect(prompt).toContain(`You are Opinion ${me.letter} among 3 anonymous opinions (A, B, C). You argue from this angle: ${me.angle}.`);
    expect(prompt).toContain('You do not see the other opinions this round.');
    expect(prompt).not.toMatch(/Alpha|Beta|Gamma|Judge|alpha|beta|gamma/);
    expect(prompt).not.toContain('Vote:');
  }
  expect(d.summaries()).toEqual([]);

  // The user writes while round 1 runs: to everyone, then to Beta only.
  const everyone = await owner.call('debates.post', { debateId, text: 'Think about phones too.' });
  const toBeta = await owner.call('debates.post', { debateId, text: '@Beta why not SQLite?' });
  expect([everyone.to, everyone.round, toBeta.to, toBeta.round]).toEqual([null, 2, by(debate, 'beta').id, 2]);

  const positions: Record<string, string> = { alpha: 'Ship the SQLite cache', beta: 'Keep the JSON files', gamma: 'Ship the SQLite cache' };
  d.reply = run => run.prompt.includes('Boite debate, round 2')
    ? `Position: ${positions[run.model!]}\nObjection: migrations need care.\nVote: ${run.model === 'beta' ? 'Keep the JSON files' : 'Ship the SQLite cache'}`
    : run.prompt.includes('You did not take part') ? '## Summary\nSQLite won 2/3; JSON keeps one voice.' : null;
  for (const run of d.round(1, 2)) run.finish(`Position: ${positions[run.model!]}\nBecause it fits.`);

  // Round 2 reads round 1 under letters, the objection rule, the user's messages for it and the vote.
  await waitFor(() => d.summaries().length === 1);
  const second = d.round(2, 2);
  expect(second).toHaveLength(3);
  for (const run of second) {
    const prompt = d.debatePart(run);
    expect(prompt).toContain('The answers of round 1');
    expect(prompt).toContain('Because it fits.');
    expect(prompt).toContain('Before you agree with any opinion, name at least one concrete objection');
    expect(prompt).toContain('end with one line `Vote:');
    expect(prompt).toContain('Think about phones too.');
    expect(prompt.includes('@Beta why not SQLite?')).toBe(run.model === 'beta');
    expect(prompt).not.toMatch(/Alpha|Gamma|Judge|alpha|beta|gamma/);
  }
  // The summarizer did not debate, starts after the last answer and reads the count.
  const summary = d.summaries()[0]!;
  expect(summary.threadId).toBe(debate.summarizer.threadId!);
  expect(debate.participants.some(p => p.threadId === summary.threadId)).toBe(false);
  expect(d.runs.indexOf(summary)).toBeGreaterThan(Math.max(...second.map(run => d.runs.indexOf(run))));
  expect(summary.prompt).toContain('"votes":"2/3"');
  expect(summary.prompt).toContain('Think about phones too.');

  await waitFor(() => h.core.debates.get({ debateId }).debate.status === 'done');
  let posts: DebatePost[];
  ({ debate, posts } = await read(debateId));
  expect(debate.tally.map(t => [t.proposal, t.votes, t.of])).toEqual([['Ship the SQLite cache', 2, 3], ['Keep the JSON files', 1, 3]]);
  const answer = (model: string, round: number) => posts.find(post => post.author === by(debate, model).id && post.round === round)!;
  expect(answer('beta', 2).inReplyTo).toBe(toBeta.id);
  expect(answer('alpha', 2).inReplyTo).toBeNull();
  expect([answer('alpha', 1).vote, answer('alpha', 2).vote]).toEqual([null, 'Ship the SQLite cache']);
  expect(posts.at(-1)).toMatchObject({ author: 'summary', text: '## Summary\nSQLite won 2/3; JSON keeps one voice.' });

  // The summary waits for the parent's own turn, then wakes it once.
  expect(debate.delivered).toBe(false);
  d.reply = () => 'Noted.';
  d.runs.find(run => run.threadId === threadId)!.finish('Started a debate.');
  await waitFor(() => d.runs.filter(run => run.threadId === threadId).length === 2);
  const delivered = d.runs.filter(run => run.threadId === threadId)[1]!.prompt;
  expect(delivered).toContain(`Debate ${debateId} on "Which cache should Boite use?" is over. Summary by Judge, who did not debate.`);
  expect(delivered).toContain(`Opinion ${by(debate, 'alpha').letter} = Alpha (player)`);
  expect(delivered).toContain('SQLite won 2/3');
  await waitFor(() => h.core.debates.get({ debateId }).debate.delivered);
  await waitFor(() => threadsOf(debate).every(id => h.core.threads.require(id).archived));
  expect((await boite(h, threadId, ['delegate', 'list'])).out).toContain(`${debateId} debate done`);
  expect(h.core.delegation.instructions(threadId, 'organise a debate between models')).toContain('delegate debate');
}, 20_000);

test('round 1 with fewer than two answers stops the debate and tells the parent, without a summary', async () => {
  const d = driver(run => (run.prompt.includes('Boite debate, round 1') ? (run.model === 'alpha' ? 'Position: Ship the SQLite cache' : '') : run.prompt.includes('Debate dbt_') ? 'Noted.' : null));
  const { h, threadId, start, read } = await setup();
  const { id } = await start();
  await waitFor(() => d.runs.filter(run => run.threadId === threadId).length === 1);
  const { debate, posts } = await read(id);
  expect(debate.status).toBe('stopped');
  expect(debate.note).toBe('Only 1 of 3 debaters answered round 1; a debate needs two, so it stopped.');
  expect(posts.filter(post => post.author === 'system').map(post => post.text)).toEqual(expect.arrayContaining(['Beta did not answer round 1: its answer was empty.', 'Gamma did not answer round 1: its answer was empty.']));
  expect(d.summaries()).toEqual([]);
  expect(d.runs.find(run => run.threadId === threadId)!.prompt).toContain(`Debate ${id} on "Which cache should Boite use?" ended without a summary (stopped): Only 1 of 3`);
  await waitFor(() => threadsOf(debate).every(thread => h.core.threads.require(thread).archived));
});

test('a debater past the round\'s time is absent from it, its turn stops and the debate goes on', async () => {
  const d = driver(run => (run.model === 'gamma' ? null : run.prompt.includes('You did not take part') ? 'Summary.' : run.prompt.includes('Boite debate') ? `Position: ${run.model}` : 'Noted.'));
  const { h, start, read } = await setup();
  h.core.debates.minuteMs = 150;
  const { id } = await start({ rounds: 1, timeoutMinutes: 1 });
  await waitFor(() => h.core.debates.get({ debateId: id }).debate.status === 'done', 5000);
  const { debate, posts } = await read(id);
  const gamma = by(debate, 'gamma');
  expect(gamma.absent).toEqual([1]);
  expect(posts.map(post => post.text)).toContain('Gamma did not answer round 1: no answer within 1 minute.');
  expect(d.runs.find(run => run.threadId === gamma.threadId)!.status).toBe('stopped');
  // A single round asks no vote; the summary names who was missing.
  expect(d.round(1, 1).every(run => !d.debatePart(run).includes('Vote:'))).toBe(true);
  expect(d.summaries()[0]!.prompt).toContain(`Did not answer, supplied as JSON data:\n[{"opinion":"${gamma.letter}","rounds":[1]}]`);
});

test('everyone backing one proposal in round 1 goes straight to the summary', async () => {
  const d = driver(run => (run.prompt.includes('You did not take part') ? 'Unanimous.' : run.prompt.includes('Boite debate') ? `**Position:** ship the SQLite cache${run.model === 'beta' ? '.' : ''}` : 'Noted.'));
  const { h, start } = await setup();
  const { id } = await start({ rounds: 3 });
  await waitFor(() => h.core.debates.get({ debateId: id }).debate.status === 'done');
  const { debate } = h.core.debates.get({ debateId: id });
  expect([debate.consensus, debate.round]).toEqual([true, 1]);
  expect(d.round(2, 3)).toEqual([]);
  expect(d.summaries()[0]!.prompt).toContain('Everyone backed the same proposal in round 1');
});

test('the user closes a round, concludes, and the parent\'s agent stops the debate without being woken', async () => {
  const d = driver();
  const { h, owner, threadId, start, read } = await setup();
  const { id } = await start({ rounds: 3 });
  await waitFor(() => d.round(1, 3).length === 3);
  let { debate } = await read(id);
  for (const run of d.round(1, 3)) if (run.model !== 'gamma') run.finish(`Position: ${run.model}`);
  await waitFor(() => h.core.debates.get({ debateId: id }).posts.length === 2);
  // Tour suivant: Gamma is absent from round 1, its turn stops, round 2 asks everyone.
  await owner.call('debates.next', { debateId: id });
  await waitFor(() => d.round(2, 3).length === 3);
  ({ debate } = await read(id));
  expect(by(debate, 'gamma').absent).toEqual([1]);
  expect(d.round(1, 3).find(run => run.model === 'gamma')!.status).toBe('stopped');

  // Conclure: round 2 still finishes, then the summary instead of round 3.
  expect((await owner.call('debates.conclude', { debateId: id })).concluding).toBe(true);
  for (const run of d.round(2, 3)) run.finish(`Position: ${run.model}`);
  await waitFor(() => d.summaries().length === 1);
  expect(d.round(3, 3)).toEqual([]);
  expect(h.core.debates.get({ debateId: id }).debate.status).toBe('summarizing');
  expect(await failure(() => owner.call('debates.post', { debateId: id, text: 'One more thing' }))).toHaveProperty('message', expect.stringContaining('being summarized'));
  expect((await boite(h, threadId, ['delegate', 'list'])).out).toContain(`${id} debate summarizing`);

  const stopped = await boite(h, threadId, ['delegate', 'stop', id]);
  expect(stopped.code).toBe(0);
  ({ debate } = await read(id));
  expect([debate.status, debate.note, debate.delivered]).toEqual(['stopped', 'Stopped by the agent that started it.', true]);
  await waitFor(() => d.summaries()[0]!.status === 'stopped');
  await waitFor(() => threadsOf(debate).every(thread => h.core.threads.require(thread).archived));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(d.runs.filter(run => run.threadId === threadId)).toEqual([]);
}, 20_000);

test('archiving the thread that started a debate stops it, its debaters\' turns and the summary', async () => {
  const d = driver();
  const { h, owner, threadId, start, read } = await setup();
  const { id } = await start({ rounds: 2 });
  await waitFor(() => d.round(1, 2).length === 3);
  await owner.call('threads.archive', { threadId });
  await waitFor(() => h.core.debates.get({ debateId: id }).debate.status === 'stopped');
  const { debate } = await read(id);
  expect(debate.note).toBe('The thread that started it was archived.');
  await waitFor(() => d.round(1, 2).every(run => run.status === 'stopped'));
  await waitFor(() => threadsOf(debate).every(thread => h.core.threads.require(thread).archived));
  expect(d.summaries()).toEqual([]);
});

test('a core that did not hand over stops its running debates on the next start', async () => {
  driver();
  const { h, start } = await setup();
  const { id } = await start({ rounds: 2 });
  await h.core.close();
  const restarted = new Core({ dataDir: h.dataDir, token: h.token });
  try {
    const stored = JSON.parse((restarted.journal.db.query('SELECT data FROM debates WHERE id = ?').get(id) as { data: string }).data) as Debate;
    expect([stored.status, stored.note]).toEqual(['stopped', 'Boite restarted during the debate, so it stopped.']);
  } finally { await restarted.close(); }
});
