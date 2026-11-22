import { CHAT_PREVIEW_IMAGES, IMAGE_INLINE_CHARS, imageSize, type ChatPreviewSize } from '@boite/contracts';

type Preview = { data: string; bytes: number; mimeType: string };
const CACHE_ENTRIES = 32;
const CACHE_ENTRY_BYTES = 256 * 1024;

/** Data URLs already held by a card stay valid after its copy leaves this cache. */
export class FakeImagePreviews {
  readonly #held = new Map<string, Promise<Preview | null>>();

  read(key: string, size: ChatPreviewSize, source: () => Blob | Promise<Blob | null>): Promise<Preview | null> {
    let preview = this.#held.get(key);
    if (preview) this.#held.delete(key);
    else {
      preview = this.#make(size, source);
      const pending = preview;
      const forget = () => { if (this.#held.get(key) === pending) this.#held.delete(key); };
      void pending.then(value => { if (!value || value.bytes > CACHE_ENTRY_BYTES) forget(); }, forget);
    }
    this.#held.set(key, preview);
    if (this.#held.size > CACHE_ENTRIES) this.#held.delete(this.#held.keys().next().value!);
    return preview;
  }

  clear(): void { this.#held.clear(); }

  async #make(size: ChatPreviewSize, source: () => Blob | Promise<Blob | null>): Promise<Preview | null> {
    const original = await source();
    if (!original || !CHAT_PREVIEW_IMAGES.test(original.type)) return null;
    const resized = typeof createImageBitmap === 'function' ? await fakeImagePreview(original, size) : null;
    const copy = resized ?? original;
    if (resized === null && copy.size > IMAGE_INLINE_CHARS / 4 * 3) return null;
    const data = (await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(copy);
    })).split(',')[1] ?? '';
    if (resized === null) {
      const dimensions = imageSize(data);
      if (!dimensions || Math.max(dimensions.width, dimensions.height) > size) return null;
    }
    return { data, bytes: copy.size, mimeType: copy.type };
  }
}

/** The demo uses the browser's decoder for the same bounded, first-frame copy as the core. */
async function fakeImagePreview(source: Blob, max: ChatPreviewSize): Promise<Blob | null> {
  try {
    const image = await createImageBitmap(source);
    try {
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.75));
    } finally {
      image.close();
    }
  } catch {
    return null;
  }
}
