import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { ATTACHMENT_MAX_BYTES, RpcErrorCode, type CoreLogRecord, type CoreLogsQuery } from '@boite/contracts';
import { RpcFailure } from '../lib/client';
import DiagnosticsPage from './DiagnosticsPage.svelte';
import type { Store } from '../lib/store.svelte';

vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  invoke: vi.fn(),
}));

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(invoke).mockReset();
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

/** `core.logs` as the core answers it: newest first, `since` and `until` inclusive, at most `limit`. */
function logs(records: CoreLogRecord[], query: CoreLogsQuery): CoreLogRecord[] {
  return records
    .filter(record => (query.since === undefined || record.at >= query.since) && (query.until === undefined || record.at <= query.until))
    .sort((a, b) => b.at - a.at)
    .slice(0, query.limit ?? 100);
}

async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) { await Promise.resolve(); await tick(); }
  flushSync();
}

test('a burst past one page between two reads reaches the page whole, and rows the cap drops leave Load older', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const start = Date.now();
  const record = (index: number): CoreLogRecord => ({ id: `r${index}`, runId: 'run_test', level: 'info', at: start - 60_000 + index, origin: 'core', source: 'test', event: 'test.line', message: `line ${index}` });
  const records = Array.from({ length: 10 }, (_, index) => record(index));
  const call = vi.fn(async (method: string, params: CoreLogsQuery) => {
    if (method === 'core.logs') return logs(records, params);
    return new Promise(() => {});
  });
  const store = { client: { call }, owner: true, connection: 'ready', threads: [], settings: null } as unknown as Store;
  running = mount(DiagnosticsPage, { target: document.body, props: { store } });
  await settle();
  const shown = () => [...document.querySelectorAll('[data-testid=diagnostics-record]')].length;
  expect(shown()).toBe(10);
  expect(document.querySelector('[data-testid=diagnostics-older]')).toBeNull();

  // 450 records in one interval: more than the 200 one read returns.
  for (let index = 10; index < 460; index += 1) records.push(record(index));
  await vi.advanceTimersByTimeAsync(3000);
  await settle();
  expect(shown()).toBe(460);

  // Past the 2000 rows the page keeps, the oldest leave the view and Load older offers them again.
  for (let index = 460; index < 2100; index += 1) records.push(record(index));
  for (let round = 0; round < 3; round += 1) { await vi.advanceTimersByTimeAsync(3000); await settle(); }
  expect(shown()).toBe(2000);
  expect(document.querySelector('[data-testid=diagnostics-older]')).not.toBeNull();
});

test('a core older than the anonymized log names its machine and turns off the export and the report it cannot answer', async () => {
  const call = vi.fn(async (method: string) => {
    if (method === 'core.logs') return [];
    throw new RpcFailure({ code: RpcErrorCode.MethodNotFound, message: `unknown method ${method}` });
  });
  const store = { client: { call }, owner: true, connection: 'ready', threads: [], settings: null, core: { hostname: 'boite' } } as unknown as Store;
  running = mount(DiagnosticsPage, { target: document.body, props: { store } });
  await settle();
  const outdated = document.querySelector('[data-testid=diagnostics-outdated]');
  expect(outdated?.textContent).toContain('Boite on boite');
  expect(document.querySelector('[data-testid=diagnostics-problems]')).toBeNull();
  expect((document.querySelector('[data-testid=diagnostics-export]') as HTMLButtonElement).disabled).toBe(true);
  expect((document.querySelector('[data-testid=diagnostics-report]') as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent).not.toContain('unknown method');
  expect(call.mock.calls.map(([method]) => method)).not.toContain('diagnostics.export');
});

test('the desktop saves an anonymized export over 5 MiB through its file ticket', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const endpointUrl = 'http://127.0.0.1:4311';
  const name = 'boite-diagnostics-test.txt';
  const url = `/file/${'a'.repeat(64)}`;
  const text = 'Synthetic anonymized report.\n'.repeat(200_000);
  const bytes = new TextEncoder().encode(text).byteLength;
  expect(bytes).toBeGreaterThan(ATTACHMENT_MAX_BYTES);
  let refusal: string | null = null;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'save_attachment' && ArrayBuffer.isView(args) && args.byteLength > ATTACHMENT_MAX_BYTES) {
      refusal = `body: expected at most ${ATTACHMENT_MAX_BYTES} bytes, got ${args.byteLength}`;
      throw new Error(refusal);
    }
    return { path: `/Downloads/${name}`, opened: false } as never;
  });
  const call = vi.fn(async (method: string) => {
    if (method === 'diagnostics.exportFile') return { name, bytes, url };
    if (method === 'diagnostics.export') return { name, text };
    if (method === 'core.logs') return [];
    return new Promise(() => {});
  });
  const store = { client: { call }, endpointUrl, owner: true, connection: 'ready', threads: [], settings: null } as unknown as Store;
  running = mount(DiagnosticsPage, { target: document.body, props: { store } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=diagnostics-export]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=diagnostics-export-note]')).not.toBeNull());
  expect(refusal).toBeNull();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(['save_attachment_url']);
  expect(vi.mocked(invoke).mock.calls[0]?.[1]).toEqual({ name, url: `${endpointUrl}${url}`, open: false });
  expect(document.querySelector('[data-testid=diagnostics-export-note]')?.textContent).toContain(`Saved ${name}`);
});

test('a desktop connected to an older core still saves the text it receives', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const name = 'boite-diagnostics-test.txt';
  const text = 'Synthetic report with accents é.\n';
  vi.mocked(invoke).mockResolvedValue({ path: `/Downloads/${name}`, opened: false });
  const call = vi.fn(async (method: string) => {
    if (method === 'diagnostics.exportFile') throw new RpcFailure({ code: RpcErrorCode.MethodNotFound, message: `unknown method ${method}` });
    if (method === 'diagnostics.export') return { name, text };
    if (method === 'core.logs') return [];
    return new Promise(() => {});
  });
  const store = { client: { call }, endpointUrl: 'http://127.0.0.1:4311', owner: true, connection: 'ready', threads: [], settings: null } as unknown as Store;
  running = mount(DiagnosticsPage, { target: document.body, props: { store } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=diagnostics-export]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=diagnostics-export-note]')?.textContent).toContain(`Saved ${name}`));
  expect(call.mock.calls.filter(([method]) => method.startsWith('diagnostics.export')).map(([method]) => method)).toEqual(['diagnostics.exportFile', 'diagnostics.export']);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('save_attachment', new TextEncoder().encode(text), expect.objectContaining({ headers: { 'x-boite-name': name, 'x-boite-open': '0' } }));
});

test.each(['browser', 'phone'] as const)('the %s still receives the full text export', async platform => {
  const name = 'boite-diagnostics-test.txt';
  const text = 'Synthetic report with accents é.\n';
  const createObjectURL = vi.fn((_file: File) => 'blob:diagnostics');
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const share = vi.fn(async (_data: ShareData) => {});
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
  vi.stubGlobal('matchMedia', () => ({ matches: platform === 'phone' }));
  Object.assign(navigator, { canShare: () => true, share });
  const call = vi.fn(async (method: string) => {
    if (method === 'diagnostics.export') return { name, text };
    if (method === 'core.logs') return [];
    return new Promise(() => {});
  });
  const store = { client: { call }, endpointUrl: 'https://core.example', owner: true, connection: 'ready', threads: [], settings: null } as unknown as Store;
  running = mount(DiagnosticsPage, { target: document.body, props: { store } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=diagnostics-export]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=diagnostics-export-note]')?.textContent).toContain(name));
  expect(call.mock.calls.filter(([method]) => method.startsWith('diagnostics.export')).map(([method]) => method)).toEqual(['diagnostics.export']);
  expect(invoke).not.toHaveBeenCalled();
  if (platform === 'phone') {
    expect(share).toHaveBeenCalledOnce();
    const file = share.mock.calls[0]?.[0].files?.[0];
    expect(file?.name).toBe(name);
    expect(await file?.text()).toBe(text);
  } else {
    expect(download).toHaveBeenCalledOnce();
    const file = createObjectURL.mock.calls[0]?.[0];
    expect(file?.name).toBe(name);
    expect(await file?.text()).toBe(text);
  }
});

test('a problem says when it was last seen in one sentence, the relative time carrying its own "ago"', async () => {
  const problem = { origin: 'core', source: 'test', event: 'test.failed', level: 'error', count: 1, firstAt: Date.now() - 2_400_000, lastAt: Date.now() - 2_400_000, message: 'failed', threadIds: [] };
  const call = vi.fn(async (method: string) => {
    if (method === 'diagnostics.summary') return { problems: [problem] };
    if (method === 'core.logs') return [];
    return new Promise(() => {});
  });
  const store = { client: { call }, owner: true, connection: 'ready', threads: [], settings: null } as unknown as Store;
  running = mount(DiagnosticsPage, { target: document.body, props: { store } });
  await settle();
  const when = document.querySelector('[data-testid=diagnostics-problem] .when')!.textContent!;
  expect(when).toBe('last seen 40m ago');
});

test('a count of one takes the singular word: "1 detail", never "1 details"', async () => {
  const environment = { version: '2.4.0', channel: 'stable', platform: 'linux', osRelease: '6.8', arch: 'x64', uptimeMs: 60_000 };
  const call = vi.fn(async (method: string) => {
    if (method === 'diagnostics.summary') return { generatedAt: Date.now(), environment, problems: [], threads: [], logFiles: [], counts: { debug: 1, info: 4, warn: 1, error: 2 }, since: Date.now() - 86_400_000 };
    if (method === 'core.logs') return [];
    return new Promise(() => {});
  });
  const store = { client: { call }, owner: true, connection: 'ready', threads: [], settings: null } as unknown as Store;
  running = mount(DiagnosticsPage, { target: document.body, props: { store } });
  await settle();
  const counts = Array.from(document.querySelectorAll('[data-testid=diagnostics-counts] .count')).map(el => el.textContent?.replace(/\s+/g, ' ').trim());
  expect(counts).toEqual(['2 errors', '1 warning', '4 info', '1 detail']);
});
