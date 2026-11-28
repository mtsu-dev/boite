/**
 * Antigravity's children that outlive the prompt that launched them. From 1.5
 * an `invoke_subagent` call, or a `swarm` call that adds workers, returns as
 * soon as the children start, and the coordinator often ends its prompt to
 * wait for them. The children keep running inside the agent, and when one
 * reports, the agent wakes the coordinator and streams its next reply with no
 * prompt open. The protocol says none of this, so it is read from the records
 * the agent keeps under `GEMINI_HOME`, the layout of agy 1.5.11; no released
 * server speaks the `_antigravity/swarm` protocol that would say it live:
 *
 * - `antigravity-acp/brain/<session>/.system_generated/subagents/<child>.json`,
 *   one record per child the session launched, `state` among its fields;
 * - `.../<conversation>/.system_generated/messages/*.json`, a conversation's
 *   inbox: a child's holds the launching call (`sourceMetadata.tool.toolCall`),
 *   the parent's holds what each child reported, `read.json` the receipts;
 * - `.../<session>/.system_generated/swarm/members.json`, the swarm roster,
 *   where a worker that was killed or parks until mentioned never reports;
 * - `.../<session>/.system_generated/logs/transcript.jsonl`, whose last step is
 *   a `SYSTEM_MESSAGE` while a wake is dequeued and not yet answered.
 *
 * Every read is bounded, follows no link, and proves nothing when it fails: an
 * unreadable record holds no turn open.
 */
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

const NATIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MESSAGE_FILES = 256;
/** Records or messages listed at most in one directory; of those, the bounds below are read. */
const MAX_RECORDS = 4096;
const MAX_CHILDREN = 64;
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const HIGH_PRIORITY = 'MESSAGE_PRIORITY_HIGH';
const LOW_PRIORITY = 'MESSAGE_PRIORITY_LOW';
/** The tools whose children outlive their call. */
const LAUNCHERS = new Set(['invoke_subagent', 'swarm']);

export interface DetachedWork {
  /** Children one of the given tool calls launched, reported or not. */
  launched: number;
  /** Of those, the ones still working: no report, not killed, not parked. */
  atWork: number;
}

type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * `segments` below `root`, each one a real directory and the last of the kind
 * asked, none a link. Undefined otherwise.
 */
async function managed(root: string, segments: string[], kind: 'file' | 'directory'): Promise<{ path: string; size: number } | undefined> {
  let current = root;
  let size = 0;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => undefined);
    const last = index === segments.length - 1;
    if (info === undefined || info.isSymbolicLink() || (last && kind === 'file' ? !info.isFile() : !info.isDirectory())) return undefined;
    size = info.size;
  }
  return (await realpath(current).catch(() => undefined)) === current ? { path: current, size } : undefined;
}

async function readJson(root: string, segments: string[]): Promise<unknown> {
  const file = await managed(root, segments, 'file');
  if (file === undefined || file.size > MAX_FILE_BYTES) return undefined;
  const raw = await readFile(file.path, 'utf8').catch(() => undefined);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

const generated = (conversation: string, ...rest: string[]): string[] => ['antigravity-acp', 'brain', conversation, '.system_generated', ...rest];

interface InboxMessage {
  name: string;
  body: Json;
}

/**
 * `names` in `directory`, the `count` newest by modification time, or the
 * oldest when `newest` is false.
 */
async function byAge(directory: string, names: string[], count: number, newest: boolean): Promise<string[]> {
  if (names.length <= count) return names;
  const dated = await Promise.all(names.map(async (name) => ({ name, at: (await lstat(join(directory, name)).catch(() => undefined))?.mtimeMs ?? 0 })));
  return dated.sort((a, b) => newest ? b.at - a.at : a.at - b.at).slice(0, count).map((entry) => entry.name);
}

/**
 * A conversation's inbox, `read.json` aside: the newest messages within the
 * bound, or the oldest for `newest` false. Null on a message it cannot read.
 */
async function readInbox(root: string, conversation: string, newest = true): Promise<InboxMessage[] | null> {
  const directory = generated(conversation, 'messages');
  const inbox = await managed(root, directory, 'directory');
  if (inbox === undefined) return [];
  const listed = (await readdir(inbox.path).catch(() => null))?.filter((name) => name.endsWith('.json') && name !== 'read.json');
  if (listed === undefined || listed.length > MAX_RECORDS) return null;
  const names = await byAge(inbox.path, listed, MAX_MESSAGE_FILES, newest);
  const messages: InboxMessage[] = [];
  for (const name of names) {
    const body = object(await readJson(root, [...directory, name]));
    if (body === null) return null;
    messages.push({ name, body });
  }
  return messages;
}

/** The call that launched a child, when its parent sent it with one of the launchers. */
function launchOf(message: Json, parent: string): string | undefined {
  if (message['sender'] !== parent) return undefined;
  const tool = object(object(message['sourceMetadata'])?.['tool']);
  const call = object(tool?.['toolCall']);
  const conversation = tool?.['conversationId'];
  if (call === null || (conversation !== undefined && conversation !== parent)) return undefined;
  const name = text(call['name']);
  return name !== undefined && LAUNCHERS.has(name) ? text(call['id']) : undefined;
}

/** Swarm workers that will not report on their own: killed, or parked until a message mentions them. */
async function silentWorkers(root: string, session: string): Promise<Set<string>> {
  const members = object(object(await readJson(root, generated(session, 'swarm', 'members.json')))?.['members']);
  const silent = new Set<string>();
  for (const value of Object.values(members ?? {})) {
    const member = object(value);
    const conversation = text(member?.['conversation_id']);
    if (member === null || conversation === undefined) continue;
    const killed = member['desired_state'] === 'KILLED' || member['phase'] === 'KILLED';
    const parked = member['wake_mode'] === 'mentions' || member['wake_mode'] === 'anything';
    if (killed || parked) silent.add(conversation);
  }
  return silent;
}

/** The children `session` launched with one of `launches`, and how many still work. */
export async function readDetachedWork(home: string, session: string, launches: ReadonlySet<string>): Promise<DetachedWork> {
  const none = { launched: 0, atWork: 0 };
  if (!NATIVE_ID.test(session) || launches.size === 0) return none;
  const root = await realpath(home).catch(() => undefined);
  if (root === undefined) return none;
  const records = await managed(root, generated(session, 'subagents'), 'directory');
  if (records === undefined) return none;
  const names = (await readdir(records.path).catch(() => [])).filter((name) => name.endsWith('.json') && NATIVE_ID.test(name.slice(0, -5)));
  if (names.length === 0 || names.length > MAX_RECORDS) return none;
  // The session's older children stay on disk; the turn's own are the newest,
  // and so are their reports in the session's inbox.
  const children = (await byAge(records.path, names, MAX_CHILDREN, true)).map((name) => name.slice(0, -5));
  const parentInbox = await readInbox(root, session);
  if (parentInbox === null) return none;
  const reported = new Set(parentInbox.map((message) => message.body['sender']));
  const silent = await silentWorkers(root, session);
  let launched = 0;
  let atWork = 0;
  for (const child of children) {
    // The launching call is the first message a child receives.
    const inbox = await readInbox(root, child, false);
    if (inbox === null || !inbox.some((message) => launches.has(launchOf(message.body, session) ?? ''))) continue;
    launched += 1;
    if (reported.has(child) || silent.has(child)) continue;
    // `manage_subagents` kill only marks the record: a killed child never reports.
    const record = object(await readJson(root, generated(session, 'subagents', `${child}.json`)));
    if (record === null || record['state'] === 'SUBAGENT_STATE_KILLED') continue;
    atWork += 1;
  }
  return { launched, atWork };
}

/**
 * True while the agent owes `session` a reply it has not started: a report it
 * wakes on still unread in the inbox, or one it dequeued, the transcript's last
 * step, with no answer after it. False when the records prove neither.
 */
export async function readPendingReply(home: string, session: string): Promise<boolean> {
  if (!NATIVE_ID.test(session)) return false;
  const root = await realpath(home).catch(() => undefined);
  if (root === undefined) return false;
  const inbox = await readInbox(root, session);
  if (inbox !== null && inbox.length > 0) {
    const receipts = await readReceipts(root, session);
    const unread = receipts !== null && inbox.some(({ name, body }) => {
      const id = text(body['id']);
      return receipts[name.slice(0, -5)] !== true && (id === undefined || receipts[id] !== true) && body['priority'] === HIGH_PRIORITY;
    });
    if (unread) return true;
  }
  const last = await lastTranscriptStep(root, session);
  if (last === null || last['type'] !== 'SYSTEM_MESSAGE') return false;
  const content = text(last['content']);
  return content === undefined || content.includes(`priority=${HIGH_PRIORITY}`) || !content.includes(`priority=${LOW_PRIORITY}`);
}

/** The inbox's read receipts: none while `read.json` is absent, null when it cannot be read. */
async function readReceipts(root: string, session: string): Promise<Json | null> {
  const path = generated(session, 'messages', 'read.json');
  const receipts = await readJson(root, path);
  if (receipts !== undefined) return object(receipts);
  return (await lstat(join(root, ...path)).catch(() => undefined)) === undefined ? {} : null;
}

async function lastTranscriptStep(root: string, session: string): Promise<Json | null> {
  const file = await managed(root, generated(session, 'logs', 'transcript.jsonl'), 'file');
  if (file === undefined || file.size === 0) return null;
  const handle = await open(file.path, 'r').catch(() => null);
  if (handle === null) return null;
  try {
    const start = Math.max(0, file.size - TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(file.size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8', 0, bytesRead).split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    // A tail that starts mid-file starts mid-line: its first line is no step.
    const last = lines.at(-1);
    if (last === undefined || (start > 0 && lines.length < 2)) return null;
    try {
      return object(JSON.parse(last));
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}
