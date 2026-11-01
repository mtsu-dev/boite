import { isAgentPicture } from '@boite/contracts';
import type { Store } from './store.svelte';

/**
 * The pictures the owner imported for bots, by avatar (`img:<hash>`). A
 * profile names its picture by the hash of its bytes, so the same avatar is
 * the same image on every machine: the first connected core that holds it
 * answers `agents.picture.get`, and the client keeps the `data:` URL for the
 * rest of its life. A picture no core holds is asked again after `RETRY_MS`.
 */
const RETRY_MS = 60_000;

/** The stores a picture may come from; the workspace names them (workspace.svelte.ts), a test may too. */
let sources: () => readonly Store[] = () => [];
export function pictureSources(list: () => readonly Store[]): void { sources = list; }

class AgentPictures {
  /** Each picture fetched or imported here, as a `data:` URL. */
  urls = $state<Record<string, string>>({});
  /** The pictures no connected core held when last asked: drawn as the robot their id picks meanwhile. */
  missing = $state<Record<string, number>>({});
  #loading = new Set<string>();
  /** The clients each missing picture was last asked of: a client not among them is asked without waiting `RETRY_MS`. */
  #asked = new Map<string, Set<object>>();

  url(avatar: string): string | null { return this.urls[avatar.trim()] ?? null; }

  /** Keeps a picture this client just imported, so the form shows it without asking it back. */
  remember(avatar: string, dataUrl: string): void {
    const key = avatar.trim();
    if (!isAgentPicture(key) || !dataUrl.startsWith('data:image/')) return;
    this.urls = { ...this.urls, [key]: dataUrl };
    if (key in this.missing) { const { [key]: _gone, ...rest } = this.missing; this.missing = rest; }
  }

  /**
   * Fetches a picture the first time an avatar draws it. The sources and their
   * connections are read before anything returns, so an effect that calls this
   * runs again once a machine connects, and that machine is asked at once even
   * within `RETRY_MS` of a miss.
   */
  async load(avatar: string): Promise<void> {
    const key = avatar.trim();
    if (!isAgentPicture(key) || this.urls[key] !== undefined) return;
    // Read before any other return: an effect stays subscribed to connections and to the miss, even while a fetch runs.
    const ready = [...new Set(sources())].filter(store => store.client && store.connection === 'ready');
    const missed = this.missing[key];
    if (this.#loading.has(key)) return;
    // Within `RETRY_MS` of a miss, only the machines not asked then.
    const recent = missed !== undefined && Date.now() - missed < RETRY_MS;
    const asked = recent ? this.#asked.get(key) ?? new Set<object>() : new Set<object>();
    const fresh = ready.filter(store => !asked.has(store.client!));
    if (!fresh.length) return;
    this.#loading.add(key);
    try {
      for (const store of fresh) {
        try {
          const answer = await store.client!.call('agents.picture.get', { avatar: key });
          if (answer.dataUrl.startsWith('data:image/')) { this.#asked.delete(key); this.remember(key, answer.dataUrl); return; }
        } catch { /* another machine may hold it */ }
      }
      this.#asked.set(key, new Set([...asked, ...fresh.map(store => store.client!)]));
      this.missing = { ...this.missing, [key]: recent ? missed : Date.now() };
    } finally {
      this.#loading.delete(key);
    }
  }
}

export const agentPictures = new AgentPictures();

/** The edge, in pixels, a still picture is shrunk to before it is sent: four times the largest avatar drawn. */
export const PICTURE_EDGE = 256;

/**
 * The file the owner picked, as the `data:` URL `agents.picture.put` takes: a
 * GIF small enough goes as it is and stays animated; anything else is cropped
 * to its centred square and drawn at `PICTURE_EDGE`, as WebP where the browser
 * writes it, else PNG.
 */
export async function pictureDataUrl(file: Blob, maxBytes: number): Promise<string> {
  if (file.type === 'image/gif' && file.size <= maxBytes) return await readAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const edge = Math.min(PICTURE_EDGE, side);
    const canvas = document.createElement('canvas');
    canvas.width = edge; canvas.height = edge;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas: no 2D context to draw the picture');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
    const webp = canvas.toDataURL('image/webp', 0.86);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('the picture could not be read'));
    reader.readAsDataURL(file);
  });
}
