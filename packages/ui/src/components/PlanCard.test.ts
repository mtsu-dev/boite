import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import PlanCard from './PlanCard.svelte';
import { phoneWidth } from '../test/phone-width';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const PLAN = '# Trace tab\n\n1. Read `trace.get`.';

function draw(owner: boolean, call = vi.fn()) {
  const store = { owner, connection: 'ready', error: null as string | null, client: { call } };
  running = mount(PlanCard, { target: document.body, props: { store: store as never, threadId: 't-1', plan: PLAN } });
  flushSync();
  return { card: document.body.querySelector<HTMLElement>('[data-testid=plan-card]')!, store, call };
}

async function settle() {
  for (let i = 0; i < 4; i++) { await tick(); await Promise.resolve(); }
  flushSync();
}

test('the plan reads as a document and copies whole', async () => {
  const writeText = vi.fn(async (_text: string) => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { card } = draw(true);
  await settle();
  expect(card.querySelector('.body h3')?.textContent).toBe('Trace tab');
  card.querySelector<HTMLButtonElement>('[data-testid=plan-copy]')!.click();
  await settle();
  expect(writeText).toHaveBeenCalledWith(PLAN);
  expect(card.querySelector('[data-testid=plan-copy]')?.getAttribute('title')).toBe('Copied');
});

test('saving writes the next free plan file at the root of the thread folder', async () => {
  const call = vi.fn(async (method: string) => method === 'files.list'
    ? [{ name: 'plan-trace-tab.md', path: 'plan-trace-tab.md', kind: 'file', bytes: 1, modifiedAt: 0 }]
    : { bytes: PLAN.length, modifiedAt: 1 });
  const { card } = draw(true, call);
  const save = card.querySelector<HTMLButtonElement>('[data-testid=plan-save]')!;
  save.click();
  await settle();
  expect(call).toHaveBeenCalledWith('files.list', { threadId: 't-1' });
  expect(call).toHaveBeenCalledWith('files.write', { threadId: 't-1', path: 'plan-trace-tab-2.md', text: PLAN });
  expect(save.getAttribute('aria-label')).toBe('Saved as plan-trace-tab-2.md');
  expect(card.querySelector('.head')?.textContent).toContain('Saved as plan-trace-tab-2.md');
  expect(save.disabled).toBe(true);
});

test('ticked steps count in the head', () => {
  const store = { owner: false, connection: 'ready', error: null, client: { call: vi.fn() } };
  running = mount(PlanCard, { target: document.body, props: { store: store as never, threadId: 't-1', plan: '## Plan\n\n- [x] Read\n- [ ] Write\n- [ ] Test' } });
  flushSync();
  const card = document.body.querySelector<HTMLElement>('[data-testid=plan-card]')!;
  expect(card.querySelector('.count')?.textContent).toBe('1 of 3');
  expect(card.classList.contains('lead')).toBe(true);
});

test('a paired device can copy and download but not write into the folder', () => {
  const { card } = draw(false);
  expect(card.querySelector('[data-testid=plan-download]')).not.toBeNull();
  expect(card.querySelector('[data-testid=plan-save]')).toBeNull();
});

test('each action says its word on a desktop; a phone gathers them under one "more" button whose menu names them', async () => {
  let { card } = draw(true);
  expect([...card.querySelectorAll('.actions button')].map((button) => button.textContent?.trim())).toEqual(['Copy', 'Download', 'Save']);
  unmount(running!, { outro: false });
  document.body.innerHTML = '';
  const restore = phoneWidth();
  // The menu sizes its sheet with a ResizeObserver, which jsdom lacks.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  try {
    ({ card } = draw(true));
    // No bare row of icons: one button, named, at the head's end.
    expect(card.querySelector('.actions')).toBeNull();
    const more = card.querySelector<HTMLButtonElement>('[data-testid=plan-menu]')!;
    expect(more.getAttribute('aria-label')).toBe('Plan actions');
    more.click();
    await settle();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid=plan-menu-menu] [role^=menuitem]')];
    expect(rows.map((row) => row.textContent?.trim())).toEqual(['Copy', 'Download .md', 'Save to folder']);
  } finally { restore(); }
});
