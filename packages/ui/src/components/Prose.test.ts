import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import Prose from './Prose.svelte';
import type { Store } from '../lib/store.svelte';
import { resetFeatures, setFeature } from '../lib/features';
import { installExternalLinks } from '../lib/links';
import { contextMenu } from '../lib/context-menu.svelte';
import { confirm } from '../lib/confirm.svelte';
import { fileNotice } from '../lib/file-open.svelte';

/** `files.locate` for a file that is there as written. */
const asWritten = async (_threadId: string, path: string) => ({ ok: true as const, value: [path] });

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  resetFeatures();
  delete window.__TAURI_INTERNALS__;
  if (confirm.current) confirm.answer('cancel');
  fileNotice.dismiss();
});

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

/**
 * A simulated shell: `client_path_info` answers from `files`, a path it does
 * not list is missing, and the opener's calls are only recorded, never run.
 */
function shell(files: Record<string, 'document' | 'folder' | 'program'> = {}) {
  const invoke = vi.fn(async (command: string, args?: { path?: string }) => {
    if (command === 'client_path_info') return files[args?.path ?? ''] ?? 'missing';
    return undefined;
  });
  window.__TAURI_INTERNALS__ = { invoke } as unknown as typeof window.__TAURI_INTERNALS__;
  const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
  return { invoke, calls };
}

/** A Store with the parts a file link reaches: its machine, the thread's folder, the core's lookups and the panel. */
function storeOf(options: { os?: string; localCore?: boolean; owner?: boolean; cwd?: string; locateFile?: Store['locateFile']; listFiles?: Store['listFiles'] } = {}) {
  const panel = { openFile: vi.fn(), openFiles: vi.fn() };
  const store = {
    owner: options.owner ?? true, localCore: options.localCore ?? false,
    core: { os: options.os ?? 'linux', hostname: 'atelier' },
    threads: [{ id: 'thread', cwd: options.cwd ?? '/srv/project' }],
    openThread: { id: 'thread' },
    locateFile: vi.fn(options.locateFile ?? asWritten), listFiles: vi.fn(options.listFiles ?? (async () => ({ ok: true as const, value: [] }))),
    readFile: vi.fn(), reportError: vi.fn(), panel
  } as unknown as Store;
  return { store, panel };
}

function show(text: string, store: Store): void {
  running = mount(Prose, { target: document.body, props: { text, store, threadId: 'thread' } });
  flushSync();
}

test('a PC drive path in a thread on a Linux machine opens on this computer, and a program asks before it runs', async () => {
  const { calls } = shell({ 'N:\\dev\\orbitkit\\orbitkit-setup.exe': 'program' });
  const { store } = storeOf({ os: 'linux' });
  show('The installer: **`N:\\dev\\orbitkit\\orbitkit-setup.exe`**', store);
  const chip = query<HTMLAnchorElement>('a.file-chip');
  expect(chip.querySelector('.file-chip-name')?.textContent).toBe('orbitkit-setup.exe');
  expect(chip.title).toBe('N:\\dev\\orbitkit\\orbitkit-setup.exe');
  expect(chip.dataset.kind).toBe('program');

  chip.click();
  await vi.waitFor(() => expect(confirm.current?.title).toBe('Launch orbitkit-setup.exe?'));
  // The Linux machine is never asked for a drive it cannot have, and no card or launch comes before the answer.
  expect(store.locateFile).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid=chat-file]')).toBeNull();
  expect(calls('open_client_path')).toEqual([]);
  expect(confirm.current?.altLabel).toBe('Show in folder');
  confirm.answer('confirm');
  await vi.waitFor(() => expect(calls('open_client_path')).toEqual([{ path: 'N:\\dev\\orbitkit\\orbitkit-setup.exe', confirmed: true }]));

  await tick(); chip.click();
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  confirm.answer('alt');
  await vi.waitFor(() => expect(calls('reveal_client_path')).toEqual([{ path: 'N:\\dev\\orbitkit\\orbitkit-setup.exe' }]));

  await tick(); chip.click();
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  confirm.answer('cancel');
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(calls('open_client_path')).toHaveLength(1);
});

test('a file found nowhere greys its chip and says where it was looked for, with the path to copy', async () => {
  const { calls } = shell({ 'N:\\dev\\notes.md': 'document' });
  const { store } = storeOf({ os: 'linux', locateFile: async (_thread, path) => ({ ok: true, value: path === 'here.txt' ? [path] : [] }) });
  show('`N:\\dev\\gone.exe`, `gone.txt`, `here.txt` and `N:\\dev\\notes.md`', store);
  const [foreign, gone, here, notes] = document.querySelectorAll<HTMLAnchorElement>('a.file-chip');
  await vi.waitFor(() => expect(foreign!.hasAttribute('data-missing')).toBe(true));
  await vi.waitFor(() => expect(gone!.hasAttribute('data-missing')).toBe(true));
  expect(here!.hasAttribute('data-missing')).toBe(false);
  expect(notes!.hasAttribute('data-missing')).toBe(false);

  foreign!.click();
  await vi.waitFor(() => expect(fileNotice.current).toMatchObject({ title: 'Not found on this computer', path: 'N:\\dev\\gone.exe' }));
  await tick(); gone!.click();
  await vi.waitFor(() => expect(fileNotice.current).toMatchObject({ title: 'Not found on atelier', path: '/srv/project/gone.txt' }));
  expect(document.querySelector('[data-testid=chat-file]')).toBeNull();
  // A document on this computer opens in its app at once.
  await tick(); notes!.click();
  await vi.waitFor(() => expect(calls('open_client_path')).toEqual([{ path: 'N:\\dev\\notes.md', confirmed: false }]));
  expect(confirm.current).toBeNull();
});

test('a project file of a thread on another machine opens in the panel at its line, a folder in the file tree', async () => {
  const { invoke } = shell();
  const { store, panel } = storeOf({ os: 'linux', locateFile: async (_thread, path) => ({ ok: true, value: path === 'core.md' ? ['.local/core.md'] : [path] }) });
  setFeature('open-chat-links', true);
  show('See `src/app.ts:12`, `core.md`, `/srv/project/docs/` and `/etc/hosts`.', store);
  const [code, tail, folder, outside] = document.querySelectorAll<HTMLAnchorElement>('a.file-chip');
  code!.click();
  await vi.waitFor(() => expect(panel.openFile).toHaveBeenCalledWith('src/app.ts', 12));
  await tick(); tail!.click();
  await vi.waitFor(() => expect(panel.openFile).toHaveBeenLastCalledWith('.local/core.md', undefined));
  await tick(); folder!.click();
  await vi.waitFor(() => expect(panel.openFiles).toHaveBeenCalledWith('docs'));
  await tick(); outside!.click();
  await vi.waitFor(() => expect(fileNotice.current).toMatchObject({ title: 'Outside the project on atelier', path: '/etc/hosts' }));
  // Another machine's files never reach this computer's opener, the switch on or not.
  expect(invoke.mock.calls.filter(([name]) => name !== 'client_path_info')).toEqual([]);
});

test('a dotless file opens as a file, a greyed chip lights up once a click finds it, and a click whose thread was left opens nothing', async () => {
  let written = false;
  const locateFile = async (_thread: string, path: string) => ({ ok: true as const, value: path === 'notes.md' && !written ? [] : [path] });
  const listFiles = async () => ({ ok: true as const, value: [
    { name: 'glossary', path: 'refs/glossary', kind: 'file' as const, bytes: 4, modifiedAt: 0 },
    { name: 'docs', path: 'refs/docs', kind: 'dir' as const, bytes: null, modifiedAt: 0 },
    { name: 'v1.2', path: 'refs/v1.2', kind: 'dir' as const, bytes: null, modifiedAt: 0 },
    { name: 'takes.mp4', path: 'refs/takes.mp4', kind: 'dir' as const, bytes: null, modifiedAt: 0 }
  ] });
  const { store, panel } = storeOf({ locateFile, listFiles });
  show('`refs/glossary`, `refs/docs`, `refs/v1.2`, `refs/takes.mp4`, `notes.md` and `src/app.ts`', store);
  const [glossary, docs, dotted, takes, notes, app] = document.querySelectorAll<HTMLAnchorElement>('a.file-chip');
  glossary!.click();
  await vi.waitFor(() => expect(panel.openFile).toHaveBeenCalledWith('refs/glossary', undefined));
  expect(panel.openFiles).not.toHaveBeenCalled();
  await tick(); docs!.click();
  await vi.waitFor(() => expect(panel.openFiles).toHaveBeenCalledWith('refs/docs'));
  expect(store.listFiles).toHaveBeenCalledWith('thread', 'refs');
  // A dot in a folder's name does not make it a file.
  await tick(); dotted!.click();
  await vi.waitFor(() => expect(panel.openFiles).toHaveBeenLastCalledWith('refs/v1.2'));
  // Nor does a video's name: a folder of takes opens in the tree, not the viewer.
  await tick(); takes!.click();
  await vi.waitFor(() => expect(panel.openFiles).toHaveBeenLastCalledWith('refs/takes.mp4'));

  await vi.waitFor(() => expect(notes!.hasAttribute('data-missing')).toBe(true));
  written = true;
  await tick(); notes!.click();
  await vi.waitFor(() => expect(panel.openFile).toHaveBeenLastCalledWith('notes.md', undefined));
  expect(notes!.hasAttribute('data-missing')).toBe(false);

  // The user moves to another thread while the core looks: the panel there stays as it was.
  let answer!: (value: { ok: true; value: string[] }) => void;
  vi.mocked(store.locateFile).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const opened = panel.openFile.mock.calls.length;
  await tick(); app!.click();
  await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
  (store as unknown as { openThread: { id: string } }).openThread = { id: 'another' };
  answer({ ok: true, value: ['src/app.ts'] });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(panel.openFile.mock.calls.length).toBe(opened);
});

test('a slow look started as the chip came in cannot grey it again after a click found the file', async () => {
  let late!: (value: { ok: true; value: string[] }) => void;
  const locateFile = vi.fn<Store['locateFile']>()
    .mockImplementationOnce(() => new Promise(resolve => { late = resolve; }))
    .mockImplementation(async (_thread, path) => ({ ok: true, value: [path] }));
  const { store, panel } = storeOf({ locateFile });
  show('`notes.md`', store);
  const chip = query<HTMLAnchorElement>('a.file-chip');
  await vi.waitFor(() => expect(late).toBeTypeOf('function'));
  chip.click();
  await vi.waitFor(() => expect(panel.openFile).toHaveBeenCalledWith('notes.md', undefined));
  late({ ok: true, value: [] });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(chip.hasAttribute('data-missing')).toBe(false);
});

test('a slow look that fails cannot clear the grey a newer click put on a missing chip', async () => {
  let late!: (value: { ok: true; value: string[] }) => void;
  const locateFile = vi.fn<Store['locateFile']>()
    .mockImplementationOnce(() => new Promise(resolve => { late = resolve; }))
    .mockImplementation(async () => ({ ok: true, value: [] }));
  const { store } = storeOf({ locateFile });
  show('`notes.md`', store);
  const chip = query<HTMLAnchorElement>('a.file-chip');
  await vi.waitFor(() => expect(late).toBeTypeOf('function'));
  chip.click();
  await vi.waitFor(() => expect(chip.hasAttribute('data-missing')).toBe(true));
  // Two candidates make the old look fail.
  late({ ok: true, value: ['a/notes.md', 'b/notes.md'] });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(chip.hasAttribute('data-missing')).toBe(true);
});

test.each([false, true])('a thread on this computer opens a program only once confirmed, and documents per the switch (open-chat-links: %s)', async (direct) => {
  const { calls } = shell({ 'C:\\project\\build\\game.exe': 'program', 'C:\\project\\notes.txt': 'document' });
  const { store, panel } = storeOf({ os: 'windows', localCore: true, cwd: 'C:/project' });
  setFeature('open-chat-links', direct);
  show('[Launch game](build/game.exe) and [Notes](notes.txt)', store);
  const [game, notes] = document.querySelectorAll<HTMLAnchorElement>('a.file-chip');
  expect(game!.textContent).toBe('Launch game');
  game!.click();
  await vi.waitFor(() => expect(confirm.current?.confirmLabel).toBe('Launch'));
  expect(calls('open_client_path')).toEqual([]);
  confirm.answer('confirm');
  await vi.waitFor(() => expect(calls('open_client_path')).toEqual([{ path: 'C:\\project\\build\\game.exe', confirmed: true }]));
  await tick(); notes!.click();
  if (direct) await vi.waitFor(() => expect(calls('open_client_path')).toContainEqual({ path: 'C:\\project\\notes.txt', confirmed: false }));
  else await vi.waitFor(() => expect(panel.openFile).toHaveBeenCalledWith('notes.txt', undefined));
});

test('a shell refusal for a file of the local thread shows the notice with its path', async () => {
  const { invoke, calls } = shell();
  invoke.mockRejectedValue(new Error('shell refused path'));
  const { store } = storeOf({ os: 'windows', localCore: true, cwd: 'C:/project' });
  setFeature('open-chat-links', true);
  show('`notes.txt`', store);
  query<HTMLAnchorElement>('a.file-chip').click();
  await vi.waitFor(() => expect(fileNotice.current).toMatchObject({ title: 'Not found on this computer', path: 'C:\\project\\notes.txt' }));
  expect(store.reportError).not.toHaveBeenCalled();
  expect(calls('open_client_path')).toEqual([]);
});

test('dragging across a program link opens nothing, the next click asks first', async () => {
  const { calls } = shell({ 'C:\\project\\build\\game.exe': 'program' });
  const { store } = storeOf({ os: 'windows', localCore: true, cwd: 'C:/project' });
  show('[Launch game](build/game.exe)', store);
  const link = query<HTMLAnchorElement>('a[data-file-path]');
  link.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  link.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 60, clientY: 10 }));
  link.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 60, clientY: 10 }));
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  await vi.dynamicImportSettled();
  expect(confirm.current).toBeNull();
  link.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  link.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  expect(calls('open_client_path')).toEqual([]);
});

test('a phone opens a project file in the panel without searching, and says a PC path is not its to open', async () => {
  const { store, panel } = storeOf({ owner: false });
  show('`src/app.ts` and `N:\\dev\\notes.md`', store);
  const [code, foreign] = document.querySelectorAll<HTMLAnchorElement>('a.file-chip');
  code!.click();
  await vi.waitFor(() => expect(panel.openFile).toHaveBeenCalledWith('src/app.ts', undefined));
  await tick(); foreign!.click();
  await vi.waitFor(() => expect(fileNotice.current).toMatchObject({ title: 'Only the computer that holds this file can open it', path: 'N:\\dev\\notes.md' }));
  expect(store.locateFile).not.toHaveBeenCalled();
  expect(code!.hasAttribute('data-missing')).toBe(false);
});

test('two files of one name show their folders, and two candidates for a tail are reported', async () => {
  const locateFile = async (_thread: string, path: string) => ({ ok: true as const, value: path === 'index.ts' ? ['a/index.ts', 'b/index.ts'] : [path] });
  const { store, panel } = storeOf({ locateFile });
  show('`src/index.ts`, `test/index.ts`, `app.ts` and `index.ts`', store);
  const chips = [...document.querySelectorAll<HTMLAnchorElement>('a.file-chip')];
  await vi.waitFor(() => expect(chips.map(chip => chip.classList.contains('collide'))).toEqual([true, true, false, true]));
  chips[3]!.click();
  await vi.waitFor(() => expect(store.reportError).toHaveBeenCalledWith(new Error('index.ts names several files: a/index.ts, b/index.ts'), 'minor'));
  expect(panel.openFile).not.toHaveBeenCalled();
});

test.each([false, true])('selecting external link text skips navigation, then a click still opens it (shell: %s)', async (shell) => {
  const invoke = vi.fn(async () => {});
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  if (shell) window.__TAURI_INTERNALS__ = { invoke } as unknown as typeof window.__TAURI_INTERNALS__;
  running = mount(Prose, { target: document.body, props: { text: '[External reference](https://example.invalid/reference)' } });
  flushSync();
  const stopLinks = installExternalLinks(document.body);
  try {
    const link = query<HTMLAnchorElement>('a[href]');
    link.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    link.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 60, clientY: 10 }));
    link.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 60, clientY: 10 }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    link.dispatchEvent(click);
    await vi.dynamicImportSettled();
    expect(click.defaultPrevented).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    link.click();
    if (shell) await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', { url: 'https://example.invalid/reference', with: undefined }, undefined));
    else expect(opened).toHaveBeenCalledWith('https://example.invalid/reference', '_blank', 'noopener,noreferrer');
  } finally { stopLinks(); opened.mockRestore(); }
});


test('a fenced block carries a copy button that writes the code to the clipboard', async () => {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  running = mount(Prose, {
    target: document.body,
    props: { text: 'Run it:\n\n```sh\nbun run --cwd packages/ui test\n```\n' }
  });
  flushSync();
  await tick();

  // One button per fenced block, inside the wrapper the effect hangs around it.
  const button = query<HTMLButtonElement>('[data-testid=code-copy]');
  expect(button.parentElement?.classList.contains('code-block')).toBe(true);
  expect(document.querySelectorAll('[data-testid=code-copy]')).toHaveLength(1);
  expect(button.textContent).toBe('Copy');

  button.click();
  await tick();
  await tick();

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0]?.[0]).toContain('bun run --cwd packages/ui test');
  expect(button.textContent).toBe('Copied');

  // The label goes back on the way out, so nothing has to time it.
  button.dispatchEvent(new Event('pointerleave'));
  expect(button.textContent).toBe('Copy');
});

test('tilde and longer backtick fences render as code with a copy button, blank lines and inner fences included', async () => {
  running = mount(Prose, {
    target: document.body,
    props: { text: 'One:\n\n~~~ts\nconst a = 1;\n\nconst b = 2;\n~~~\n\nTwo:\n\n````md\n```sh\nls\n```\n\nend\n````\n' }
  });
  flushSync();
  await tick();

  const code = [...document.querySelectorAll('pre code')].map(node => node.textContent);
  expect(code).toEqual(['const a = 1;\n\nconst b = 2;', '```sh\nls\n```\n\nend']);
  expect(document.querySelectorAll('[data-testid=code-copy]')).toHaveLength(2);
});

test('fenced code inside a quote carries its copy button too', async () => {
  running = mount(Prose, {
    target: document.body,
    props: { text: 'Quoted:\n\n> ```sh\n> echo hello\n> ```\n\n> ~~~\n> echo tilde\n> ~~~\n' }
  });
  flushSync();
  await tick();

  const code = [...document.querySelectorAll('pre code')].map(node => node.textContent);
  expect(code).toEqual(['echo hello', 'echo tilde']);
  expect(document.querySelectorAll('blockquote [data-testid=code-copy]')).toHaveLength(2);
});

test('a block that is still being written carries no button yet', async () => {
  // The pass that hangs them walks every block of the answer, and it ran every
  // 48 ms while the part streamed, for a button on code nobody can copy yet.
  running = mount(Prose, {
    target: document.body,
    props: { text: 'Run it:\n\n```sh\nbun run --cwd packages/ui te', live: true }
  });
  flushSync();
  // An unfinished fenced block stays buffered while the complete paragraph is visible.
  await new Promise((resolve) => setTimeout(resolve, 120));
  flushSync();
  await tick();

  expect(document.querySelector('pre')).toBeNull();
  expect(query('[data-testid=text-part]').textContent).toContain('Run it:');
  expect(document.querySelector('[data-testid=code-copy]')).toBeNull();
});

test('live text shows the unfinished paragraph instead of only typing dots', () => {
  running = mount(Prose, { target: document.body, props: { text: 'First paragraph.\n\nWriting the next', live: true, typing: true, bubble: true } });
  flushSync();
  expect(query('[data-testid=text-part]').textContent).toContain('Writing the next');
});

test('plain text preserves its rendered content and gets no copy button', async () => {
  running = mount(Prose, { target: document.body, props: { text: 'Plain `inline` text only.' } });
  flushSync();
  await tick();

  expect(query('[data-testid=text-part]').textContent).toBe('Plain inline text only.');
  expect(document.querySelector('[data-testid=code-copy]')).toBeNull();
});

test('a file link\'s menu copies the whole or the relative path, shows it in its folder and still opens it', async () => {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const { calls } = shell({ 'E:\\Hexalife\\addons\\printer.qc': 'document' });
  const { store, panel } = storeOf({ os: 'windows', localCore: true, cwd: 'E:\\Hexalife' });
  show('See `addons/printer.qc:12`, `E:\\Hexalife\\models\\` and `thr_abcdefabcdef12`.', store);
  const [file, folder] = document.querySelectorAll<HTMLAnchorElement>('a[data-file-path]');

  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  file!.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
  expect(contextMenu.current?.items.map(item => item.id)).toEqual(['open', 'reveal', 'copy', 'copy-relative']);
  contextMenu.current!.onpick('copy');
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('E:\\Hexalife\\addons\\printer.qc'));
  file!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  contextMenu.current!.onpick('copy-relative');
  await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith('addons\\printer.qc'));
  file!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  contextMenu.current!.onpick('reveal');
  await vi.waitFor(() => expect(calls('reveal_client_path')).toEqual([{ path: 'E:\\Hexalife\\addons\\printer.qc' }]));

  folder!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  contextMenu.current!.onpick('copy');
  await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith('E:\\Hexalife\\models\\'));

  file!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  contextMenu.current!.onpick('open');
  await vi.waitFor(() => expect(panel.openFile).toHaveBeenCalledWith('addons/printer.qc', 12));

  query<HTMLAnchorElement>('a[data-thread-address]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  contextMenu.current!.onpick('copy');
  await vi.waitFor(() => expect(writeText).toHaveBeenLastCalledWith('thr_abcdefabcdef12'));
  contextMenu.close();
});

test('show in folder for a file found on another computer names the found path', async () => {
  const { calls } = shell();
  const { store } = storeOf({ locateFile: async () => ({ ok: true, value: ['docs/notes.txt'] }) });
  show('`/srv/project/notes.txt`', store);
  query<HTMLAnchorElement>('a.file-chip').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  expect(contextMenu.current?.items.some(item => item.id === 'reveal')).toBe(true);
  contextMenu.current!.onpick('reveal');
  contextMenu.close();
  await vi.waitFor(() => expect(fileNotice.current).toMatchObject({ title: 'Only the computer that holds this file can open it', path: '/srv/project/docs/notes.txt' }));
  expect(calls('reveal_client_path')).toEqual([]);
});

test('a phone\'s menu has no folder to show, and a copied selection carries a chip\'s whole path', async () => {
  const { store } = storeOf({ owner: false });
  show('Edit `src/lib/app.ts:12` now.', store);
  const chip = query<HTMLAnchorElement>('a.file-chip');
  chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  expect(contextMenu.current?.items.map(item => item.id)).toEqual(['open', 'copy', 'copy-relative']);
  contextMenu.close();
  const paragraph = query('[data-testid=paragraph] p');
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  // jsdom has no DataTransfer: the copy event carries a stand-in for the clipboard.
  const copied = new Map<string, string>();
  const event = Object.assign(new Event('copy', { bubbles: true, cancelable: true }), { clipboardData: { setData: (type: string, text: string) => copied.set(type, text) } });
  paragraph.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(copied.get('text/plain')).toBe('Edit src/lib/app.ts:12 now.');
});

test('unmount releases the standalone diagram URL while its viewer chunk is still pending', async () => {
  const { parts } = await import('../lib/deferred-parts');
  const load = vi.spyOn(parts.ImageViewer, 'load').mockImplementation(() => new Promise(() => {}));
  const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  const revoke = vi.fn();
  Object.assign(URL, { createObjectURL: () => 'blob:diagram-unmount', revokeObjectURL: revoke });
  try {
    running = mount(Prose, { target: document.body, props: { text: ['```mermaid', 'flowchart LR', '  A --> B', '```'].join('\n') } });
    await vi.waitFor(() => expect(document.querySelector('[data-testid=diagram-enlarge]')).not.toBeNull(), { timeout: 10_000 });
    query<HTMLButtonElement>('[data-testid=diagram-enlarge]').click();
    flushSync();
    expect(load).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    await unmount(running);
    running = null;
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:diagram-unmount');
  } finally {
    load.mockRestore();
    Object.assign(URL, original);
  }
});

test('a media chip replacing a standalone diagram releases the diagram URL', async () => {
  const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  const revoke = vi.fn();
  Object.assign(URL, { createObjectURL: () => 'blob:diagram-replacement', revokeObjectURL: revoke });
  try {
    const { store } = storeOf();
    vi.mocked(store.readFile).mockResolvedValue({ ok: true, value: { kind: 'image', path: 'notes.png', bytes: 4, modifiedAt: 0, mime: 'image/png', url: '/file/test' } });
    show('```mermaid\nflowchart LR\n  A --> B\n```\n\n`notes.png`', store);
    await vi.waitFor(() => expect(document.querySelector('[data-testid=diagram-enlarge]')).not.toBeNull(), { timeout: 10_000 });
    query<HTMLButtonElement>('[data-testid=diagram-enlarge]').click();
    await vi.waitFor(() => expect(query('[data-testid=image-viewer]').getAttribute('aria-label')).toBe('Diagram.svg'));
    expect(revoke).not.toHaveBeenCalled();
    query<HTMLAnchorElement>('a.file-chip').click();
    await vi.waitFor(() => expect(query('[data-testid=image-viewer]').getAttribute('aria-label')).toBe('notes.png'));
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:diagram-replacement');
  } finally {
    Object.assign(URL, original);
  }
});
