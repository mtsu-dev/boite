import { fitTranscript, TRANSCRIPT_ENTRY_PAGE, TRANSCRIPT_ENTRY_TEXT, TRANSCRIPT_ENTRY_TOOLS, TRANSCRIPT_READ_ENTRIES, transcriptStretch as stretch, type AgentContact, type AgentMatch, type AgentTranscript, type AgentTranscriptEntry, type CoordinationPeer, type Message, type MessagePart } from '@boite/contracts';
import type { Database } from 'bun:sqlite';
import { address, text } from './coordination-letter.ts';
import { invalidParams } from './errors.ts';
import { threadRef } from './contacts/project-policy.ts';

/** At most this many words in a search; each costs one scan of the candidates' chat. */
export const SEARCH_WORDS = 8;
/** Matches returned by one core. */
export const SEARCH_RESULTS = 20;
export { TRANSCRIPT_READ_ENTRIES as READ_ENTRIES, TRANSCRIPT_ENTRY_TEXT as ENTRY_TEXT, TRANSCRIPT_ENTRY_PAGE as ENTRY_PAGE };
/** The longest entry text an older core sends in a page: 4,000 characters and " ...". */
const OLDER_ENTRY_TEXT = 4004;
const EXCERPT_SIDE = 90;

/** Lower-cased words of at least two characters, deduplicated, or a refusal naming the field. */
export function searchWords(query: unknown): string[] {
  if (typeof query !== 'string' || query.trim().length === 0 || query.length > 500) throw invalidParams('query: expected 1 to 500 characters');
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(word => word.length >= 2))];
  if (words.length === 0) throw invalidParams('query: expected at least one word of two characters or more');
  return words.slice(0, SEARCH_WORDS);
}

type Field = AgentMatch['matched'][number];

function fields(contact: AgentContact): [Field, string][] {
  return [
    ['title', contact.title],
    ['project', contact.project ?? ''],
    ['branch', contact.branch ?? ''],
    ['agent', contact.agent ?? ''],
    ['resources', contact.resources],
  ];
}

/** The text a user and an agent wrote in a message, without tool output or reasoning. */
export function spoken(parts: MessagePart[]): string {
  return parts.flatMap(part => part.type === 'text' ? [part.text] : part.type === 'error' ? [`[error] ${part.message}`] : []).join('\n');
}

function excerpt(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word);
  const start = Math.max(0, at - EXCERPT_SIDE);
  const end = Math.min(text.length, at + word.length + EXCERPT_SIDE);
  return `${start > 0 ? '... ' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? ' ...' : ''}`;
}

const CHAT_TEXT = "j.value->>'type' = 'text' AND m.role IN ('user', 'assistant')";

/**
 * Contacts among `candidates` where every word appears in a field or in the
 * chat. Field matches rank first, then the most recently active.
 */
export function searchContacts(db: Database, candidates: AgentContact[], words: string[], readChat = true, sanitize?: (value: string) => string): AgentMatch[] {
  if (candidates.length === 0) return [];
  const ids = JSON.stringify(candidates.map(contact => contact.threadId));
  const inChat = new Map<string, Set<string>>();
  for (const word of readChat ? words : []) {
    const rows = db.query(`SELECT DISTINCT m.thread_id AS id${sanitize ? ", j.value->>'text' AS text" : ''} FROM messages m, json_each(m.parts) j WHERE m.thread_id IN (SELECT value FROM json_each(?)) AND ${CHAT_TEXT} AND instr(lower(j.value->>'text'), ?) > 0`).all(ids, word) as { id: string; text?: string }[];
    inChat.set(word, new Set(rows.filter(row => !sanitize || sanitize(row.text!) === row.text).map(row => row.id)));
  }
  const matches: AgentMatch[] = [];
  for (const contact of candidates) {
    const matched = new Set<Field>();
    const chatWords: string[] = [];
    let all = true;
    for (const word of words) {
      const hit = fields(contact).filter(([, value]) => value.toLowerCase().includes(word)).map(([field]) => field);
      for (const field of hit) matched.add(field);
      const chat = inChat.get(word)?.has(contact.threadId) === true;
      if (chat) chatWords.push(word);
      if (hit.length === 0 && !chat) { all = false; break; }
    }
    if (!all) continue;
    if (chatWords.length > 0) matched.add('chat');
    matches.push({ ...contact, matched: [...matched], excerpts: chatWords.length > 0 ? excerpts(db, contact.threadId, chatWords, sanitize) : [] });
  }
  const fieldHits = (match: AgentMatch) => match.matched.filter(field => field !== 'chat').length;
  return matches.sort((a, b) => fieldHits(b) - fieldHits(a) || (b.activeAt ?? 0) - (a.activeAt ?? 0)).slice(0, SEARCH_RESULTS);
}

/** Up to three recent excerpts of one thread's chat, around the first word each message contains. */
function excerpts(db: Database, threadId: string, words: string[], sanitize?: (value: string) => string): string[] {
  const rows = db.query(`SELECT j.value->>'text' AS text FROM messages m, json_each(m.parts) j WHERE m.thread_id = ? AND ${CHAT_TEXT} AND instr(lower(j.value->>'text'), ?) > 0 ORDER BY m.created_at DESC LIMIT 3`).all(threadId, words[0]!) as { text: string }[];
  return rows.filter(row => !sanitize || sanitize(row.text) === row.text).map(row => excerpt(row.text, words.find(word => row.text.toLowerCase().includes(word)) ?? words[0]!));
}

/** What a read asks: a page of the newest entries before `before`, or one entry's text from `offset`. */
export interface TranscriptQuery { limit: number; before?: number; entry?: string; offset?: number }

/** A read's parameters, checked field by field; `field` prefixes the names a refusal gives. */
export function transcriptQuery(value: unknown, field = ''): TranscriptQuery {
  const raw = (value ?? {}) as { limit?: unknown; before?: unknown; entry?: unknown; offset?: unknown };
  const limit = raw.limit === undefined ? TRANSCRIPT_READ_ENTRIES : raw.limit;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw invalidParams(`${field}limit: expected 1 to 100`);
  if (raw.before !== undefined && !Number.isSafeInteger(raw.before)) throw invalidParams(`${field}before: expected a timestamp`);
  if (raw.entry !== undefined && (typeof raw.entry !== 'string' || raw.entry.length === 0 || raw.entry.length > 100)) throw invalidParams(`${field}entry: expected an entry id of 1 to 100 characters`);
  if (raw.offset !== undefined && (raw.entry === undefined || !Number.isSafeInteger(raw.offset) || (raw.offset as number) < 0)) throw invalidParams(`${field}offset: expected a nonnegative integer beside entry`);
  return {
    limit: limit as number,
    ...(raw.before === undefined ? {} : { before: raw.before as number }),
    ...(raw.entry === undefined ? {} : { entry: raw.entry as string, offset: (raw.offset as number | undefined) ?? 0 }),
  };
}

/** The query as a request payload: only the fields set, so an older core reads the same page. */
export function queryPayload(query: TranscriptQuery): { limit: number; before?: number; entry?: string; offset?: number } {
  return { limit: query.limit, ...(query.before === undefined ? {} : { before: query.before }), ...(query.entry === undefined ? {} : { entry: query.entry, offset: query.offset ?? 0 }) };
}

type Row = { id: string; role: Message['role']; parts: string; created_at: number };
type Held = (messageId: string) => Message | undefined;

/** A message's spoken text and tool names, as a reader may see them. */
function said(row: Row, held?: Held, sanitize?: (value: string) => string): { text: string; tools: string[] } {
  const parts = held?.(row.id)?.parts ?? JSON.parse(row.parts) as MessagePart[];
  const raw = spoken(parts);
  return { text: sanitize ? sanitize(raw) : raw, tools: parts.flatMap(part => part.type === 'tool' ? [sanitize ? sanitize(part.name) : part.name] : []) };
}

/** The newest `TRANSCRIPT_ENTRY_TOOLS` names, each at the 200 characters a reading core accepts, after a count of the ones left out. */
function pageTools(tools: string[]): string[] {
  const kept = tools.slice(-TRANSCRIPT_ENTRY_TOOLS).map(name => name.slice(0, 200));
  return tools.length > kept.length ? [`+${tools.length - kept.length} earlier`, ...kept] : kept;
}

/**
 * A page of entries or one entry's text of thread `threadId`, shown as
 * `contact`, as `query` asks. A page fits `TRANSCRIPT_READ_BUDGET` with the contact card, its newest
 * entries kept. Only the rows read are loaded: a long thread's tool output is
 * never loaded whole. `held` gives the current parts of a message still
 * streaming, whose row can be up to 30 seconds behind.
 */
export function readTranscript(db: Database, threadId: string, contact: AgentContact, query: TranscriptQuery, held?: Held, sanitize?: (value: string) => string): AgentTranscript {
  return query.entry === undefined ? fitTranscript({ contact, ...transcript(db, threadId, query.limit, query.before, held, sanitize) })
    : { contact, ...transcriptEntry(db, threadId, query.entry, query.offset ?? 0, held, sanitize) };
}

/**
 * The newest `limit` entries before `before`, oldest first, and whether older
 * ones remain. Each carries the first `ENTRY_TEXT` characters of its text; a
 * longer one names its whole `length` and the `next` offset of the rest.
 * The caller fits the page to the read budget.
 */
export function transcript(db: Database, threadId: string, limit: number, before: number | undefined, held?: Held, sanitize?: (value: string) => string): { entries: AgentTranscriptEntry[]; more: boolean } {
  const entries: AgentTranscriptEntry[] = [];
  const cursor = before ?? Number.MAX_SAFE_INTEGER;
  let skip = 0;
  // A message with neither text nor a tool (reasoning alone) is skipped, so a page may take another read.
  for (;;) {
    const rows = db.query('SELECT id, role, parts, created_at FROM messages WHERE thread_id = ? AND created_at <= ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?').all(threadId, cursor, limit, skip) as Row[];
    for (const row of rows) {
      if (entries.length === limit) break;
      skip += 1;
      if (row.created_at >= (before ?? Number.MAX_SAFE_INTEGER)) continue;
      const { text, tools } = said(row, held, sanitize);
      if (text.length === 0 && tools.length === 0) continue;
      const page = stretch(text, 0, TRANSCRIPT_ENTRY_TEXT);
      entries.push({ id: row.id, role: row.role, at: row.created_at, text: page.text, tools: pageTools(tools), ...(page.next === undefined ? {} : { length: text.length, next: page.next }) });
    }
    if (entries.length === limit || rows.length < limit) break;
  }
  const more = entries.length === limit && db.query('SELECT 1 FROM messages WHERE thread_id = ? AND created_at <= ? LIMIT 1 OFFSET ?').get(threadId, cursor, skip) !== null;
  return { entries: entries.reverse(), more };
}

/** Up to `ENTRY_PAGE` characters of one entry's text from `offset`, its whole `length`, and `next` while some remain. */
function transcriptEntry(db: Database, threadId: string, id: string, offset: number, held?: Held, sanitize?: (value: string) => string): { entries: AgentTranscriptEntry[]; more: boolean } {
  const row = db.query('SELECT id, role, parts, created_at FROM messages WHERE id = ? AND thread_id = ?').get(id, threadId) as Row | null;
  if (!row) throw invalidParams(`entry: ${id} is not an entry of this thread`);
  const { text } = said(row, held, sanitize);
  if (offset > text.length) throw invalidParams(`offset: expected 0 to ${text.length}, the length of entry ${id}`);
  const page = stretch(text, offset, TRANSCRIPT_ENTRY_PAGE);
  return { entries: [{ id: row.id, role: row.role, at: row.created_at, text: page.text, tools: [], length: text.length, offset, ...(page.next === undefined ? {} : { next: page.next }) }], more: false };
}

/**
 * A transcript from another core, checked field by field before it reaches an
 * agent. With `entry`, the answer must be that one entry from that offset: an
 * older core ignores the request and sends a page, which is refused rather
 * than shown as the text asked for.
 */
export function checkTranscript(value: unknown, entry?: { entry?: string; offset?: number }): { entries: AgentTranscriptEntry[]; more: boolean } {
  const raw = value as { entries?: unknown; more?: unknown } | null;
  if (!raw || !Array.isArray(raw.entries) || raw.entries.length > 100 || typeof raw.more !== 'boolean') throw invalidParams('transcript: expected at most 100 entries and a more flag');
  const single = entry?.entry !== undefined;
  const most = single ? TRANSCRIPT_ENTRY_PAGE : OLDER_ENTRY_TEXT;
  const count = (number: unknown) => number === undefined || (Number.isSafeInteger(number) && (number as number) >= 0);
  const entries = raw.entries.map((item: Partial<AgentTranscriptEntry>, index) => {
    if (!item || typeof item.id !== 'string' || !['user', 'assistant', 'system'].includes(item.role as string) || !Number.isSafeInteger(item.at)
      || typeof item.text !== 'string' || item.text.length > most || !Array.isArray(item.tools) || item.tools.some(tool => typeof tool !== 'string' || tool.length > 200)
      || !count(item.length) || !count(item.offset) || !count(item.next) || (item.next !== undefined && (item.length === undefined || item.next > item.length || item.next <= (item.offset ?? 0)))) {
      throw invalidParams(`transcript.entries[${index}]: expected id, role, at, text up to ${most} characters, tool names and offsets within its length`);
    }
    return {
      id: item.id.slice(0, 100), role: item.role!, at: item.at!, text: item.text, tools: item.tools.slice(0, TRANSCRIPT_ENTRY_TOOLS + 1),
      ...(item.length === undefined ? {} : { length: item.length }), ...(item.offset === undefined ? {} : { offset: item.offset }), ...(item.next === undefined ? {} : { next: item.next }),
    };
  });
  if (single && (entries.length !== 1 || entries[0]!.id !== entry.entry || entries[0]!.offset !== (entry.offset ?? 0))) {
    throw invalidParams(`transcript: expected entry ${entry.entry} from offset ${entry.offset ?? 0}; that machine may run an older Boite that reads pages only`);
  }
  return { entries, more: single ? false : raw.more };
}

/**
 * `contact`'s transcript from another core, checked. A page is cut to this
 * core's preview and read budget whatever that core sent: an entry longer
 * than `ENTRY_TEXT` keeps its start and names the rest from there, which the
 * sending core reads back by `entry` and `offset`.
 */
export function remoteTranscript(contact: AgentContact, value: unknown, entry?: { entry?: string; offset?: number }): AgentTranscript {
  const checked = checkTranscript(value, entry);
  if (entry?.entry !== undefined) return { contact, ...checked };
  const entries = checked.entries.map(item => {
    const page = stretch(item.text, 0, TRANSCRIPT_ENTRY_TEXT);
    return page.next === undefined ? item : { ...item, text: page.text, length: item.length ?? item.text.length, next: page.next };
  });
  return fitTranscript({ contact, entries, more: checked.more });
}

/** A search result from another core, checked before it reaches an agent. */
export function checkMatchExtras(value: { matched?: unknown; excerpts?: unknown }): Pick<AgentMatch, 'matched' | 'excerpts'> {
  const allowed: Field[] = ['title', 'project', 'branch', 'agent', 'resources', 'chat'];
  if (!Array.isArray(value.matched) || value.matched.some(field => !allowed.includes(field as Field))) throw invalidParams('match.matched: expected field names');
  if (!Array.isArray(value.excerpts) || value.excerpts.length > 3 || value.excerpts.some(text => typeof text !== 'string' || text.length > 400)) throw invalidParams('match.excerpts: expected up to three short excerpts');
  return { matched: [...new Set(value.matched as Field[])], excerpts: value.excerpts as string[] };
}

/** An agent another core listed, kept to the fields and sizes this core shows, named after the machine it came from. */
export function checkRemoteContact(contact: AgentContact, peer: CoordinationPeer): AgentContact {
  if (!contact || contact.coreId !== peer.coreId || !['brief', 'team'].includes(contact.mode) || !['idle', 'queued', 'running', 'waiting', 'error'].includes(contact.status)) throw invalidParams('agent: invalid remote contact');
  const optional = (value: unknown) => typeof value === 'string' && value.length <= 200 ? value : undefined;
  const project = optional(contact.project);
  const agent = optional(contact.agent);
  const branch = optional(contact.branch);
  const sharedThread = contact.sharedThread === undefined ? undefined : threadRef(contact.sharedThread);
  if (sharedThread && (sharedThread.address.coreId !== contact.coreId || sharedThread.address.threadId !== contact.threadId)) throw invalidParams('agent.sharedThread: expected this descriptor address');
  return {
    ...address(contact, 'agent'), title: text(contact.title, 'agent.title', 200), machine: peer.name, resources: typeof contact.resources === 'string' && contact.resources.length <= 500 ? contact.resources : '', status: contact.status, mode: contact.mode,
    ...(project === undefined ? {} : { project }), ...(agent === undefined ? {} : { agent }),
    ...(branch === undefined ? {} : { branch }), ...(Number.isSafeInteger(contact.activeAt) ? { activeAt: contact.activeAt } : {}),
    ...(contact.lastCompletedAt === null || Number.isSafeInteger(contact.lastCompletedAt) && contact.lastCompletedAt! >= 0 ? { lastCompletedAt: contact.lastCompletedAt } : {}),
    ...(typeof contact.projectArchived === 'boolean' ? { projectArchived: contact.projectArchived } : {}),
    ...(typeof contact.paused === 'boolean' ? { paused: contact.paused } : {}),
    ...(sharedThread === undefined ? {} : { sharedThread }),
  };
}

/**
 * A directory or search a contact's gateway answers for its group: `partial: 1`
 * in the request asks it to count the machines of that group that did not
 * answer. An older core ignores the flag and sends the bare list.
 */
export interface PartialList { entries: unknown[]; unavailable: number }
export const PARTIAL = 1;

/** The entries of a list answer, old or partial, and how many machines behind it did not answer. */
export function partialList(answer: unknown, max = 100): PartialList {
  const value = Array.isArray(answer) ? { entries: answer, unavailable: 0 } : answer as Partial<PartialList> | null;
  if (!value || !Array.isArray(value.entries) || value.entries.length > max) throw invalidParams(`answer: expected at most ${max} entries`);
  if (!Number.isSafeInteger(value.unavailable) || value.unavailable! < 0 || value.unavailable! > 256) throw invalidParams('answer.unavailable: expected a count of machines');
  return { entries: value.entries, unavailable: value.unavailable! };
}

/**
 * One tool call's output from `offset`, `ENTRY_PAGE` characters at a time, as
 * an entry naming the tool: the whole result a carried history cut
 * (`continuation.ts`). Only the thread that ran the call reads it.
 */
export function toolOutputEntry(entry: Pick<AgentTranscriptEntry, 'id' | 'role' | 'at'>, tool: string, output: string, offset: number): AgentTranscriptEntry {
  if (offset > output.length) throw invalidParams(`offset: expected 0 to ${output.length}, the length of that tool call's output`);
  return { ...entry, ...stretch(output, offset, TRANSCRIPT_ENTRY_PAGE), tools: [tool], length: output.length, offset };
}

/** The name a lookup reports for a source that answered without some of its machines. */
export function partialName(name: string, missing: number): string {
  return missing === 0 ? name : `${name} (${missing} of its machines did not answer)`;
}
