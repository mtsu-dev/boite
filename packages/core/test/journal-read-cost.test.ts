import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, ThreadSummary, Turn } from '@boite/contracts';
import type { Core } from '../src/core.ts';
import { Journal } from '../src/journal.ts';
import { finalText } from '../src/agents/runtime.ts';

let dir: string, journal: Journal;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'boite-read-cost-')); journal = new Journal(join(dir, 'journal.db')); });
afterEach(() => { journal.close(); rmSync(dir, { recursive: true, force: true }); });

const thread = (id: string, archived = false, projectId = 'project'): ThreadSummary => ({
  id, projectId, title: id, titleSource: 'user', providerId: 'echo', accountId: 'account', model: null,
  effort: null, cwd: dir, branch: null, permissionMode: 'default', status: 'idle', unread: false,
  archived, pinned: false, sessionId: null, load: null, context: null, createdAt: 1, updatedAt: 1,
});
const message = (id: string, parts: Message['parts'], over: Partial<Message> = {}): Message => ({
  id, threadId: 'thread', turnId: 'turn', role: 'assistant', state: 'complete', createdAt: 1, parts, ...over,
});
const turn = (id: string, status: Turn['status'] = 'done', threadId = 'thread'): Turn => ({
  id, threadId, status, queuedAt: 1, startedAt: status === 'queued' ? null : 2,
  finishedAt: status === 'done' ? 3 : null, usage: null, error: null,
});

test('visible thread reads filter archives before decoding, preserving project, deletion and prompt metadata', () => {
  for (const row of [thread('visible'), thread('archived', true), thread('other', false, 'other'), thread('deleted')]) journal.putThread(row);
  journal.putMessage(message('prompt', [{ type: 'text', text: 'hello' }], { threadId: 'visible', role: 'user', createdAt: 42 }));
  journal.stageThreadDeletion('deleted', [journal.getThread('deleted')!]);
  expect(journal.listThreads().map(t => t.id)).toEqual(['visible', 'archived', 'other']);
  expect(journal.listThreads('project', { includeArchived: false }).map(t => t.id)).toEqual(['visible']);
  expect(journal.listThreads(undefined, { includeArchived: false }).map(t => t.id)).toEqual(['visible', 'other']);
  expect(journal.listThreads('project', { includeArchived: false })[0]?.lastUserMessageAt).toBe(42);
  // A hidden archived row need not be materialized by the visible-list path.
  journal.db.query("UPDATE threads SET context = 'broken JSON' WHERE id = 'archived'").run();
  expect(() => journal.listThreads('project', { includeArchived: false })).not.toThrow();
  expect(() => journal.listThreads('project')).toThrow();
});

test('final text stays scoped to its turn and skips tool blobs while normal reads still validate them', () => {
  journal.putMessage(message('answer', [
    { type: 'text', text: 'old block' },
    { type: 'tool', toolId: 'call', name: 'Read', input: {}, status: 'done', output: 'x'.repeat(64 * 1024) },
    { type: 'text', text: '  The answer.  ' },
  ]));
  journal.putMessage(message('tool-only', [{ type: 'text', text: ' \n ' }]));
  journal.putMessage(message('next-turn', [{ type: 'text', text: 'another turn' }], { turnId: 'next' }));
  journal.putMessage(message('other-thread', [{ type: 'text', text: 'another thread' }], { threadId: 'other' }));
  const core = { journal } as Core;
  expect(finalText(core, { id: 'turn', threadId: 'thread' })).toBe('The answer.');
  expect(finalText(core, { id: 'missing', threadId: 'thread' })).toBe('');
  journal.db.query("UPDATE part_blobs SET data = ?, codec = 1 WHERE message_id = 'answer'").run(new Uint8Array([1, 2, 3]));
  expect(finalText(core, { id: 'turn', threadId: 'thread' })).toBe('The answer.');
  expect(() => [...journal.walkAgentMessagesBackwards('thread', 'turn')]).toThrow();
  expect(() => journal.getMessage('answer')).toThrow();
});

test('final text reads the unpersisted overlay and still reports malformed inline JSON', () => {
  journal.putMessage(message('live', [], { state: 'streaming' }));
  journal.appendDelta('thread', 'live', 0, 'streamed answer');
  expect(finalText({ journal } as Core, { id: 'turn', threadId: 'thread' })).toBe('streamed answer');
  journal.setMessageState('live', 'complete');
  journal.db.query("UPDATE messages SET parts = 'broken JSON' WHERE id = 'live'").run();
  expect(() => finalText({ journal } as Core, { id: 'turn', threadId: 'thread' })).toThrow();
});

test('page turns include active work once, reject foreign ids and preserve row order and complete metadata', () => {
  const first: Turn = { ...turn('first'), checkpoint: { sessionId: 'session', entry: 'entry' }, quiet: true };
  const active = turn('active', 'running');
  const queued = turn('queued', 'queued');
  for (const row of [first, turn('old'), active, turn('foreign', 'running', 'other'), queued, turn('last')]) journal.putTurn(row);
  expect(journal.listTurnsFor('thread', ['last', 'active', 'foreign', 'first', 'last', 'missing']))
    .toEqual([first, active, queued, turn('last')]);
  expect(journal.listTurnsFor('thread', [])).toEqual([active, queued]);
  journal.putTurn({ ...active, status: 'done', finishedAt: 4 });
  expect(journal.listTurnsFor('thread', [])).toEqual([queued]);
  expect(journal.listTurnsFor('missing', ['first'])).toEqual([]);
});

test('compaction statistics remain correct after replacements, raw writes, rollback, moves, deletes and reopen', () => {
  const compaction = { type: 'compaction', trigger: 'manual', preTokens: 1200, postTokens: 100 } as const;
  journal.putMessage(message('a', [compaction, compaction]));
  journal.putMessage(message('prompt', [{ type: 'text', text: 'prompt' }], { role: 'user' }));
  journal.putMessage(message('quoted', [{ type: 'text', text: JSON.stringify(compaction) }]));
  expect(journal.threadStats('thread')).toEqual({ compactions: 2, prompts: 1 });
  expect(journal.threadStats('thread')).toEqual({ compactions: 2, prompts: 1 });
  journal.db.query('UPDATE messages SET parts = ? WHERE id = ?').run(JSON.stringify([compaction]), 'a');
  expect(journal.threadStats('thread')).toEqual({ compactions: 1, prompts: 1 });
  expect(() => journal.db.transaction(() => {
    journal.db.query("DELETE FROM messages WHERE id = 'a'").run();
    expect(journal.threadStats('thread')).toEqual({ compactions: 0, prompts: 1 });
    throw new Error('rollback');
  })()).toThrow('rollback');
  expect(journal.threadStats('thread')).toEqual({ compactions: 1, prompts: 1 });
  journal.putMessage(message('a', [compaction, compaction, compaction]));
  expect(journal.threadStats('thread')).toEqual({ compactions: 3, prompts: 1 });
  journal.db.query("UPDATE messages SET thread_id = 'other' WHERE id = 'a'").run();
  expect(journal.threadStats('thread')).toEqual({ compactions: 0, prompts: 1 });
  expect(journal.threadStats('other')).toEqual({ compactions: 3, prompts: 0 });
  journal.db.query("UPDATE messages SET role = 'user' WHERE id = 'a'").run();
  expect(journal.threadStats('other')).toEqual({ compactions: 0, prompts: 1 });
  journal.db.query("DELETE FROM messages WHERE id IN ('a', 'prompt')").run();
  journal.close(); journal = new Journal(join(dir, 'journal.db'));
  expect(journal.threadStats('thread')).toEqual({ compactions: 0, prompts: 0 });
  expect(journal.threadStats('other')).toEqual({ compactions: 0, prompts: 0 });
});

test('schema 49 gains lazy statistics without rewriting historical messages', () => {
  const parts: Message['parts'] = [{ type: 'compaction', trigger: 'manual', preTokens: 1000, postTokens: 100 }];
  journal.putMessage(message('historical', parts));
  const before = journal.db.query('SELECT * FROM messages').all();
  journal.db.exec('DROP TABLE message_compactions; PRAGMA user_version = 49');
  journal.close(); journal = new Journal(join(dir, 'journal.db'));
  expect(journal.schema).toEqual({ from: 49, to: 50 });
  expect(journal.db.query('SELECT * FROM messages').all()).toEqual(before);
  expect(journal.db.query('SELECT COUNT(*) AS n FROM message_compactions').get()).toEqual({ n: 0 });
  expect(journal.threadStats('thread')).toEqual({ compactions: 1, prompts: 0 });
  journal.db.query("UPDATE messages SET parts = '[]' WHERE id = 'historical'").run();
  expect(journal.threadStats('thread')).toEqual({ compactions: 0, prompts: 0 });
});
