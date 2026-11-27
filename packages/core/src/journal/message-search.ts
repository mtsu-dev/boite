import type { Database } from 'bun:sqlite';
import { gradeMessage, messageSearchTerms, orderMessageMatches, type RpcParams, type ThreadMessageMatch } from '@boite/contracts';
import { REMOVED_PROJECTS } from './thread-rows.ts';

/** Text parts stay inline. Only tool, file and image fields use part_blobs. */
const TEXT = "(SELECT group_concat(coalesce(value->>'displayText', value->>'text'), char(10)) FROM json_each(CASE WHEN json_valid(@.parts) AND json_type(@.parts) = 'array' THEN @.parts ELSE '[]' END) WHERE value->>'type' = 'text')";
const OVERLAY_TEXT = `(SELECT group_concat(coalesce(json->>'displayText', json->>'text'), char(10)) FROM (SELECT part_index, json FROM (SELECT CAST(je.key AS INTEGER) AS part_index, je.value AS json FROM json_each(CASE WHEN json_valid(@.parts) AND json_type(@.parts) = 'array' THEN @.parts ELSE '[]' END) je WHERE NOT EXISTS (SELECT 1 FROM streaming_parts sp WHERE sp.message_id = @.id AND sp.part_index = CAST(je.key AS INTEGER)) UNION ALL SELECT sp.part_index, sp.json FROM streaming_parts sp WHERE sp.message_id = @.id) ORDER BY part_index) WHERE json->>'type' = 'text')`;
const MERGED_TEXT = `CASE WHEN EXISTS (SELECT 1 FROM streaming_parts sp WHERE sp.message_id = @.id) THEN ${OVERLAY_TEXT} ELSE ${TEXT} END`;
const VISIBLE = "@.role IN ('user', 'assistant') AND EXISTS (SELECT 1 FROM threads WHERE id = @.thread_id AND incognito = 0)";

const INFIX = "SELECT 1 FROM sqlite_schema WHERE name = 'messages_fts_infix'";

export function ensureMessageSearchTriggers(db: Database): void {
  const infix = db.query(INFIX).get() !== null;
  const key = (row: string) => `(SELECT id FROM message_search_keys WHERE message_id = ${row}.id)`;
  const remove = (row: string) => `
    DELETE FROM messages_fts WHERE rowid = ${key(row)};
    ${infix ? `DELETE FROM messages_fts_infix WHERE rowid = ${key(row)};` : ''}`;
  const add = (row: string) => `
    INSERT INTO message_search_keys(message_id, thread_id, role, created_at)
      SELECT ${row}.id, ${row}.thread_id, ${row}.role, ${row}.created_at WHERE ${VISIBLE.replaceAll('@', row)}
      ON CONFLICT(message_id) DO UPDATE SET thread_id = excluded.thread_id, role = excluded.role, created_at = excluded.created_at;
    INSERT INTO messages_fts(rowid, body)
      SELECT ${key(row)}, ${TEXT.replaceAll('@', row)}
      WHERE ${VISIBLE.replaceAll('@', row)};
    ${infix ? `INSERT INTO messages_fts_infix(rowid, body)
      SELECT ${key(row)}, ${TEXT.replaceAll('@', row)}
      WHERE ${VISIBLE.replaceAll('@', row)};` : ''}`;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS message_search_insert AFTER INSERT ON messages
      WHEN new.role IN ('user', 'assistant') OR ${key('new')} IS NOT NULL BEGIN
      ${remove('new')}
      ${add('new')}
      DELETE FROM message_search_keys WHERE message_id = new.id AND NOT (${VISIBLE.replaceAll('@', 'new')});
    END;
    CREATE TRIGGER IF NOT EXISTS message_search_update AFTER UPDATE OF parts ON messages
      WHEN new.role IN ('user', 'assistant') AND (old.parts IS NOT new.parts
        OR EXISTS (SELECT 1 FROM streaming_parts WHERE message_id = new.id)) BEGIN
      ${remove('old')}
      ${add('new')}
    END;
    CREATE TRIGGER IF NOT EXISTS message_search_delete AFTER DELETE ON messages BEGIN
      ${remove('old')}
      DELETE FROM message_search_keys WHERE message_id = old.id;
    END;
  `);
}

export function createMessageSearch(db: Database): void {
  // A VACUUM can change messages.rowid. Keep permanent integer keys and prefer contentless
  // FTS5 tables (`content='', contentless_delete=1`, SQLite 3.43+) so bodies are not duplicated,
  // falling back to standard FTS5 on older system SQLite builds such as macOS 13 (3.39.5).
  db.exec(`
    CREATE TABLE message_search_keys (
      id INTEGER PRIMARY KEY,
      message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
  let contentless = true;
  try {
    db.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2')`);
  } catch (error) {
    if (!(error instanceof Error) || !/contentless_delete|unrecognized option|unknown option/i.test(error.message)) throw error;
    contentless = false;
    db.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(body, tokenize='unicode61 remove_diacritics 2')`);
  }
  // Some system SQLite versions support trigram but lack its diacritic option (3.45+).
  let infix = true;
  try {
    const mode = contentless ? "content='', contentless_delete=1, " : '';
    db.exec(`CREATE VIRTUAL TABLE messages_fts_infix USING fts5(body, ${mode}tokenize='trigram remove_diacritics 1')`);
  } catch (error) {
    if (!(error instanceof Error) || !/tokenizer|contentless_delete|unrecognized option|unknown option/i.test(error.message)) throw error;
    infix = false;
  }
  db.exec(`
    INSERT INTO message_search_keys(message_id, thread_id, role, created_at)
      SELECT m.id, m.thread_id, m.role, m.created_at FROM messages m WHERE ${VISIBLE.replaceAll('@', 'm')};
    INSERT INTO messages_fts(rowid, body)
      SELECT k.id, ${TEXT.replaceAll('@', 'm')}
      FROM message_search_keys k JOIN messages m ON m.id = k.message_id;
    ${infix ? `INSERT INTO messages_fts_infix(rowid, body)
      SELECT k.id, ${TEXT.replaceAll('@', 'm')}
      FROM message_search_keys k JOIN messages m ON m.id = k.message_id;` : ''}
  `);
  ensureMessageSearchTriggers(db);
}

/** The caller commits this with the side rows, or both roll back together. */
export function refreshStreamMessageSearch(db: Database, id: string, body: string): void {
  const held = db.query<{ id: number }, [string]>('SELECT id FROM message_search_keys WHERE message_id = ?').get(id);
  if (held === null) return;
  db.query('DELETE FROM messages_fts WHERE rowid = ?').run(held.id);
  db.query('INSERT INTO messages_fts(rowid, body) VALUES (?, ?)').run(held.id, body);
  if (db.query(INFIX).get() !== null) {
    db.query('DELETE FROM messages_fts_infix WHERE rowid = ?').run(held.id);
    db.query('INSERT INTO messages_fts_infix(rowid, body) VALUES (?, ?)').run(held.id, body);
  }
}

export function copyStreamMessageSearch(db: Database, from: string, to: string): void {
  const source = db.query<{ body: string | null }, [string]>(`
    SELECT ${MERGED_TEXT.replaceAll('@', 'm')} AS body
    FROM messages m WHERE m.id = ?
  `).get(from);
  if (source) refreshStreamMessageSearch(db, to, source.body ?? '');
}

type Candidate = Omit<ThreadMessageMatch, 'snippet' | 'score'> & { body: string; rowid: number };

function candidateRows(db: Database, index: 'messages_fts' | 'messages_fts_infix', visible: string, ftsQuery: string, cap: number): Candidate[] {
  // Give each matching thread its top candidates in a single pass without OFFSET rescans
  // or nested FTS5 MATCH joins, reading message text only for the bounded winning page.
  return db.query<Candidate, [string, number]>(`
    WITH ranked AS (
      SELECT k.id, ${index}.rank AS relevance, k.created_at AS at,
        row_number() OVER (PARTITION BY k.thread_id
          ORDER BY ${index}.rank, k.created_at DESC, k.message_id) AS position
      FROM ${index}
      JOIN message_search_keys k ON k.id = ${index}.rowid
      JOIN threads t ON t.id = k.thread_id
      WHERE ${visible} AND ${index} MATCH ?
    ), page AS (
      SELECT id, position, relevance, at FROM ranked WHERE position <= 4
      ORDER BY position, relevance, at DESC, id DESC LIMIT ?
    )
    SELECT k.id AS rowid, k.message_id AS messageId, k.thread_id AS threadId,
      k.role, k.created_at AS messageCreatedAt,
      COALESCE(${MERGED_TEXT.replaceAll('@', 'm')}, '') AS body
    FROM page
    JOIN message_search_keys k ON k.id = page.id
    JOIN messages m ON m.id = k.message_id
    ORDER BY page.position, page.relevance, page.at DESC, page.id DESC
  `).all(ftsQuery, cap);
}

export function searchThreadMessages(db: Database, query: string, { limit = 20, includeArchived = true }: Pick<RpcParams<'threads.search'>, 'limit' | 'includeArchived'> = {}): ThreadMessageMatch[] {
  const terms = messageSearchTerms(query);
  if (!terms.length) return [];
  const exactWords: string[] = [];
  const wordsOnly: string[] = [];
  const wordsWithInfix: string[] = [];
  const infixOnly: string[] = [];
  for (const { words, exact } of terms) {
    const pattern = `"${words.join(' ')}"`;
    const length = Array.from(words[0]!).length;
    const word = pattern + (!exact && length >= 3 ? '*' : '');
    exactWords.push(pattern);
    if (exact || length < 4) wordsOnly.push(word);
    else { wordsWithInfix.push(word); infixOnly.push(pattern); }
  }
  const visible = `
    t.incognito = 0
    AND NOT EXISTS (SELECT 1 FROM thread_deletions WHERE thread_id = t.id)
    AND (t.project_id IS NULL OR t.project_id NOT IN (${REMOVED_PROJECTS}))
    ${includeArchived ? '' : 'AND t.archived = 0'}
  `;
  const maxResults = Math.min(limit, 50);
  const maxScan = Math.min(1600, Math.max(400, maxResults * 16));
  const matches = new Map<string, ThreadMessageMatch>();
  const seen = new Set<number>();
  const cutoff = (): number => {
    if (matches.size < maxResults) return -Infinity;
    return [...matches.values()].map(hit => hit.score).sort((a, b) => b - a)[maxResults - 1]!;
  };
  const collect = (index: 'messages_fts' | 'messages_fts_infix', ftsQuery: string): void => {
    for (const { rowid, body, ...row } of candidateRows(db, index, visible, ftsQuery, maxScan)) {
      if (seen.has(rowid)) continue;
      seen.add(rowid);
      const grade = gradeMessage(body, terms);
      if (!grade) continue;
      const hit = { ...row, ...grade };
      const previous = matches.get(hit.threadId);
      if (!previous || orderMessageMatches(hit, previous) < 0) matches.set(hit.threadId, hit);
    }
  };
  const exactQuery = exactWords.join(' AND ');
  const wordQuery = [...wordsOnly, ...wordsWithInfix].join(' AND ');
  // Query exact whole-word matches before prefix matches so many prefix hits cannot evict exact words.
  if (exactQuery !== wordQuery) {
    collect('messages_fts', exactQuery);
  }
  // A prefix-only hit scores at most 2 for a single term or 100 + (3*(n-1)+2)/n for multiple terms; skip if already beaten.
  const maxPrefixScore = terms.length === 1 ? 2 : 100 + (3 * (terms.length - 1) + 2) / terms.length;
  if (exactQuery === wordQuery || cutoff() <= maxPrefixScore) {
    collect('messages_fts', wordQuery);
  }
  // Evaluate internal substrings on indexed candidates without joining a second FTS5 MATCH;
  // gradeMessage verifies any short or exact terms on the bounded page.
  const maxInfixScore = terms.length === 1 ? 1 : 100 + (3 * (terms.length - 1) + 1) / terms.length;
  if (infixOnly.length > 0 && cutoff() <= maxInfixScore && db.query(INFIX).get() !== null) {
    collect('messages_fts_infix', infixOnly.join(' AND '));
  }
  return [...matches.values()].sort(orderMessageMatches).slice(0, maxResults);
}
