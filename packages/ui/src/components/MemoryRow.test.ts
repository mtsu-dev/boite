import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { strings } from '../lib/strings';
import { setLocaleSetting } from '../lib/i18n.svelte';
import MemoryCorner from './MemoryCorner.svelte';
import MemoryRow from './MemoryRow.svelte';
import MessageList from './MessageList.svelte';

let mounted: ReturnType<typeof mount> | undefined;
/** The reason and stopped processes sit behind the row's "i". */
function tipText(row: Element): string {
  row.querySelector<HTMLButtonElement>('[data-testid=memory-row-info]')!.click();
  flushSync();
  return document.querySelector('[data-testid=memory-row-info-text]')?.textContent ?? '';
}

afterEach(async () => { if (mounted) await unmount(mounted); mounted = undefined; await setLocaleSetting('en'); document.body.innerHTML = ''; localStorage.clear(); });

test.each([['en', 'thread-quota'], ['en', 'budget'], ['en', 'machine'], ['fr', 'thread-quota'], ['fr', 'budget'], ['fr', 'machine']] as const)('renders a %s %s kill with its process, size and crossed limit', async (locale, reason) => {
  await setLocaleSetting(locale);
  mounted = mount(MemoryRow, { target: document.body, props: { event: { threadId: 't', kind: 'killed', reason, limitBytes: 9728 * 1048576, state: 'critical', exe: 'C:\\bin\\cargo.exe', bytes: 2147483648, at: 1 } } });
  flushSync();
  const row = document.querySelector('[data-testid=memory-row]')!;
  // What happened in plain words first, the process and its size second.
  expect(row.querySelector('.title')?.textContent).toBe(strings.resources.killTitle);
  expect(row.querySelector('.detail')?.textContent).toBe(locale === 'fr' ? 'cargo.exe, 2,0 Go' : 'cargo.exe, 2.0 GB');
  expect(row.textContent).not.toContain('C:\\bin');
  expect(tipText(row)).toBe(strings.resources.killReason[reason](locale === 'fr' ? '9,5 Go' : '9.5 GB'));
});

test('unknown process and size are omitted', () => {
  mounted = mount(MemoryRow, { target: document.body, props: { event: { threadId: 't', kind: 'thread-cap', state: 'ok', at: 1 } } });
  flushSync();
  const row = document.querySelector('[data-testid=memory-row]')!;
  expect(row.querySelector('.detail')?.textContent).toBe(strings.resources.threadCap);
  expect(row.querySelector('.title')).toBeNull();
  expect(row.querySelector('[data-testid=memory-row-info]')).toBeNull();
});

test.each(['en', 'fr'] as const)('renders a %s throttling notice with its limit and no stopped process', async (locale) => {
  await setLocaleSetting(locale);
  mounted = mount(MemoryRow, { target: document.body, props: { event: { threadId: 't', kind: 'throttled', limitBytes: 5120 * 1048576, bytes: 6144 * 1048576, state: 'ok', at: 1 } } });
  flushSync();
  const row = document.querySelector('[data-testid=memory-row]')!;
  expect(row.getAttribute('data-kind')).toBe('throttled');
  expect(row.querySelector('.detail')?.textContent).toBe(strings.resources.throttled(locale === 'fr' ? '5,0 Go' : '5.0 GB'));
  expect(row.querySelector('.title')).toBeNull();
  expect(row.querySelector('[data-testid=memory-row-info]')).toBeNull();
});

test('a stop inside a message leaves the conversation for the notification corner', async () => {
  const client = new FakeClient({ delayMs: 0 }); const store = new Store(); store.attach(client);
  try {
    await store.connect(); await store.open('t-trace');
    const thread = store.openThread!;
    thread.memoryEvents = [{ threadId: thread.id, kind: 'killed', reason: 'machine', limitBytes: 3072 * 1048576, state: 'critical', exe: 'cargo.exe', at: 20 }];
    thread.messages = [{ id: 'interrupted', threadId: thread.id, turnId: 'turn', role: 'assistant', state: 'complete', createdAt: 10, parts: [
      { type: 'text', text: 'Before the interruption' },
      { type: 'tool', toolId: 'build', name: 'Bash', input: { command: 'cargo build' }, output: 'Stopped', status: 'error', startedAt: 15, finishedAt: 21 },
      { type: 'text', text: 'After the interruption' },
      { type: 'tool', toolId: 'retry', name: 'Bash', input: { command: 'cargo build -j 2' }, output: 'Done', status: 'done', startedAt: 30, finishedAt: 40 },
    ] }];
    mounted = mount(MessageList, { target: document.body, props: { store, threadId: thread.id, messages: thread.messages } });
    flushSync();
    const text = document.querySelector('[data-testid=timeline]')!.textContent!;
    expect(text).toContain('After the interruption');
    expect(text).not.toContain(strings.resources.killTitle);
    const corner = mount(MemoryCorner, { target: document.body, props: { store } });
    try {
      flushSync();
      // A stop the thread already had is history: the corner only carries one that lands while it is open.
      expect(document.querySelector('[data-testid=memory-corner]')).toBeNull();
      client.emitMemory({ ...thread.memoryEvents[0]!, at: Date.now() });
      flushSync();
      expect(document.querySelector('[data-testid=memory-corner] [data-testid=memory-row] .title')?.textContent).toBe(strings.resources.killTitle);
    } finally { await unmount(corner); }
  } finally { store.detach(); client.close(); }
});

test('live stops share one corner card, open the memory settings and stay dismissed after reopening', async () => {
  const client = new FakeClient({ delayMs: 0 }); const store = new Store(); store.attach(client);
  try {
    await store.connect(); await store.open('t-trace');
    const thread = store.openThread!;
    thread.memoryEvents = [];
    mounted = mount(MemoryCorner, { target: document.body, props: { store } });
    flushSync();
    expect(document.querySelector('[data-testid=memory-corner]')).toBeNull();
    const at = Date.now();
    for (const [index, exe] of ['cargo.exe', 'rustc.exe', 'node.exe'].entries()) client.emitMemory({ threadId: thread.id, kind: 'killed', reason: 'machine', limitBytes: 3072 * 1048576, bytes: 100 * 1048576, exe, state: 'critical', at: at + index * 3000 });
    flushSync();
    const row = () => document.querySelector('[data-testid=memory-corner] [data-testid=memory-row]');
    expect(document.querySelectorAll('[data-testid=memory-corner] [data-testid=memory-row]')).toHaveLength(1);
    expect(row()!.textContent).toContain(strings.resources.killCount(3));
    expect(row()!.textContent).not.toContain('rustc.exe');
    expect(tipText(row()!)).toContain('cargo.exe (100 MB), rustc.exe (100 MB), node.exe (100 MB)');
    row()!.querySelector<HTMLButtonElement>('.configure')!.click();
    flushSync();
    expect(store.settingsTab).toBe('resources');
    expect(store.settingsSection?.id).toBe('limits');
    // Opening the settings answered the card: it does not come back with the thread.
    expect(row()).toBeNull();
    await store.open('t-trace'); flushSync();
    expect(row()).toBeNull();
    client.emitMemory({ threadId: thread.id, kind: 'budget', state: 'critical', at: at + 60_000 });
    flushSync();
    expect(row()).not.toBeNull();
    row()!.querySelector<HTMLButtonElement>('[data-testid=memory-row-dismiss]')!.click();
    flushSync();
    expect(row()).toBeNull();
  } finally { store.detach(); client.close(); }
});

test('neither a stop the thread had nor a live one becomes a row of the timeline', async () => {
  const client = new FakeClient({ delayMs: 0 }); const store = new Store(); store.attach(client);
  try {
    await store.connect(); await store.open('t-trace');
    expect(store.openThread!.memoryEvents?.length).toBeGreaterThan(0);
    mounted = mount(MessageList, { target: document.body, props: { store, threadId: 't-trace', messages: store.openThread!.messages } });
    flushSync();
    const rows = () => document.querySelectorAll('[data-testid=timeline] [data-testid=memory-row]');
    expect(rows()).toHaveLength(0);
    client.emitMemory({ threadId: 't-trace', kind: 'budget', state: 'critical', at: Date.now() });
    client.emitMemory({ threadId: 't-trace', kind: 'killed', reason: 'machine', limitBytes: 3277 * 1048576, exe: 'link.exe', state: 'critical', at: Date.now() + 1 });
    flushSync();
    expect(rows()).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid=timeline] [data-testid=message]').length).toBeGreaterThan(0);
  } finally { store.detach(); client.close(); }
});
