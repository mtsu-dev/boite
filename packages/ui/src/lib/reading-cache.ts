import type { Message, MessagePart, Thread, ToolDocument } from '@boite/contracts';
import { whenIdle } from './idle';

/** At most this many bytes of text and image data per kept timeline, counted as UTF-16. */
export const READING_CACHE_BYTES = 4 * 1024 * 1024;
export const READING_CACHE_MESSAGES = 2000;
/** At most this many timelines are kept, and this many bytes of them together. */
export const READING_CACHE_THREADS = 16;
export const READING_CACHE_TOTAL = 4 * READING_CACHE_BYTES;

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
 * counted at when it came in. A leave counts the thread it leaves and nothing
 * else: the running total comes from the sizes kept here, so no call site can
 * drop an entry and forget its bytes.
 */
export class ReadingCache {
  readonly #threads = new Map<string, Thread>();
  readonly #bytes = new Map<string, number>();
  #total = 0;
  /** Counts every delete and clear, kept or not: what a page read before it no longer vouches for. */
  #changes = 0;
  /** The count at each thread's last delete, and at the last clear. */
  readonly #dropped = new Map<string, number>();
  #cleared = 0;

  /** `forgotten` hears of a thread whose visit is no longer one to resume from (`forget`). */
  constructor(private readonly forgotten?: (id: string) => void) {}

  get size(): number { return this.#threads.size; }

  get(id: string): Thread | undefined { return this.#threads.get(id); }

  /**
   * Keeps `thread` as the newest visit when it fits, then lets the oldest go
   * until the bounds hold. Once the page is idle, and while `settle` agrees,
   * `copy` replaces the entry: the click that left it never pays for that.
   */
  remember(id: string, thread: Thread, bytes: number, copy?: (held: Thread) => Thread, settle: () => boolean = () => true): void {
    this.delete(id);
    if (bytes > READING_CACHE_BYTES) return;
    this.#threads.set(id, thread);
    this.#bytes.set(id, bytes);
    this.#total += bytes;
    while (this.#threads.size > READING_CACHE_THREADS || this.#total > READING_CACHE_TOTAL) this.delete(this.#threads.keys().next().value!);
    if (copy && this.#threads.get(id) === thread) whenIdle(() => { if (this.#threads.get(id) === thread && settle()) this.#threads.set(id, copy(thread)); });
  }

  /**
   * Keeps a page read ahead of any visit, only where it fits beside what is
   * held: it never pushes out a timeline the reader left, nor replaces one.
   * Answers whether it was kept.
   */
  prefill(id: string, thread: Thread, bytes: number): boolean {
    if (this.#threads.has(id) || bytes > READING_CACHE_BYTES) return false;
    if (this.#threads.size >= READING_CACHE_THREADS || this.#total + bytes > READING_CACHE_TOTAL) return false;
    this.#threads.set(id, thread);
    this.#bytes.set(id, bytes);
    this.#total += bytes;
    return true;
  }

  /** The point a read starts from; `droppedSince` answers whether its thread left the cache after it. */
  mark(): number { return this.#changes; }

  /** Whether `id` was deleted, or the cache cleared, since `mark`: a page read before then may hold what left the thread. */
  droppedSince(id: string, mark: number): boolean {
    return this.#cleared > mark || (this.#dropped.get(id) ?? 0) > mark;
  }

  /** Another copy of the same timeline in place of `held`: same size, same place in the order. */
  replace(id: string, held: Thread, copy: Thread): void {
    if (this.#threads.get(id) === held) this.#threads.set(id, copy);
  }

  delete(id: string): boolean {
    // Counted even when nothing is held: a read ahead of the thread may be on its way.
    this.#dropped.set(id, ++this.#changes);
    const bytes = this.#bytes.get(id);
    if (bytes === undefined) return false;
    this.#total -= bytes;
    this.#bytes.delete(id);
    return this.#threads.delete(id);
  }

  /** Lets `id` go because what it holds can no longer be caught up from, and says so to whoever kept another copy. */
  forget(id: string): boolean {
    this.forgotten?.(id);
    return this.delete(id);
  }

  clear(): void {
    this.#cleared = ++this.#changes;
    this.#dropped.clear();
    this.#threads.clear();
    this.#bytes.clear();
    this.#total = 0;
  }
}
