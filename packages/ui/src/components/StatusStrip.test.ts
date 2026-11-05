import { afterEach, expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../test/fake-client';
import { workspace } from '../lib/workspace.svelte';
import { inbox, storeSources } from '../lib/inbox';
import { undo } from '../lib/undo.svelte';
import StatusStrip from './StatusStrip.svelte';
import stripSource from './StatusStrip.svelte?raw';

let view: ReturnType<typeof mount> | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (view) unmount(view, { outro: false });
  view = undefined;
  document.body.replaceChildren();
});

const strip = () => document.querySelector<HTMLElement>('[data-testid="status-strip"]');

test('a finished turn offers Mark done and Archive, and Archive leaves the Undo toast', async ({ ready }) => {
  const { store } = await ready();
  await store.open('t-trace');
  view = mount(StatusStrip, { target: document.body, props: { store } });
  flushSync();
  expect(strip()?.dataset.state).toBe('finished');
  expect(strip()?.textContent).toContain('Finished');
  expect(document.querySelector('[data-testid="status-strip-done"]')?.textContent).toBe('Mark done');
  document.querySelector<HTMLButtonElement>('[data-testid="status-strip-archive"]')!.click();
  await vi.waitFor(() => expect(store.threads.some(thread => thread.id === 't-trace')).toBe(false));
  expect(undo.current?.message).toMatch(/^Archived /);
});

test('a thread waiting on the user says so in amber, never Working, even while its turn runs', async ({ ready }) => {
  const { store } = await ready();
  await store.open('t-scheduler');
  expect(store.openThread?.turns.at(-1)?.status).toBe('running');
  view = mount(StatusStrip, { target: document.body, props: { store } });
  flushSync();
  expect(strip()?.dataset.state).toBe('waiting');
  expect(document.querySelector('[data-testid="status-strip-waiting"]')?.textContent?.trim()).toMatch(/^Waiting for you · \d+(d \d+h|h \d\dm|m \d\ds|s)$/);
  expect(document.querySelector('[data-testid="status-strip-working"]')).toBeNull();
  expect(document.querySelector('[data-testid="status-strip-done"]')).toBeNull();
});

test('a running turn counts its time in the accent', async ({ ready }) => {
  const { store } = await ready();
  await store.open('t-trace');
  store.openThread!.status = 'running';
  view = mount(StatusStrip, { target: document.body, props: { store } });
  flushSync();
  expect(strip()?.dataset.state).toBe('working');
  expect(document.querySelector('[data-testid="status-strip-elapsed"]')?.textContent).toMatch(/^\d+(s|m \d\ds|h \d\dm)$/);
  expect(document.querySelector('[data-testid="status-strip-waiting"]')).toBeNull();
});

test('Next needs you walks the Inbox: it counts the same threads and opens the one that has waited longest, changing nothing else', async ({ ready }) => {
  const { store, client } = await ready();
  await store.open('t-trace');
  // The home's Inbox and the strip read one list (lib/inbox.test.ts holds its rule).
  const others = inbox(storeSources(workspace.machinesOr(store))).needs.filter(card => card.thread.id !== 't-trace');
  expect(others.length).toBeGreaterThan(1);
  const oldest = others[0]!.thread;
  const select = vi.spyOn(workspace, 'select').mockResolvedValue();
  const calls = vi.spyOn(client, 'call');
  view = mount(StatusStrip, { target: document.body, props: { store } });
  flushSync();
  const next = document.querySelector<HTMLButtonElement>('[data-testid="status-strip-next"]')!;
  expect(next.textContent).toContain(`Next needs you (${others.length})`);
  next.click();
  expect(select).toHaveBeenCalledWith(store, oldest.id);
  // It only opens: no send, archive or move goes to the core.
  expect(calls.mock.calls.map(([method]) => method).filter(method => !/\.(get|list)$/.test(method))).toEqual([]);
});

test('a question asked while the turn runs reads as work with a question, not as a wait', async ({ ready }) => {
  const { store } = await ready();
  await store.open('t-trace');
  Object.assign(store.openThread!, { status: 'running', openQuestions: 1 });
  view = mount(StatusStrip, { target: document.body, props: { store } });
  flushSync();
  expect(strip()?.dataset.state).toBe('asking');
  expect(document.querySelector('[data-testid="status-strip-working"]')?.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^Working \d.* · question for you$/);
  expect(document.querySelector('[data-testid="status-strip-waiting"]')).toBeNull();
  // Once no turn runs, the same question is the user's move: a plain wait.
  store.openThread!.status = 'idle';
  flushSync();
  expect(strip()?.dataset.state).toBe('waiting');
});

test('one timer on the line: with a state shown, the delegated group keeps its time in the tooltip', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0, delegationDemo: true });
  store.attach(client);
  await store.connect();
  await store.open('t-trace');
  store.openThread!.status = 'running';
  view = mount(StatusStrip, { target: document.body, props: { store } });
  const counts = await vi.waitFor(() => {
    const found = document.querySelector<HTMLButtonElement>('[data-testid="active-subagents"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(counts.getAttribute('aria-label')).toMatch(/^\d+ subagents?( · \d+ workflows?)?$|^\d+ workflows?$/);
  expect(counts.querySelector('.time')).toBeNull();
  expect(counts.title).toMatch(/Delegated work running for \d/);
  expect(strip()!.querySelectorAll('.time')).toHaveLength(1);
});

// jsdom lays nothing out, so the phone rule is read from the component's own
// style: the round 1 strip cut its state to nothing because the lead shrank.
test('the state label never shrinks, and under 420 px the counts and Next turn into chips that keep their names', () => {
  const css = stripSource.slice(stripSource.indexOf('<style>'));
  const rule = (selector: string, within = css) => within.match(new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[2] ?? '';
  expect(rule('.lead')).toMatch(/flex: none/);
  expect(rule('.lead')).not.toMatch(/overflow|min-width: 0/);
  expect(css).not.toMatch(/\.lead[^{]*\.ui-label[^{]*\{[^}]*text-overflow/);
  expect(rule('.strip')).toMatch(/flex-wrap: wrap/);
  const narrow = css.slice(css.indexOf('@container strip (max-width: 420px)'));
  expect(narrow.length).toBeGreaterThan(0);
  expect(rule('.words', narrow)).toMatch(/display: none/);
  expect(rule('.number', narrow)).toMatch(/display: inline/);
  // The names stay whole while the words hide.
  expect(stripSource).toMatch(/data-testid="active-subagents"[\s\S]*?aria-label=\{delegatedWords\}/);
  expect(stripSource).toMatch(/data-testid="status-strip-next"[\s\S]*?aria-label=\{fill\(strings\.chat\.strip\.nextTitle/);
});
