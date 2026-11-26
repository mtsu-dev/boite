import { DISPLAY_IMAGE_MAX, DISPLAY_THUMB_MAX, FILE_ROUTE, IMAGE_INLINE_CHARS, decodedBytes, imageSize, type ChatPreviewSize, type ImageAttachment } from '@boite/contracts';
import type { Core } from './core.ts';
import { messageOf } from './errors.ts';
import { mediaDisplay, mediaPreviews, putMediaDisplay, putMediaPreview } from './journal/media-previews.ts';
import type { AttachmentPreviewLookup, PreviewSource } from './journal/attachment-previews.ts';

/** Past this many pixels a picture gets no blur: decoding it costs more memory than the blur is worth. */
const PREVIEW_MAX_PIXELS = 7680 * 4320;
/** Blurs made at once. Each holds one decoded picture on Bun's image worker. */
const PREVIEW_CONCURRENCY = 3;
/** Base64 characters held by pictures waiting for a blur. Past this, the next read of their page asks again. */
const PREVIEW_QUEUE_CHARS = 64 * 1024 * 1024;

/** WebP copies made at once. Each decodes one picture on Bun's image worker, about 130 ms for a 1920 by 1080 screenshot. */
const DISPLAY_CONCURRENCY = 2;
/** What `messages.attachment` with `display` converts. A GIF keeps its frames by staying as it is. */
export const DISPLAY_TYPES = /^image\/(png|jpeg|webp)$/;

/** Which copy: the one the timeline draws, or the one a prompt's thumbnail draws. */
export type DisplaySize = 'large' | 'thumb' | ChatPreviewSize;
type ImageSource = string | Uint8Array | Blob;
type ChatImageSource = { data: ImageSource; mimeType: string };
const DISPLAY_SIZES = {
  large: { max: DISPLAY_IMAGE_MAX, quality: 80 },
  thumb: { max: DISPLAY_THUMB_MAX, quality: 75 },
};

/**
 * The `media_displays` row a copy is kept in. The large copy keeps the part's
 * own index and a thumbnail's goes to `-2 - partIndex`, so the table needs no
 * size column and the deletes of a thread or a rewind, which go by message,
 * take both. An older core reads only indexes from 0 and never sees them.
 */
function slotOf(partIndex: number, size: DisplaySize): number {
  if (size === 'large') return partIndex;
  if (size === 'thumb') return -2 - partIndex;
  // Ordinary part indexes are JavaScript array indexes. Keep preview slots above them and
  // give each size a stable offset, independent of new presets added later.
  return 2 ** 32 + partIndex * 4096 + size;
}

/**
 * The copy of a picture the timeline draws: WebP, its longer side at most
 * `DISPLAY_IMAGE_MAX` at quality 80, or `DISPLAY_THUMB_MAX` at quality 75 for
 * a thumbnail. Measured on 2026-10-07, 1.5 to 2.5 MB PNG screenshots became
 * 50 to 130 KB at the large size. `source` is the original as base64 or the
 * bytes of a larger copy. Null when Bun cannot decode it or refuses its size;
 * AVIF would be smaller still, but Bun's Linux build cannot encode it.
 */
async function makeDisplay(source: ImageSource, size: DisplaySize = 'large'): Promise<Uint8Array | null> {
  if (typeof Bun.Image !== 'function') return null;
  const { max, quality } = typeof size === 'number' ? { max: size, quality: 75 } : DISPLAY_SIZES[size];
  try {
    const image = new Bun.Image(typeof source === 'string' ? Buffer.from(source, 'base64') : source, { maxPixels: PREVIEW_MAX_PIXELS });
    return await image.resize(max, max, { fit: 'inside', withoutEnlargement: true }).webp({ quality }).bytes();
  } catch {
    return null;
  }
}

/** A historical image travels at preview size, with its original available as a file. */
export async function historyImagePreview(image: ImageAttachment): Promise<ImageAttachment | null> {
  if (typeof Bun.Image !== 'function') return null;
  try {
    const source = new Bun.Image(Buffer.from(image.data, 'base64'), { maxPixels: PREVIEW_MAX_PIXELS });
    const { width, height, format } = await source.metadata();
    // A JPEG's orientation can exchange its axes at the receiving provider.
    if (width <= (format === 'jpeg' ? 720 : 1280) && height <= 720) return image;
    const bytes = await source.resize(1280, 720, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).bytes();
    return { ...image, mimeType: 'image/webp', data: Buffer.from(bytes).toString('base64') };
  } catch {
    return null;
  }
}

/** A codec the browser supports can pass through when the source already fits the preview. */
async function smallChatSource(source: ChatImageSource | null, size: ChatPreviewSize): Promise<string | null> {
  if (source === null) return null;
  const { data } = source;
  const bytes = typeof data === 'string' ? Math.ceil(data.length / 4) * 3 : data instanceof Blob ? data.size : data.length;
  if (bytes > IMAGE_INLINE_CHARS / 4 * 3) return null;
  const encoded = typeof data === 'string' ? data : Buffer.from(data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data).toString('base64');
  const dimensions = imageSize(encoded);
  return dimensions && Math.max(dimensions.width, dimensions.height) <= size ? encoded : null;
}

interface Job {
  threadId: string;
  messageId: string;
  partIndex: number;
  source: PreviewSource;
  chars: number;
}

/** A ThumbHash render of the picture as a PNG data URL, or null when Bun cannot decode it or refuses its size. */
async function makePreview(data: string): Promise<string | null> {
  if (typeof Bun.Image !== 'function') return null;
  try {
    return await new Bun.Image(Buffer.from(data, 'base64'), { maxPixels: PREVIEW_MAX_PIXELS }).placeholder();
  } catch {
    return null;
  }
}

/**
 * The blur a deferred picture is drawn with until its bytes arrive. A page
 * asked with `compactImages` leaves large images on the core
 * (`previewImageData`); each keeps the size its header gives and, from here,
 * a blur that `Bun.Image.placeholder()` makes once on Bun's image worker and
 * `media_previews` keeps. A picture with none yet goes out without one and is
 * queued.
 */
export class MediaPreviews {
  readonly #waiting = new Map<string, Job>();
  private readonly running = new Map<string, Job>();
  #queuedChars = 0;
  /** WebP copies being made, one promise per picture however many clients ask. */
  readonly #displays = new Map<string, Promise<{ data: Uint8Array; kept: boolean }>>();
  #displaying = 0;
  readonly #displayTurns: (() => void)[] = [];

  readonly #core: Core;

  constructor(core: Core) {
    this.#core = core;}

  /** What a projection of `threadId`'s messages asks for each deferred picture. */
  lookup(threadId: string): AttachmentPreviewLookup {
    let known: { messageId: string; parts: Map<number, string | null> } | null = null;
    return (messageId, partIndex, data) => {
      if (known?.messageId !== messageId) {
        try {
          known = { messageId, parts: mediaPreviews(this.#core.journal.db, messageId) };
        } catch (error) {
          // A page goes out without its blurs rather than not at all.
          this.#core.log('warn', `media previews of message ${messageId} could not be read: ${messageOf(error)}`);
          return null;
        }
      }
      if (known.parts.has(partIndex)) return known.parts.get(partIndex) ?? null;
      this.enqueue(threadId, messageId, partIndex, data);
      return null;
    };
  }

  /**
   * A WebP copy for `messages.attachment` with `display`, made once and kept
   * in `media_displays`. `source` is the original as base64 or the bytes of
   * the large copy, which a thumbnail is made from when it is kept. The
   * answer is the copy's bytes, or empty when the source is what to send: a
   * picture Bun cannot convert, or one whose copy would not be lighter.
   * `kept` is false when the journal could not keep it (a full disk, a
   * message that left its thread): only these bytes hold it then.
   */
  async display(threadId: string, messageId: string, partIndex: number, size: DisplaySize, read: () => ImageSource | null): Promise<{ data: Uint8Array; kept: boolean }> {
    const kept = this.kept(threadId, messageId, partIndex, size);
    if (kept !== null) return { data: kept, kept: true };
    const key = `${threadId}\0${messageId}\0${partIndex}\0${size}`;
    let made = this.#displays.get(key);
    if (made === undefined) {
      made = this.#displayTurn(async () => {
        const source = read();
        if (source === null) return { data: new Uint8Array(0), kept: false };
        const sourceBytes = typeof source === 'string' ? source.length * 3 / 4 : source instanceof Blob ? source.size : source.length;
        const copy = await makeDisplay(source, size);
        const light = copy !== null && (typeof size === 'number' || copy.length < sourceBytes) ? copy : new Uint8Array(0);
        let kept = false;
        try {
          if (!this.#core.journal.isClosed()) {
            putMediaDisplay(this.#core.journal.db, threadId, messageId, slotOf(partIndex, size), light);
            // Nothing is written for a message that left its thread meanwhile.
            kept = this.#core.journal.db.query('SELECT 1 FROM media_displays WHERE message_id = ? AND part_index = ? AND thread_id = ?')
              .get(messageId, slotOf(partIndex, size), threadId) !== null;
          }
        } catch (error) {
          this.#core.log('warn', `${size} copy of message ${messageId} part ${partIndex} was not kept: ${messageOf(error)}`);
        }
        return { data: light, kept };
      }).finally(() => this.#displays.delete(key));
      this.#displays.set(key, made);
    }
    return await made;
  }

  /** A chat preview can only serve its own bounded copy, including when the original compresses better. */
  async chatPreview(threadId: string, messageId: string, partIndex: number, size: ChatPreviewSize, source: () => ChatImageSource | null,
    options: { ticket: boolean; permit?: { check(): void }; noStore?: boolean }): Promise<{ data: string; url?: string; bytes: number; mimeType: string }> {
    const cached = this.kept(threadId, messageId, partIndex, size);
    const copy = cached === null ? await this.display(threadId, messageId, partIndex, size, () => source()?.data ?? null) : { data: cached, kept: true };
    options.permit?.check();
    const mimeType = 'image/webp';
    const bytes = copy.data.length;
    if (!bytes) {
      const fallback = source();
      const data = await smallChatSource(fallback, size);
      options.permit?.check();
      return data && fallback ? { data, bytes: decodedBytes(data), mimeType: fallback.mimeType } : { data: '', bytes, mimeType };
    }
    if (!options.ticket || !copy.kept) return { data: Buffer.from(copy.data).toString('base64'), bytes, mimeType };
    const ticket = this.#core.fileTickets.mintBytes(`${threadId}:${messageId}:${partIndex}:preview:${size}`, () => {
      options.permit?.check();
      const data = this.kept(threadId, messageId, partIndex, size);
      return data?.length ? { data, mime: mimeType, ...((options.noStore || options.permit) ? { noStore: true as const } : {}) } : null;
    });
    return { data: '', url: `${FILE_ROUTE}/${ticket}`, bytes, mimeType };
  }

  /**
   * The copy `display` already kept, read without the original: empty when
   * its source is what to send, null when none was made. Only a copy of a
   * message of `threadId` is found, so a hit needs no other check.
   */
  kept(threadId: string, messageId: string, partIndex: number, size: DisplaySize): Uint8Array | null {
    try {
      return mediaDisplay(this.#core.journal.db, threadId, messageId, slotOf(partIndex, size));
    } catch (error) {
      this.#core.log('warn', `${size} copy of message ${messageId} part ${partIndex} could not be read: ${messageOf(error)}`);
      return null;
    }
  }

  /** Runs `work` once fewer than `DISPLAY_CONCURRENCY` copies are being made. */
  async #displayTurn<T>(work: () => Promise<T>): Promise<T> {
    if (this.#displaying >= DISPLAY_CONCURRENCY) await new Promise<void>(resolve => this.#displayTurns.push(resolve));
    else this.#displaying += 1;
    try {
      return await work();
    } finally {
      const next = this.#displayTurns.shift();
      if (next) next();
      else this.#displaying -= 1;
    }
  }

  /** Queue a missing blur; a full queue leaves it for a later read. */
  private enqueue(threadId: string, messageId: string, partIndex: number, source: PreviewSource): void {
    const key = `${threadId}\0${messageId}\0${partIndex}`;
    const existing = this.#waiting.get(key) ?? this.running.get(key);
    if (existing !== undefined) return;
    const chars = typeof source === 'string' ? source.length : source.chars;
    if (this.#queuedChars + chars > PREVIEW_QUEUE_CHARS && this.#waiting.size + this.running.size > 0) return;
    this.#queuedChars += chars;
    this.#waiting.set(key, { threadId, messageId, partIndex, source, chars });
    this.#pump();
  }

  #pump(): void {
    while (this.running.size < PREVIEW_CONCURRENCY && this.#waiting.size > 0) {
      const [key, job] = this.#waiting.entries().next().value as [string, Job];
      this.#waiting.delete(key);
      this.running.set(key, job);
      // Defer the read even for a free slot, so page hydration never has to inflate the stored picture.
      void Promise.resolve().then(async () => {
        if (this.#core.journal.isClosed()) return;
        const data = typeof job.source === 'string' ? job.source : job.source.read();
        if (data === null) return;
        const preview = await makePreview(data);
        if (!this.#core.journal.isClosed()) putMediaPreview(this.#core.journal.db, job.threadId, job.messageId, job.partIndex, preview);
      }).catch((error: unknown) => {
        this.#core.log('warn', `media preview for ${job.messageId} part ${job.partIndex} failed: ${messageOf(error)}`);
      }).finally(() => {
        this.running.delete(key);
        this.#queuedChars -= job.chars;
        this.#pump();
      });
    }
  }
}
