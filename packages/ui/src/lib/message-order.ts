import { queueOrder, type Message, type Turn } from '@boite/contracts';
import { viewPart } from './inline-view';

/**
 * Files an agent publishes with `boite attach` land in the journal when it
 * runs the command, often in the middle of its answer. Once the turn ends the
 * chat draws them after everything else the turn wrote, so a capture is where
 * the reader stops instead of somewhere up the answer. A turn still running
 * shows them where they came, so a file is visible as soon as it is sent.
 */

/** A message `artifacts.publish` wrote: an assistant message that is one file and nothing else. */
export function publishedFile(message: Message): boolean {
  if (message.role !== 'assistant') return false;
  const part = message.parts[0];
  return (part?.type === 'file' || (part?.type === 'artifact' && !part.view)) && message.parts.length === 1;
}

/** The first message of each turn: on a wake turn, the prompt it opened with. A line Boite adds to that turn later is not a second wake. */
export function firstByTurn(messages: readonly Message[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const message of messages) if (!first.has(message.turnId)) first.set(message.turnId, message.id);
  return first;
}

/** One model attribution per turn; views and published files draw after the answer. */
export function firstAssistantByTurn(messages: readonly Message[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'assistant' && !result.has(message.turnId) && !viewPart(message) && !publishedFile(message)) result.set(message.turnId, message.id);
  }
  return result;
}

/** Only indexes and ids, so a retained reading position never owns message bodies. */
export function readingOrder(messages: readonly Message[]) {
  return { files: filePlacements(messages), first: firstByTurn(messages), assistants: firstAssistantByTurn(messages) };
}

/** The last ordinary message to place each published file after. */
function filePlacements(timeline: readonly Message[]): ReadonlyMap<number, number> {
  const files = new Map<number, string>();
  const lastOther = new Map<string, number>();
  timeline.forEach((message, index) => {
    if (publishedFile(message)) files.set(index, message.turnId);
    else if (!viewPart(message)) lastOther.set(message.turnId, index);
  });
  const placements = new Map<number, number>();
  for (const [file, turn] of files) {
    const after = lastOther.get(turn);
    if (after !== undefined && after > file) placements.set(file, after);
  }
  return placements;
}

/**
 * `timeline` with each finished turn's published files moved after its last
 * other message, in the order they were published. Views are left for
 * `ViewPlacement`, which puts them after the files. A turn with nothing else
 * here keeps its place. The same array comes back when nothing moves.
 */
export function filesLast(timeline: Message[], turns: readonly Pick<Turn, 'id' | 'status'>[], placements = filePlacements(timeline)): Message[] {
  if (placements.size === 0) return timeline;
  const live = new Set(turns.filter((turn) => turn.status === 'running' || turn.status === 'queued').map((turn) => turn.id));
  const held = new Map<number, Message[]>();
  const moved = new Set<number>();
  for (const [file, after] of placements) {
    const message = timeline[file]!;
    if (live.has(message.turnId)) continue;
    const list = held.get(after);
    if (list) list.push(message);
    else held.set(after, [message]);
    moved.add(file);
  }
  if (moved.size === 0) return timeline;
  const placed: Message[] = [];
  timeline.forEach((message, index) => {
    if (moved.has(index)) return;
    placed.push(message);
    const files = held.get(index);
    if (files) placed.push(...files);
  });
  return placed;
}

const pinging = (turn: Pick<Turn, 'execution'> | undefined) => turn?.execution?.operation === 'keepalive';
type Pinged = Pick<Turn, 'id' | 'queuedAt' | 'execution'>;
/** The turns in the order they were queued, whatever order a store merge left them in. */
const queued = (turns: readonly Pinged[]) => [...turns].sort(queueOrder);

/**
 * `timeline` with each of Boite's cache pings as one line: its opening
 * message stands for it and its one-word answer is left out. A ping followed
 * by another one leaves the line to the last of them, which
 * `keepaliveRun` counts. The same array comes back when there is no ping.
 */
export function quietKeepalives(timeline: Message[], turns: readonly Pinged[]): Message[] {
  if (!turns.some(pinging)) return timeline;
  const merged = new Set<string>(), pings = new Set<string>();
  queued(turns).forEach((turn, index, ordered) => {
    if (!pinging(turn)) return;
    pings.add(turn.id);
    if (pinging(ordered[index + 1])) merged.add(turn.id);
  });
  return timeline.filter((message) => !pings.has(message.turnId) || (message.role === 'system' && !merged.has(message.turnId)));
}

/** How many pings in a row end with this one: the count its line says. */
export function keepaliveRun(turns: readonly Pinged[], turnId: string): number {
  const ordered = queued(turns);
  let index = ordered.findIndex((turn) => turn.id === turnId), count = 0;
  while (index >= 0 && pinging(ordered[index])) { count += 1; index -= 1; }
  return Math.max(count, 1);
}
