import { DISPLAY_THUMB_MAX, parseGroupRelayUrl, type ChatPreviewSize, type RpcParams, type ThreadId } from '@boite/contracts';
import { coreHref } from '../endpoint';
import { strings } from '../strings';
import type { StoreContext } from './context';
import { desktopShell } from '../shell-platform';

/** Copies kept for a scroll back; past either bound the oldest goes. */
const KEPT = 120;
const KEPT_GLOBAL = 4 * KEPT;
/**
 * About 24 MB of `data:` strings, including originals sent by older cores.
 * A ticketed copy is an address: the browser's cache holds its bytes.
 */
export const KEPT_CHARS = 24 * 1024 * 1024;
/** Renderer-wide cap across all connected machines, evicting hidden stores first. */
export const KEPT_GLOBAL_CHARS = KEPT_CHARS;

interface RendererHeld {
  chars: number;
  visible: () => boolean;
  evict: () => void;
}

interface Held {
  promise: Promise<string>;
  /** The URL's length once it arrived, 0 before. */
  chars: number;
  global: RendererHeld;
}

const rendererEntries = new Set<RendererHeld>();
let rendererChars = 0;

function evictionCandidate(needChars: boolean): RendererHeld | undefined {
  let hidden: RendererHeld | undefined;
  let visible: RendererHeld | undefined;
  for (const entry of rendererEntries) {
    if (needChars && entry.chars === 0) continue;
    if (!entry.visible()) { hidden = entry; break; }
    visible ??= entry;
  }
  return hidden ?? visible;
}

/**
 * The copies of deferred pictures the timeline draws. `messages.attachment`
 * with `previewMax` answers a WebP sized for the picture's box and display.
 * Older cores interpret the compatible `display` and `thumb` flags.
 * The original stays on the core until the viewer, a download or an edit
 * asks for it. A copy never replaces
 * a part's bytes: what is sent again or saved is the original. An evicted
 * picture still on screen keeps its `<img>`; it is asked again only when it
 * nears the screen after a remount.
 *
 * The copy comes as an address on the core's file route (`ticket`), which the
 * `<img>` loads and the browser caches, rather than base64 in a JSON frame to
 * parse and decode. The desktop shell's policy admits `/file/` only at a
 * machine's own address, so through another member's relay it asks for
 * base64, as an older core answers anyway.
 */
export class DisplayImages {
  readonly #held = new Map<string, Held>();
  #chars = 0;

  constructor(private readonly ctx: StoreContext) {}

  /** What the kept URLs hold together, in characters. */
  get chars(): number { return this.#chars; }

  /** The URL of the copy, or of the original from a core that does not make copies. `thumb` asks for the thumbnail's size. */
  load(threadId: ThreadId, messageId: string, partIndex: number, mimeType: string, size: boolean | ChatPreviewSize = false): Promise<string> {
    const client = this.ctx.client;
    if (!client) return Promise.reject(new Error(strings.connection.unavailable));
    const key = JSON.stringify([threadId, messageId, partIndex, size]);
    const held = this.#held.get(key);
    if (held) {
      // Most recently used last: the order the oldest leave in.
      this.#held.delete(key);
      this.#held.set(key, held);
      rendererEntries.delete(held.global);
      rendererEntries.add(held.global);
      return held.promise;
    }
    const thumb = size === true || (typeof size === 'number' && size <= DISPLAY_THUMB_MAX);
    const promise = this.request({
      threadId, messageId, partIndex, display: true,
      ...(thumb ? { thumb } : {}), ...(typeof size === 'number' ? { previewMax: size } : {})
    }, mimeType);
    const global: RendererHeld = {
      chars: 0,
      visible: () => this.ctx.store?.visible !== false,
      evict: () => this.#drop(key)
    };
    const entry: Held = { promise, chars: 0, global };
    promise.then((url) => {
      if (this.#held.get(key) !== entry) return;
      entry.chars = url.length;
      global.chars = url.length;
      this.#chars += url.length;
      rendererChars += url.length;
      this.#evict();
    }, () => {
      // A failed read is asked again by the next picture that nears the screen.
      if (this.#held.get(key) === entry) this.#drop(key);
    });
    this.#held.set(key, entry);
    rendererEntries.add(global);
    this.#evict();
    return promise;
  }

  /** The viewer or player reads its original without hydrating the message's base64. */
  original(threadId: ThreadId, messageId: string, partIndex: number, mimeType: string): Promise<string> {
    return this.request({ threadId, messageId, partIndex }, mimeType);
  }

  private async request(params: RpcParams<'messages.attachment'>, mimeType: string): Promise<string> {
    const client = this.ctx.client;
    if (!client) throw new Error(strings.connection.unavailable);
    const endpoint = this.ctx.store?.endpointUrl ?? null;
    const ticket = !(desktopShell() && endpoint !== null && parseGroupRelayUrl(endpoint) !== null);
    const { data, mimeType: type, url } = await client.call('messages.attachment', { ...params, ...(ticket ? { ticket } : {}) });
    if (url === undefined) {
      if (!data && params.previewMax !== undefined) throw new Error(strings.chat.imageUnavailable);
      return `data:${type ?? mimeType};base64,${data}`;
    }
    return url.startsWith('/') && endpoint !== null ? coreHref(endpoint, url) : url;
  }

  /**
   * Lets a copy go so the next `load` asks again: its address no longer
   * loads, a ticket that expired after the browser's cache let it go, or a
   * core that restarted and forgot it.
   */
  forget(threadId: ThreadId, messageId: string, partIndex: number, size: boolean | ChatPreviewSize = false): void {
    this.#drop(JSON.stringify([threadId, messageId, partIndex, size]));
  }

  /** Another machine's pictures: its keys do not name the client they came from. */
  clear(): void {
    for (const held of this.#held.values()) {
      rendererEntries.delete(held.global);
      rendererChars -= held.global.chars;
    }
    this.#held.clear();
    this.#chars = 0;
  }

  #drop(key: string): void {
    const held = this.#held.get(key);
    if (!held) return;
    this.#chars -= held.chars;
    rendererChars -= held.global.chars;
    rendererEntries.delete(held.global);
    this.#held.delete(key);
  }

  #evict(): void {
    while (this.#held.size > KEPT || this.#chars > KEPT_CHARS) {
      const oldest = this.#held.keys().next().value;
      if (oldest === undefined) break;
      this.#drop(oldest);
    }
    while (rendererChars > KEPT_GLOBAL_CHARS) {
      const victim = evictionCandidate(true);
      if (!victim) break;
      victim.evict();
    }
    while (rendererEntries.size > KEPT_GLOBAL) {
      const victim = evictionCandidate(false);
      if (!victim) break;
      victim.evict();
    }
  }
}
