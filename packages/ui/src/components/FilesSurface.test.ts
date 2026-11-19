import { expect, test, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { FileEntry } from '@boite/contracts';
import FilesSurface from './FilesSurface.svelte';

test('a directory expanded after remount shows its cached rows and refreshes once idle', async () => {
  const callbacks = new Map<number, IdleRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestIdleCallback', (run: IdleRequestCallback) => {
    callbacks.set(++sequence, run);
    return sequence;
  });
  vi.stubGlobal('cancelIdleCallback', (id: number) => callbacks.delete(id));
  const dir: FileEntry = { name: 'src', path: 'src', kind: 'dir', bytes: null, modifiedAt: 0 };
  let name = 'before.ts';
  const listFiles = vi.fn(async (_threadId: string, path?: string) => ({
    ok: true,
    value: path ? [{ name, path: `src/${name}`, kind: 'file', bytes: 0, modifiedAt: 0 }] : [dir],
  }));
  const props = { store: { openThread: { id: 't', cwd: '/work' }, clientGeneration: 0, listFiles },
    surface: { id: 'files', kind: 'files' }, panel: {} } as unknown as NonNullable<Parameters<typeof FilesSurface>[1]>;
  const row = (path: string) => document.querySelector<HTMLButtonElement>(`[data-path="${path}"]`);
  let app = mount(FilesSurface, { target: document.body, props });
  try {
    await vi.waitFor(() => expect(row('src')).not.toBeNull());
    row('src')!.click();
    await vi.waitFor(() => expect(row('src/before.ts')).not.toBeNull());
    await unmount(app);
    name = 'after.ts';
    app = mount(FilesSurface, { target: document.body, props });
    await vi.waitFor(() => expect(row('src')).not.toBeNull());
    row('src')!.click();
    await tick();
    expect(row('src/before.ts')).not.toBeNull();
    expect(listFiles.mock.calls).toEqual([['t', undefined], ['t', 'src']]);
    for (const [id, run] of callbacks) {
      callbacks.delete(id);
      run({ didTimeout: false, timeRemaining: () => 50 });
    }
    await vi.waitFor(() => expect(row('src/after.ts')).not.toBeNull());
    expect(row('src/before.ts')).toBeNull();
  } finally {
    await unmount(app);
    vi.unstubAllGlobals();
  }
});

test.each([true, false])('a failed revalidation invalidates rows only for a confirmed refusal (%s)', async inaccessible => {
  const callbacks = new Map<number, IdleRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestIdleCallback', (run: IdleRequestCallback) => { callbacks.set(++sequence, run); return sequence; });
  vi.stubGlobal('cancelIdleCallback', (id: number) => callbacks.delete(id));
  const entry: FileEntry = { name: 'old.txt', path: 'old.txt', kind: 'file', bytes: 1, modifiedAt: 0 };
  let failure = false;
  const listFiles = vi.fn(async () => failure ? { ok: false, error: 'Directory unavailable', ...(inaccessible ? { inaccessible: true } : {}) } : { ok: true, value: [entry] });
  const props = { store: { openThread: { id: 't', cwd: '/work' }, clientGeneration: 0, listFiles },
    surface: { id: 'files', kind: 'files' }, panel: {} } as unknown as NonNullable<Parameters<typeof FilesSurface>[1]>;
  const shown = () => document.querySelector('[data-path="old.txt"]') !== null;
  let app = mount(FilesSurface, { target: document.body, props });
  try {
    await vi.waitFor(() => expect(shown()).toBe(true));
    await unmount(app);
    failure = true;
    app = mount(FilesSurface, { target: document.body, props });
    await tick();
    expect(shown()).toBe(true);
    for (const [id, run] of callbacks) { callbacks.delete(id); run({ didTimeout: false, timeRemaining: () => 50 }); }
    await vi.waitFor(() => expect(document.querySelector('[data-testid="files-error"]')).not.toBeNull());
    expect(shown()).toBe(!inaccessible);
    await unmount(app);
    app = mount(FilesSurface, { target: document.body, props });
    await tick();
    expect(shown()).toBe(!inaccessible);
  } finally {
    await unmount(app);
    vi.unstubAllGlobals();
  }
});
