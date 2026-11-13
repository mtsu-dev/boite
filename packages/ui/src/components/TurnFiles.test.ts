import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Store } from '../lib/store.svelte';
import { TurnFileCache, turnFiles } from '../lib/turn-files';
import { DeferredParts } from '../lib/store/deferred-parts';
import type { Message } from '@boite/contracts';
import type { ToolPart } from '../lib/tool-groups';
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

test('leased diffs retry failed reads on reopening without using the legacy loader', async () => {
  const diff = { kind: 'diff' as const, path: 'a.ts', oldText: 'old', newText: 'new' };
  const refresh = vi.fn().mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValue(undefined);
  const release = vi.fn();
  const acquireDiff = vi.fn(() => ({ ready: Promise.resolve(), refresh, release }));
  const loadDiffs = vi.fn();
  component = mount(TurnFiles, { target: document.body, props: {
    store: { openProject: null, pickerAvailable: false } as unknown as Store,
    files: turnFiles([{ type: 'tool', toolId: 'edit', name: 'Edit', input: {}, output: null, status: 'done', documents: [diff] }], '/repo'),
    diffs: [diff], cwd: '/repo', deferred: [{ messageId: 'answer', toolId: 'edit' }],
    sources: [{ messageId: 'answer', toolId: 'edit' }], acquireDiff, loadDiffs,
  } });
  flushSync();
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid=turn-diff-toggle]')!;
  toggle.click(); flushSync();
  await vi.waitFor(() => expect(document.querySelector('[role=alert]')?.textContent).toBe('temporarily unavailable'));
  toggle.click(); flushSync();
  expect(release).toHaveBeenCalledTimes(1);
  toggle.click(); flushSync();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=turn-diff-loading]')).toBeNull());
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(loadDiffs).not.toHaveBeenCalled();
  expect(document.querySelector('[role=alert]')).toBeNull();
});

test.each(['card-first', 'files-first', 'hydrated-first'])('a visible diff keeps a shared read after its tool closes and releases on hide/unmount (%s)', async order => {
  const part = reactive<ToolPart>({ type: 'tool', toolId: 'edit', name: 'Edit', status: 'done',
    input: { file_path: 'a.ts' }, inputDeferred: true, output: 'preview', outputDeferred: true,
    documents: [{ kind: 'diff', path: 'a.ts', oldText: '', newText: '' }], documentsDeferred: true });
  const full = { input: { file_path: 'a.ts', old_string: 'old', new_string: 'complete input' }, output: 'complete output',
    documents: [{ kind: 'diff' as const, path: 'a.ts', oldText: 'old', newText: 'complete diff' }] };
  const message = { id: 'answer', role: 'assistant', turnId: 'turn', parts: [part] } as Message;
  let finish!: (result: { part: typeof full }) => void;
  const call = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const parts = new DeferredParts({ client: { call }, store: { core: { features: { deferredToolParts: true } } } } as never,
    { messages: () => [message], threadSnapshots: () => [] });
  const cache = new TurnFileCache();
  const read = () => cache.read('turn', [message], '/repo', false);
  const acquireDiff = vi.fn((source: { messageId: string; toolId: string }) => parts.acquireToolOutput('thread', source.messageId, source.toolId, false));
  const props = { store: { openProject: null, pickerAvailable: false } as unknown as Store, cwd: '/repo',
    get files() { return read().files; }, get diffs() { return read().diffs; },
    get deferred() { return read().deferred; }, get sources() { return read().sources; }, acquireDiff };
  const first = order !== 'files-first' ? parts.acquireToolOutput('thread', 'answer', 'edit') : undefined;
  if (order === 'hydrated-first') { finish({ part: full }); await first!.ready; }
  component = mount(TurnFiles, { target: document.body, props }); flushSync();
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid=turn-diff-toggle]')!;
  toggle.click(); flushSync();
  const card = first ?? parts.acquireToolOutput('thread', 'answer', 'edit');
  card.release();
  finish({ part: full }); await card.ready;
  await vi.waitFor(() => { flushSync(); expect(document.querySelector('[data-testid=diff-view]')?.textContent).toContain('complete diff'); });
  expect(call).toHaveBeenCalledTimes(1);
  expect(part.input).toEqual(full.input);
  expect(acquireDiff).toHaveBeenCalledTimes(1);
  toggle.click(); flushSync();
  await vi.waitFor(() => { flushSync(); expect(part.documentsDeferred).toBe(true); });
  expect(read().diffs).toEqual([]);
  expect(part.input).toEqual({ file_path: 'a.ts' });
  expect(part.inputDeferred).toBe(true);
  expect(part.documents).toEqual([{ kind: 'diff', path: 'a.ts', oldText: '', newText: '' }]);
  toggle.click(); flushSync();
  expect(call).toHaveBeenCalledTimes(2);
  finish({ part: full });
  await vi.waitFor(() => { flushSync(); expect(document.querySelector('[data-testid=diff-view]')?.textContent).toContain('complete diff'); });
  await unmount(component); component = undefined;
  expect(part.documentsDeferred).toBe(true);
  expect(part.inputDeferred).toBe(true);
  expect(read().diffs).toEqual([]);
});
