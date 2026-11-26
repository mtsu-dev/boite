import type { Message, MessagePart, Thread, ToolDocument } from '@boite/contracts';
import { whenIdle } from './idle';

/** At most this many bytes of text and image data per kept timeline, counted as UTF-16. */
export const READING_CACHE_BYTES = 4 * 1024 * 1024;
export const READING_CACHE_MESSAGES = 2000;
/** At most this many timelines are kept, and this many bytes of them together. */
export const READING_CACHE_THREADS = 16;
const READING_CACHE_TOTAL = 4 * READING_CACHE_BYTES;
export const READING_CACHE_GLOBAL_BYTES = 24 * 1024 * 1024;

interface ReadingEntry {
  bytes: number;
  preloaded: boolean;
  priority: () => number;
  evict: () => void;
}

const rendererEntries = new Set<ReadingEntry>();
let rendererBytes = 0;

function evictionCandidate(entries: Iterable<ReadingEntry>): ReadingEntry | undefined {
  let candidate: ReadingEntry | undefined;
  let rank = Infinity;
  for (const entry of entries) {
    const priority = entry.priority();
    const next = priority === Infinity ? priority : priority + (entry.preloaded ? 0 : 2);
    if (next < rank) { candidate = entry; rank = next; }
  }
  return candidate;
}

export interface ReadingMark {
  dropped: boolean;
  release(): void;
}

function documentChars(document: ToolDocument): number {
  if (document.kind === 'diff') return document.oldText.length + document.newText.length;
  if (document.kind === 'markdown') return document.text.length;
  return document.data.length;
}

/** The characters a part holds, read from its strings rather than from a JSON copy of it. */
function partChars(part: MessagePart): number {
  switch (part.type) {
    case 'text':
      return part.text.length + (part.displayText?.length ?? 0);
    case 'thinking':
      return part.text.length;
    case 'image':
    case 'file':
      return part.data.length;
    case 'tool': {
      let chars = (part.output?.length ?? 0) + (part.inputText?.length ?? 0) + (JSON.stringify(part.input ?? null)?.length ?? 0);
      for (const document of part.documents ?? []) chars += documentChars(document);
      return chars;
    }
    default:
      return JSON.stringify(part).length;
  }
}

/** The characters a message holds in its parts. */
export function messageChars(message: Message): number {
  let chars = 0;
  for (const part of message.parts) chars += partChars(part);
  return chars;
}

/** Stops at the per-thread bound; cache accounting never serializes whole messages. */
export function readingCacheBytes(messages: readonly Message[]): number {
  if (messages.length > READING_CACHE_MESSAGES) return READING_CACHE_BYTES + 1;
  let chars = 0;
  for (const message of messages) {
    chars += messageChars(message);
    if (chars * 2 > READING_CACHE_BYTES) return READING_CACHE_BYTES + 1;
  }
  return chars * 2;
}

/**
 * The timelines left recently, oldest first, each with the size it was
 * counted at when it came in. Both waiting and prepared visits reserve
 * space, so a busy renderer cannot accumulate pages behind its idle callbacks.
 */
export class ReadingCache {
  readonly #threads = new Map<string, Thread>();
  readonly #pending = new Map<string, { prepare: () => void; cancel: () => void }>();
  readonly #copies = new Map<string, () => void>();
  readonly #entries = new Map<string, ReadingEntry>();
  #total = 0;
  readonly #marks = new Map<string, Set<ReadingMark>>();

  /** `forgotten` hears of a thread whose visit is no longer one to resume from (`forget`). */
  constructor(
    private readonly forgotten?: (id: string) => void,
    private readonly visible: () => boolean = () => true,
    private readonly open: () => string | undefined = () => undefined
  ) {}

  get size(): number { return this.#threads.size; }

  has(id: string): boolean { return this.#threads.has(id) || this.#pending.has(id); }

  get(id: string): Thread | undefined {
    this.#pending.get(id)?.prepare();
    return this.#threads.get(id);
  }

  visited(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.preloaded = false;
    this.#entries.delete(id);
    this.#entries.set(id, entry);
    rendererEntries.delete(entry);
    rendererEntries.add(entry);
  }

  canPrefill(id: string, bytes: number): boolean {
    return !this.has(id) && bytes <= READING_CACHE_BYTES
      && this.#entries.size < READING_CACHE_THREADS && this.#total + bytes <= READING_CACHE_TOTAL
      && rendererBytes + bytes <= READING_CACHE_GLOBAL_BYTES && rendererEntries.size < 4 * READING_CACHE_THREADS;
  }

  /** Prepare a visit after the destination can paint. A quick return can still use the page. */
  defer(thread: Thread, bytes: number, page: (thread: Thread) => Thread, copy: (held: Thread) => Thread, settle: () => boolean): boolean {
    const id = thread.id;
    this.delete(id);
    if (bytes > READING_CACHE_BYTES) return false;
    const prepare = () => {
      const pending = this.#pending.get(id);
      if (pending?.prepare !== prepare) return;
      pending.cancel();
      this.#pending.delete(id);
      const projected = page(thread);
      this.#store(id, projected, readingCacheBytes(projected.messages), copy, settle);
    };
    this.#pending.set(id, { prepare, cancel: whenIdle(prepare) });
    this.#retain(id, bytes);
    return this.has(id);
  }

  /**
   * Keeps `thread` as the newest visit when it fits, then lets the oldest go
   * until the bounds hold. Once the page is idle, and while `settle` agrees,
   * `copy` replaces the entry: the click that left it never pays for that.
   */
  remember(id: string, thread: Thread, bytes: number, copy?: (held: Thread) => Thread, settle: () => boolean = () => true): void {
    this.delete(id);
    this.#store(id, thread, bytes, copy, settle);
  }

  #store(id: string, thread: Thread, bytes: number, copy: ((held: Thread) => Thread) | undefined, settle: () => boolean): void {
    if (bytes > READING_CACHE_BYTES) { this.delete(id); return; }
    this.#threads.set(id, thread);
    this.#retain(id, bytes);
    if (copy && this.#threads.get(id) === thread) this.#copies.set(id, whenIdle(() => {
      this.#copies.delete(id);
      if (this.#threads.get(id) === thread && settle()) this.#threads.set(id, copy(thread));
    }));
  }

  /**
   * Keeps a page read ahead of any visit, only where it fits beside what is
   * held: it never pushes out a timeline the reader left, nor replaces one.
   * Answers whether it was kept.
   */
  prefill(id: string, thread: Thread, bytes: number): boolean {
    if (!this.canPrefill(id, bytes)) return false;
    this.#threads.set(id, thread);
    this.#retain(id, bytes, true);
    return true;
  }

  #retain(id: string, bytes: number, preloaded = false): void {
    this.#unaccount(id);
    const entry = {
      bytes, preloaded,
      priority: () => this.visible() ? (this.open() === id ? Infinity : 1) : 0,
      evict: () => this.delete(id)
    };
    this.#entries.set(id, entry);
    rendererEntries.add(entry);
    this.#total += bytes;
    rendererBytes += bytes;
    while (this.#entries.size > READING_CACHE_THREADS || this.#total > READING_CACHE_TOTAL) {
      const victim = evictionCandidate(this.#entries.values());
      if (!victim) break;
      victim.evict();
    }
    while (rendererBytes > READING_CACHE_GLOBAL_BYTES || rendererEntries.size > 4 * READING_CACHE_THREADS) {
      const victim = evictionCandidate(rendererEntries);
      if (!victim) break;
      victim.evict();
    }
  }

  #unaccount(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    rendererEntries.delete(entry);
    this.#total -= entry.bytes;
    rendererBytes -= entry.bytes;
  }

  /** Only reads currently in flight need to hear that a page was invalidated. */
  mark(id: string): ReadingMark {
    const marks = this.#marks.get(id) ?? new Set<ReadingMark>();
    const mark: ReadingMark = { dropped: false, release: () => {
      marks.delete(mark);
      if (!marks.size && this.#marks.get(id) === marks) this.#marks.delete(id);
    } };
    marks.add(mark);
    this.#marks.set(id, marks);
    return mark;
  }

  /** Another copy of the same timeline in place of `held`: same size, same place in the order. */
  replace(id: string, held: Thread, copy: Thread): void {
    if (this.#threads.get(id) === held) this.#threads.set(id, copy);
  }

  delete(id: string): boolean {
    for (const mark of this.#marks.get(id) ?? []) mark.dropped = true;
    this.#marks.delete(id);
    this.#copies.get(id)?.();
    this.#copies.delete(id);
    const pending = this.#pending.get(id);
    if (pending) {
      pending.cancel();
      this.#pending.delete(id);
    }
    this.#unaccount(id);
    return this.#threads.delete(id) || pending !== undefined;
  }

  /** Lets `id` go because what it holds can no longer be caught up from, and says so to whoever kept another copy. */
  forget(id: string): boolean {
    this.forgotten?.(id);
    return this.delete(id);
  }

  clear(): void {
    for (const id of this.#entries.keys()) this.delete(id);
    for (const id of this.#marks.keys()) this.delete(id);
  }
}
