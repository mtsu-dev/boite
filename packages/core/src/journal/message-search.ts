import type { Database } from 'bun:sqlite';
import { gradeMessage, messageSearchTerms, orderMessageMatches, type RpcParams, type ThreadMessageMatch } from '@boite/contracts';
import { REMOVED_PROJECTS } from './thread-rows.ts';

/** Text parts stay inline. Only tool, file and image fields use part_blobs. */
const TEXT = "(SELECT group_concat(coalesce(value->>'displayText', value->>'text'), char(10)) FROM json_each(@.parts) WHERE value->>'type' = 'text')";
const VISIBLE = "@.role IN ('user', 'assistant') AND EXISTS (SELECT 1 FROM threads WHERE id = @.thread_id AND incognito = 0)";

export function createMessageSearch(db: Database): void {
  // A VACUUM can change messages.rowid. Keep a permanent integer key for FTS.
  db.exec(`
    CREATE TABLE message_search_keys (id INTEGER PRIMARY KEY, message_id TEXT NOT NULL UNIQUE);
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      message_id UNINDEXED, thread_id UNINDEXED, role UNINDEXED, created_at UNINDEXED, body,
      tokenize='unicode61 remove_diacritics 2'
    )`);
  // The trigram postings share the main index's stored text. Some system
  // SQLite versions support trigram but lack its diacritic option.
  let infix = true;
  try {
    db.exec(`CREATE VIRTUAL TABLE messages_fts_infix USING fts5(body, content='', tokenize='trigram remove_diacritics 1')`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('tokenizer')) throw error;
    infix = false;
  }
  const key = (row: string) => `(SELECT id FROM message_search_keys WHERE message_id = ${row}.id)`;
  const remove = (row: string) => `
    ${infix ? `INSERT INTO messages_fts_infix(messages_fts_infix, rowid, body)
      SELECT 'delete', rowid, body FROM messages_fts WHERE rowid = ${key(row)};` : ''}
    DELETE FROM messages_fts WHERE rowid = ${key(row)};`;
  const add = (row: string) => `
    INSERT INTO message_search_keys(message_id)
      SELECT ${row}.id WHERE ${VISIBLE.replaceAll('@', row)}
      ON CONFLICT(message_id) DO NOTHING;
    INSERT INTO messages_fts(rowid, message_id, thread_id, role, created_at, body)
      SELECT ${key(row)}, ${row}.id, ${row}.thread_id, ${row}.role, ${row}.created_at, ${TEXT.replaceAll('@', row)}
      WHERE ${VISIBLE.replaceAll('@', row)};
    ${infix ? `INSERT INTO messages_fts_infix(rowid, body)
      SELECT rowid, body FROM messages_fts WHERE rowid = ${key(row)};` : ''}`;
  db.exec(`
    INSERT INTO message_search_keys(message_id)
      SELECT m.id FROM messages m WHERE ${VISIBLE.replaceAll('@', 'm')};
    INSERT INTO messages_fts(rowid, message_id, thread_id, role, created_at, body)
      SELECT k.id, m.id, m.thread_id, m.role, m.created_at, ${TEXT.replaceAll('@', 'm')}
      FROM message_search_keys k JOIN messages m ON m.id = k.message_id;
    ${infix ? 'INSERT INTO messages_fts_infix(rowid, body) SELECT rowid, body FROM messages_fts;' : ''}
    -- REPLACE need not fire DELETE triggers, so update any existing postings.
    CREATE TRIGGER message_search_insert AFTER INSERT ON messages
      WHEN new.role IN ('user', 'assistant') OR ${key('new')} IS NOT NULL BEGIN
      ${remove('new')}
      ${add('new')}
    END;
    CREATE TRIGGER message_search_update AFTER UPDATE OF parts ON messages
      WHEN new.role IN ('user', 'assistant') AND old.parts IS NOT new.parts BEGIN
      ${remove('old')}
      ${add('new')}
    END;
    CREATE TRIGGER message_search_delete AFTER DELETE ON messages BEGIN
      ${remove('old')}
      DELETE FROM message_search_keys WHERE message_id = old.id;
    END;
  `);
}

type Candidate = Omit<ThreadMessageMatch, 'snippet' | 'score'> & { body: string };

export function searchThreadMessages(db: Database, query: string, { limit = 20, includeArchived = true }: Omit<RpcParams<'threads.search'>, 'query'> = {}): ThreadMessageMatch[] {
  const terms = messageSearchTerms(query);
  if (!terms.length) return [];
  const infix = db.query("SELECT 1 FROM sqlite_schema WHERE name = 'messages_fts_infix'").get() !== null;
  const wordPatterns: string[] = [];
  const infixPatterns: string[] = [];
  for (const { words, exact } of terms) {
    const pattern = `"${words.join(' ')}"`;
    if (exact || words[0]!.length < 4) wordPatterns.push(pattern + (!exact && words[0]!.length === 3 ? '*' : ''));
    else infixPatterns.push(pattern);
  }
  const constraints: string[] = [];
  const bindings: string[] = [];
  if (wordPatterns.length) {
    constraints.push('messages_fts MATCH ?');
    bindings.push(wordPatterns.join(' AND '));
  }
  if (infix && infixPatterns.length) {
    constraints.push('messages_fts.rowid IN (SELECT rowid FROM messages_fts_infix WHERE messages_fts_infix MATCH ?)');
    bindings.push(infixPatterns.join(' AND '));
  }
  const rows = db.query<Candidate, string[]>(`
    SELECT message_id AS messageId, thread_id AS threadId, role, messages_fts.created_at AS messageCreatedAt, body
    FROM messages_fts
    JOIN threads t ON t.id = messages_fts.thread_id
    WHERE t.incognito = 0 AND body IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM thread_deletions WHERE thread_id = t.id)
      AND (t.project_id IS NULL OR t.project_id NOT IN (${REMOVED_PROJECTS}))
      ${includeArchived ? '' : 'AND t.archived = 0'}
      ${constraints.map(clause => `AND ${clause}`).join(' ')}
  `);
  const matches = new Map<string, ThreadMessageMatch>();
  for (const { body, ...row } of rows.iterate(...bindings)) {
    const grade = gradeMessage(body, terms);
    if (!grade) continue;
    const hit = { ...row, ...grade };
    const previous = matches.get(hit.threadId);
    if (!previous || orderMessageMatches(hit, previous) < 0) matches.set(hit.threadId, hit);
  }
  return [...matches.values()].sort(orderMessageMatches).slice(0, Math.min(limit, 50));
}
