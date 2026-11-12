/*
 * The agent's browser draws two device pixels per CSS pixel (`RENDER_SCALE`),
 * so a screenshot comes out twice the page's size. The agent is given it at
 * the page's size, as before: it reads coordinates off it, and pays for its
 * pixels. The method is T3 Code's (https://github.com/pingdotgg/t3code, MIT
 * License): the page shrinks its own picture in an isolated world, as the core
 * has no image library, rather than a clip scale, which makes Chromium mirror
 * the top-left of the page into a `backdrop-filter`.
 */

/** Runs in an isolated world of the page. */
const SHRINK_PNG = `async function (png) {
  const ratio = devicePixelRatio || 1;
  if (ratio <= 1) return png;
  const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const width = Math.max(1, Math.round(bitmap.width / ratio)), height = Math.max(1, Math.round(bitmap.height / ratio));
  // Namespaced, as an XML document's createElement makes a plain element with no getContext.
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
}`;

/** Runs in an isolated world of the page: a JPEG no wider than `maxWidth`, at `quality` of 100. */
const SHRINK_JPEG = `async function (jpeg, maxWidth, quality) {
  const bytes = Uint8Array.from(atob(jpeg), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  if (bitmap.width <= maxWidth) { bitmap.close(); return jpeg; }
  const width = Math.max(1, Math.round(maxWidth)), height = Math.max(1, Math.round(bitmap.height * width / bitmap.width));
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality / 100).slice("data:image/jpeg;base64,".length);
}`;

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** Calls `declaration` in an isolated world of the page's main frame. Null when the page could not answer a text. */
async function inPage(send: Send, declaration: string, values: unknown[]): Promise<string | null> {
  const { frameTree } = await send('Page.getFrameTree') as { frameTree: { frame: { id: string } } };
  const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'boite-screenshot' }) as { executionContextId: number };
  const { result, exceptionDetails } = await send('Runtime.callFunctionOn', {
    functionDeclaration: declaration, executionContextId, arguments: values.map(value => ({ value })), awaitPromise: true, returnByValue: true,
  }) as { result?: { value?: unknown }; exceptionDetails?: unknown };
  return !exceptionDetails && typeof result?.value === 'string' && result.value.length > 0 ? result.value : null;
}

/** A PNG of the page's viewport at its CSS size, base64. Null when the page could not shrink it. */
export async function shrunkScreenshot(send: Send): Promise<string | null> {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }) as { data?: string };
  if (typeof shot.data !== 'string') return null;
  return inPage(send, SHRINK_PNG, [shot.data]);
}

/** A JPEG, base64, shrunk by the page to `maxWidth` pixels wide at `quality`. Null when the page could not shrink it. */
export function shrunkJpeg(send: Send, jpeg: string, maxWidth: number, quality: number): Promise<string | null> {
  return inPage(send, SHRINK_JPEG, [jpeg, maxWidth, quality]);
}

/** The width a JPEG says it has, from its frame header. Null for anything else. */
export function jpegWidth(bytes: Uint8Array): number | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) { at += 1; continue; }
    // A start of frame, which the tables that share its range are not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return (bytes[at + 7]! << 8) | bytes[at + 8]!;
    at += 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
  }
  return null;
}
