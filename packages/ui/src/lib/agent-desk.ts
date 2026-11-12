import { formatLocale } from './i18n.svelte';
import type { AgentWatch, Message, MessagePart, Thread } from '@boite/contracts';

/**
 * What the desk (the right panel's `desk` surface of a persistent agent's
 * thread) and the bot's column read: how each thread on it stands, which are
 * still in hand and which are done, what the running turn has done so far, and
 * the notes its memory holds.
 */

/** A desk card's state, the one its chip says: what the user most needs to know about that thread. */
export type DeskState = 'needs-you' | 'stalled' | 'failed' | 'working' | 'queued' | 'merged' | 'review' | 'done' | 'idle' | 'archived';

/**
 * The chip a desk card shows, first match wins: a question for the user, a
 * turn gone silent, a failure, then work under way, then where its pull
 * request stands, then how the thread rests.
 */
export function deskState(watch: Pick<AgentWatch, 'state' | 'stalledSince' | 'pullRequest'>): DeskState {
  if (watch.state === 'needs-you') return 'needs-you';
  if (watch.stalledSince !== null && (watch.state === 'working' || watch.state === 'queued')) return 'stalled';
  if (watch.state === 'failed') return 'failed';
  if (watch.state === 'working' || watch.state === 'queued') return watch.state;
  if (watch.pullRequest?.state === 'merged') return 'merged';
  if (watch.pullRequest && (watch.pullRequest.state === 'open' || watch.pullRequest.state === 'draft')) return 'review';
  return watch.state === 'archived' ? 'archived' : watch.state === 'done' ? 'done' : 'idle';
}

/**
 * The colour a state takes, from the app's status tokens: live for what waits
 * on someone, danger for what broke, success for what landed (a merged pull
 * request included), the accent only for work under way, as the thread
 * list's running mark.
 */
export function deskTone(state: DeskState): 'accent' | 'live' | 'danger' | 'success' | 'muted' {
  if (state === 'needs-you' || state === 'stalled' || state === 'review') return 'live';
  if (state === 'failed') return 'danger';
  if (state === 'working' || state === 'queued') return 'accent';
  if (state === 'done' || state === 'merged') return 'success';
  return 'muted';
}

/** Cards that need the user first, then the ones at work, then the rest by their last activity. */
export function deskOrder(watches: readonly AgentWatch[]): AgentWatch[] {
  const rank: Record<DeskState, number> = { 'needs-you': 0, stalled: 1, failed: 2, working: 3, queued: 3, review: 4, merged: 5, idle: 6, done: 7, archived: 8 };
  return [...watches].sort((a, b) => rank[deskState(a)] - rank[deskState(b)] || b.lastActivityAt - a.lastActivityAt);
}

export type ToolStep = Extract<MessagePart, { type: 'tool' }>;

/** The calls a turn made so far, oldest first: what the desk's Now lists live. */
export function turnSteps(messages: readonly Message[], turnId: string): ToolStep[] {
  const steps: ToolStep[] = [];
  for (const message of messages) {
    if (message.turnId !== turnId || message.role !== 'assistant') continue;
    for (const part of message.parts) if (part.type === 'tool') steps.push(part);
  }
  return steps;
}

/** The turn running on a thread, when one is. */
export function runningTurn(thread: Pick<Thread, 'turns'> | null | undefined) {
  return thread?.turns.findLast(turn => turn.status === 'running') ?? null;
}

/** A thread the bot is done with: merged, finished or archived. The rest it still handles. */
export function deskDone(watch: Pick<AgentWatch, 'state' | 'stalledSince' | 'pullRequest'>): boolean {
  const state = deskState(watch);
  return state === 'merged' || state === 'done' || state === 'archived';
}

/** The desk in the column's two sections, each in the desk's order. */
export function splitDesk(watches: readonly AgentWatch[]): { handling: AgentWatch[]; done: AgentWatch[] } {
  const ordered = deskOrder(watches);
  return { handling: ordered.filter(watch => !deskDone(watch)), done: ordered.filter(deskDone) };
}

/**
 * The notes of a MEMORY.md, as plain lines: its list items when it has any,
 * else its paragraphs. Headings, rules and empty lines are not notes; inline
 * marks (bold, code, links) are read as their words.
 */
export function memoryNotes(text: string): string[] {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const items = lines.filter(line => /^([-*+]|\d+[.)])\s+/.test(line)).map(line => line.replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''));
  const notes = items.length ? items : lines.filter(line => line && !/^(#{1,6}\s|[-*_]{3,}$|```|>)/.test(line));
  return notes.map(plain).filter(Boolean);
}

function plain(line: string): string {
  return line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|\*|`)(.+?)\1/g, '$2').replace(/(^|\W)_([^_]+?)_(?!\w)/g, '$1$2').trim();
}

/** `12 Oct`, or `12 Oct 2025` in another year: the day a bot was made, on its desk. */
export function calendarDay(at: number, now = Date.now()): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(formatLocale(), sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
}
