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

test('a finished thread read from above its end offers Last answer, and only then', async ({ ready }) => {
  const { store } = await ready();
  await store.open('t-trace');
  const onlastanswer = vi.fn();
  view = mount(StatusStrip, { target: document.body, props: { store, away: false, onlastanswer } });
  flushSync();
  // At the end the answer is in view: nothing to go back to.
  expect(strip()?.dataset.state).toBe('finished');
  expect(document.querySelector('[data-testid="status-strip-last-answer"]')).toBeNull();
  unmount(view, { outro: false });
  view = mount(StatusStrip, { target: document.body, props: { store, away: true, onlastanswer } });
  flushSync();
  const last = document.querySelector<HTMLButtonElement>('[data-testid="status-strip-last-answer"]')!;
  expect(last.textContent).toBe('Last answer');
  last.click();
  expect(onlastanswer).toHaveBeenCalledOnce();
  // A turn running again: the strip is the live line, no way back offered.
  store.openThread!.status = 'running';
  flushSync();
  expect(document.querySelector('[data-testid="status-strip-last-answer"]')).toBeNull();
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

test('on a thread that needs the user, the jump counts the others in the sidebar fold\'s words, never the tab\'s', async ({ ready }) => {
  const { store } = await ready();
  await store.open('t-scheduler');
  const needs = inbox(storeSources(workspace.machinesOr(store))).needs;
  // The Needs you tab counts the open thread; the jump walks only the others.
  expect(needs.some(card => card.thread.id === 't-scheduler')).toBe(true);
  const others = needs.length - 1;
  expect(others).toBeGreaterThan(0);
  view = mount(StatusStrip, { target: document.body, props: { store } });
  flushSync();
  const next = document.querySelector<HTMLButtonElement>('[data-testid="status-strip-next"]')!;
  expect([...next.querySelectorAll('.ui-label')].map(node => node.textContent)).toEqual([others === 1 ? '1 more needs you' : `${others} more need you`]);
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
  // The same words as the phone's chip on every width: what it opens, then how many wait.
  expect(next.textContent).toContain(`Needs you · ${others.length}`);
  // One label, never a bare chevron and number: a second long form no longer stands beside it.
  expect([...next.querySelectorAll('.ui-label')].map(node => node.textContent)).toEqual([`Needs you · ${others.length}`]);
  expect(next.querySelector('.lucide-chevron-right')).not.toBeNull();
  expect(next.querySelector('.number')).toBeNull();
  // Label in Name (WCAG 2.5.3): the accessible name is the visible words, the thread is its description.
  expect(next.hasAttribute('aria-label')).toBe(false);
  expect(next.querySelector('[aria-hidden=true].ui-label')).toBeNull();
  expect(next.textContent?.trim()).toBe(`Needs you · ${others.length}`);
  expect(next.title).toContain(oldest.title);
  const hint = document.getElementById(next.getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toBe(`Opens ${oldest.title}, waiting longest`);
  expect(next.contains(hint)).toBe(false);
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
  // The tooltip names the counts too: a mouse user on the shrunk chip reads what the glyph and number mean.
  expect(counts.title.split('\n')[0]).toBe(counts.getAttribute('aria-label'));
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
  expect(stripSource).toMatch(/data-testid="status-strip-next"[\s\S]*?aria-describedby=\{nextHintId\}/);
});
