import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Store } from '../lib/store.svelte';
import { turnFiles } from '../lib/turn-files';
import { reactive } from '../test/reactive.svelte';
import TurnFiles from './TurnFiles.svelte';

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (component) await unmount(component); component = undefined; document.body.innerHTML = ''; });

test('deferred previews load on demand without hiding available diffs and retry a failed read', async () => {
  const loadDiffs = vi.fn().mockRejectedValueOnce(new Error('diff unavailable')).mockResolvedValue(undefined);
  const diff = { kind: 'diff' as const, path: 'a.ts', oldText: 'old', newText: 'new' };
  const files = turnFiles([{ type: 'tool', toolId: 'edit', name: 'Edit', input: { file_path: 'a.ts' }, output: null, status: 'done', documents: [diff] }], '/repo');
  component = mount(TurnFiles, { target: document.body, props: {
    store: { openProject: null, pickerAvailable: false } as unknown as Store, files, diffs: [diff], cwd: '/repo',
    deferred: [{ messageId: 'answer', toolId: 'edit' }], loadDiffs,
  } });
  flushSync();
  expect(loadDiffs).not.toHaveBeenCalled();
  const button = document.querySelector<HTMLButtonElement>('[data-testid=turn-diff-toggle]')!;
  button.click(); flushSync();
  await vi.waitFor(() => expect(document.querySelector('[role=alert]')?.textContent).toBe('diff unavailable'));
  expect(document.querySelector('[data-testid=diff-view]')?.getAttribute('data-path')).toBe('a.ts');
  button.click(); flushSync(); button.click(); flushSync();
  expect(loadDiffs).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(document.querySelector('[data-testid=turn-diff-loading]')).toBeNull());
  expect(document.querySelector('[role=alert]')).toBeNull();
});

test('new edits retry an open deferred preview and clear its previous error', async () => {
  const diff = { kind: 'diff' as const, path: 'a.ts', oldText: 'old', newText: 'new' };
  const loadDiffs = vi.fn().mockRejectedValueOnce(new Error('temporary failure'));
  const props = reactive({ store: { openProject: null, pickerAvailable: false } as unknown as Store,
    files: turnFiles([{ type: 'tool', toolId: 'edit', name: 'Edit', input: {}, output: null, status: 'done', documents: [diff] }], '/repo'),
    diffs: [diff], cwd: '/repo', deferred: [{ messageId: 'answer', toolId: 'edit' }], loadDiffs });
  loadDiffs.mockImplementation(async () => { props.deferred = []; });
  component = mount(TurnFiles, { target: document.body, props });
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=turn-diff-toggle]')!.click(); flushSync();
  await vi.waitFor(() => expect(document.querySelector('[role=alert]')?.textContent).toBe('temporary failure'));
  props.deferred = [...props.deferred, { messageId: 'answer', toolId: 'new-edit' }]; flushSync();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=turn-diff-loading]')).toBeNull());
  expect(loadDiffs).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role=alert]')).toBeNull();
  expect(document.querySelector('[data-testid=diff-view]')).not.toBeNull();
});

test('the card has one action: its own diff, with the folder\'s whole change set offered under it', async () => {
  const diff = { kind: 'diff' as const, path: 'a.ts', oldText: 'old\n', newText: 'new\nmore\n' };
  const openChanges = vi.fn();
  const files = turnFiles([{ type: 'tool', toolId: 'edit', name: 'Edit', input: { file_path: '/repo/a.ts' }, output: null, status: 'done', documents: [diff] }], '/repo');
  component = mount(TurnFiles, { target: document.body, props: {
    store: { openProject: { repository: true }, pickerAvailable: false, panel: { openChanges } } as unknown as Store, files, diffs: [diff], cwd: '/repo',
    deferred: [], loadDiffs: async () => {},
  } });
  flushSync();
  const header = document.querySelector('[data-testid=turn-files] header, .turn-files header')!;
  expect(header.querySelector('[data-testid=turn-diff-toggle]')).not.toBeNull();
  expect(document.querySelector('[data-testid=turn-all-changes]')).toBeNull();
  document.querySelector<HTMLButtonElement>('[data-testid=turn-diff-toggle]')!.click(); flushSync();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=diff-view]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[data-testid=turn-all-changes]')!.click();
  expect(openChanges).toHaveBeenCalledWith('a.ts');
});
