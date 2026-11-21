import type { Database } from 'bun:sqlite';
import { redactSharedText } from './contacts/file-policy.ts';

/** One thread a search may return, with what its fields already matched. */
export interface ChatCandidate { threadId: string; fieldWords: string[]; fieldHits: number; activeAt: number }
export interface ChatSearch {
  candidates: ChatCandidate[];
  words: string[];
  /** Leave out a message the shared file policy would withhold, as a match and as an excerpt. */
  redact: boolean;
  results: number;
}
/** A returned thread: whether its chat matched a word, and up to three excerpts of it. */
export interface ChatHit { threadId: string; chat: boolean; excerpts: string[] }

/** Characters kept on each side of a matched word in an excerpt. */
const EXCERPT_SIDE = 90;
const CHAT_TEXT = "j.value->>'type' = 'text' AND m.role IN ('user', 'assistant')";

function excerpt(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word);
  const start = Math.max(0, at - EXCERPT_SIDE);
  const end = Math.min(text.length, at + word.length + EXCERPT_SIDE);
  return `${start > 0 ? '... ' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? ' ...' : ''}`;
}

/**
 * The candidates where every word appears in a field or in the chat: field
 * matches first, then the most recently active, `results` at most. `db` null
 * searches the fields alone. The chat scan reads every candidate's messages,
 * seconds on a large journal, so the core runs it in a worker
 * (`journal-reads.ts`): full messages stay there, and only ids and bounded
 * excerpts come back.
 */
export function searchChat(db: Database | null, { candidates, words, redact, results }: ChatSearch): ChatHit[] {
  const kept = (text: string) => !redact || redactSharedText(text) === text;
  const inChat = new Map<string, Set<string>>();
  if (db && candidates.length > 0) {
    const ids = JSON.stringify(candidates.map(candidate => candidate.threadId));
    // A redacted search judges each message, so its rows carry the text and are read one at a time.
    const columns = redact ? "m.thread_id AS id, w.value AS word, j.value->>'text' AS text" : 'DISTINCT m.thread_id AS id, w.value AS word';
    const scan = db.query<{ id: string; word: string; text?: string }, [string, string]>(`SELECT ${columns}
      FROM messages m CROSS JOIN json_each(m.parts) j CROSS JOIN json_each(?) w
      WHERE m.thread_id IN (SELECT value FROM json_each(?)) AND ${CHAT_TEXT} AND instr(lower(j.value->>'text'), w.value) > 0`);
    for (const word of words) inChat.set(word, new Set());
    for (const row of scan.iterate(JSON.stringify(words), ids)) {
      if (row.text === undefined || kept(row.text)) inChat.get(row.word)!.add(row.id);
    }
  }
  const matches = candidates.flatMap(candidate => {
    const chatWords: string[] = [];
    for (const word of words) {
      const chat = inChat.get(word)?.has(candidate.threadId) === true;
      if (chat) chatWords.push(word);
      else if (!candidate.fieldWords.includes(word)) return [];
    }
    return [{ ...candidate, chatWords }];
  }).sort((a, b) => b.fieldHits - a.fieldHits || b.activeAt - a.activeAt).slice(0, results);
  // Only the matches returned get excerpts: each costs a read of its thread's chat.
  const recent = db?.query(`SELECT j.value->>'text' AS text FROM messages m, json_each(m.parts) j WHERE m.thread_id = ? AND ${CHAT_TEXT} AND instr(lower(j.value->>'text'), ?) > 0 ORDER BY m.created_at DESC LIMIT 3`);
  return matches.map(({ threadId, chatWords }) => ({
    threadId,
    chat: chatWords.length > 0,
    excerpts: recent && chatWords.length > 0
      ? (recent.all(threadId, chatWords[0]!) as { text: string }[]).filter(row => kept(row.text)).map(row => excerpt(row.text, chatWords.find(word => row.text.toLowerCase().includes(word)) ?? chatWords[0]!))
      : [],
  }));
}
