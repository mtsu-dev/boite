/*
 * A conversation as Boite's journal holds it, into the records of
 * `records.ts`: what the user saw, whatever agent ran it. It is the only
 * record of an agent that keeps no transcript Boite reads (ACP, pi), and it
 * carries what no agent's file has: each turn's status, error and usage.
 *
 * Runs in the reader worker on its own read-only connection. A published file
 * (an artifact) stays a reference: its bytes belong to the artifact store.
 */

import type { Database } from 'bun:sqlite';
import type { MessagePart } from '@boite/contracts';
import { hydrate } from '../journal/part-blobs.ts';
import { toMessage, type MessageRow, type TurnRow } from '../journal/rows.ts';
import { capOutput, record, stripBlobs, type Json, type Sink, type TranscriptRecord } from './records.ts';

type Emit = (record: TranscriptRecord) => void;

function parsed(text: string | null): Json | undefined {
  if (text === null) return undefined;
  try { return JSON.parse(text) as Json; } catch { return text; }
}

function turnRecord(row: TurnRow): TranscriptRecord {
  return record({
    t: row.queued_at, k: 'turn', turn: row.id, status: row.status, started: row.started_at, finished: row.finished_at,
    usage: parsed(row.usage), error: row.error ?? undefined, execution: parsed(row.execution), totals: parsed(row.agent_totals ?? null),
  });
}

function partRecords(part: MessagePart, base: { [key: string]: Json | undefined }, role: string, sink: Sink, emit: Emit): void {
  const said = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role;
  if (part.type === 'text') {
    const { type: _type, text, ...rest } = part;
    emit(record({ ...base, k: said, text, ...(Object.keys(rest).length > 0 ? { info: stripBlobs(rest as unknown as Json, sink) } : {}) }));
  } else if (part.type === 'thinking') {
    emit(record({ ...base, k: 'reasoning', text: part.text, t: part.startedAt ?? base.t }));
  } else if (part.type === 'tool') {
    const failed = part.status === 'error' || part.status === 'denied' || (typeof part.exitCode === 'number' && part.exitCode !== 0);
    const { type: _type, toolId, name, input, inputText, output, status, exitCode, ...rest } = part;
    emit(record({ ...base, k: 'call', call: toolId, tool: name, input: stripBlobs((input ?? inputText ?? null) as Json, sink) }));
    emit(record({
      ...base, k: 'result', call: toolId, out: output === null ? undefined : capOutput(output, failed, sink), status,
      exit: exitCode ?? undefined, error: part.status === 'error' || part.status === 'denied' ? true : undefined,
      info: Object.keys(rest).length > 0 ? stripBlobs(rest as unknown as Json, sink) : undefined,
    }));
  } else if (part.type === 'image' || part.type === 'file') {
    emit(record({
      ...base, k: said, part: {
        type: part.type, mime: part.mimeType, name: part.type === 'file' ? part.name : part.alt,
        data: part.data.length > 0 ? sink.blob(part.data, part.mimeType) : null,
      },
    }));
  } else {
    emit(record({ ...base, k: 'other', type: part.type, data: stripBlobs(part as unknown as Json, sink) }));
  }
}

/**
 * Emits one thread's turns and messages in journal order, each turn before
 * its first message. `pause` runs between messages so the writer keeps up.
 */
export async function journalRecords(db: Database, threadId: string, sink: Sink, emit: Emit, pause: () => Promise<void>): Promise<void> {
  const thread = db.query('SELECT id, title, provider_id, account_id, model, cwd, session_id, created_at, updated_at FROM threads WHERE id = ?').get(threadId) as { [key: string]: Json } | null;
  if (thread !== null) emit(record({ t: thread.created_at, k: 'context', what: 'thread', data: thread }));
  const turns = new Map((db.query('SELECT * FROM turns WHERE thread_id = ? ORDER BY rowid').all(threadId) as TurnRow[]).map(row => [row.id, row]));
  const statement = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY rowid');
  try {
    for (const row of statement.iterate(threadId) as Iterable<MessageRow>) {
      const turn = turns.get(row.turn_id);
      if (turn !== undefined) {
        turns.delete(row.turn_id);
        emit(turnRecord(turn));
      }
      const message = hydrate(db, toMessage(row));
      const base = { t: message.createdAt, id: message.id, turn: message.turnId, state: message.state === 'complete' ? undefined : message.state };
      for (const part of message.parts) if (part !== null && typeof part === 'object') partRecords(part, base, message.role, sink, emit);
      await pause();
    }
  } finally { statement.finalize(); }
  // Turns that never wrote a message: queued, refused or failed before a word.
  for (const turn of turns.values()) emit(turnRecord(turn));
}
