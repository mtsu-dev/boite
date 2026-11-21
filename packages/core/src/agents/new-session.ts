import { AGENT_HANDOFF_MAX, type AgentProfile, type Message, type NewConversationNotice, type RpcResult, type ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { HISTORY_START_PREFIX, type HistoryStart } from '../continuation.ts';
import { refused } from '../errors.ts';
import { newId } from '../ids.ts';
import { saveThread } from '../threads/records.ts';
import { quoted } from './validation.ts';

/**
 * A mochi's new conversation (`agents.session.new`, `boite mochi new-session`):
 * its thread stays, with its memory, routines, desk, settings, teams and the
 * history the user sees, but its next turn opens a fresh provider session that
 * carries none of the earlier messages. It is the same step a compaction swap,
 * an account switch or a move takes (a new session generation, no session id),
 * with a marker in the thread where the new conversation starts
 * (`HISTORY_START_PREFIX`), which `continuationInput` never reads past.
 *
 * Never in the middle of a turn: asked while one runs, even by the mochi in its
 * own turn, the request waits in the journal and the turn runner applies it
 * once that turn's end is written, before any wake or held answer starts the
 * next (`applyWaiting`). The handoff note goes once, in the context block of
 * the first turn that ends on the new session (`handoffFor`, `handoffEnded`).
 */

/** The request waiting for the thread's turn to end, by thread. */
const WAITING = 'agents:new-session:';
/** The handoff note waiting for the new conversation's first turn, by thread. */
export const HANDOFF_PREFIX = 'agents:handoff:';
/**
 * How soon after a new conversation it started a mochi may start another:
 * a mochi asking on every wake would otherwise never keep a session. The user
 * may start one at any time.
 */
export const MOCHI_NEW_SESSION_GAP_MS = 30 * 60_000;
/** The marker's text: what any client that does not draw `newConversation` shows. */
export const NEW_CONVERSATION_TEXT = 'New conversation: the next turn starts a fresh session without the messages above. Memory, routines and desk are kept.';

type By = NewConversationNotice['by'];
interface Waiting { by: By; note: string | null; at: number }
interface Started extends HistoryStart { by: By }
interface Handoff { by: By; note: string | null; turnId: string | null }

export class AgentNewSessions {
  constructor(private readonly core: Core) {}

  request(agent: AgentProfile, threadId: string, by: By, note: string | null): RpcResult<'agents.session.new'> {
    const thread = this.core.threads.require(threadId);
    if (note !== null && note.length > AGENT_HANDOFF_MAX) {
      throw refused(`agents.session.new.note: expected at most ${AGENT_HANDOFF_MAX} characters, got ${note.length}`, { field: 'note', expected: `1 to ${AGENT_HANDOFF_MAX} characters` });
    }
    if (by === 'mochi') {
      const last = this.core.journal.getSetting(`${HISTORY_START_PREFIX}${threadId}`) as Started | undefined;
      const since = last === undefined ? Infinity : Date.now() - last.at;
      if (last?.by === 'mochi' && since < MOCHI_NEW_SESSION_GAP_MS) {
        const minutes = Math.ceil((MOCHI_NEW_SESSION_GAP_MS - since) / 60_000);
        throw refused(`agents.session.new: you started a new conversation ${Math.floor(since / 60_000)} minutes ago; a mochi may start another ${MOCHI_NEW_SESSION_GAP_MS / 60_000} minutes after the last, in ${minutes} minutes, or the user may start one now`, { threadId, reason: 'too-soon' });
      }
    }
    const waiting: Waiting = { by, note, at: Date.now() };
    if (this.core.threads.isBusy(threadId)) {
      // A second request in the same turn takes the place of the first, note included.
      this.core.journal.setSetting(`${WAITING}${threadId}`, waiting);
      return { agentId: agent.id, threadId, when: 'turn-end' };
    }
    this.#apply(thread, waiting, this.core.journal.lastTurn(threadId)?.id ?? null);
    return { agentId: agent.id, threadId, when: 'done' };
  }

  /** Whether a new conversation waits for the thread's turn to end. */
  pending(threadId: string): boolean {
    return this.core.journal.getSetting(`${WAITING}${threadId}`) !== undefined;
  }

  /**
   * Called by the turn runner once `ended` is settled and everything that
   * reads the session it ended on has run, before the next turn can start.
   */
  applyWaiting(threadId: string, ended: string): void {
    const key = `${WAITING}${threadId}`;
    const waiting = this.core.journal.getSetting(key) as Waiting | undefined;
    if (waiting === undefined || this.core.journal.isClosed()) return;
    this.core.journal.deleteSetting(key);
    const thread = this.core.journal.getThread(threadId);
    if (thread !== null) this.#apply(thread, waiting, ended);
  }

  #apply(thread: ThreadSummary, request: Waiting, closed: string | null): void {
    const core = this.core;
    const threadId = thread.id;
    const now = Date.now();
    const notice: NewConversationNotice = { by: request.by, ...(request.note ? { note: request.note } : {}) };
    // On the turn it closes, as a move's note: the next turn's messages all come after it.
    const message: Message = {
      id: newId('msg_'), threadId, turnId: closed ?? newId('trn_'), role: 'system',
      parts: [{ type: 'text', text: NEW_CONVERSATION_TEXT, newConversation: notice }], state: 'complete', createdAt: now,
    };
    const start: Started = { messageId: message.id, turnId: message.turnId, at: now, by: request.by };
    const next: ThreadSummary = { ...thread, sessionId: null, sessionResumeAt: null, sessionGeneration: (thread.sessionGeneration ?? 0) + 1, context: null, promptCache: null };
    core.journal.append({ type: 'agent.session.new', threadId, version: 1, payload: { messageId: message.id, by: request.by, note: request.note !== null, sessionGeneration: next.sessionGeneration } }, () => {
      core.journal.putMessage(message);
      core.journal.setSetting(`${HISTORY_START_PREFIX}${threadId}`, start);
      core.journal.setSetting(`${HANDOFF_PREFIX}${threadId}`, { by: request.by, note: request.note, turnId: null } satisfies Handoff);
      // Nothing of the conversation left may come back: not a session this account
      // left before, the tail of a compaction or the context block it read.
      for (const prefix of ['account-sessions:', 'compaction-tail:', 'agents:context:']) core.journal.deleteSetting(`${prefix}${threadId}`);
    });
    core.bus.emit('message.started', message);
    core.bus.emit('message.completed', { threadId, messageId: message.id, state: 'complete' });
    // The warm process holds the old session; a turn queued meanwhile took that session too.
    core.threads.autoCompact.cancel(threadId);
    core.threads.cacheKeepalive.cancel(threadId);
    core.threads.releaseAgent(threadId);
    saveThread(core, next, 'thread.updated');
    for (const turn of core.journal.listTurns(threadId)) {
      if (turn.status !== 'queued' || turn.execution === undefined) continue;
      const { sessionResumeAt: _dropped, ...execution } = turn.execution;
      const followed = { ...turn, execution: { ...execution, sessionId: null, sessionGeneration: next.sessionGeneration ?? 0 } };
      core.journal.append({ type: 'turn.sessionNew', threadId, version: 1, payload: followed }, () => core.journal.putTurn(followed));
    }
    core.log('info', `thread ${threadId}: a new conversation starts, asked by the ${request.by}${request.note ? ' with a handoff note' : ''}`, { source: 'agents', threadId });
  }

  /**
   * The handoff line the new conversation's first turn carries after the context
   * block: the note, quoted as data, or just that a new conversation started.
   * Kept until a turn that carried it ends without failing, even when the failed
   * one left a session behind.
   */
  handoffFor(threadId: string, turnId: string): string {
    const key = `${HANDOFF_PREFIX}${threadId}`;
    const handoff = this.core.journal.getSetting(key) as Handoff | undefined;
    if (handoff === undefined) return '';
    this.core.journal.setSetting(key, { ...handoff, turnId });
    const who = handoff.by === 'mochi' ? 'you asked for it' : 'the user asked for it';
    const head = `Boite: this is a new conversation (${who}). Your earlier messages stay in the thread for the user but are not in this session; your memory, routines and desk are as before.`;
    return handoff.note === null
      ? head
      : `${head} Handoff note ${handoff.by === 'mochi' ? 'you wrote' : 'from the user'} for it, sent once: ${quoted(handoff.note)}`;
  }

  /** The note is spent once a turn that carried it ends; a failed turn leaves it for the next. */
  handoffEnded(turn: { id: string; threadId: string; status: string }): void {
    const key = `${HANDOFF_PREFIX}${turn.threadId}`;
    const handoff = this.core.journal.getSetting(key) as Handoff | undefined;
    if (handoff === undefined || handoff.turnId !== turn.id) return;
    if (turn.status === 'error') this.core.journal.setSetting(key, { ...handoff, turnId: null });
    else this.core.journal.deleteSetting(key);
  }
}
