import { CHAT_PREVIEW_IMAGES, type ChatPreviewSize } from '@boite/contracts';

/** The demo uses the browser's decoder for the same bounded, first-frame copy as the core. */
export async function fakeImagePreview(source: Blob, max: ChatPreviewSize): Promise<Blob | null> {
  if (!CHAT_PREVIEW_IMAGES.test(source.type)) return null;
  if (typeof createImageBitmap !== 'function') return source;
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
