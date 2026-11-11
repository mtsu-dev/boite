import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Project } from '@boite/contracts';
import { Store } from '../lib/store.svelte';
import ProjectThreadCounters from './ProjectThreadCounters.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted, { outro: false });
  mounted = undefined;
  document.body.innerHTML = '';
});

function head(props: { waiting: number; listed: number; collapsed?: boolean; failed?: number }) {
  const project = { id: 'p1', name: 'orbit', path: '/src/orbit' } as Project;
  const entry = { machine: { id: 'local', label: 'Local', store: new Store() }, project } as never;
  mounted = mount(ProjectThreadCounters, { target: document.body, props: { entry, working: 0, controls: 'c', ...props } });
  flushSync();
  const counter = document.querySelector<HTMLElement>('[data-testid=project-waiting-count]')!;
  return { counter, word: counter.querySelector<HTMLElement>('.word')! };
}

test('the head counts what its rows already say, and says Needs you in words once one of those rows is out of sight', () => {
  // Every row that needs the user is on screen and says it: the head keeps the dot and the count.
  let { counter, word } = head({ waiting: 2, listed: 2 });
  expect(word.classList.contains('spare')).toBe(true);
  expect(counter.querySelector('.number')?.textContent).toBe('2');
  expect(counter.getAttribute('aria-label')).toBe('orbit: 2 need you');
  unmount(mounted!, { outro: false }); mounted = undefined;
  // One of them is not drawn as a row: the head says the state itself.
  ({ counter, word } = head({ waiting: 2, listed: 1 }));
  expect(word.classList.contains('spare')).toBe(false);
  expect(word.textContent).toBe('Needs you');
  unmount(mounted!, { outro: false }); mounted = undefined;
  // A folded card shows no rows at all.
  ({ counter, word } = head({ waiting: 2, listed: 2, collapsed: true }));
  expect(word.classList.contains('spare')).toBe(false);
  expect(counter.getAttribute('aria-label')).toBe('orbit: 2 need you');
});

test('a head that counts only failures wears the failure\'s mark and colour; a mix keeps amber and names both counts', () => {
  let { counter, word } = head({ waiting: 1, failed: 1, listed: 0 });
  expect(counter.dataset['state']).toBe('error');
  expect(counter.classList.contains('failed')).toBe(true);
  expect(counter.querySelector('.fail')).not.toBeNull();
  expect(counter.querySelector('.dot')).toBeNull();
  expect(word.textContent).toBe('Failed');
  expect(counter.getAttribute('aria-label')).toBe('orbit: 1 failed');
  unmount(mounted!, { outro: false }); mounted = undefined;
  // The user's turn ranks first: one waiting beside one failure keeps the amber dot and its word.
  ({ counter, word } = head({ waiting: 2, failed: 1, listed: 0 }));
  expect(counter.dataset['state']).toBe('waiting');
  expect(counter.classList.contains('failed')).toBe(false);
  expect(counter.querySelector('.dot')).not.toBeNull();
  expect(word.textContent).toBe('Needs you');
  expect(counter.querySelector('.number')?.textContent).toBe('2');
  expect(counter.getAttribute('aria-label')).toBe('orbit: 1 need you, 1 failed');
});
