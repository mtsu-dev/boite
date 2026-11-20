import type { MemoryEvent, Message, Thread } from '@boite/contracts';
import { failureKind } from './failed-attempts';
import { TimelineRows, type TimelineRow } from './timeline-rows';
import type { Placement } from './store/message-positions.svelte';

function builder(): TimelineRows {
  return new TimelineRows(read => {
    const value = $derived.by(read);
    return () => value;
  });
}

type Input = {
  timeline: readonly Message[];
  memory?: ReadonlyMap<string, MemoryEvent[]> | undefined;
  breaks?: ReadonlyMap<string, unknown> | undefined;
};

const LIVE_MESSAGES = 32;

/** Keep the reactive row projection of the reading window apart from its live end. */
export class ReactiveTimelineRows {
  readonly #history = builder();
  readonly #live = builder();
  readonly #input: () => Input;
  #rows: TimelineRow[] = [];
  #before: TimelineRow[] = [];
  #after: TimelineRow[] = [];
  order = '';
  changedFrom = 0;

  #boundary = $derived.by(() => {
    const timeline = this.#input().timeline;
    // Neither a wake nor an error can cross the split. A long, unbroken
    // failure run stays together, even if it fills the entire window.
    let at = Math.max(0, timeline.length - LIVE_MESSAGES);
    while (at > 0 && failureKind(timeline[at]!)) at--;
    return at;
  });

  #prefix = $derived.by(() => this.#input().timeline.slice(0, this.#boundary));
  #suffix = $derived.by(() => this.#input().timeline.slice(this.#boundary));
  #historyRows = $derived.by(() => this.#history.build(this.#prefix, this.#input().memory, this.#input().breaks));
  #liveRows = $derived.by(() => this.#live.build(this.#suffix, this.#input().memory, this.#input().breaks));

  constructor(input: () => Input) {
    const value = $derived.by(input);
    this.#input = () => value;
  }

  get hasRows(): boolean { return this.#rows.length > 0; }

  build(): TimelineRow[] {
    const before = this.#historyRows, after = this.#liveRows;
    if (before === this.#before && after === this.#after) {
      this.changedFrom = this.#rows.length;
      return this.#rows;
    }
    this.changedFrom = before !== this.#before ? this.#history.changedFrom : before.length + this.#live.changedFrom;
    this.#before = before;
    this.#after = after;
    this.order = before.length && after.length ? `${this.#history.order}\0${this.#live.order}` : this.#history.order || this.#live.order;
    return this.#rows = before.concat(after);
  }
}

class ThreadTimeline {
  readonly #placement;
  readonly rows: ReactiveTimelineRows;

  constructor(thread: Thread, readPlacement: () => Placement) {
    this.#placement = $derived.by(readPlacement);
    let previous: ReadonlyMap<string, unknown> | undefined;
    const breaks = $derived.by(() => {
      const next = this.#placement.gaps;
      const known = previous;
      if (known && known.size === next.size && [...next.keys()].every(id => known.has(id))) return known;
      return previous = next.size ? next : undefined;
    });
    this.rows = new ReactiveTimelineRows(() => ({ timeline: thread.messages, breaks }));
  }

  get placement(): Placement { return this.#placement; }
}

/** A held page owns its row projection and message placement. */
export class ThreadTimelineRows {
  readonly #entries = new WeakMap<Thread, ThreadTimeline>();

  constructor(private readonly placementOf: (thread: Thread) => Placement) {}

  prepare(thread: Thread): void {
    if (!this.#entries.has(thread)) this.#entries.set(thread, new ThreadTimeline(thread, () => this.placementOf(thread)));
  }

  get(thread: Thread): ThreadTimeline | undefined { return this.#entries.get(thread); }
}
