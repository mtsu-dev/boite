/*
 * Renders the Markdown blocks of a page of history off the main thread
 * (`prepareBlocks` in `markdown.ts` sends them): `renderMarkdown` is pure and
 * returns an HTML string, which the page keeps in its block cache.
 */
import { renderMarkdown } from './markdown';

self.onmessage = ({ data }: MessageEvent<{ id: number; blocks: string[]; rich: boolean }>) => {
  try {
    self.postMessage({ id: data.id, html: data.blocks.map((block) => renderMarkdown(block, data.rich)) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
