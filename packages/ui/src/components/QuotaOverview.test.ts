import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { AccountQuota } from '@boite/contracts';
import QuotaOverview from './QuotaOverview.svelte';
import { quotaResetTime } from '../lib/format';

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (component) await unmount(component); component = undefined; document.body.innerHTML = ''; });

const quota = (accountId: string, label: string, usedPercent: number): AccountQuota => ({
  accountId, providerId: 'codex', providerName: 'Codex', label, enabled: true, status: 'ready',
  windows: [{ id: 'week', label: 'Weekly', usedPercent, resetsAt: null }], checkedAt: null, error: null,
});

test('each subscription has its own name, limits, error and expansion beside the provider logo', () => {
  component = mount(QuotaOverview, { target: document.body, props: {
    rows: [{ ...quota('personal', 'Personal', 10), credits: { kind: 'balance', enabled: null, remaining: 42, limit: null, unlimited: false } }, { ...quota('work', 'Work', 90), error: 'Work quota unavailable', status: 'unavailable' }], connect: () => {},
  } });
  flushSync();
  const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="quota-provider"]')];
  expect(rows.map(row => row.querySelector('.name')!.textContent)).toEqual(['Personal', 'Work']);
  expect(rows.map(row => row.querySelector('.amount')!.textContent)).toEqual(['90% left', '10% left']);
  expect(rows.map(row => row.querySelector('[data-logo]')!.getAttribute('data-logo'))).toEqual(['codex', 'codex']);
  expect(rows[0]!.textContent).not.toContain('unavailable');
  expect(rows[0]!.querySelector('[data-testid=quota-credits]')!.textContent).toContain('42 credits');
  expect(rows[1]!.querySelector('[data-testid=quota-credits]')).toBeNull();
  expect(rows[1]!.querySelector('.meters')!.classList.contains('stale')).toBe(true);
  rows[0]!.querySelector<HTMLButtonElement>('button')!.click(); flushSync();
  expect(document.querySelectorAll('.details')).toHaveLength(1);
  expect(rows[0]!.querySelector('.details')!.textContent).toContain('90% left');
  rows[1]!.querySelector<HTMLButtonElement>('button')!.click(); flushSync();
  expect(rows[0]!.querySelector('.details')).toBeNull();
  expect(rows[1]!.querySelector('.details')!.textContent).toContain('10% left');
});

test('exhausted subscriptions put an available allowance first without claiming unconfirmed automatic spending', () => {
  const balance = { kind: 'balance' as const, enabled: true, remaining: 42.5, limit: null, unlimited: false };
  const variants = [
    { ...quota('paid', 'Personal', 100), credits: balance },
    { ...quota('unknown', 'Work', 100), credits: { ...balance, enabled: null } },
    { ...quota('stale', 'Stale', 100), credits: balance, status: 'unavailable' as const },
    { ...quota('empty', 'Empty', 100), credits: { ...balance, remaining: 0 } },
    { ...quota('rounded', 'Almost exhausted', 99.99), credits: balance },
  ];
  component = mount(QuotaOverview, { target: document.body, props: { rows: variants, connect: () => {} } });
  flushSync();
  const paid = document.querySelector('[data-account-id="paid"]')!;
  expect(paid.querySelector('.paid-label')!.textContent).toBe('Using credits');
  expect(paid.querySelector('.paid-amount')!.textContent).toBe('42.5 credits');
  expect(paid.querySelector('.amount')).toBeNull();
  expect(paid.querySelector('.meters')).toBeNull();
  expect(document.querySelector('[data-account-id="unknown"] .paid-label')!.textContent).toBe('Credits remaining');
  for (const id of ['stale', 'empty', 'rounded']) expect(document.querySelector(`[data-account-id="${id}"] .paid`)).toBeNull();
});

test('the open thread\'s account is tagged, and an address in a name sits in the blurred span', () => {
  component = mount(QuotaOverview, { target: document.body, props: { rows: [quota('personal', 'Personal', 10), quota('work', 'Claude Pro · work@corp.io', 20)], current: 'work' } });
  flushSync();
  const [personal, work] = [...document.querySelectorAll<HTMLElement>('[data-testid="quota-provider"]')];
  expect(personal!.classList.contains('current')).toBe(false);
  expect(work!.classList.contains('current')).toBe(true);
  expect(document.querySelectorAll('[data-testid=quota-current]')).toHaveLength(1);
  expect(work!.querySelector('[data-testid=quota-current]')!.textContent).toBe('This thread');
  expect(work!.querySelector('.name .private-email')!.textContent).toBe('work@corp.io');
  expect(personal!.querySelector('.private-email')).toBeNull();
});

test('profile labels stay visible even for Default; missing labels fall back to the provider', async () => {
  for (const [label, name] of [['Default', 'Default'], ['Personal', 'Personal'], ['', 'Codex']]) {
    component = mount(QuotaOverview, { target: document.body, props: { rows: [quota('only', label!, 10)], connect: () => {} } });
    flushSync();
    expect(document.querySelector('.name')!.textContent).toBe(name);
    await unmount(component); component = undefined;
  }
});

test('an unread account remains reorderable from its row with the keyboard', () => {
  const writes: string[][] = [];
  component = mount(QuotaOverview, { target: document.body, props: {
    rows: [quota('known', 'Personal', 10), { ...quota('unread', 'Work', 0), windows: [] }],
    connect: () => {}, onreorder: async (ids) => { writes.push(ids); return true; },
  } });
  flushSync();
  const row = document.querySelector<HTMLButtonElement>('[data-account-id="unread"] .summary')!;
  expect(row.disabled).toBe(false);
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  flushSync();
  expect(writes).toEqual([['unread', 'known']]);
  expect(document.querySelector('[data-testid="quota-provider"]')!.getAttribute('data-account-id')).toBe('unread');
  expect(document.activeElement).toBe(row);
});

test('the headline and reset come from the primary window, weekly first unless Douane flags another', () => {
  const soon = Date.now() + 3_600_000, later = Date.now() + 4 * 86_400_000;
  const windows = [
    { id: 'five-hour', label: '5 hours', usedPercent: 51, resetsAt: soon },
    { id: 'seven-day', label: 'Weekly', usedPercent: 31, resetsAt: later },
  ];
  const row: AccountQuota = { ...quota('famille', 'Famille', 0), windows };
  component = mount(QuotaOverview, { target: document.body, props: { rows: [row], connect: () => {} } });
  flushSync();
  const article = () => document.querySelector<HTMLElement>('[data-testid="quota-provider"]')!;
  expect(article().querySelector('.amount')!.textContent).toBe('69% left');
  expect(article().querySelector('.mini-window.lead')!.getAttribute('title')).toContain('69%');
  expect(article().querySelector('.caption.reset')!.textContent).toBe(quotaResetTime(later));
  unmount(component);
  document.body.innerHTML = '';
  const flagged: AccountQuota = { ...row, windows: [{ ...windows[0]!, primary: true }, windows[1]!] };
  component = mount(QuotaOverview, { target: document.body, props: { rows: [flagged], connect: () => {} } });
  flushSync();
  expect(article().querySelector('.amount')!.textContent).toBe('49% left');
  expect(article().querySelectorAll('.mini-window')).toHaveLength(2);
  expect(article().querySelector('.caption.reset')!.textContent).toBe(quotaResetTime(soon));
  unmount(component);
  document.body.innerHTML = '';
  // A primary without a reset shows none rather than another window's.
  const unknown: AccountQuota = { ...row, windows: [{ ...windows[0]!, resetsAt: null, primary: true }, windows[1]!] };
  component = mount(QuotaOverview, { target: document.body, props: { rows: [unknown], connect: () => {} } });
  flushSync();
  expect(article().querySelector('.caption.reset')).toBeNull();
});

test('a window Douane cannot fully explain says how much was used outside it, from 5 points on', () => {
  const limit = (id: string, label: string, outsidePercent?: number) =>
    ({ id, label, usedPercent: 60, resetsAt: null, ...(outsidePercent === undefined ? {} : { outsidePercent }) });
  component = mount(QuotaOverview, { target: document.body, props: { rows: [
    { ...quota('leaked', 'Claude Max', 60), windows: [limit('five-hour', '5 hours', 12), limit('weekly', 'Weekly', 40)] },
    { ...quota('noise', 'Claude Pro', 60), windows: [limit('weekly', 'Weekly', 4.9)] },
    quota('plain', 'Codex', 60),
  ] } });
  flushSync();
  const lines = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-account-id="${id}"] [data-testid=quota-outside]`)];
  // Collapsed, the row says the largest share once, in the danger colour, with why behind its "i".
  expect(lines('leaked').map(line => [line.dataset.window, line.querySelector('.ui-label')!.textContent])).toEqual([['weekly', '40% used outside Douane']]);
  expect(lines('leaked')[0]!.querySelector('[data-testid=info-tip]')!.getAttribute('aria-label')).toContain('40% used outside Douane');
  expect(lines('noise')).toEqual([]);
  expect(lines('plain')).toEqual([]);
  // Expanded, each window over the line carries its own share, weekly first as the row leads with it.
  document.querySelector<HTMLButtonElement>('[data-account-id="leaked"] button')!.click(); flushSync();
  expect(lines('leaked').map(line => [line.dataset.window, line.querySelector('.ui-label')!.textContent])).toEqual([
    ['weekly', '40% used outside Douane'], ['five-hour', '12% used outside Douane'],
  ]);
  expect(lines('leaked').every(line => line.parentElement!.classList.contains('details'))).toBe(true);
});
