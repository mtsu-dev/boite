import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONVERSATION_PROFILE_ID, doneQuestion, RpcErrorCode, type PromptCache } from '@boite/contracts';
import { assertAllowed } from '../src/access.ts';
import { connect } from '../src/client.ts';
import { Core } from '../src/core.ts';
import { setDriver } from '../src/drivers/index.ts';
import { echoDriver } from '../src/drivers/echo.ts';
import type { Driver } from '../src/drivers/types.ts';
import { MergedPrAsk } from '../src/merged-pr-ask.ts';
import { archiveState, archiveStateKey } from '../src/merged-pr-archive-state.ts';
import { fetchedRepositories, githubRepository, parseMergedPrProof } from '../src/pull-requests.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';
import { rejection, thrown } from './settle.ts';

let harness: TestCore;
let service: MergedPrAsk;
let restoreSpawn: (() => void) | undefined;
let restoreDriver: (() => void) | undefined;
beforeEach(async () => { harness = await startTestCore(); });
afterEach(async () => { restoreSpawn?.(); restoreSpawn = undefined; await service?.close(); await harness.stop(); restoreDriver?.(); restoreDriver = undefined; });
const gitEnv = { ...process.env, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Fixture', GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'fixture@example.invalid' };
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: gitEnv, stdout: 'pipe', stderr: 'pipe' });
  if (!result.success) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
const PR7 = 'https://github.com/example/repo/pull/7';
/**
 * The echo agent answering in one line. The plain echo agent opens a question
 * card on the word `question`, which the Done question's prompt holds.
 */
const quietEcho: Driver = { ...echoDriver, startTurn(ctx) {
  const message = ctx.emit.startMessage('assistant');
  ctx.emit.part(message, 0, { type: 'text', text: 'Noted.' });
  ctx.emit.complete(message, 'complete');
  return { done: Promise.resolve({ status: 'done', sessionId: null, usage: null }), stop() {} };
} };
/** The turns Boite opened to ask the agent whether the thread is done. */
const questions = (threadId: string) => harness.core.journal.listTurns(threadId).filter(turn => turn.execution?.operation === 'pull-request');
/** Boite asked once about `urls` with a turn of its own, recorded them, and put nothing away; then the agent answered. */
async function expectAsked(threadId: string, urls = [PR7], summary = '#7 merged'): Promise<void> {
  const asked = questions(threadId);
  expect(asked).toHaveLength(1);
  const { text, label } = doneQuestion({ urls, summary });
  const message = [...harness.core.journal.walkTurnMessages(threadId, asked[0]!.id)].find(entry => entry.role === 'system');
  expect(message?.parts[0]).toMatchObject({ type: 'text', text, displayText: label });
  expect(text.startsWith('Boite: every pull request')).toBe(true);
  expect(archiveState(harness.core.journal, threadId).asked).toEqual(urls);
  expect(harness.core.threads.require(threadId)).toMatchObject({ archived: false });
  expect(harness.core.threads.require(threadId).doneAt ?? null).toBeNull();
  await waitFor(() => harness.core.journal.getTurn(asked[0]!.id)?.finishedAt != null && harness.core.threads.require(threadId).status === 'idle');
  expect(harness.core.threads.require(threadId).archived).toBe(false);
}
/** Nothing asked: no turn of Boite's own, no URL recorded. */
function expectNotAsked(threadId: string): void {
  expect(questions(threadId)).toEqual([]);
  expect(archiveState(harness.core.journal, threadId).asked ?? []).toEqual([]);
}
/** A finished turn copied onto `threadId`: a thread is asked only while its last turn is recent. */
function finishedTurn(source: string, threadId: string, id = `trn_${threadId}`): void {
  harness.core.journal.putTurn({ ...harness.core.journal.lastTurn(source)!, id, threadId });
}

async function fixture() {
  restoreDriver ??= setDriver('echo', quietEcho);
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  // The conversation that opened the pull request: its last turn keeps the agent's cache warm.
  const opened = await client.call('turns.start', { threadId, prompt: 'Open the pull request.' });
  await waitFor(() => harness.core.journal.getTurn(opened.id)?.status === 'done' && harness.core.threads.require(threadId).status === 'idle');
  const repo = join(harness.dataDir, 'repo'), checkout = join(harness.dataDir, 'worktree');
  mkdirSync(repo);
  git(repo, 'init', '-q'); git(repo, 'commit', '-q', '--allow-empty', '-m', 'fixture');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/example/repo.git');
  git(repo, 'worktree', 'add', '-q', '-b', 'topic', checkout);
  const thread = harness.core.threads.require(threadId);
  const project = harness.core.journal.getProject(thread.projectId!)!;
  harness.core.journal.putProject({ ...project, path: repo });
  harness.core.journal.putThread({ ...thread, cwd: checkout, branch: 'topic', pinned: false, unread: false });
  const sha = git(checkout, 'rev-parse', 'HEAD');
  let candidates = [{ title: 'Merged change', baseRefName: 'main', number: 7, url: 'https://github.com/example/repo/pull/7', state: 'MERGED', headRefName: 'topic', headRefOid: sha, headRepository: { name: 'repo' }, headRepositoryOwner: { login: 'example' }, isCrossRepository: false, mergedAt: '2026-10-01T12:00:00Z' }];
  const spawn = harness.core.procs.spawn.bind(harness.core.procs);
  let ghGate: string | undefined;
  let hideList = false;
  let unavailableView: string | undefined;
  let ghCalls = 0;
  const replacement = spyOn(harness.core.procs, 'spawn').mockImplementation((scope, command, args, options) => {
    if (command !== 'gh') return spawn(scope, command, args, options);
    ghCalls++;
    const wait = ghGate ? `while (!require('node:fs').existsSync(${JSON.stringify(ghGate)})) await Bun.sleep(5);` : '';
    // `gh pr view <url>` answers one object, or fails for an unknown PR.
    if (args[1] === 'view') {
      if (args[2] === unavailableView) return spawn(scope, process.execPath, ['-e', 'console.error("HTTP 502: Bad Gateway"); process.exit(1)'], options);
      const found = candidates.find(candidate => candidate.url === args[2]);
      return spawn(scope, process.execPath, ['-e', found ? `${wait}console.log(${JSON.stringify(JSON.stringify(found))})` : 'console.error("no pull requests found"); process.exit(1)'], options);
    }
    return spawn(scope, process.execPath, ['-e', `${wait}console.log(${JSON.stringify(JSON.stringify(hideList ? [] : candidates))})`], options);
  });
  restoreSpawn = () => replacement.mockRestore();
  await harness.core.mergedPrAsk.close();
  service = new MergedPrAsk(harness.core, harness.core.pullRequests, 0, 0);
  Object.defineProperty(harness.core, 'mergedPrAsk', { value: service });
  return { client, threadId, repo, checkout, project, sha, setCandidates: (value: typeof candidates) => { candidates = value; }, candidates,
    holdGh: () => { ghGate = join(harness.dataDir, 'gh-gate'); },
    releaseGh: () => { if (ghGate) writeFileSync(ghGate, 'ready'); },
    ghCalls: () => ghCalls,
    hideList: () => { hideList = true; },
    failView: (url: string) => { unavailableView = url; },
    /** Every process the core spawned since the fixture started, as `<command> <first argument>`. */
    spawned: () => replacement.mock.calls.map(([, command, args]) => `${command} ${args[0]}`),
  };
}

async function completedFamily() {
  restoreDriver = setDriver('echo', { protocol: 'echo', sideQuestion: async () => 'Completed fixture question.', startTurn(ctx) {
    const message = ctx.emit.startMessage('assistant');
    ctx.emit.part(message, 0, { type: 'text', text: 'Completed fixture work.' });
    ctx.emit.complete(message, 'complete');
    return { done: Promise.resolve({ status: 'done', sessionId: null, usage: null }), stop() {} };
  } });
  const f = await fixture();
  const run = await f.client.call('workflows.start', { threadId: f.threadId, requestId: 'archive-family-workflow', plan: { name: 'Completed family', steps: [{ id: 'review', task: 'Review the merged change.' }] } });
  await waitFor(() => {
    const current = harness.core.workflows.get(f.threadId, run.id);
    return current.status === 'done' && current.delivered && harness.core.threads.require(f.threadId).status === 'idle';
  });
  const delegated = await f.client.call('delegation.spawn', { threadId: f.threadId, profileId: CONVERSATION_PROFILE_ID, task: 'Verify the merged change.', requestId: 'archive-family-delegate' });
  await waitFor(() => {
    const team = harness.core.delegation.get(f.threadId);
    return team.messages.some(letter => letter.origin === 'result' && letter.status === 'delivered') && harness.core.threads.require(f.threadId).status === 'idle' && harness.core.threads.require(delegated.thread.id).status === 'idle';
  });
  const children = harness.core.journal.listThreads().filter(thread => thread.parentThreadId === f.threadId);
  expect(children).toHaveLength(2);
  // Both finished and told their parent: they are put away as done.
  expect(children.map(child => [child.archived, child.doneAt != null])).toEqual([[true, true], [true, true]]);
  for (const thread of [harness.core.threads.require(f.threadId), ...children]) await f.client.call('threads.markRead', { threadId: thread.id });
  return { ...f, children, runId: run.id };
}

test.each(['badge', 'linked PR'] as const)('a merge the %s detects while the thread works is asked only after that turn ends', async source => {
  const f = await fixture();
  const core = harness.core;
  await service.close();
  // A short settling delay after the turn, and no periodic sweep: only the detection asks.
  service = new MergedPrAsk(core, core.pullRequests, 50, 3_600_000);
  Object.defineProperty(core, 'mergedPrAsk', { value: service });
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  restoreDriver?.();
  restoreDriver = setDriver('echo', { ...quietEcho, startTurn(ctx) {
    return { stop() { finish(); }, done: gate.then(() => {
      const message = ctx.emit.startMessage('assistant');
      ctx.emit.part(message, 0, { type: 'text', text: 'Final answer after the merge.' });
      ctx.emit.complete(message, 'complete');
      return { status: 'done' as const, sessionId: null, usage: null };
    }) };
  } });
  const turn = await f.client.call('turns.start', { threadId: f.threadId, prompt: 'Finish reporting the merged change.' });
  try {
    await waitFor(() => core.threads.runner.handles.has(f.threadId));
    if (source === 'badge') expect(await f.client.call('threads.pullRequest', { threadId: f.threadId })).toMatchObject({ state: 'MERGED' });
    else await f.client.call('threads.linkPullRequest', { threadId: f.threadId, url: f.candidates[0]!.url });
    // The detection found the thread at work: nothing lands in the middle of the agent's answer.
    await Bun.sleep(200);
    expectNotAsked(f.threadId);
    finish();
    await waitFor(() => core.journal.getTurn(turn.id)?.status === 'done');
    const ended = core.journal.getTurn(turn.id)!.finishedAt!;
    await waitFor(() => questions(f.threadId).length > 0, 3000);
    expect(questions(f.threadId)[0]!.queuedAt).toBeGreaterThanOrEqual(ended + 50);
    await expectAsked(f.threadId);
  } finally { finish(); }
});

test.each(['restore', 'draft'] as const)('detected merges respect a late %s during checkout validation', async change => {
  const f = await fixture();
  const core = harness.core;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let validating = false;
  let validated = false;
  const validate = core.pullRequests.validateMergedCheckout.bind(core.pullRequests);
  const held = spyOn(core.pullRequests, 'validateMergedCheckout').mockImplementation(async (...args) => {
    validating = true;
    await gate;
    return validate(...args).finally(() => { validated = true; });
  });
  try {
    await f.client.call('threads.pullRequest', { threadId: f.threadId });
    await waitFor(() => validating);
    if (change === 'restore') core.threads.archive(f.threadId, false);
    else core.threads.focus.set('typing-device', null, [f.threadId]);
    release();
    await waitFor(() => validated);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(core.threads.require(f.threadId).archived).toBe(false);
    expectNotAsked(f.threadId);
  } finally { release(); held.mockRestore(); }
});

test('a merge observed as the last detection finishes is processed without another notification', async () => {
  const f = await fixture();
  const journal = harness.core.journal;
  const read = journal.getThread.bind(journal);
  const get = spyOn(journal, 'getThread').mockImplementation(id => {
    if (id === 'deleted-merge-detection') {
      // A badge result queued behind the final read runs before the drain's cleanup.
      queueMicrotask(() => service.observe(f.threadId));
      return null;
    }
    return read(id);
  });
  try {
    service.observe('deleted-merge-detection');
    await waitFor(() => questions(f.threadId).length > 0, 1500);
  } finally { get.mockRestore(); }
  await expectAsked(f.threadId);
});

test('a failed detected conversation read asks nothing there and continues with the next merge', async () => {
  const f = await fixture();
  const core = harness.core, journal = core.journal;
  const broken = 'unreadable-detected-thread';
  journal.putThread({ ...core.threads.require(f.threadId), id: broken, branch: 'unreadable' });
  const read = journal.getThread.bind(journal);
  const warning = spyOn(core, 'log');
  const get = spyOn(journal, 'getThread').mockImplementation(id => {
    if (id === broken) throw new Error('fixture journal read failed');
    return read(id);
  });
  try {
    service.observe(broken);
    service.observe(f.threadId);
    await waitFor(() => questions(f.threadId).length > 0, 1500);
    expect(warning.mock.calls.some(([, , context]) => context?.event === 'ask.detectionFailed' && context.threadId === broken)).toBe(true);
  } finally { get.mockRestore(); warning.mockRestore(); }
  expectNotAsked(broken);
  await expectAsked(f.threadId);
});

test('detected proof failures back off independently of history scans and retry after expiry or a thread change', async () => {
  const f = await fixture();
  const journal = harness.core.journal;
  const original = harness.core.threads.require(f.threadId);
  const proof = spyOn(harness.core.pullRequests, 'proveMerged').mockResolvedValue(null);
  const now = Date.now.bind(Date);
  let elapsed = 0;
  const clock = spyOn(Date, 'now').mockImplementation(() => now() + elapsed);
  const observe = async () => {
    service.observe(f.threadId);
    // A null proof settles within the detection turn, including its promise callbacks.
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
  };
  try {
    expect(await service.sweep()).toBe(0);
    expect(proof).toHaveBeenCalledTimes(1);
    elapsed = 30_000;
    await observe(); // A scan's negative proof cannot delay newly detected work.
    expect(proof).toHaveBeenCalledTimes(2);
    for (let read = 0; read < 3; read++) await observe();
    expect(proof).toHaveBeenCalledTimes(2);
    elapsed = 60_001;
    expect(await service.sweep()).toBe(0);
    expect(proof).toHaveBeenCalledTimes(3);
    await observe();
    expect(proof).toHaveBeenCalledTimes(3);
    elapsed = 90_001;
    await observe();
    expect(proof).toHaveBeenCalledTimes(4);
    journal.putThread({ ...original, updatedAt: original.updatedAt + 1 });
    await observe();
    expect(proof).toHaveBeenCalledTimes(5);
    expectNotAsked(f.threadId);
  } finally { proof.mockRestore(); clock.mockRestore(); }
});

test('large sweeps bound hydration, yield to owner RPCs and advance beyond retained candidates', async () => {
  const f = await fixture();
  const journal = harness.core.journal;
  const original = harness.core.threads.require(f.threadId);
  const ids: string[] = [];
  journal.db.transaction(() => {
    journal.putThread({ ...original, archived: true });
    for (let index = 0; index < 20_000; index++) {
      const id = `selection-${index}`;
      ids.push(id);
      journal.putThread({ ...original, id, branch: `selection-${index}`, cwd: join(f.checkout, id), archived: index > 168 });
      journal.putMessage({ id: `selection-message-${index}`, threadId: id, turnId: `selection-turn-${index}`, role: 'user', state: 'complete', createdAt: 1, parts: [{ type: 'text', text: 'Retained history.' }] });
      if (index <= 168) finishedTurn(f.threadId, id, `selection-turn-${index}`);
      if (index >= 8 && index < 168) harness.core.threads.deferred.pendingWakes.set(id, 'Retained result');
    }
  })();
  const enumerations = spyOn(journal, 'listThreads');
  const hydration = spyOn(journal, 'getThread');
  const scheduler = spyOn(harness.core.scheduler, 'state');
  const proved: string[] = [];
  const proofYielded: boolean[] = [];
  let yielded = false;
  const proof = spyOn(harness.core.pullRequests, 'proveMerged').mockImplementation(async thread => { proved.push(thread.id); proofYielded.push(yielded); return null; });
  const measurements: Record<string, number | boolean>[] = [];
  try {
    for (let pass = 0; pass < 3; pass++) {
      const enumerated = enumerations.mock.calls.length, hydrated = hydration.mock.calls.length, snapshots = scheduler.mock.calls.length, proofs = proved.length;
      yielded = false;
      setImmediate(() => { yielded = true; });
      const started = performance.now(), usage = process.cpuUsage();
      const pending = service.sweep();
      const synchronousMs = performance.now() - started;
      const rpcStarted = performance.now();
      expect((await f.client.call('projects.list', {})).some(project => project.id === f.project.id)).toBe(true);
      const rpcMs = performance.now() - rpcStarted;
      expect(await pending).toBe(0);
      const elapsedMs = performance.now() - started;
      const cpu = process.cpuUsage(usage);
      measurements.push({ pass, enumerations: enumerations.mock.calls.length - enumerated, hydrated: hydration.mock.calls.length - hydrated,
        schedulerSnapshots: scheduler.mock.calls.length - snapshots, proofs: proved.length - proofs, synchronousMs, elapsedMs, rpcMs,
        cpuMs: (cpu.user + cpu.system) / 1000, yielded });
    }
    console.log('archive-selection-measurement', JSON.stringify({ threads: 20_001, messages: 20_000, measurements }));
    expect(enumerations).not.toHaveBeenCalled();
    expect(measurements.every(measurement => Number(measurement.hydrated) <= 136 && Number(measurement.schedulerSnapshots) <= 17)).toBe(true);
    expect(measurements.every(measurement => Number(measurement.proofs) <= 8)).toBe(true);
    expect(proofYielded.every(Boolean)).toBe(true);
    expect(proved).toContain(ids[168]!);
    expect(proved.filter(id => ids.slice(8, 168).includes(id))).toEqual([]);
    expectNotAsked(ids[168]!);
    const unrelated = await echoThread(harness, f.client, 'Unrelated work after archive scans');
    const turn = await f.client.call('turns.start', { threadId: unrelated.threadId, prompt: 'Still functional.' });
    await waitFor(() => journal.getTurn(turn.id)?.status === 'done');
    expect(journal.getTurn(turn.id)?.status).toBe('done');
  } finally { proof.mockRestore(); enumerations.mockRestore(); hydration.mockRestore(); scheduler.mockRestore(); }
});

test('unmerged worktree threads share repository reads and check again once a minute', async () => {
  const f = await fixture();
  const journal = harness.core.journal;
  const original = harness.core.threads.require(f.threadId);
  const ids = [f.threadId];
  for (let index = 1; index < 4; index++) {
    const checkout = join(harness.dataDir, `worktree-${index}`);
    git(f.repo, 'worktree', 'add', '-q', '-b', `topic-${index}`, checkout);
    journal.putThread({ ...original, id: `unmerged-${index}`, cwd: checkout, branch: `topic-${index}` });
    finishedTurn(f.threadId, `unmerged-${index}`);
    ids.push(`unmerged-${index}`);
  }
  const open = ['topic', 'topic-1', 'topic-2', 'topic-3'].map((branch, index) => ({ ...f.candidates[0]!, number: 10 + index, url: `https://github.com/example/repo/pull/${10 + index}`, state: 'OPEN', headRefName: branch }));
  f.setCandidates(open);
  const proved = spyOn(harness.core.pullRequests, 'proveMerged');
  const now = Date.now.bind(Date);
  let elapsed = 0;
  const clock = spyOn(Date, 'now').mockImplementation(() => now() + elapsed);
  const passes: { proofs: number; spawned: string[] }[] = [];
  const sweep = async (expected = 0) => {
    const proofs = proved.mock.calls.length, spawned = f.spawned().length;
    expect(await service.sweep()).toBe(expected);
    passes.push({ proofs: proved.mock.calls.length - proofs, spawned: f.spawned().slice(spawned) });
    return passes.at(-1)!;
  };
  try {
    // Four open pull requests: one remote read and one list for the repository, no status walk.
    expect(await sweep()).toEqual({ proofs: 4, spawned: ['git remote', 'gh api'] });
    expect(await sweep()).toEqual({ proofs: 0, spawned: [] });
    expect(await sweep()).toEqual({ proofs: 0, spawned: [] });
    // An updated thread is proved again at once, from what the repository reads kept.
    journal.putThread({ ...journal.getThread(ids[1]!)!, updatedAt: original.updatedAt + 1 });
    const updated = await sweep();
    expect(updated.proofs).toBe(1);
    expect(updated.spawned).not.toContain('git status');
    // Each minute asks again, sharing the cached remotes and one fresh repository list.
    elapsed = 60_001;
    expect(await sweep()).toEqual({ proofs: 4, spawned: ['gh api'] });
    elapsed += 30_000;
    expect((await sweep()).proofs).toBe(0);
    elapsed += 30_001;
    expect((await sweep()).proofs).toBe(4);
    // A merge is found once the thread changes, and only that checkout's status is walked.
    f.setCandidates([{ ...open[0]!, state: 'MERGED' }, ...open.slice(1)]);
    journal.putThread({ ...journal.getThread(f.threadId)!, updatedAt: original.updatedAt + 2 });
    elapsed += 15_001;
    const merged = await sweep(1);
    expect(merged.proofs).toBe(1);
    expect(merged.spawned.filter(command => command === 'git status')).toHaveLength(2);
    expect(merged.spawned.filter(command => command === 'gh api')).toHaveLength(1);
    console.log('archive-spawn-measurement', JSON.stringify({ threads: 4, passes }));
  } finally { proved.mockRestore(); clock.mockRestore(); }
  await expectAsked(f.threadId, ['https://github.com/example/repo/pull/10'], '#10 merged');
});

test('sweep rowid cycles revisit old candidates while appends and replacements continue', async () => {
  const f = await fixture();
  const journal = harness.core.journal;
  const original = harness.core.threads.require(f.threadId);
  journal.putThread({ ...original, archived: true });
  const ids = Array.from({ length: 9 }, (_, index) => `cycle-${index}`);
  for (const id of ids) { journal.putThread({ ...original, id, branch: id, cwd: join(f.checkout, id) }); finishedTurn(f.threadId, id); }
  const proved: string[] = [];
  const proof = spyOn(harness.core.pullRequests, 'proveMerged').mockImplementation(async thread => { proved.push(thread.id); return null; });
  const now = Date.now.bind(Date);
  let elapsed = 0;
  const clock = spyOn(Date, 'now').mockImplementation(() => now() + elapsed);
  try {
    expect(await service.sweep()).toBe(0);
    expect(proved).toEqual(ids.slice(0, 8));
    // A replaced row receives a new rowid outside the current cycle boundary.
    journal.putThread({ ...original, id: ids[0]!, branch: ids[0]!, cwd: join(f.checkout, ids[0]!) });
    for (let index = 0; index < 32; index++) journal.putThread({ ...original, id: `append-${index}`, archived: true });
    expect(await service.sweep()).toBe(0);
    expect(proved.slice(8)).toEqual([ids[8]!]);
    for (let index = 32; index < 64; index++) journal.putThread({ ...original, id: `append-${index}`, archived: true });
    // Threads proved unmerged wait five minutes before the next proof.
    elapsed = 5 * 60_000 + 1;
    const secondCycle = proved.length;
    expect(await service.sweep()).toBe(0);
    expect(proved.slice(secondCycle)).toHaveLength(8);
    for (let index = 64; index < 96; index++) journal.putThread({ ...original, id: `append-${index}`, archived: true });
    expect(await service.sweep()).toBe(0);
    expect(proved.slice(secondCycle)).toContain(ids[0]!);
  } finally { proof.mockRestore(); clock.mockRestore(); }
});

test('a PR merging outside Boite is asked about on the next minute without a thread mutation', async () => {
  const f = await fixture();
  f.setCandidates([{ ...f.candidates[0]!, state: 'OPEN' }]);
  expect(await service.sweep()).toBe(0);
  f.setCandidates([{ ...f.candidates[0]!, state: 'MERGED' }]);
  const now = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(now + 61_000);
  try { expect(await service.sweep()).toBe(1); }
  finally { clock.mockRestore(); }
  await expectAsked(f.threadId);
});

test.each(['unread', 'viewed'] as const)('a merged PR asks its %s conversation without manual acknowledgement', async state => {
  const f = await fixture();
  if (state === 'unread') {
    harness.core.journal.putThread({ ...harness.core.threads.require(f.threadId), unread: true });
  } else {
    await f.client.call('threads.focus', { threadId: f.threadId, protectedThreadIds: [] });
  }
  expect(await service.sweep()).toBe(1);
  const saved = await f.client.call('threads.get', { threadId: f.threadId });
  expect(saved.archiveReason ?? null).toBeNull();
  await expectAsked(f.threadId);
  expect(existsSync(join(f.checkout, '.git'))).toBe(true);
});

test('a delivered merged family is asked with unread history and a viewed child, its children and histories untouched', async () => {
  const f = await completedFamily();
  for (const thread of [harness.core.threads.require(f.threadId), ...f.children]) {
    harness.core.journal.putThread({ ...thread, unread: true });
  }
  const children = f.children.map(child => harness.core.threads.require(child.id));
  const histories = children.map(child => harness.core.journal.listTurns(child.id));
  await f.client.call('threads.focus', { threadId: children[0]!.id, protectedThreadIds: [] });
  expect(await service.sweep()).toBe(1);
  await expectAsked(f.threadId);
  expect(children.map(child => harness.core.threads.require(child.id))).toEqual(children);
  expect(children.map(child => harness.core.journal.listTurns(child.id))).toEqual(histories);
  expect(existsSync(join(f.checkout, '.git'))).toBe(true);
});

test('root mutations during archive selection yields are observed before proof admission', async () => {
  const f = await fixture();
  const journal = harness.core.journal;
  const original = harness.core.threads.require(f.threadId);
  const proof = spyOn(harness.core.pullRequests, 'proveMerged').mockResolvedValue(null);
  try {
    for (const mutate of [
      () => journal.putThread({ ...original, status: 'running' }),
      () => journal.stageThreadDeletion(original.id, [original]),
    ]) {
      let mutated = false;
      const mutation = new Promise<void>(resolve => setImmediate(() => { mutate(); mutated = true; resolve(); }));
      const sweeping = service.sweep();
      await mutation;
      expect(await sweeping).toBe(0);
      expect(mutated).toBe(true);
      expect(proof).not.toHaveBeenCalled();
      journal.restoreDeletedThreads(original.id);
      journal.putThread(original);
    }
    expect(await f.client.call('projects.list', {})).toBeInstanceOf(Array);
  } finally { proof.mockRestore(); }
});

test('retained child activity, protected input and undelivered family results keep the question away', async () => {
  const f = await completedFamily();
  const child = harness.core.threads.require(f.children[0]!.id);
  for (const patch of [{ status: 'running' as const }, { pinned: true }, { agentSessionId: 'retained-session' }]) {
    harness.core.journal.putThread({ ...child, ...patch });
    expect(await service.sweep()).toBe(0);
  }
  harness.core.journal.putThread(child);
  const childProcess = harness.core.procs.spawn(child.id, process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: f.checkout });
  try { expect(await service.sweep()).toBe(0); }
  finally { harness.core.procs.killTree(child.id); await childProcess.exited; }
  await f.client.call('threads.focus', { threadId: null, protectedThreadIds: [child.id] });
  expect(await service.sweep()).toBe(0);
  await f.client.call('threads.focus', { threadId: child.id, protectedThreadIds: [child.id] });
  expect(await service.sweep()).toBe(0);
  await f.client.call('threads.focus', { threadId: null, protectedThreadIds: [] });
  harness.core.journal.db.query("UPDATE workflow_runs SET data = json_set(data, '$.delivered', 0) WHERE id = ?").run(f.runId);
  expect(await service.sweep()).toBe(0);
  harness.core.journal.db.query("UPDATE workflow_runs SET data = json_set(data, '$.delivered', 1) WHERE id = ?").run(f.runId);
  const letter = harness.core.delegation.get(f.threadId).messages.find(letter => letter.origin === 'result')!;
  harness.core.journal.db.query("UPDATE delegation_messages SET status = 'uncertain' WHERE id = ?").run(letter.id);
  expect(await service.sweep()).toBe(0);
  harness.core.journal.db.query("UPDATE delegation_messages SET status = 'delivered' WHERE id = ?").run(letter.id);
  // An unread archived child stays as it is while its parent is asked.
  harness.core.journal.putThread({ ...child, archived: true, unread: true });
  expect(await service.sweep()).toBe(1);
  expect(harness.core.threads.require(child.id).unread).toBe(true);
  await expectAsked(f.threadId);
});

test('pending and retained side answers on a root or retained descendant keep the question away', async () => {
  const f = await completedFamily();
  const child = f.children[0]!;
  // Its finished step was put away as done; the user reopened it.
  await f.client.call('threads.archive', { threadId: child.id, archived: false });
  const descendant = { ...harness.core.threads.require(child.id), id: 'thr_archive_descendant', parentThreadId: child.id };
  harness.core.journal.putThread(descendant);
  harness.core.journal.putTurn({ ...harness.core.journal.listTurns(child.id).at(-1)!, id: 'trn_archive_descendant', threadId: descendant.id });
  restoreDriver?.();
  let finish!: (answer: string) => void;
  restoreDriver = setDriver('echo', { ...quietEcho, sideQuestion: () => new Promise(resolve => { finish = resolve; }) });
  const root = harness.core.threads.require(f.threadId);
  for (const threadId of [f.threadId, child.id, descendant.id]) {
    const answered = f.client.next('thread.btw', event => event.requestId === 'side_archive');
    await f.client.call('threads.subscribe', { threadId });
    await f.client.call('threads.btw', { threadId, question: 'Keep this answer available', requestId: 'side_archive' });
    expect(harness.core.threads.require(threadId).status).toBe('idle');
    expect(harness.core.procs.liveCount(threadId)).toBe(0);
    expect(await service.sweep()).toBe(0);
    finish('A retained answer');
    expect((await answered).answer).toBe('A retained answer');
    expect(await service.sweep()).toBe(0);
    await f.client.call('threads.btw.cancel', { threadId, requestId: 'side_archive' });
    expect(service.eligible(root)).toBe(true);
  }
  expect(await service.sweep()).toBe(1);
  await expectAsked(f.threadId);
});

test('a child turn admitted during final Git validation keeps its merged parent from being asked', async () => {
  const f = await completedFamily();
  const childId = f.children[0]!.id;
  // Its finished step was put away as done; the user reopened it.
  await f.client.call('threads.archive', { threadId: childId, archived: false });
  restoreDriver?.();
  restoreDriver = setDriver('echo', { protocol: 'echo', startTurn() {
    let finish!: () => void;
    const done = new Promise<import('../src/drivers/types.ts').TurnResult>(resolve => { finish = () => resolve({ status: 'stopped', sessionId: null, usage: null }); });
    return { done, stop: finish };
  } });
  const validate = harness.core.pullRequests.validateMergedCheckout.bind(harness.core.pullRequests);
  const held = spyOn(harness.core.pullRequests, 'validateMergedCheckout').mockImplementation(async (thread, proof, signal) => {
    const valid = await validate(thread, proof, signal);
    harness.core.threads.startTurn(childId, 'Work admitted while Git was validating');
    return valid;
  });
  try {
    expect(await service.sweep()).toBe(0);
    expect(harness.core.threads.require(childId).status).toBe('running');
    expectNotAsked(f.threadId);
  } finally { held.mockRestore(); harness.core.threads.stopTurn(childId); }
});

test('repository identities normalize slashes around the git suffix', () => {
  for (const remote of ['https://github.com/example/repo.git/', 'git@github.com:example/repo.git//', 'https://github.com/example/repo/.git', 'https://github.com/example/repo/.git/', 'https://github.com/example/repo']) {
    const remotes = `origin ${remote} (fetch)`;
    expect(githubRepository(remotes)).toBe('github.com/example/repo');
    expect([...fetchedRepositories(remotes)]).toEqual(['github.com/example/repo']);
  }
});

test('strict action proof rejects forks, reused branch, wrong tip and repository ambiguity', () => {
  const expected = { repository: 'github.com/example/repo', checkoutRepository: '/repo/.git', branch: 'topic', sha: 'a'.repeat(40) };
  const pr = { number: 7, url: 'https://github.com/example/repo/pull/7', state: 'MERGED', headRefName: 'topic', headRefOid: expected.sha, headRepository: { name: 'repo' }, headRepositoryOwner: { login: 'example' }, isCrossRepository: false, mergedAt: '2026-10-01T12:00:00Z' };
  expect(parseMergedPrProof(JSON.stringify([pr]), expected)?.number).toBe(7);
  for (const candidate of [[pr, pr], [{ ...pr, isCrossRepository: true }], [{ ...pr, headRefOid: 'b'.repeat(40) }], [{ ...pr, headRefName: 'other' }], [{ ...pr, headRepositoryOwner: { login: 'fork' } }], [{ ...pr, mergedAt: null }], [{ ...pr, url: `${pr.url}?token=unsafe` }]]) expect(parseMergedPrProof(JSON.stringify(candidate), expected)).toBeNull();
  // A linked PR names itself; its head may differ from the checkout's branch, but never its tip or repository.
  expect(parseMergedPrProof(JSON.stringify([{ ...pr, headRefName: 'other' }]), expected, true)?.number).toBe(7);
  for (const candidate of [{ ...pr, headRefOid: 'b'.repeat(40) }, { ...pr, isCrossRepository: true }, { ...pr, headRepositoryOwner: { login: 'fork' } }, { ...pr, state: 'OPEN' }]) expect(parseMergedPrProof(JSON.stringify([candidate]), expected, true)).toBeNull();
  expect(githubRepository('origin https://github.com/example/repo.git (fetch)\norigin git@github.com:example/repo.git (push)')).toBe(expected.repository);
  expect(githubRepository('origin https://github.com/fork/repo.git (fetch)\nupstream https://github.com/example/repo.git (fetch)')).toBeNull();
});

test('closing the question loop aborts its current proof and fences a late completion', async () => {
  const f = await fixture();
  let signal: AbortSignal | undefined;
  let release!: (value: null) => void;
  const proof = new Promise<null>(resolve => { release = resolve; });
  const held = spyOn(harness.core.pullRequests, 'proveMerged').mockImplementation((_thread, ownerSignal) => { signal = ownerSignal; return proof; });
  const pass = service.sweep();
  let closed = false;
  try {
    await waitFor(() => signal !== undefined, 500);
    const closing = service.close().then(() => { closed = true; });
    await waitFor(() => closed, 500);
    expect(signal!.aborted).toBe(true);
    release(null);
    await Promise.all([pass, closing]);
    expectNotAsked(f.threadId);
    expect(archiveState(harness.core.journal, f.threadId).binding).toBeUndefined();
  } finally { release(null); held.mockRestore(); await pass; }
});

test('canceling one proof consumer preserves the coalesced consumer and its owning process', async () => {
  const f = await fixture();
  f.holdGh();
  const thread = harness.core.threads.require(f.threadId);
  const first = new AbortController(), second = new AbortController();
  const a = harness.core.pullRequests.proveMerged(thread, first.signal).catch(() => null);
  const subscriptions = spyOn(second.signal, 'addEventListener');
  let b: ReturnType<typeof harness.core.pullRequests.proveMerged> | undefined;
  try {
    await waitFor(() => f.ghCalls() === 1);
    b = harness.core.pullRequests.proveMerged(thread, second.signal);
    // The shared remote read, then the shared pull request list have each registered cancellation.
    await waitFor(() => subscriptions.mock.calls.length >= 2);
    first.abort();
    expect(await a).toBeNull();
    f.releaseGh();
    expect((await b)?.number).toBe(7);
    expect(f.ghCalls()).toBe(1);
  } finally { f.releaseGh(); first.abort(); second.abort(); subscriptions.mockRestore(); await a; await b?.catch(() => null); }
});

test('closing the question loop cancels its last proof consumer and captured GitHub process', async () => {
  const f = await fixture();
  f.holdGh();
  const pass = service.sweep();
  let closed = false;
  try {
    await waitFor(() => f.ghCalls() === 1);
    const scopes = harness.core.procs.liveThreads().filter(scope => scope.startsWith(`pull-request:${f.threadId}:`));
    expect(scopes).toHaveLength(1);
    const closing = service.close().then(() => { closed = true; });
    await waitFor(() => closed, 500);
    // Windows exit tracing can settle after the archive loop closes.
    await waitFor(() => harness.core.procs.liveCount(scopes[0]!) === 0);
    expect(harness.core.procs.liveCount(scopes[0]!)).toBe(0);
    expect(await pass).toBe(0);
    expectNotAsked(f.threadId);
    expect(archiveState(harness.core.journal, f.threadId).binding).toBeUndefined();
    await closing;
  } finally { f.releaseGh(); await service.close(); await pass; }
});

test('closing during validation cannot ask or write after the Journal closes', async () => {
  const f = await fixture();
  let signal: AbortSignal | undefined;
  let release!: (value: boolean) => void;
  const validation = new Promise<boolean>(resolve => { release = resolve; });
  const held = spyOn(harness.core.pullRequests, 'validateMergedCheckout').mockImplementation((_thread, _proof, ownerSignal) => { signal = ownerSignal; return validation; });
  const pass = service.sweep();
  let closed = false;
  try {
    await waitFor(() => signal !== undefined);
    const closing = service.close().then(() => { closed = true; });
    await waitFor(() => closed, 500);
    expect(signal!.aborted).toBe(true);
    expectNotAsked(f.threadId);
    await harness.stop();
    expect(harness.core.journal.isClosed()).toBe(true);
    release(true);
    expect(await pass).toBe(0);
    await closing;
    expect(await service.sweep()).toBe(0);
  } finally { release(true); held.mockRestore(); await pass; }
});

test('protected input holds the question, which is asked once, keeps the checkout and is not asked again after a restart', async () => {
  const f = await fixture();
  const secondOwner = await harness.connect();
  // Older clients omit input leases and clear parked drafts on archive events.
  await f.client.call('threads.focus', { threadId: null });
  expect(await service.sweep()).toBe(0);
  expect(harness.core.threads.require(f.threadId).archived).toBe(false);
  await f.client.call('threads.focus', { threadId: null, protectedThreadIds: [f.threadId] });
  await secondOwner.call('threads.focus', { threadId: null, protectedThreadIds: [f.threadId] });
  expect(await service.sweep()).toBe(0);
  await f.client.call('threads.focus', { threadId: null, protectedThreadIds: [] });
  await f.client.call('threads.focus', { threadId: null });
  expect(await service.sweep()).toBe(0);
  expect((await rejection(secondOwner.call('threads.focus', { threadId: null, protectedThreadIds: Array.from({ length: 257 }, (_, index) => `id-${index}`) }))).reason).toMatchObject({ rpc: { code: RpcErrorCode.InvalidParams, data: { field: 'protectedThreadIds' } } });
  expect(await service.sweep()).toBe(0);
  await f.client.call('threads.focus', { threadId: null, protectAllThreads: true });
  secondOwner.close();
  expect(await service.sweep()).toBe(0);
  await f.client.call('threads.focus', { threadId: null, protectedThreadIds: [] });
  expect(await service.sweep()).toBe(0);
  const legacyOwner = await harness.connect();
  await legacyOwner.call('threads.focus', { threadId: null });
  await f.client.call('threads.focus', { threadId: null, protectAllThreads: false });
  expect(await service.sweep()).toBe(0);
  legacyOwner.close();
  let askCount = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    askCount += await service.sweep();
    if (askCount) break;
    await Bun.sleep(5);
  }
  expect(askCount).toBe(1);
  await expectAsked(f.threadId);
  expect(existsSync(join(f.checkout, '.git'))).toBe(true);
  expect(git(f.repo, 'show-ref', '--verify', 'refs/heads/topic')).toContain(f.sha);
  const restartDir = join(harness.dataDir, 'restart');
  mkdirSync(restartDir);
  harness.core.journal.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  copyFileSync(join(harness.dataDir, 'journal.db'), join(restartDir, 'journal.db'));
  const restarted = new Core({ dataDir: restartDir, token: harness.token });
  try {
    expect(restarted.threads.require(f.threadId).archived).toBe(false);
    expect(archiveState(restarted.journal, f.threadId).asked).toEqual([PR7]);
    await restarted.mergedPrAsk.close();
    const resumed = new MergedPrAsk(restarted, restarted.pullRequests, 0, 0);
    Object.defineProperty(restarted, 'mergedPrAsk', { value: resumed });
    const proof = archiveState(restarted.journal, f.threadId).binding!;
    expect(proof).toMatchObject({ url: PR7, number: 7 });
    const held = spyOn(restarted.pullRequests, 'proveMerged').mockResolvedValue(proof);
    try { expect(await resumed.sweep()).toBe(0); }
    finally { held.mockRestore(); }
    expect(restarted.journal.listTurns(f.threadId).filter(turn => turn.execution?.operation === 'pull-request')).toHaveLength(1);
  }
  finally { await restarted.close(); }
});

test('dirty, advanced or wrong checkout and duplicate root holders are never asked', async () => {
  const f = await fixture();
  writeFileSync(join(f.checkout, 'dirty'), 'changes');
  expect(await service.sweep()).toBe(0);
  git(f.checkout, 'add', 'dirty'); git(f.checkout, 'commit', '-q', '-m', 'advanced');
  expect(await service.sweep()).toBe(0);
  git(f.checkout, 'reset', '--hard', f.sha);
  git(f.checkout, 'checkout', '-q', '-b', 'wrong');
  expect(await service.sweep()).toBe(0);
  git(f.checkout, 'checkout', '-q', 'topic');
  const thread = harness.core.threads.require(f.threadId);
  harness.core.journal.putThread({ ...thread, id: 'other-holder', archived: true });
  expect(await service.sweep()).toBe(0);
  expectNotAsked(f.threadId);
});

test('a worktree branch renamed by its agent is asked about through its own merged PR', async () => {
  const f = await fixture();
  // The agent left the starting branch for one named after its fix, then opened the PR from it.
  git(f.checkout, 'checkout', '-q', '-b', 'fix/topic');
  f.setCandidates([{ ...f.candidates[0]!, headRefName: 'fix/topic' }]);
  expect(await service.sweep()).toBe(1);
  expect(archiveState(harness.core.journal, f.threadId).binding).toMatchObject({ branch: 'fix/topic', sha: f.sha, number: 7 });
  await expectAsked(f.threadId);
});

test('a linked PR pushed under another branch name asks the conversation', async () => {
  const f = await fixture();
  // A repository discovery page cannot disprove an explicit URL, even when it is not full.
  f.hideList();
  const pushed = { ...f.candidates[0]!, headRefName: 'fix/elsewhere' };
  f.setCandidates([pushed]);
  // `git push origin HEAD:fix/elsewhere` leaves no local branch of that name to look up.
  expect(await service.sweep()).toBe(0);
  const link = { url: pushed.url, repository: 'example/repo', number: 7, title: 'Fix', state: 'OPEN', draft: false, head: 'fix/elsewhere', base: 'main', headRepository: 'example/repo', checkedAt: 1 };
  // The newest link no longer resolves; the older one still proves the merge.
  harness.core.journal.setSetting(`linked-pull-requests:${f.threadId}`, [link, { ...link, url: 'https://github.com/example/repo/pull/6', number: 6 }]);
  expect(await service.sweep()).toBe(1);
  expect(archiveState(harness.core.journal, f.threadId).reason).toBeUndefined();
  await expectAsked(f.threadId, [pushed.url]);
});

test('busy, protected input, paused workflow, child and stale opt-out or restore keep the question away', async () => {
  const f = await fixture();
  const original = harness.core.threads.require(f.threadId);
  for (const patch of [{ status: 'waiting' as const }, { pinned: true }]) {
    harness.core.journal.putThread({ ...original, ...patch }); expect(await service.sweep()).toBe(0);
  }
  harness.core.journal.putThread(original);
  harness.core.threads.focus.set('fixture-viewer', f.threadId, [f.threadId], false);
  expect(await service.sweep()).toBe(0);
  harness.core.threads.focus.set('fixture-viewer', null, []);
  harness.core.journal.db.query("INSERT INTO workflow_runs (id,root_id,status,created_at,updated_at,data) VALUES ('paused',?,'paused',0,0,'{}')").run(f.threadId);
  expect(await service.sweep()).toBe(0);
  harness.core.journal.db.query("DELETE FROM workflow_runs WHERE id='paused'").run();
  harness.core.journal.db.query("INSERT INTO workflow_runs (id,root_id,status,created_at,updated_at,data) VALUES ('undelivered',?,'done',0,0,'{\"delivered\":false}')").run(f.threadId);
  expect(await service.sweep()).toBe(0);
  harness.core.journal.db.query("DELETE FROM workflow_runs WHERE id='undelivered'").run();
  harness.core.journal.putThread({ ...original, id: 'child', parentThreadId: original.id });
  expect(await service.sweep()).toBe(0);
  harness.core.journal.deleteThreads(['child']);
  const prove = harness.core.pullRequests.proveMerged.bind(harness.core.pullRequests);
  let duringProof = () => { harness.core.projects.setAutoArchiveMergedPr(f.project.id, false); };
  const replacement = spyOn(harness.core.pullRequests, 'proveMerged').mockImplementation(async thread => { const proof = await prove(thread); duringProof(); return proof; });
  try {
    expect(await service.sweep()).toBe(0);
    harness.core.projects.setAutoArchiveMergedPr(f.project.id, true);
    duringProof = () => { harness.core.threads.archive(f.threadId, false); };
    expect(await service.sweep()).toBe(0);
    expect(await service.sweep()).toBe(0);
  } finally { replacement.mockRestore(); }
  expectNotAsked(f.threadId);
});

test('a stale proof cannot ask a moved or deleted root', async () => {
  const f = await fixture();
  const original = harness.core.threads.require(f.threadId);
  const prove = harness.core.pullRequests.proveMerged.bind(harness.core.pullRequests);
  let action = () => { harness.core.journal.putThread({ ...original, cwd: f.repo, branch: null }); };
  const replacement = spyOn(harness.core.pullRequests, 'proveMerged').mockImplementation(async thread => { const proof = await prove(thread); action(); return proof; });
  try {
    expect(await service.sweep()).toBe(0);
    expect(harness.core.threads.require(f.threadId).cwd).toBe(f.repo);
    expectNotAsked(f.threadId);
    harness.core.journal.putThread(original);
    action = () => { harness.core.journal.deleteThreads([f.threadId]); };
    expect(await service.sweep()).toBe(0);
    expect(harness.core.journal.getThread(f.threadId)).toBeNull();
  } finally { replacement.mockRestore(); }
});


test('turning the setting off reveals a thread an older core hid after its merge, preserves manual archives, and asks nothing while off', async () => {
  const f = await fixture();
  const original = harness.core.threads.require(f.threadId);
  /** What an older core left: the thread in Done, with the merge as its reason. */
  const legacyHide = () => {
    const now = Date.now();
    harness.core.journal.putThread({ ...harness.core.threads.require(f.threadId), archived: true, doneAt: now, archivedAt: now });
    harness.core.journal.setSetting(archiveStateKey(f.threadId), { ...archiveState(harness.core.journal, f.threadId), reason: { type: 'pr-merged', number: 7, url: PR7, archivedAt: now } });
  };
  harness.core.journal.putThread({ ...original, id: 'manually-archived', branch: 'manual', archived: true });
  legacyHide();
  const project = await f.client.call('projects.setAutoArchiveMergedPr', { projectId: f.project.id, enabled: false });
  expect(project.autoArchiveMergedPr).toBe(false);
  expect(harness.core.threads.require(f.threadId).archived).toBe(false);
  expect(harness.core.threads.require(f.threadId).doneAt).toBeUndefined();
  expect(archiveState(harness.core.journal, f.threadId).reason).toBeUndefined();
  expect(harness.core.threads.require('manually-archived').archived).toBe(true);
  expect(archiveState(harness.core.journal, f.threadId).dismissed ?? []).toEqual([]);
  expect(await service.sweep()).toBe(0);
  expectNotAsked(f.threadId);
  await f.client.call('projects.setAutoArchiveMergedPr', { projectId: f.project.id, enabled: true });
  // On again: the merged thread is asked, never hidden.
  expect(await service.sweep()).toBe(1);
  await expectAsked(f.threadId);
  // An explicit archive of a thread an older core hid becomes a manual archive.
  legacyHide();
  await f.client.call('threads.archive', { threadId: f.threadId, archived: true });
  await f.client.call('projects.setAutoArchiveMergedPr', { projectId: f.project.id, enabled: false });
  expect(harness.core.threads.require(f.threadId).archived).toBe(true);
  f.client.close();
});

test('project opt-out survives other policy writers and default access denies devices and agents', async () => {
  const f = await fixture();
  expect((await f.client.call('projects.list', {})).find(project => project.id === f.project.id)?.autoArchiveMergedPr).toBe(true);
  await f.client.call('projects.setAutoArchiveMergedPr', { projectId: f.project.id, enabled: false });
  await f.client.call('projects.setWorktreeDefault', { projectId: f.project.id, enabled: false });
  await f.client.call('projects.archive', { projectId: f.project.id, archived: true });
  await f.client.call('projects.archive', { projectId: f.project.id, archived: false });
  expect(harness.core.projects.require(f.project.id).autoArchiveMergedPr).toBe(false);
  for (const principal of ['session', 'agent'] as const) expect(() => assertAllowed('projects.setAutoArchiveMergedPr', { identity: { principal, threadId: f.threadId, sessionId: 'fixture' } } as never, { projectId: f.project.id, enabled: true })).toThrow();
  expect(await thrown(f.client.call('projects.setAutoArchiveMergedPr', { projectId: f.project.id, enabled: 'yes' as never }))).toThrow('boolean');
  expect(await service.sweep()).toBe(0);
});

test('foreign fork must not block the local merged PR', async () => {
  const f = await fixture();
  f.setCandidates([f.candidates[0]!, {...f.candidates[0]!, number: 8, url: 'https://github.com/example/repo/pull/8', state: 'OPEN', isCrossRepository: true, headRepositoryOwner: {login: 'foreigner'}}]);
  expect(await service.sweep()).toBe(1);
});

test('an old linked merge must not archive a newer open PR', async () => {
  const f = await fixture();
  const opened = {...f.candidates[0]!, number: 8, url: 'https://github.com/example/repo/pull/8', state: 'OPEN'};
  f.setCandidates([opened, f.candidates[0]!]);
  const link = {url: f.candidates[0]!.url, repository: 'example/repo', number: 7, title: 'Old', state: 'MERGED', draft: false, head: 'topic', base: 'main', headRepository: 'example/repo', checkedAt: 1};
  harness.core.journal.setSetting(`linked-pull-requests:${f.threadId}`, [link, {...link, number: 8, url: opened.url, state: 'OPEN'}]);
  expect(await service.sweep()).toBe(0);
});


test('a new automatic open PR blocks an older linked merge on the same checkout', async () => {
  const f = await fixture();
  const merged = f.candidates[0]!;
  f.setCandidates([{ ...merged, number: 8, url: 'https://github.com/example/repo/pull/8', state: 'OPEN' }, merged]);
  harness.core.journal.setSetting(`linked-pull-requests:${f.threadId}`, [{ url: merged.url }]);
  expect(await service.sweep()).toBe(0);
});


test('an unreadable linked PR keeps the conversation visible despite another merged link', async () => {
  const f = await fixture();
  const unknown = 'https://github.com/example/repo/pull/8';
  f.failView(unknown);
  harness.core.journal.setSetting(`linked-pull-requests:${f.threadId}`, [{ url: f.candidates[0]!.url }, { url: unknown }]);
  expect(await service.sweep()).toBe(0);
});

/** A link as `threads.linkPullRequest` stores it. */
const linkOf = (number: number, state: 'OPEN' | 'MERGED' | 'CLOSED') => ({ url: `https://github.com/example/repo/pull/${number}`, repository: 'example/repo', number, title: `Change ${number}`, state, draft: false, head: 'topic', base: 'main', headRepository: 'example/repo', checkedAt: Date.now() });

test('linked pull requests all closed without a merge are asked about once, with no merge to prove', async () => {
  const f = await fixture();
  const closed = { ...f.candidates[0]!, state: 'CLOSED', mergedAt: null as unknown as string };
  f.setCandidates([closed, { ...closed, number: 8, url: 'https://github.com/example/repo/pull/8' }]);
  harness.core.journal.setSetting(`linked-pull-requests:${f.threadId}`, [linkOf(8, 'CLOSED'), linkOf(7, 'CLOSED')]);
  expect(await service.sweep()).toBe(1);
  const urls = harness.core.linkedPullRequests.saved(f.threadId).map(pr => pr.url);
  await expectAsked(f.threadId, urls, urls.map(url => `#${url.split('/').at(-1)} closed`).join(', '));
  expect(archiveState(harness.core.journal, f.threadId).binding).toBeUndefined();
});

test('a second sweep does not ask again about the same pull request', async () => {
  const f = await fixture();
  expect(await service.sweep()).toBe(1);
  await expectAsked(f.threadId);
  // The agent answered and left the thread open: the thread changed, the pull request did not.
  const now = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(now + 61_000);
  try { expect(await service.sweep()).toBe(0); }
  finally { clock.mockRestore(); }
  service.observe(f.threadId);
  await Bun.sleep(100);
  expect(questions(f.threadId)).toHaveLength(1);
});

test('a thread the user restored from Done is not asked about its merged pull request', async () => {
  const f = await fixture();
  await f.client.call('threads.archive', { threadId: f.threadId, archived: true, onlyIfIdle: true });
  expect(harness.core.threads.require(f.threadId).archived).toBe(true);
  await f.client.call('threads.archive', { threadId: f.threadId, archived: false });
  expect(archiveState(harness.core.journal, f.threadId).restoredCheckout).toMatchObject({ cwd: f.checkout, branch: 'topic' });
  expect(await service.sweep()).toBe(0);
  service.observe(f.threadId);
  await Bun.sleep(100);
  expectNotAsked(f.threadId);
});

test('a thread whose prompt cache expired, or whose last turn is over an hour old with no cache, is not asked', async () => {
  const f = await fixture();
  const original = harness.core.threads.require(f.threadId);
  const cache = (at: number): PromptCache => ({ at, ttlSeconds: 300, source: 'reported', readTokens: 1000, model: original.model, accountId: original.accountId });
  harness.core.journal.putThread({ ...original, promptCache: cache(Date.now() - 301_000) });
  expect(await service.sweep()).toBe(0);
  // A live cache of the model the thread left is cold for the next turn.
  harness.core.journal.putThread({ ...original, promptCache: { ...cache(Date.now() - 10_000), model: 'another-model' } });
  expect(await service.sweep()).toBe(0);
  const lastTurn = harness.core.journal.lastTurn(f.threadId)!.finishedAt!;
  const clock = spyOn(Date, 'now').mockReturnValue(lastTurn + 60 * 60_000 + 1);
  try {
    harness.core.journal.putThread({ ...original, promptCache: null });
    expect(await service.sweep()).toBe(0);
    expectNotAsked(f.threadId);
    // The same old turn behind a cache the provider still holds: that is asked.
    harness.core.journal.putThread({ ...original, promptCache: cache(Date.now() - 10_000) });
    expect(await service.sweep()).toBe(1);
  } finally { clock.mockRestore(); }
  await expectAsked(f.threadId);
});


test('a merge proof waits while a linked pull request in another repository is still open', async () => {
  const f = await fixture();
  harness.core.journal.setSetting(`linked-pull-requests:${f.threadId}`, [linkOf(7, 'MERGED'), { ...linkOf(9, 'OPEN'), url: 'https://github.com/example/other/pull/9', repository: 'example/other', headRepository: 'example/other' }]);
  expect(await service.sweep()).toBe(0);
  service.observe(f.threadId);
  await Bun.sleep(100);
  expectNotAsked(f.threadId);
});

test('a close a pull request watch has yet to tell is left to its wake, which asks in that turn', async () => {
  const f = await fixture();
  const holds = spyOn(harness.core.pullRequestWatches, 'holdsClose').mockReturnValue(true);
  try {
    expect(await service.sweep()).toBe(0);
    service.observe(f.threadId);
    await Bun.sleep(100);
    expectNotAsked(f.threadId);
  } finally { holds.mockRestore(); }
  // Told, or ended without telling: the sweep asks.
  expect(await service.sweep()).toBe(1);
  await expectAsked(f.threadId);
});
