import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { AccountQuota } from '@boite/contracts';
import type { Store } from '../lib/store.svelte';
import LimitsButton from './LimitsButton.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => { vi.useRealTimers(); if (mounted) await unmount(mounted); mounted = undefined; document.body.innerHTML = ''; });
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
const quota: AccountQuota = {
  accountId: 'claude-account', providerId: 'claude', providerName: 'Claude', label: 'Home', enabled: true,
  status: 'ready', windows: [{ id: 'week', label: 'Weekly', usedPercent: 88, resetsAt: null }], checkedAt: null, error: null,
};
type Listener = (rows: AccountQuota[]) => void;
function storeOf(rows: () => AccountQuota[], endpointUrl: string, ids: string[]) {
  let update: Listener = () => {};
  const store = { client: { call: vi.fn(async () => rows()), on: (event: string, listener: Listener) => { if (event === 'quotas.updated') update = listener; return () => {}; } },
    connection: 'ready', owner: true, endpointUrl, accounts: ids.map(id => ({ id, status: 'ok' })) } as unknown as Store;
  return { store, update: (next: AccountQuota[]) => update(next) };
}

test('quiet, the gauge alone; low, an amber ring of what is left; it keeps the limits test ids and opens the glance', async () => {
  let rows = [{ ...quota, windows: [{ ...quota.windows[0]!, usedPercent: 30 }] }];
  const { store, update } = storeOf(() => rows, 'limits-button-low', ['claude-account']);
  mounted = mount(LimitsButton, { target: document.body, props: { store } });
  await settle();

  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-limits]')!;
  expect(document.querySelector('[data-testid=limits-gauge]')).toBeNull();
  expect(button.getAttribute('aria-label')).toBe('Account limits');

  rows = [quota];
  update(rows);
  await settle();
  const ring = document.querySelector<SVGElement>('[data-testid=limits-gauge]')!;
  expect(ring.dataset.left).toBe('12');
  expect(ring.dataset.limit).toBe('low');
  expect(ring.dataset.share).toBe('0.12');
  expect(button.classList.contains('low')).toBe(true);
  // One Claude account: the sentence names whose limit it is; the account follows.
  expect(button.getAttribute('aria-label')).toBe('12% of Claude\'s weekly limit left · Home');
  expect(document.querySelector('[data-testid=limits-countdown]')).toBeNull();

  button.click();
  await settle();
  expect(document.querySelector('[data-testid=limits-glance]')).not.toBeNull();
});

test('out: a red ring filled by the wait already done, the time left under it, and gone once the reset passes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
  const start = new Date('2026-11-17T10:00:00Z').getTime();
  vi.setSystemTime(start);
  // A 5-hour window spent, back in 1 h 30: 3 h 30 of 5 h already waited.
  const rows = [{ ...quota, windows: [{ id: '5h', label: '5 hours', usedPercent: 100, resetsAt: start + 90 * 60_000 }] }];
  const { store } = storeOf(() => rows, 'limits-button-out', ['claude-account']);
  mounted = mount(LimitsButton, { target: document.body, props: { store } });
  await settle();

  const ring = document.querySelector<SVGElement>('[data-testid=limits-gauge]')!;
  expect(ring.dataset.limit).toBe('out');
  expect(ring.dataset.share).toBe('0.70');
  expect(document.querySelector('[data-testid=limits-countdown]')!.textContent).toBe('1h30');
  expect(document.querySelector('[data-testid=nav-limits]')!.getAttribute('aria-label')).toMatch(/^Claude's 5-hour limit is used up, back \S.* · back in 1h30$/);

  vi.advanceTimersByTime(60 * 60_000);
  await settle();
  expect(document.querySelector('[data-testid=limits-countdown]')!.textContent).toBe('30m');

  // The reset passes with no fresh reading: the stale one no longer says out.
  vi.advanceTimersByTime(31 * 60_000);
  await settle();
  expect(document.querySelector('[data-testid=limits-gauge]')).toBeNull();
  expect(document.querySelector('[data-testid=limits-countdown]')).toBeNull();
});

test('several accounts: silent while one has room, then every account out until the first reset', async () => {
  const windows = (used: number, resetsAt: number | null = null) => [{ id: 'week', label: 'Weekly', usedPercent: used, resetsAt }];
  let rows: AccountQuota[] = [quota, { ...quota, accountId: 'claude-work', label: 'Work', windows: windows(40) }];
  const { store, update } = storeOf(() => rows, 'limits-button-several', ['claude-account', 'claude-work']);
  mounted = mount(LimitsButton, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector('[data-testid=limits-gauge]')).toBeNull();

  rows = [{ ...quota, windows: windows(100, Date.now() + 3_600_000) }, { ...rows[1]!, windows: windows(100, Date.now() + 7_200_000) }];
  update(rows);
  await settle();
  expect(document.querySelector<SVGElement>('[data-testid=limits-gauge]')!.dataset.limit).toBe('out');
  expect(document.querySelector('[data-testid=nav-limits]')!.getAttribute('aria-label')).toMatch(/^Every Claude account is out, first one back \S/);
});

test('an account used outside Douane lights a red dot on the quiet gauge and names the account', async () => {
  const rows = [{ ...quota, label: 'nefreex2', windows: [{ id: 'month', label: 'Monthly', usedPercent: 84, resetsAt: null, outsidePercent: 40 }] },
    { ...quota, accountId: 'claude-work', label: 'Work', windows: [{ id: 'week', label: 'Weekly', usedPercent: 20, resetsAt: null }] }];
  const { store } = storeOf(() => rows, 'limits-button-leak', ['claude-account', 'claude-work']);
  mounted = mount(LimitsButton, { target: document.body, props: { store } });
  await settle();

  expect(document.querySelector('[data-testid=limits-gauge]')).toBeNull();
  expect(document.querySelector('[data-testid=limits-leak]')).not.toBeNull();
  expect(document.querySelector('[data-testid=nav-limits]')!.getAttribute('aria-label')).toBe('40% of nefreex2 (Claude) used outside Douane');
});

test('the red dot follows each leaky window to its reset, one wake after another', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
  const start = new Date('2026-11-17T10:00:00Z').getTime();
  vi.setSystemTime(start);
  const rows = [{ ...quota, windows: [
    { id: '5h', label: '5 hours', usedPercent: 30, resetsAt: start + 60 * 60_000, outsidePercent: 50 },
    { id: 'week', label: 'Weekly', usedPercent: 30, resetsAt: start + 120 * 60_000, outsidePercent: 20 },
  ] }];
  const { store } = storeOf(() => rows, 'limits-button-leak-chain', ['claude-account']);
  mounted = mount(LimitsButton, { target: document.body, props: { store } });
  await settle();
  const label = () => document.querySelector('[data-testid=nav-limits]')!.getAttribute('aria-label');
  expect(label()).toBe('50% of Home (Claude) used outside Douane');

  vi.advanceTimersByTime(61 * 60_000);
  await settle();
  expect(label()).toBe('20% of Home (Claude) used outside Douane');

  vi.advanceTimersByTime(60 * 60_000);
  await settle();
  expect(document.querySelector('[data-testid=limits-leak]')).toBeNull();
});
