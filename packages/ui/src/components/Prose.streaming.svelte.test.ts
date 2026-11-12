import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Prose from './Prose.svelte';
import { appendText, textRevision } from '../lib/text-revisions';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (mounted) await unmount(mounted); mounted = undefined; document.body.innerHTML = ''; });

test('streamed revisions retain prose nodes, hide split drawings and reset after longer snapshots', () => {
  const source = $state({ text: 'First\n\nLook:\n> > ```m' });
  mounted = mount(Prose, { target: document.body, props: {
    get text() { return source.text; }, get revision() { return textRevision(source); }, live: true, bubble: true,
  } });
  flushSync();
  const first = document.querySelector('[data-testid=paragraph]');
  expect(document.querySelector('[data-testid=paragraph-pending]')?.textContent).toContain('```m');
  appendText(source, 'ermaid\n> > flowchart LR'); flushSync();
  expect(document.querySelector('[data-testid=paragraph]')).toBe(first);
  expect(document.querySelector('[data-testid=paragraph-pending]')?.textContent).toBe('Look:');
  expect(document.querySelector('[data-testid=drawing-pending]')).not.toBeNull();
  expect(document.querySelector('.answer-bubble')).not.toBeNull();
  source.text = 'Different\n\n```ts\n' + source.text + '\ncode'; flushSync();
  expect(document.querySelector('[data-testid=drawing-pending]')).toBeNull();
  expect(document.querySelector('[data-testid=paragraph-pending]')?.textContent).toContain('```mermaid');
  source.text = 'Done\n[BOITE_GOAL_COM'; flushSync();
  expect(document.body.textContent?.trim()).toBe('Done');
  appendText(source, 'PLETE]\n'); flushSync();
  expect(document.body.textContent?.trim()).toBe('Done');
});
