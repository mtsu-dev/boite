import { afterEach, expect, spyOn, test } from 'bun:test';
import type { HarnessUpdate, ProviderSummary, PullRequestWatch, StateReading, ThreadSummary } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { QuotaStore } from '../src/quotas.ts';
import { readState } from '../src/state.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let harness: TestCore | undefined;
afterEach(async () => { await harness?.stop(); harness = undefined; });

function reading<D extends StateReading['domain']>(value: StateReading, domain: D): Extract<StateReading, { domain: D }> {
  expect(value.domain).toBe(domain);
  return value as Extract<StateReading, { domain: D }>;
}

test('S1: limits read the cached rows only, never a provider, even on a cold cache', async () => {
  harness = await startTestCore();
  const account = harness.core.accounts.add({ providerId: 'codex', label: 'Fixture' });
  let calls = 0;
  const store = new QuotaStore(harness.core, async () => { calls++; return [{ id: 'session', label: 'Session', usedPercent: 20, resetsAt: null }]; });
  (harness.core as { quotas: QuotaStore }).quotas = store;
  const cold = reading(await readState(harness.core, 'limits'), 'limits').limits;
  expect(calls).toBe(0);
  expect(cold.find(limit => limit.account === 'Fixture')?.windows).toEqual([]);
  await reading(await readState(harness.core, 'summary'), 'summary');
  expect(calls).toBe(0);
  // The Limits page's own read fills the cache; state shows it without reading again.
  await store.list();
  const read = calls;
  expect(read).toBeGreaterThan(0);
  const warm = reading(await readState(harness.core, 'limits'), 'limits').limits;
  expect(warm.find(limit => limit.account === 'Fixture')?.windows.map(window => window.usedPercent)).toEqual([20]);
  expect(calls).toBe(read);
  expect(account.id).toBeTruthy();
});

function thread(id: string, fields: Partial<ThreadSummary>): ThreadSummary {
  return { id, title: id, projectId: null, status: 'idle', unread: false, archived: false, updatedAt: 1, backgroundWork: { kinds: [] }, ...fields } as ThreadSummary;
}

test('S2: the inbox lists what Activity lists: no read failure, no mochi conversation, no thread still watching a pull request', async () => {
  harness = await startTestCore();
  const watching: PullRequestWatch = { url: 'https://example.com/pr/1', repository: 'o/r', number: 1, since: 1, seen: null, paused: null };
  const threads = [
    thread('thr_failed_unread', { status: 'error', unread: true, updatedAt: 5 }),
    thread('thr_failed_read', { status: 'error', unread: false }),
    thread('thr_stopped_read', { backgroundWait: { state: 'interrupted', for: 'a shell', reason: 'core-restarted', at: 1 } }),
    thread('thr_mochi', { status: 'waiting', agentSessionId: 'ses_1' } as Partial<ThreadSummary>),
    thread('thr_watching', { unread: true, pullRequestWatches: [watching] }),
    thread('thr_done', { unread: true, updatedAt: 4 }),
    // Passed unfiltered: activityEvents itself keeps only what feedThread keeps.
    thread('thr_team', { status: 'waiting', teamId: 'team_1' } as Partial<ThreadSummary>),
    thread('thr_archived', { unread: true, archived: true }),
    thread('thr_waiting', { status: 'waiting', updatedAt: 3 }),
    thread('thr_parent', { status: 'running' }),
    thread('thr_child_failed', { status: 'error', unread: true, parentThreadId: 'thr_parent' } as Partial<ThreadSummary>),
  ];
  spyOn(harness.core.threads, 'list').mockReturnValue(threads);
  const inbox = reading(await readState(harness.core, 'inbox'), 'inbox').inbox;
  expect(inbox.map(row => [row.threadId, row.kind, row.section])).toEqual([
    ['thr_waiting', 'question', 'needs'],
    ['thr_failed_unread', 'failed', 'needs'],
    ['thr_done', 'done', 'updates'],
  ]);
  const summary = reading(await readState(harness.core, 'summary'), 'summary').summary;
  expect(summary.inbox).toEqual({ needs: 2, updates: 1 });
});

test('S3: Muse goes through Douane when the gateway verified its native pool, and only then', async () => {
  harness = await startTestCore();
  const settings = harness.core.settings.get();
  spyOn(harness.core.settings, 'get').mockReturnValue({ ...settings, subscriptionProxy: { enabled: true, kind: 'douane', baseUrl: 'http://127.0.0.1:9/v1', dashboardUrl: 'http://127.0.0.1:9/' } });
  spyOn(harness.core.providers, 'list').mockReturnValue({ loaded: [{ id: 'muse', protocol: 'muse', name: 'Muse' } as ProviderSummary], rejected: [] });
  const pool = { status: 'ready' as const, providers: [{ providerId: 'meta', name: 'Meta', entries: [{ id: 'm', label: 'Meta', status: 'ready' }] }] as never, updatedAt: null, checkedAt: null, error: null };
  const state = spyOn(harness.core.quotas.gateway, 'state').mockReturnValue({ ...pool, nativeMuse: true });
  expect(reading(await readState(harness.core, 'route'), 'route').route.providers).toEqual([{ id: 'muse', name: 'Muse', viaGateway: true }]);
  state.mockReturnValue({ ...pool, nativeMuse: false });
  expect(reading(await readState(harness.core, 'route'), 'route').route.providers).toEqual([{ id: 'muse', name: 'Muse', viaGateway: false }]);
});

test('Activity shows a new interruption in a read conversation until that interruption is acknowledged', async () => {
  harness = await startTestCore();
  const { core } = harness;
  const owner = await harness.connect();
  const parent = await echoThread(harness, owner, 'Parent');
  const child = await echoThread(harness, owner, 'Child');
  const thread = core.journal.getThread(child.threadId)!;
  core.journal.putThread({ ...thread, parentThreadId: parent.threadId });
  const stopped = async (request: string) => {
    const done = owner.next('turn.finished', turn => turn.threadId === thread.id);
    await owner.call('turns.start', { threadId: thread.id, prompt: 'Track a build', clientRequestId: request });
    const turn = await done;
    expect(turn.status).toBe('done');
    await owner.call('threads.markRead', { threadId: thread.id });
    const history = core.threads.agentState.backgroundHistory;
    const origin = { providerId: thread.providerId, sessionGeneration: thread.sessionGeneration ?? 0, parentTurnId: turn.id };
    history.observe(thread.id, [{ id: request, kind: 'shell', description: 'Build', toolId: null, startedAt: turn.finishedAt! - 1 }], origin, turn.finishedAt!);
    history.checkpoint(thread.id, turn.id);
    history.cancelSession(thread.id, origin, Date.now() + 1);
    const snapshot = await owner.call('threads.get', { threadId: thread.id });
    expect(snapshot).toMatchObject({ unread: false, backgroundWait: { state: 'interrupted' } });
    return snapshot.backgroundWait?.state === 'interrupted' ? snapshot.backgroundWait.at : NaN;
  };
  const listed = async () => reading(await readState(core, 'inbox'), 'inbox').inbox.some(row => row.threadId === thread.id && row.kind === 'stopped');
  const first = await stopped('activity-build-1');
  expect(await listed()).toBe(true);
  await owner.call('threads.markRead', { threadId: thread.id });
  expect(await listed()).toBe(true);
  core.journal.putThread({ ...core.journal.getThread(thread.id)!, unread: true });
  await owner.call('threads.markRead', { threadId: thread.id, interruptionAt: first });
  expect(await listed()).toBe(false);
  expect(await owner.call('threads.get', { threadId: thread.id })).toMatchObject({ unread: true, interruptionReadAt: first });
  await stopped('activity-build-2');
  await owner.call('threads.markRead', { threadId: thread.id, interruptionAt: first });
  expect(await listed()).toBe(true);
  await owner.call('threads.get', { threadId: thread.id, open: { markRead: true } });
  expect(await listed()).toBe(false);
});

test('S4: a paired device reads as connected while one of its sockets is open, and not once it closes', async () => {
  harness = await startTestCore();
  const owner = await harness.connect();
  const { grant } = await owner.call('pairing.grant', {});
  const phone = await connect(harness.url, '', { grant, client: { name: 'pwa', version: '2.0.0-beta.1' } });
  const device = async () => reading(await readState(harness!.core, 'machines'), 'machines').machines.find(machine => machine.kind === 'device' && machine.name === 'pwa');
  expect((await device())?.current).toBe(true);
  phone.close();
  let current: boolean | null | undefined = true;
  await waitFor(() => { void device().then(found => { current = found?.current; }); return current === false; });
  expect(current).toBe(false);
  owner.close();
});

test('S5: a skipped release is neither offered nor counted as available; a pending one is', async () => {
  harness = await startTestCore();
  const update = (providerId: string, fields: Partial<HarnessUpdate>): HarnessUpdate => ({ providerId, name: providerId, route: 'self', current: '1.0.0', latest: '1.1.0', pending: false, skipped: null, state: 'idle', message: null, checkedAt: 1, ...fields } as HarnessUpdate);
  spyOn(harness.core.updates, 'list').mockResolvedValue([
    update('claude', { skipped: '1.1.0' }),
    update('codex', { pending: true }),
    update('grok', { skipped: '1.1.0', pending: false, state: 'failed', message: 'offline' }),
  ]);
  const agents = reading(await readState(harness.core, 'updates'), 'updates').updates.agents;
  expect(agents.map(agent => [agent.provider, agent.offered])).toEqual([['claude', false], ['codex', true], ['grok', false]]);
  const summary = reading(await readState(harness.core, 'summary'), 'summary').summary;
  expect(summary.updates.available).toBe(1);
});
