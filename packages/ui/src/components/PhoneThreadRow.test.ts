import type { ThreadSummary } from '@boite/contracts';
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import PhoneThreadRow from './PhoneThreadRow.svelte';
import rowSource from './PhoneThreadRow.svelte?raw';

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

test('a phone row names another machine as "· glyph name", gives a title that needs the user two lines in every list, and puts a pin on its second line', async () => {
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
  // Round 13: the Needs you filter (no band labels, `pin` on) cut "Retry failed syncs when the netw…" to one line.
  expect((await draw({ status: 'waiting', pinned: false }, true)).lines).toBe('2');
  expect(await draw({ status: 'waiting', pinned: true }, true)).toEqual({ lines: '2', pinInTitle: false, pinBeside: true });
});

test('under a project header a pinned row keeps one line with its pin before the time, a failure leads its second line in words, and at 360 px every title takes two lines', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && !row.agentSessionId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  store.pendingQuestions = []; store.pendingPermissions = [];
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const draw = async (fields: Partial<ThreadSummary>) => {
    if (mounted) await unmount(mounted);
    Object.assign(thread, { subagentQuestions: [], backgroundWork: undefined, backgroundWait: undefined, pullRequestWatches: undefined, ...fields });
    mounted = mount(PhoneThreadRow, { target: document.body, props: { machine: { id: 'http://localhost:3773', label: 'This PC', store }, project, thread, now: Date.now(), items: [], grouped: true, onopen: () => {}, onaction: () => {} } });
    await settle();
    const head = document.querySelector<HTMLElement>('[data-testid=mobile-row] .head')!;
    const meta = document.querySelector<HTMLElement>('[data-testid=mobile-row] .meta');
    return { pinInTitle: head.querySelector('[data-testid=thread-pinned]') !== null, pinBeside: meta?.querySelector('[data-testid=thread-pinned]') != null, leads: meta?.firstElementChild?.getAttribute('data-testid') ?? null };
  };
  // Owner's call, round 13: a pin alone adds no second line; it stands just before the time.
  expect(await draw({ status: 'idle', pinned: true })).toEqual({ pinInTitle: true, pinBeside: false, leads: null });
  expect(document.querySelector('.head [data-testid=thread-pinned]')?.nextElementSibling?.classList.contains('time')).toBe(true);
  // With a failure the pin joins the time on the second line.
  expect(await draw({ status: 'error', pinned: true })).toEqual({ pinInTitle: false, pinBeside: true, leads: 'thread-failed' });
  // Nothing before the word under a project's header: it leads the line, its dot hidden by `.meta > .fact.failed:first-child`.
  expect((await draw({ status: 'error', pinned: false })).leads).toBe('thread-failed');
  expect(await draw({ status: 'idle', pinned: false })).toEqual({ pinInTitle: false, pinBeside: false, leads: null });
  expect(document.querySelector('[data-testid=mobile-row]')!.classList.contains('grouped')).toBe(true);
  // jsdom applies no media query: read the rule the browser would apply at 360 px ("…the co…", "…sync e…" before).
  const narrow = rowSource.slice(rowSource.indexOf('@media (max-width: 360px)'));
  expect(narrow).toMatch(/\.grouped \.title \{[^}]*-webkit-line-clamp: 2[^}]*text-wrap: pretty/);
  expect(rowSource).toMatch(/\.meta > \.fact\.failed:first-child > \[aria-hidden='true'\] \{ display: none; \}/);
});

test('a wrapped title with no grey line ends its last line with the time, and a subagent chip says how many need the user', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && !row.agentSessionId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  store.pendingQuestions = []; store.pendingPermissions = [];
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const draw = async (fields: Partial<ThreadSummary>, grouped = true) => {
    if (mounted) await unmount(mounted);
    Object.assign(thread, { subagentQuestions: [], backgroundWork: undefined, backgroundWait: undefined, pullRequestWatches: undefined, ...fields });
    mounted = mount(PhoneThreadRow, { target: document.body, props: { machine: { id: 'http://localhost:3773', label: 'This PC', store }, project, thread, now: Date.now(), items: [], grouped, onopen: () => {}, onaction: () => {} } });
    await settle();
    const head = document.querySelector<HTMLElement>('[data-testid=mobile-row] .head')!;
    return {
      low: head.classList.contains('low') && head.dataset.lastLine === 'line',
      timeEndsLine: head.querySelector('[data-last-line=cluster] .time') !== null,
      room: head.querySelector('[data-last-line=title] > [data-last-line=room]:last-child') !== null
    };
  };
  // Round 14: at 360 "Pick the cache for the / sync engine" put its age on the first line, two ages 31 px apart in a 52 px pitch.
  expect(await draw({ status: 'waiting', pinned: false })).toEqual({ low: true, timeEndsLine: true, room: true });
  expect(await draw({ status: 'idle', pinned: false })).toEqual({ low: true, timeEndsLine: true, room: true });
  expect(rowSource).toMatch(/\.head\.low > \* \{ grid-area: 1 \/ 1; \}/);
  expect(rowSource).toMatch(/\.low \.cluster \{ justify-self: end; align-self: end;/);
  // A row with a grey line keeps the time there.
  expect(await draw({ status: 'error', pinned: false })).toEqual({ low: false, timeEndsLine: false, room: false });
  expect(document.querySelector('.meta .time')).not.toBeNull();

  // Round 14: the amber chip read "2 subagents", a headcount, while it is drawn only because they ask.
  vi.spyOn(store, 'subagents').mockReturnValue({ count: 3, asking: 2, runs: 0 } as never);
  await draw({ status: 'running', pinned: false, subagentQuestions: [{ threadId: 'a', title: 'A' }, { threadId: 'b', title: 'B' }] });
  expect(document.querySelector('[data-testid=thread-subagents] .ui-label')?.textContent).toBe('2 subagents need you');
});
