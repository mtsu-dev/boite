/**
 * Isolated before/after read paths on synthetic, warm, in-memory data.
 * bun bench/journal-read-cost.ts
 * Baselines retain the previous SQL/hydration, including row conversion.
 * These are local operation costs, not whole-core or network throughput.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, ThreadSummary } from '../packages/contracts/src/index.ts';
import type { Core } from '../packages/core/src/core.ts';
import { Journal } from '../packages/core/src/journal.ts';
import { toTurn, type TurnRow } from '../packages/core/src/journal/rows.ts';
import { finalText } from '../packages/core/src/agents/runtime.ts';
import { pendingMail } from '../packages/core/src/delegation/pending-mail.ts';

const dir = mkdtempSync(join(tmpdir(), 'boite-read-bench-'));
const journal = new Journal(':memory:');
const db = journal.db;
const sample = (run: () => unknown, samples = 9): number => {
  run();
  const times = Array.from({ length: samples }, () => { const at = performance.now(); run(); return performance.now() - at; });
  return +times.sort((a, b) => a - b)[Math.floor(samples / 2)]!.toFixed(3);
};
const print = (name: string, data: object) => console.log(JSON.stringify({ name, ...data }));
try {
  print('environment', { date: new Date().toISOString(), bun: Bun.version, platform: process.platform, database: ':memory:' });
  const thread: ThreadSummary = {
    id: '', projectId: 'project', title: 'Synthetic', titleSource: 'user', providerId: 'echo', accountId: 'account',
    model: null, effort: null, cwd: dir, branch: null, permissionMode: 'default', status: 'idle', unread: false,
    archived: false, pinned: false, sessionId: null, load: null, context: null, createdAt: 1, updatedAt: 1,
  };
  db.transaction(() => { for (let i = 0; i < 2000; i++) journal.putThread({ ...thread, id: `thread${i}`, archived: i >= 100 }); })();
  const beforeThreads = () => journal.listThreads().filter(t => !t.archived);
  const afterThreads = () => journal.listThreads(undefined, { includeArchived: false });
  assert.deepEqual(afterThreads(), beforeThreads());
  print('archive_filter', { rows: 2000, visible: 100, beforeMs: sample(beforeThreads), afterMs: sample(afterThreads) });

  const addTurn = db.query("INSERT INTO turns (id, thread_id, status, queued_at) VALUES (?, 'long', 'done', ?)");
  db.transaction(() => { for (let i = 0; i < 30000; i++) addTurn.run(`turn${i}`, i); })();
  db.query("UPDATE turns SET status = 'running' WHERE id = 'turn1'").run();
  const ids = Array.from({ length: 40 }, (_, i) => `turn${29960 + i}`);
  const oldTurns = "SELECT * FROM turns WHERE thread_id = ? AND (status IN ('running', 'queued') OR id IN (SELECT value FROM json_each(?))) ORDER BY rowid";
  const beforeTurns = () => (db.query(oldTurns).all('long', JSON.stringify(ids)) as TurnRow[]).map(toTurn);
  const afterTurns = () => journal.listTurnsFor('long', ids);
  assert.deepEqual(afterTurns(), beforeTurns());
  print('page_turns', { total: 30000, asked: 40, active: 1, beforeMs: sample(beforeTurns), afterMs: sample(afterTurns) });

  const output = 'synthetic result\n'.repeat(1024 * 1024);
  journal.putMessage({ id: 'answer', threadId: 'blob', turnId: 'blobTurn', role: 'assistant', state: 'complete', createdAt: 1, parts: [
    { type: 'tool', toolId: 'call', name: 'Read', input: {}, status: 'done', output }, { type: 'text', text: 'The answer.' },
  ] });
  const beforeAnswer = () => {
    for (const m of journal.walkAgentMessagesBackwards('blob', 'blobTurn')) {
      for (let at = m.parts.length - 1; at >= 0; at--) { const p = m.parts[at]!; if (p.type === 'text' && p.text.trim()) return p.text.trim(); }
    }
    return '';
  };
  const afterAnswer = () => finalText({ journal } as Core, { threadId: 'blob', id: 'blobTurn' });
  assert.equal(afterAnswer(), beforeAnswer());
  print('final_text', { toolOutputChars: output.length, textChars: 11, beforeMs: sample(beforeAnswer), afterMs: sample(afterAnswer) });

  const parts = JSON.stringify([{ type: 'text', text: 'x'.repeat(32768) }]);
  const insertMessage = db.query("INSERT INTO messages (id, thread_id, turn_id, role, parts, state, created_at) VALUES (?, 'stats', 'stats', 'assistant', ?,  'complete', 1)");
  db.transaction(() => { for (let i = 0; i < 400; i++) insertMessage.run(`stats${i}`, parts); })();
  const marker = '{"type":"compaction","trigger":"';
  const oldStats = () => db.query(`SELECT COALESCE(SUM((length(parts) - length(replace(parts, ?2, ''))) / length(?2)), 0) AS count
    FROM messages WHERE thread_id = ?1 AND role <> 'user' AND instr(parts, ?2) > 0`).get('stats', marker);
  const at = performance.now();
  assert.deepEqual(journal.threadStats('stats'), { compactions: 0, prompts: 0 });
  const coldMs = +(performance.now() - at).toFixed(3);
  const beforeMs = sample(oldStats), repeatedMs = sample(() => journal.threadStats('stats'));
  // A changed message invalidates only itself, including writes through another reader.
  const compaction: Message['parts'] = [{ type: 'compaction', trigger: 'manual', preTokens: 1000, postTokens: 100 }];
  db.query('UPDATE messages SET parts = ? WHERE id = ?').run(JSON.stringify(compaction), 'stats1');
  const changedAt = performance.now();
  assert.equal(journal.threadStats('stats').compactions, 1);
  print('thread_stats', { messages: 400, partsBytes: parts.length * 400, beforeMs, firstReadMs: coldMs, repeatedMs, changedMessageReadMs: +(performance.now() - changedAt).toFixed(3) });

  const insertMail = db.query("INSERT INTO delegation_messages (id,root_id,sender_id,recipient_id,request_id,fingerprint,status,created_at,data) VALUES (?, ?, 'child', ?, ?, '', 'received', 1, '{}')");
  db.transaction(() => {
    for (let root = 0; root < 100; root++) {
      journal.setSetting(`delegation:root${root}`, { enabled: true, paused: true });
      for (let i = 0; i < 10; i++) { const id = `mail${root}-${i}`; insertMail.run(id, `root${root}`, `root${root}`, `result:${id}`); }
    }
  })();
  const oldMailSql = "SELECT root_id, recipient_id, CASE WHEN request_id GLOB 'result:*' THEN NULL ELSE data END AS data FROM delegation_messages WHERE status = 'received'";
  const oldMail = () => {
    const rows = db.query(oldMailSql).all() as { root_id: string; recipient_id: string }[];
    for (const root of new Set(rows.map(r => r.root_id))) journal.getSetting(`delegation:${root}`);
    return rows.length;
  };
  assert.equal(oldMail(), 1000); assert.deepEqual(pendingMail(db), []);
  print('paused_results', { roots: 100, retainedResults: 1000, beforeRows: 1000, afterRows: 0, beforeMs: sample(oldMail), afterMs: sample(() => pendingMail(db)) });
} finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
