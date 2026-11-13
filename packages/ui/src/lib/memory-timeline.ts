import type { MemoryEvent, MessagePart } from '@boite/contracts';
import { partRuns, runKey, type PartRun } from './tool-groups';

type MemoryRun = { kind: 'memory'; key: string; events: MemoryEvent[] };

/** What a notice card says: the kind, a stop's reason and the limit it crossed. */
function noticeKey(event: MemoryEvent): string {
  if (event.kind === 'killed') return `killed:${event.reason}:${event.limitBytes}`;
  return event.kind === 'throttled' ? `throttled:${event.limitBytes}` : event.kind;
}

/** Back-to-back notices that would read the same become one card, whatever time passed between them. */
export const sameNotice = (before: MemoryEvent | undefined, event: MemoryEvent): boolean =>
  before !== undefined && noticeKey(before) === noticeKey(event);

/**
 * Break folded activity runs at notice boundaries so later calls cannot cover them.
 * `from` and `to` name the parts one row of a cut message draws (`timeline-rows.ts`):
 * its runs keep the indices they have in the whole message, and a notice shows in
 * the row that holds its part, the last row for one anchored at the message's end.
 */
export function memoryPartRuns(parts: MessagePart[], events: MemoryEvent[], from = 0, to = parts.length, groupChanges = false): (PartRun | MemoryRun)[] {
  if (!events.length) return partRuns(parts, from, to, groupChanges);
  const boundaries = new Map<number, MemoryEvent[]>();
  for (const event of events) {
    const index = Math.max(0, Math.min(event.anchor?.partIndex ?? parts.length, parts.length));
    if (index < from || (index >= to && to < parts.length)) continue;
    boundaries.set(index, [...(boundaries.get(index) ?? []), event]);
  }
  if (boundaries.size === 0) return partRuns(parts, from, to, groupChanges);
  const runs: (PartRun | MemoryRun)[] = [];
  let start = from;
  for (const [end, notices] of [...boundaries].sort((a, b) => a[0] - b[0])) {
    runs.push(...partRuns(parts, start, end, groupChanges));
    for (const [index, event] of notices.entries()) {
      const previous = runs.at(-1);
      if (previous?.kind === 'memory' && sameNotice(previous.events.at(-1), event)) previous.events.push(event);
      else runs.push({ kind: 'memory', key: `memory-${end}-${index}`, events: [event] });
    }
    start = end;
  }
  runs.push(...partRuns(parts, start, to, groupChanges));
  return runs;
}

type MessageRun = PartRun | MemoryRun;

function sameRun(before: MessageRun, run: MessageRun): boolean {
  if (run.kind === 'part') return before.kind === 'part' && before.index === run.index;
  if (run.kind === 'activity') return before.kind === 'activity' && before.indices.length === run.indices.length && before.indices.every((at, index) => at === run.indices[index]);
  return before.kind === 'memory' && before.events.length === run.events.length && before.events.every((event, index) => event === run.events[index]);
}

/**
 * memoryPartRuns for one row that keeps what it built, as `TimelineRows` does:
 * a run over the same parts comes back as the same object, and the same array
 * while every run is the same. A part arriving at the end then hands no new
 * `parts` to the groups above it.
 */
export class MessageRuns {
  #runs: MessageRun[] = [];

  build(parts: MessagePart[], events: MemoryEvent[], from = 0, to = parts.length, groupChanges = false): MessageRun[] {
    const known = new Map(this.#runs.map(run => [run.kind === 'memory' ? run.key : runKey(run), run]));
    let same = true;
    const runs = memoryPartRuns(parts, events, from, to, groupChanges).map((run, index) => {
      const before = known.get(run.kind === 'memory' ? run.key : runKey(run));
      const kept = before && sameRun(before, run) ? before : run;
      if (kept !== this.#runs[index]) same = false;
      return kept;
    });
    if (same && runs.length === this.#runs.length) return this.#runs;
    this.#runs = runs;
    return runs;
  }
}
