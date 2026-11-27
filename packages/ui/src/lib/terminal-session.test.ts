import { expect, test, vi } from 'vitest';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { FakeClient } from './fake-client';
import { Store } from './store.svelte';
import { TerminalSession, type TerminalAttachment } from './terminal-session.svelte';

test('the first buffered terminal input follows the pending resize', async () => {
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store();
  store.attach(client);
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.append(host);
  const OriginalObserver = globalThis.ResizeObserver;
  let resized!: ResizeObserverCallback;
  globalThis.ResizeObserver = class extends OriginalObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      resized = callback;
    }
  };
  const opened = vi.spyOn(Terminal.prototype, 'open');
  const terminal = () => opened.mock.contexts[0] as Terminal | undefined;
  let cols = 80;
  const fit = vi.spyOn(FitAddon.prototype, 'fit').mockImplementation(() => terminal()?.resize(cols, 24));
  const order: string[] = [];
  const resize = vi.spyOn(store, 'resizeTerminal').mockImplementation((_id, width) => { order.push(`resize ${width}`); });
  const write = vi.spyOn(store, 'writeTerminal').mockImplementation((_id, data) => { order.push(`write ${data}`); });
  let resolve!: (state: TerminalAttachment) => void;
  const start = vi.fn(() => new Promise<TerminalAttachment>(done => { resolve = done; }));
  const session = new TerminalSession(store, 'term', start, () => {});
  try {
    await store.connect();
    session.mount(host, { autofocus: false });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    terminal()!.input('x', true);
    cols = 100;
    resized([], {} as ResizeObserver);
    resolve({ id: 'term', cwd: '/workspace', output: '' });
    await vi.waitFor(() => expect(order).toContain('write x'));
    expect(order.slice(0, 2)).toEqual(['resize 100', 'write x']);
  } finally {
    session.dispose();
    resize.mockRestore();
    write.mockRestore();
    fit.mockRestore();
    opened.mockRestore();
    globalThis.ResizeObserver = OriginalObserver;
    host.remove();
    store.detach();
    client.close();
  }
});

test('a third detached terminal frees only the oldest screen, and the session can attach again', async () => {
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store();
  store.attach(client);
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  document.body.append(host);
  const opened = vi.spyOn(Terminal.prototype, 'open');
  const disposed = vi.spyOn(Terminal.prototype, 'dispose');
  const sessions = ['a', 'b', 'c'].map(id => {
    const attachment = vi.fn(async () => ({ id, cwd: '/workspace', output: 'shell output' }));
    return { session: new TerminalSession(store, id, attachment, () => {}), attachment };
  });
  try {
    await store.connect();
    for (const { session, attachment } of sessions) {
      session.mount(host, { autofocus: false });
      await vi.waitFor(() => expect(attachment).toHaveBeenCalledOnce());
      session.unmount(host);
    }
    expect(disposed.mock.contexts).toEqual([opened.mock.contexts[0]]);
    sessions[0]!.session.mount(host, { autofocus: false });
    await vi.waitFor(() => expect(sessions[0]!.attachment).toHaveBeenCalledTimes(2));
    expect(opened).toHaveBeenCalledTimes(4);
    expect(disposed.mock.contexts).toEqual([opened.mock.contexts[0]]);
  } finally {
    for (const { session } of sessions) session.dispose();
    opened.mockRestore();
    disposed.mockRestore();
    host.remove();
    store.detach();
    client.close();
  }
});
