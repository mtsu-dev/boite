import type { ThreadSummary } from '@boite/contracts';
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import PhoneThreadRow from './PhoneThreadRow.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

test('a phone row says Failed after its project, and only a row nothing is live on draws its mark in the muted tier', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && !row.agentSessionId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const draw = async (fields: Partial<ThreadSummary>, wait?: { reason: 'failed'; since: number }) => {
    if (mounted) await unmount(mounted);
    Object.assign(thread, { subagentQuestions: [], backgroundWork: undefined, backgroundWait: undefined, pullRequestWatches: undefined, ...fields });
    mounted = mount(PhoneThreadRow, { target: document.body, props: { machine: { id: 'http://localhost:3773', label: 'This PC', store }, project, thread, now: Date.now(), items: [], wait, onopen: () => {}, onaction: () => {} } });
    await settle();
    return {
      word: document.querySelector('[data-testid=thread-failed] .ui-label')?.textContent ?? null,
      afterProject: document.querySelector('[data-testid=thread-project] ~ [data-testid=thread-failed]') !== null,
      mono: document.querySelector('[data-testid=thread-provider] [data-mono]') !== null
    };
  };
  const failed = await draw({ status: 'error', pinned: false });
  expect(failed).toEqual({ word: 'Failed', afterProject: true, mono: false });
  expect((await draw({ status: 'waiting', pinned: false })).word).toBeNull();
  // The Inbox tab words its reason already: no second "Failed".
  expect((await draw({ status: 'error', pinned: false }, { reason: 'failed', since: Date.now() })).word).toBeNull();
  expect((await draw({ status: 'running', pinned: false })).mono).toBe(false);
  expect((await draw({ status: 'idle', pinned: true })).mono).toBe(false);
  expect(await draw({ status: 'idle', pinned: false })).toEqual({ word: null, afterProject: false, mono: true });
});

test('a phone row names another machine as "· glyph name", gives a Needs you title two lines, and puts a pin on its second line', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && !row.agentSessionId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  store.pendingQuestions = []; store.pendingPermissions = [];
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const draw = async (fields: Partial<ThreadSummary>, pin: boolean) => {
    if (mounted) await unmount(mounted);
    Object.assign(thread, { subagentQuestions: [], backgroundWork: undefined, backgroundWait: undefined, pullRequestWatches: undefined, ...fields });
    mounted = mount(PhoneThreadRow, { target: document.body, props: { machine: { id: 'farm', label: 'Builder', store }, project, thread, now: Date.now(), items: [], several: true, pin, onopen: () => {}, onaction: () => {} } });
    await settle();
    const head = document.querySelector<HTMLElement>('[data-testid=mobile-row] .head')!;
    return { lines: head.dataset.lines ?? '1', pinInTitle: head.querySelector('[data-testid=thread-pinned]') !== null, pinBeside: document.querySelector('.meta [data-testid=thread-pinned]') !== null };
  };
  // Round 11 read "render-farm  Builder" as one name: the machine follows a hidden dot, then its glyph.
  expect((await draw({ status: 'waiting', pinned: false }, false)).lines).toBe('2');
  const named = document.querySelector('[data-testid=thread-project] ~ [data-testid=thread-machine]')!;
  expect(named.querySelector(':scope > [aria-hidden=true]')?.textContent).toBe('·');
  expect(named.querySelector(':scope > svg')).not.toBeNull();
  expect(named.querySelector(':scope > .ui-label')?.textContent).toBe('Builder');
  expect((await draw({ status: 'idle', pinned: false }, false)).lines).toBe('1');
  expect((await draw({ status: 'running', pinned: false }, false)).lines).toBe('1');
  expect((await draw({ status: 'waiting', pinned: false }, true)).lines).toBe('1');
  expect(await draw({ status: 'waiting', pinned: true }, true)).toEqual({ lines: '1', pinInTitle: false, pinBeside: true });
});
