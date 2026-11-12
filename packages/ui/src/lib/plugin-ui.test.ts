import { afterEach, expect, test, vi } from 'vitest';
import type { PluginUiBundle, RpcEventName } from '@boite/contracts';
import { FakeClient } from './fake-client';
import { LOADING_KEY, PluginUi, safeModeAt, type PluginUiClient } from './plugin-ui.svelte';
import helloSource from '../../../../examples/plugins/hello/ui/index.js?raw';
import * as helloModule from '../../../../examples/plugins/hello/ui/index.js';

/** A core that serves `bundles` and records what scripts call. */
function core(bundles: PluginUiBundle[]) {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const calls: { method: string; params: unknown }[] = [];
  const client: PluginUiClient = {
    call: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method === 'plugins.ui') return structuredClone(bundles);
      return [{ id: 't1', title: 'One', updatedAt: 1 }];
    }) as PluginUiClient['call'],
    on: ((event: RpcEventName, handler: (payload: unknown) => void) => {
      const set = handlers.get(event) ?? new Set();
      handlers.set(event, set);
      set.add(handler);
      return () => set.delete(handler);
    }) as PluginUiClient['on'],
  };
  const emit = (event: string, payload: unknown) => { for (const handler of handlers.get(event) ?? []) handler(payload); };
  return { client, calls, emit, set: (next: PluginUiBundle[]) => { bundles = next; } };
}

function bundle(id: string, script: string, more: Partial<PluginUiBundle> = {}): PluginUiBundle {
  return { id, name: id.toUpperCase(), version: '1.0.0', digest: `${id}-1`, script, style: null, permissions: ['threads.read', 'ui'], settings: {}, error: null, ...more };
}

/** Scripts by their source text: jsdom imports no blob URL, the e2e does. */
function loader(modules: Record<string, (api: any) => unknown>, storage: Map<string, string> = new Map()) {
  const ui = new PluginUi();
  const opened: string[] = [];
  const store = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  ui.start({
    openTab: (key) => opened.push(key),
    threadId: () => 't1',
    importModule: async (source) => {
      const run = modules[source];
      if (!run) throw new SyntaxError(`Unexpected token in ${source}`);
      return { url: null, module: { default: run } };
    },
    storage: store,
  }, safeModeAt('', store));
  return { ui, opened, storage };
}

let live: PluginUi[] = [];
afterEach(() => { for (const ui of live) ui.stop(); live = []; vi.useRealTimers(); });

test('a script fills every slot, its RPC reaches only what it was granted, and unloading takes all of it back', async () => {
  const cleanup = vi.fn();
  const { ui, opened } = loader({
    a: (boite) => {
      boite.ui.addButton({ id: 'go', slot: 'thread-header', label: 'Go', onClick: () => boite.ui.openPanelTab('tab') });
      boite.ui.addMessageAction({ id: 'act', label: 'Act', onClick: () => undefined });
      boite.ui.addPanelTab({ id: 'tab', title: 'Tab', mount: () => cleanup });
      boite.ui.addCommand({ id: 'cmd', title: 'Command', onRun: () => undefined });
      boite.onCleanup(cleanup);
    },
  });
  live.push(ui);
  const fake = core([bundle('a', 'a')]);
  ui.attach(fake.client);
  await ui.refresh();
  expect(ui.status.a?.state).toBe('running');
  expect(ui.buttonsFor('thread-header').map((entry) => entry.key)).toEqual(['a/go']);
  expect(ui.messageActions.map((entry) => entry.key)).toEqual(['a/act']);
  expect(ui.commands.map((entry) => entry.key)).toEqual(['a/cmd']);
  ui.buttons[0]!.run({ threadId: 't1' });
  expect(opened).toEqual(['a/tab']);

  fake.set([]);
  fake.emit('plugins.uiUpdated', { digest: 'x' });
  await ui.refresh();
  expect(ui.buttons).toEqual([]);
  expect(ui.tabs).toEqual([]);
  expect(ui.status.a).toBeUndefined();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('a panel tab\'s cleanup runs exactly once, whether the tab closes or its plugin unloads first', async () => {
  const closed = vi.fn();
  const unloaded = vi.fn(() => { throw new Error('cleanup threw'); });
  const { ui } = loader({
    a: (boite) => {
      boite.ui.addPanelTab({ id: 'closed', title: 'Closed', mount: () => closed });
      boite.ui.addPanelTab({ id: 'open', title: 'Open', mount: () => unloaded });
    },
  });
  live.push(ui);
  const fake = core([bundle('a', 'a')]);
  ui.attach(fake.client);
  await ui.refresh();
  const closeTab = ui.tab('a/closed')!.mount(document.createElement('div'), { threadId: null })!;
  const stillOpen = ui.tab('a/open')!.mount(document.createElement('div'), { threadId: null })!;
  closeTab();
  closeTab();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(ui.status.a?.state).toBe('running');

  // Uninstalled with a tab open: its cleanup runs then, its throw logged, and not again when the tab goes.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  fake.set([]);
  await ui.refresh();
  expect(unloaded).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith('plugin a cleanup: cleanup threw');
  warn.mockRestore();
  stillOpen();
  expect(unloaded).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
});

test('a panel tab\'s async cleanup that rejects stops its plugin when the tab closes, and is only logged during unload', async () => {
  const rejecting = vi.fn(async () => { throw new Error('async cleanup threw'); });
  const { ui } = loader({ a: (boite) => { boite.ui.addPanelTab({ id: 't', title: 'T', mount: () => rejecting }); } });
  live.push(ui);
  const fake = core([bundle('a', 'a')]);
  ui.attach(fake.client);
  await ui.refresh();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const closeTab = ui.tab('a/t')!.mount(document.createElement('div'), { threadId: null })!;
  closeTab();
  closeTab();
  await vi.waitFor(() => expect(ui.status.a).toMatchObject({ state: 'failed', error: 'async cleanup threw' }));
  expect(rejecting).toHaveBeenCalledTimes(1);

  // Loaded again, then unloaded with the tab open: the rejection is logged, the unload goes on.
  fake.set([bundle('a', 'a', { digest: 'a-2' })]);
  await ui.refresh();
  ui.tab('a/t')!.mount(document.createElement('div'), { threadId: null });
  fake.set([]);
  await ui.refresh();
  await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('plugin a cleanup: async cleanup threw'));
  expect(rejecting).toHaveBeenCalledTimes(2);
  expect(ui.status.a).toBeUndefined();
  warn.mockRestore();
});

test('the RPC client refuses a method or event the plugin was not granted, and calls the granted ones', async () => {
  let api: any;
  const { ui } = loader({ a: (boite) => { api = boite; } });
  live.push(ui);
  const fake = core([bundle('a', 'a')]);
  ui.attach(fake.client);
  await ui.refresh();
  await expect(api.rpc.call('turns.start', {})).rejects.toThrow('turns.start needs a permission a was not granted (granted: threads.read, ui)');
  await expect(api.rpc.call('plugins.install', { id: 'x' })).rejects.toThrow('needs a permission');
  expect(() => api.rpc.on('todos.updated', () => undefined)).toThrow('todos.updated needs a permission');
  expect(await api.rpc.call('threads.list', {})).toEqual([{ id: 't1', title: 'One', updatedAt: 1 }]);
  const seen: unknown[] = [];
  api.rpc.on('thread.updated', (payload: unknown) => seen.push(payload));
  fake.emit('thread.updated', { id: 't1' });
  expect(seen).toEqual([{ id: 't1' }]);
});

test('a script that throws stops its plugin alone, its card says why, and it loads again once it changes', async () => {
  const { ui } = loader({
    bad: () => { throw new Error('boom at start'); },
    good: (boite) => { boite.ui.addButton({ id: 'b', slot: 'composer', label: 'B', onClick: () => { throw new Error('boom on click'); } }); },
    fixed: (boite) => { boite.ui.addButton({ id: 'b', slot: 'sidebar', label: 'Fixed', onClick: () => undefined }); },
  });
  live.push(ui);
  const fake = core([bundle('bad', 'bad'), bundle('good', 'good'), bundle('syntax', 'not a module')]);
  ui.attach(fake.client);
  await ui.refresh();
  expect(ui.status.bad).toMatchObject({ state: 'failed', error: 'boom at start' });
  expect(ui.status.syntax).toMatchObject({ state: 'failed', error: 'Unexpected token in not a module' });
  expect(ui.status.good?.state).toBe('running');

  // A handler that throws later: the plugin's entries go with it.
  ui.buttonsFor('composer')[0]!.run({ threadId: null });
  expect(ui.status.good).toMatchObject({ state: 'failed', error: 'boom on click' });
  expect(ui.buttons).toEqual([]);

  // The same files are not tried again on a refresh; new ones are.
  await ui.refresh();
  expect(ui.status.bad?.state).toBe('failed');
  fake.set([bundle('bad', 'fixed', { digest: 'bad-2' }), bundle('good', 'good'), bundle('syntax', 'not a module')]);
  await ui.refresh();
  expect(ui.status.bad?.state).toBe('running');
  expect(ui.buttonsFor('sidebar').map((entry) => entry.label)).toEqual(['Fixed']);
});

test('a bundle the core could not verify is shown failed with its reason and runs nothing', async () => {
  const run = vi.fn();
  const { ui } = loader({ a: run });
  live.push(ui);
  ui.attach(core([bundle('a', 'a', { error: 'The interface files of A 1.0.0 are missing or altered. Reinstall A.' })]).client);
  await ui.refresh();
  expect(ui.status.a).toMatchObject({ state: 'failed', error: 'The interface files of A 1.0.0 are missing or altered. Reinstall A.' });
  expect(run).not.toHaveBeenCalled();
});

test('settings reach the script without a reload', async () => {
  const runs = vi.fn();
  const seen: unknown[] = [];
  const { ui } = loader({ a: (boite) => { runs(); boite.settings.onChange((values: unknown) => seen.push(values)); } });
  live.push(ui);
  const fake = core([bundle('a', 'a', { settings: { greeting: 'hi' } })]);
  ui.attach(fake.client);
  await ui.refresh();
  fake.set([bundle('a', 'a', { settings: { greeting: 'hello' } })]);
  await ui.refresh();
  expect(runs).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([{ greeting: 'hello' }]);
});

test('safe mode: the flag, or a start that died loading scripts, keeps them off until asked', async () => {
  expect(safeModeAt('?safe=1', null)).toEqual({ active: true, reason: 'flag' });
  expect(safeModeAt('?safe', null)).toEqual({ active: true, reason: 'flag' });
  expect(safeModeAt('?safe=0', null)).toEqual({ active: false, reason: null });

  vi.useFakeTimers();
  const storage = new Map<string, string>();
  const run = vi.fn();
  // A start that loads: the marker is set while scripts load and cleared once the start held.
  const first = loader({ a: run }, storage);
  first.ui.attach(core([bundle('a', 'a')]).client);
  await first.ui.refresh();
  expect(storage.has(LOADING_KEY)).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(storage.has(LOADING_KEY)).toBe(false);
  first.ui.stop();

  // A start that died while loading leaves the marker: the next start is in safe mode.
  storage.set(LOADING_KEY, '1');
  run.mockClear();
  const next = loader({ a: run }, storage);
  live.push(next.ui);
  expect(next.ui.safe).toEqual({ active: true, reason: 'crash' });
  next.ui.attach(core([bundle('a', 'a')]).client);
  await next.ui.refresh();
  expect(next.ui.status.a?.state).toBe('skipped');
  expect(run).not.toHaveBeenCalled();
  await next.ui.leaveSafeMode();
  expect(next.ui.status.a?.state).toBe('running');
  expect(run).toHaveBeenCalledTimes(1);
});

test('a refresh asked while a failing one runs still reads the core', async () => {
  const { ui } = loader({ a: () => undefined });
  live.push(ui);
  let fail!: (error: Error) => void;
  let reads = 0;
  const client: PluginUiClient = {
    call: (async (method: string) => {
      if (method !== 'plugins.ui') return [];
      reads += 1;
      if (reads === 1) return new Promise((_, reject) => { fail = reject; });
      return [bundle('a', 'a')];
    }) as PluginUiClient['call'],
    on: (() => () => undefined) as PluginUiClient['on'],
  };
  ui.attach(client);
  const queued = ui.refresh();
  fail(new Error('connection dropped'));
  await queued;
  expect(reads).toBe(2);
  expect(ui.status.a?.state).toBe('running');
});

test('a window closed right after its scripts load leaves no crash marker for the next start', async () => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  const first = loader({ a: () => undefined }, storage);
  first.ui.attach(core([bundle('a', 'a')]).client);
  await first.ui.refresh();
  expect(storage.has(LOADING_KEY)).toBe(true);
  first.ui.stop();
  expect(storage.has(LOADING_KEY)).toBe(false);
  const next = loader({ a: () => undefined }, storage);
  live.push(next.ui);
  expect(next.ui.safe).toEqual({ active: false, reason: null });
});

test('the example plugin, added on the fake client, draws its recent conversations in its panel tab', async () => {
  const client = new FakeClient({ delayMs: 0 });
  try {
    await client.connect();
    const ui = new PluginUi();
    live.push(ui);
    const opened: string[] = [];
    ui.start({
      openTab: (key) => opened.push(key),
      threadId: () => null,
      importModule: async (source) => {
        if (source !== helloSource) throw new Error('the fake served another script than examples/plugins/hello/ui/index.js');
        return { url: null, module: helloModule };
      },
      storage: null,
    }, { active: false, reason: null });
    const announced = new Promise((resolve) => client.on('plugins.uiUpdated', resolve));
    ui.attach(client);
    const preview = await client.call('plugins.inspect', { url: 'https://github.com/example/hello' });
    expect(preview.manifest?.permissions).toEqual(['threads.read', 'ui']);
    await client.call('plugins.add', { previewId: preview.previewId! });
    await announced;
    await ui.refresh();
    expect(ui.status.hello?.state).toBe('running');
    const header = ui.buttonsFor('thread-header');
    expect(header.map((entry) => entry.label)).toEqual(['Recent conversations']);
    header[0]!.run({ threadId: null });
    expect(opened).toEqual(['hello/recent']);

    const element = document.createElement('div');
    const stop = ui.tab('hello/recent')!.mount(element, { threadId: null });
    await vi.waitFor(() => expect(element.querySelectorAll('.hello-recent li').length).toBeGreaterThan(0));
    const threads = await client.call('threads.list', {});
    const latest = threads.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((thread) => thread.title || '(untitled)');
    expect([...element.querySelectorAll('.hello-title')].map((node) => node.textContent)).toEqual(latest);
    stop?.();

    await client.call('plugins.uninstall', { id: 'hello' });
    await ui.refresh();
    expect(ui.buttons).toEqual([]);
    expect(ui.status.hello).toBeUndefined();
  } finally { client.close(); }
});
