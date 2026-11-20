import type { MessageId, MessagePart, ProjectId, RpcParams, Thread, ThreadId, ThreadLoad, ThreadProgress, ThreadSummary } from '@boite/contracts';
import { resumeAnchor } from '@boite/contracts';
import { sameValue } from './plain-data';
export { resumeAnchor, workingChildren, type WorkingChildren } from '@boite/contracts';

/** Same value: primitives by identity, the small objects of a summary (load, context, cache) by content. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Writes onto a held sidebar row only the fields that changed. The rows live in
 * a deep `$state` array, so a load tick then signals `row.load` alone: the
 * project lists, which read ids, projects and flags, do not run again.
 */
/** A `thread.load` on one held copy of the row: written only when it moved, so an unchanged sample re-renders nothing. */
export function patchLoad(row: Pick<ThreadSummary, 'load'>, load: ThreadLoad): void {
  if (!same(row.load, load)) row.load = load;
}

export function patchProgress(row: ThreadSummary, progress: ThreadProgress): boolean {
  if ((row.status !== 'running' && row.status !== 'waiting') || row.progress?.turnId !== progress.turnId
    || (row.progress.providerAt ?? row.progress.at) > (progress.providerAt ?? progress.at)) return false;
  if (!same(row.progress, progress)) row.progress = progress;
  return true;
}

export function patchRow(row: ThreadSummary, next: ThreadSummary): void {
  const target = row as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) if (!(key in next)) delete target[key];
  patchFields(row, next);
}

/**
 * `Object.assign` of a summary over a held thread, without the writes that
 * change nothing. The open thread is a deep `$state` proxy: assigning a load
 * tick whole gave `load`, the usage and the context new proxies each second,
 * and every reaction reading them ran again. Nothing is deleted, since a
 * thread holds messages, turns and pages a summary does not carry.
 */
export function patchFields<T extends object>(held: T, next: Partial<T>): T {
  const target = held as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) if (!same(target[key], value)) target[key] = value;
  return held;
}

/**
 * A fresh `threads.list` over the rows already held: a row the list still has
 * keeps its identity, patched, so a reconnect re-renders only the rows that
 * changed. The list's order wins and a row it no longer has is gone.
 */
export function reconcileRows(held: readonly ThreadSummary[], fresh: ThreadSummary[]): ThreadSummary[] {
  const byId = new Map(held.map((row) => [row.id, row]));
  return fresh.map((next) => {
    const row = byId.get(next.id);
    if (!row) return next;
    patchRow(row, next);
    return row;
  });
}

/** Project conversations include work delegated by a bot; ordinary helpers stay under their parent. */
export function projectThread(thread: ThreadSummary, parent?: ThreadSummary): boolean {
  return thread.projectId !== null && !thread.agentSessionId && (!thread.parentThreadId || thread.parentIsBot === true || !!parent?.agentSessionId);
}

/** The live project conversations, indexed once per change of the rows. */
export function threadsByProject(threads: readonly ThreadSummary[]): Map<ProjectId, ThreadSummary[]> {
  const groups = new Map<ProjectId, ThreadSummary[]>();
  const bots = new Map(threads.filter(thread => thread.agentSessionId).map(thread => [thread.id, thread]));
  for (const thread of threads) {
    // An incognito conversation stays off the lists: it lives on its own screen only.
    if (thread.archived || thread.incognito || !projectThread(thread, bots.get(thread.parentThreadId ?? ''))) continue;
    const group = groups.get(thread.projectId!);
    if (group) group.push(thread);
    else groups.set(thread.projectId!, [thread]);
  }
  return groups;
}

/**
 * The index of the item with that id, searched from the end. What a stream
 * writes to is the newest message or turn, so this stops at once where a
 * forward `find` crossed the whole loaded timeline on every delta.
 */
export function lastIndexById<T extends { id: string }>(items: readonly T[], id: string): number {
  for (let index = items.length - 1; index >= 0; index--) if (items[index]!.id === id) return index;
  return -1;
}

/**
 * Puts `part` at `index` of a message this client holds. An event can name a
 * part past the end of the copy: a copy painted from an earlier visit or the
 * device's snapshot while its page is still on the way, or a socket that
 * dropped deltas under backpressure and resends their part once it drains.
 * The slots in between become empty text, the way the core opens every text
 * part, until the page or the resent part fills them: a sparse `parts` throws
 * in every reader, and a throw in a render effect leaves the rest of the
 * screen, the composer's chips included, on the thread shown before.
 */
export function placePart(parts: MessagePart[], index: number, part: MessagePart): void {
  while (parts.length < index) parts.push({ type: 'text', text: '' });
  parts[index] = part;
}

/** The `threads.get` parameters for a thread, from its resume anchor when part of it is held. */
export function resumeRequest(threadId: ThreadId, held: Pick<Thread, 'messages' | 'turns'> | undefined): { threadId: ThreadId; after?: MessageId } {
  const after = held ? resumeAnchor(held) : null;
  return after === null ? { threadId } : { threadId, after };
}

/** A core with prefix proofs can reuse the window it proved. An open can re-read pages above it. */
export function snapshotResume(threadId: ThreadId, held: Thread | undefined, prefixProofs: boolean, paged = false): Pick<RpcParams<'threads.get'>, 'threadId' | 'after' | 'sync'> {
  const recorded = held?.messagesSync;
  if (prefixProofs && !recorded?.prefix) return { threadId, sync: true };
  const resume = resumeRequest(threadId, held);
  const proof = recorded?.from === resume.after ? recorded : undefined;
  if (prefixProofs) {
    if (!held || !proof?.prefix) return { threadId, sync: true };
    const first = proof.prefix.first === held.messages[0]?.id ? 0 : paged ? lastIndexById(held.messages, proof.prefix.first) : -1;
    if (first < 0 || held.messages[first + proof.prefix.count]?.id !== resume.after) return { threadId, sync: true };
  }
  return { ...resume, sync: proof ?? true };
}

/** The row part of a thread, without what only an open thread carries. */
export function summaryOf(thread: Thread): ThreadSummary {
  const { memoryEvents: _memoryEvents, messages: _messages, turns: _turns, commands: _commands, background: _background, backgroundHistory: _history, activity: _activity, messagesBefore: _before, messagesAfter: _after, messagesFrom: _from, messagesSync: _sync, messagesUnchanged: _unchanged, messageOffset: _offset, ...summary } = thread;
  return summary;
}

/** A panel key of the machine `machineId`: prefixed with its id, or bare on a store that has none. */
export function ownsPanelKey(machineId: string, key: string): boolean {
  if (!machineId) return !key.startsWith('[');
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && parsed[0] === machineId;
  } catch {
    return false;
  }
}

/**
 * The layouts a fresh `threads.list` leaves behind: this machine's, of threads
 * it no longer lists. The thread on screen is never one of them: archived from
 * another client, it stays open here, and goes when this client leaves it.
 */
export function unlistedPanels(machineId: string, listed: ReadonlySet<string>, openKey: string | null): (key: string) => boolean {
  return (key) => key !== openKey && !listed.has(key) && ownsPanelKey(machineId, key);
}

/**
 * A `threads.get` answer that starts at `messagesFrom`, laid over the window
 * already held: what came before that message stays, the rest is the core's.
 */
export function mergeResumed(held: Thread, fetched: Thread): void {
  if (fetched.messagesFrom === undefined) return;
  if (fetched.messagesUnchanged) fetched.messages = held.messages;
  else {
    const fresh = new Set(fetched.messages.map((message) => message.id));
    const from = held.messages.findIndex((message) => message.id === fetched.messagesFrom);
    const kept = held.messages.slice(0, from === -1 ? held.messages.length : from).filter((message) => !fresh.has(message.id));
    fetched.messages = [...kept, ...fetched.messages];
  }
  const turnStart = held.turns.length - fetched.turns.length;
  if (turnStart >= 0 && fetched.turns.every((turn, index) => sameValue(held.turns[turnStart + index], turn))) {
    fetched.turns = held.turns;
  } else {
    const freshTurns = new Set(fetched.turns.map((turn) => turn.id));
    fetched.turns = [...held.turns.filter((turn) => !freshTurns.has(turn.id)), ...fetched.turns];
  }
  fetched.messagesBefore = held.messagesBefore;
  delete fetched.messagesFrom;
  delete fetched.messagesUnchanged;
}

/** A verified resume already owns its arrays. An unproved page can reuse its
 * equal prefix without constructing an id map or writing unchanged entries. */
function reconcilePage<T extends { id: string }>(held: T[], fresh: T[]): T[] {
  if (held === fresh) return held;
  let first = 0;
  while (first < held.length && first < fresh.length && sameValue(held[first], fresh[first])) first++;
  if (first === fresh.length && first === held.length) return held;
  const byId = new Map(held.slice(first).map(item => [item.id, item]));
  return [...held.slice(0, first), ...fresh.slice(first).map(item => {
    const previous = byId.get(item.id);
    return previous && sameValue(previous, item) ? previous : item;
  })];
}

/** Keep unchanged messages and turns; a preview cannot certify a previously loaded suffix. */
export function reconcileThread(held: Thread, fresh: Thread): Thread {
  fresh.messages = reconcilePage(held.messages, fresh.messages);
  fresh.turns = reconcilePage(held.turns, fresh.turns);
  if (fresh.messagesSync === undefined) delete held.messagesSync;
  Object.assign(held, fresh);
  return held;
}
