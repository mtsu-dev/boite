import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USAGE_THREAD_TURNS_MAX, type ThreadSummary, type Turn, type Usage } from '@boite/contracts';
import { echoThread, startTestCore } from './harness.ts';
import type { TestCore } from './harness.ts';
import { Journal } from '../src/journal.ts';
import { SLOT_MS, usageBySlots, usageByTurns, type UsageSlotRow } from '../src/journal/usage-slots.ts';
import { thrown } from './settle.ts';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 8, 1);
const EDGES = [D0, D0 + DAY, D0 + 2 * DAY, D0 + 3 * DAY];
/** Edges that cut slots: 7 minutes and 1 ms past a boundary. */
const CUT = [D0 + 7 * 60_000, D0 + DAY + 1, D0 + 2 * DAY + SLOT_MS / 2, D0 + 3 * DAY - 1];

let harness: TestCore;
let turnCount = 0;

beforeEach(async () => {
  harness = await startTestCore();
  turnCount = 0;
});

afterEach(async () => {
  await harness.stop();
});

function usage(inputTokens: number, outputTokens: number, cost: number | null = null): Usage {
  return { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, buckets: 1, costUsdEquivalent: cost };
}

function turn(thread: ThreadSummary, finishedAt: number | null, spent: Usage | null, model: string | null = 'claude-opus-5-5', id?: string): Turn {
  turnCount += 1;
  return {
    id: id ?? `turn_${turnCount}`,
    threadId: thread.id,
    status: finishedAt === null ? 'running' : 'done',
    queuedAt: (finishedAt ?? D0) - 1000,
    startedAt: (finishedAt ?? D0) - 900,
    finishedAt,
    usage: spent,
    error: null,
    execution: {
      providerId: 'claude', accountId: thread.accountId, model, effort: null, speed: null, permissionMode: thread.permissionMode,
      sessionId: null, sessionGeneration: 0, selectionVersion: 0,
    },
  };
}

/** The sums per bucket from the slots and from the raw turns, which must be equal. */
function sides(journal: Journal, edges: readonly number[]): [UsageSlotRow[], UsageSlotRow[]] {
  const order = (rows: UsageSlotRow[]) => rows.map((row) => ({ ...row, legacy: Number(row.legacy) })).sort((a, b) => JSON.stringify([a.bucket, a.project_id, a.provider_id, a.model, a.legacy]).localeCompare(JSON.stringify([b.bucket, b.project_id, b.provider_id, b.model, b.legacy])));
  const buckets = edges.slice(1).map((edge, index) => [index, edges[index]!, edge] as [number, number, number]);
  return [order(usageBySlots(journal.db, edges)), order(usageByTurns(journal.db, buckets))];
}

function agree(journal: Journal): void {
  for (const edges of [EDGES, CUT]) {
    const [slots, raw] = sides(journal, edges);
    expect(slots).toEqual(raw);
  }
}

async function setup(): Promise<{ journal: Journal; echo: ThreadSummary; other: ThreadSummary }> {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client, 'Echo work');
  const journal = harness.core.journal;
  const echo = journal.getThread(threadId)!;
  journal.putProject({ id: 'prj_other', name: 'Other', path: harness.dataDir, createdAt: D0 });
  const other: ThreadSummary = { ...echo, id: 'thr_other', title: 'Other work', projectId: 'prj_other' };
  journal.putThread(other);
  return { journal, echo, other };
}

test('the slots equal a sum of the raw turns after a write, a rewrite, a move, a removal and an incognito erase, at whole and cut edges', async () => {
  const { journal, echo, other } = await setup();
  journal.putTurn(turn(echo, D0 + 1, usage(10, 5, 0.25)));
  journal.putTurn(turn(echo, D0 + 6 * 60_000, usage(1, 1, 0.5)));
  journal.putTurn(turn(other, D0 + 8 * 60_000, usage(2, 2)));
  journal.putTurn(turn(other, D0 + DAY, null));
  journal.putTurn(turn(echo, D0 + 2 * DAY + SLOT_MS / 2 + 3, usage(7, 7, 0.125), null));
  journal.putTurn(turn(echo, null, usage(1000, 1000)));
  agree(journal);
  expect(journal.db.query('SELECT SUM(turns) AS turns FROM usage_slots').get()).toEqual({ turns: 5 });

  // Rewritten: a running turn that finishes, a finished one whose usage and time change, one written again unchanged.
  journal.putTurn(turn(echo, D0 + DAY + 5, usage(3, 3, 0.75), 'claude-opus-5-5', 'turn_6'));
  journal.putTurn(turn(echo, D0 + DAY - 1, usage(20, 10, 0.5), 'claude-opus-5-5', 'turn_1'));
  journal.putTurn(turn(echo, D0 + DAY - 1, usage(20, 10, 0.5), 'claude-opus-5-5', 'turn_1'));
  agree(journal);
  expect(journal.db.query('SELECT SUM(turns) AS turns FROM usage_slots').get()).toEqual({ turns: 6 });

  // A thread moved to another project, and one whose model its older turns read changes.
  journal.putThread({ ...other, projectId: echo.projectId });
  journal.putTurn({ ...turn(other, D0 + 2 * DAY + 9, usage(4, 4)), execution: undefined });
  journal.putThread({ ...journal.getThread(other.id)!, model: 'gpt-5' });
  agree(journal);

  // Incognito: counted while it lives, gone with it.
  const hidden: ThreadSummary = { ...echo, id: 'thr_hidden', incognito: true };
  journal.putThread(hidden);
  journal.putTurn(turn(hidden, D0 + 3, usage(9, 9, 1)));
  agree(journal);
  // An id given twice (roots and children concatenated) gives its turns back once.
  journal.deleteThreads([hidden.id, hidden.id]);
  agree(journal);
  expect(journal.db.query('SELECT SUM(turns) AS turns FROM usage_slots').get()).toEqual({ turns: 7 });

  // A project removal keeps the turns, under their project.
  const client = await harness.connect();
  await client.call('projects.remove', { projectId: echo.projectId! });
  agree(journal);
  expect(journal.db.query('SELECT DISTINCT project_id FROM usage_slots').all()).toEqual([{ project_id: echo.projectId }]);
  expect(journal.db.query('SELECT SUM(turns) AS turns FROM usage_slots').get()).toEqual({ turns: 7 });
});

test('a journal from before the slots builds them from every finished and removed turn', async () => {
  const { echo, other } = await setup();
  const dir = mkdtempSync(join(tmpdir(), 'boite-slots-'));
  const file = join(dir, 'journal.db');
  let copy = new Journal(file);
  try {
    for (const thread of [echo, other]) copy.putThread(thread);
    copy.putTurn(turn(echo, D0 + 1, usage(10, 5, 0.25)));
    copy.putTurn(turn(other, D0 + DAY + 2, usage(2, 2)));
    copy.putTurn(turn(other, D0 + DAY + 3, null, null));
    copy.db.query('INSERT INTO removed_turn_usage VALUES (?, ?, ?, ?)').run(D0 + 2 * DAY, 'codex', 'gpt-5', JSON.stringify(usage(5, 5)));
    // What a core before the slots left: no table, version 51.
    copy.db.exec('DROP TABLE usage_slots; PRAGMA user_version = 51');
    copy.close();
    copy = new Journal(file);
    expect(copy.schema.from).toBe(51);
    const [slots, raw] = sides(copy, EDGES);
    expect(slots).toEqual(raw);
    expect(raw.map((row) => [row.bucket, row.project_id, row.provider_id, row.model, row.turns])).toEqual([
      [0, echo.projectId, 'claude', 'claude-opus-5-5', 1], [1, 'prj_other', 'claude', 'claude-opus-5-5', 1], [1, 'prj_other', 'claude', null, 1], [2, null, 'codex', 'gpt-5', 1],
    ]);
  } finally {
    copy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usage.history keeps one project\'s turns, lists every project with its name and removal, and says where the rates came from', async () => {
  const { journal, echo, other } = await setup();
  const free: ThreadSummary = { ...echo, id: 'thr_free', title: 'Free work', projectId: null };
  journal.putThread(free);
  journal.putTurn(turn(echo, D0 + 1, usage(10, 5)));
  journal.putTurn(turn(other, D0 + 2, usage(20, 5)));
  journal.putTurn(turn(free, D0 + DAY, usage(30, 5)));
  const client = await harness.connect();

  const all = await client.call('usage.history', { edges: EDGES });
  expect(all.rows.map((row) => [row.bucket, row.turns])).toEqual([[0, 2], [1, 1]]);
  expect(all.pricing).toMatchObject({ origin: expect.any(String), models: expect.any(Number) });
  const one = await client.call('usage.history', { edges: EDGES, projectId: 'prj_other' });
  expect(one.rows.map((row) => [row.bucket, row.turns, row.usage.inputTokens])).toEqual([[0, 1, 20]]);
  expect(one.threads.map((thread) => thread.threadId)).toEqual([other.id]);
  expect(one.projects).toEqual(all.projects);
  const none = await client.call('usage.history', { edges: EDGES, projectId: null });
  expect(none.rows.map((row) => [row.bucket, row.turns])).toEqual([[1, 1]]);
  expect(none.threads.map((thread) => thread.threadId)).toEqual([free.id]);
  expect(await thrown(client.call('usage.history', { edges: EDGES, projectId: ' ' }))).toThrow('projectId: expected a project id or null');

  const byProject = (history: typeof all) => Object.fromEntries((history.projects ?? []).map((project) => [String(project.projectId), [project.name, project.removed, project.turns, project.usage.inputTokens]]));
  const project = journal.getProject(echo.projectId!)!;
  expect(byProject(all)).toEqual({ [project.id]: [project.name, false, 1, 10], prj_other: ['Other', false, 1, 20], null: [null, false, 1, 30] });
  // A project whose row is gone still names its turns, as removed.
  journal.db.query('DELETE FROM projects WHERE id = ?').run('prj_other');
  expect(byProject(await client.call('usage.history', { edges: EDGES })).prj_other).toEqual([null, true, 1, 20]);
  // A removed project keeps its name and its turns, marked removed; the filter still finds them.
  await client.call('projects.remove', { projectId: echo.projectId! });
  expect(byProject(await client.call('usage.history', { edges: EDGES }))[project.id]).toEqual([project.name, true, 1, 10]);
  expect((await client.call('usage.history', { edges: EDGES, projectId: project.id })).rows.map((row) => row.turns)).toEqual([1]);
});

test('usage.thread lists a thread\'s turns oldest first, keeps the newest when capped, and totals its subagents', async () => {
  const { journal, echo } = await setup();
  const child: ThreadSummary = { ...echo, id: 'thr_child', title: 'Child', parentThreadId: echo.id };
  const small: ThreadSummary = { ...echo, id: 'thr_small', title: 'Small', parentThreadId: echo.id };
  journal.putThread(child);
  journal.putThread(small);
  journal.putTurn(turn(echo, D0 + 20, usage(2, 2), 'claude-opus-5-5', 'turn_late'));
  journal.putTurn(turn(echo, D0 + 10, usage(1, 1), null, 'turn_early'));
  journal.putTurn(turn(echo, D0 + 30, null, 'claude-opus-5-5', 'turn_silent'));
  journal.putTurn(turn(echo, D0 + 3 * DAY, usage(9, 9), 'claude-opus-5-5', 'turn_outside'));
  journal.putTurn(turn(child, D0 + 40, usage(500, 500)));
  journal.putTurn(turn(small, D0 + 50, usage(5, 5)));
  const client = await harness.connect();

  const detail = await client.call('usage.thread', { threadId: echo.id, edges: EDGES });
  expect(detail.turns.map((entry) => [entry.turnId, entry.model, entry.usage?.inputTokens ?? null])).toEqual([
    ['turn_early', null, 1], ['turn_late', 'claude-opus-5-5', 2], ['turn_silent', 'claude-opus-5-5', null],
  ]);
  expect(detail.turns[1]?.price?.model).toBe('claude-opus-5-5');
  expect(detail.turns[1]?.usage?.costUsdEquivalent).toBeGreaterThan(0);
  expect(detail.turns[2]?.price).toBeNull();
  expect(detail.truncated).toBe(false);
  expect(detail.thread).toMatchObject({ threadId: echo.id, turns: 3 });
  expect(detail.thread.usage.inputTokens).toBe(3);
  expect(detail.children.map((thread) => [thread.threadId, thread.turns])).toEqual([[child.id, 1], [small.id, 1]]);

  const codex = turn(echo, D0 + 25, usage(10, 10), 'gpt-5', 'turn_codex');
  journal.putTurn({ ...codex, execution: { ...codex.execution!, providerId: 'codex' } });
  const filtered = await client.call('usage.thread', { threadId: echo.id, edges: EDGES, providerId: 'codex' });
  expect(filtered.thread).toMatchObject({ providerId: 'codex', turns: 1 });
  expect(filtered.turns.map((entry) => entry.turnId)).toEqual(['turn_codex']);
  expect(filtered.children).toEqual([]);

  expect(await thrown(client.call('usage.thread', { threadId: 'thr_missing', edges: EDGES }))).toThrow('threadId: no thread thr_missing');
  expect(await thrown(client.call('usage.thread', { threadId: echo.id, edges: [D0] }))).toThrow('edges: expected 2 to');

  journal.db.transaction(() => {
    for (let index = 0; index < USAGE_THREAD_TURNS_MAX + 5; index++) journal.putTurn(turn(child, D0 + DAY + index, null));
  })();
  const capped = await client.call('usage.thread', { threadId: child.id, edges: EDGES });
  expect(capped.truncated).toBe(true);
  expect(capped.turns).toHaveLength(USAGE_THREAD_TURNS_MAX);
  expect(capped.turns[0]?.finishedAt).toBe(D0 + DAY + 5);
  expect(capped.turns.at(-1)?.finishedAt).toBe(D0 + DAY + USAGE_THREAD_TURNS_MAX + 4);
  expect(capped.thread.turns).toBe(USAGE_THREAD_TURNS_MAX + 6);
  expect(capped.thread.usage.inputTokens).toBe(500);
  expect(capped.turns.every((entry) => entry.usage === null)).toBe(true);
  expect(capped).toMatchObject({ reported: 1, priced: 1 });
});
