import { expect, test } from 'vitest';
import { renderMarkdown } from './markdown';
import { richMarkdown } from './rich-markdown';

/* Its own file: the drawing code must not be loaded yet, as on the first block of a session. */

test('a node gone before the drawing code arrives is not drawn into', async () => {
  const asked: string[] = [];
  const host = document.createElement('div');
  host.innerHTML = renderMarkdown('```view\n<p>Late</p>\n```');
  document.body.append(host);
  const action = richMarkdown(host, { viewBlock: async (html) => { asked.push(html); return { ok: true, value: 'about:blank' }; } });
  // Unmounted while the import is on its way, as when a chat closes or a test ends.
  action.destroy();
  await import('./rich-markdown-draw');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(asked).toEqual([]);
  expect(host.querySelector('.md-view')?.hasAttribute('data-drawn')).toBe(false);
});
