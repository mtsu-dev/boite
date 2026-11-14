import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { AccountQuota } from '@boite/contracts';
import type { Store } from '../lib/store.svelte';
import QuotaLine from './QuotaLine.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (mounted) await unmount(mounted); mounted = undefined; document.body.innerHTML = ''; });
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
const quota: AccountQuota = {
  accountId: 'claude-account', providerId: 'claude', providerName: 'Claude', label: 'Home', enabled: true,
  status: 'ready', windows: [{ id: 'week', label: 'Weekly', usedPercent: 88, resetsAt: null }], checkedAt: null, error: null,
};

test('the list foot says the tightest window and whose it is in words, keeps the limits test ids and opens the glance', async () => {
  const call = vi.fn(async () => [quota]);
  const store = { client: { call, on: () => () => {} }, connection: 'ready', owner: true, endpointUrl: 'quota-line-core', accounts: [{ id: 'claude-account', status: 'ok' }] } as unknown as Store;
  mounted = mount(QuotaLine, { target: document.body, props: { store } });
  await settle();

  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-limits]')!;
  const figure = document.querySelector<HTMLElement>('[data-testid=limits-gauge]')!;
  expect(figure.dataset.left).toBe('12');
  // One Claude account: the provider names whose limit it is; the account is in the tooltip.
  expect(figure.textContent).toBe('12% of Claude\'s weekly limit left');
  expect(button.getAttribute('aria-label')).toContain('12% left: Weekly, Home');
  expect(button.querySelector('svg')!.classList.contains('low')).toBe(true);

  button.click();
  await settle();
  expect(document.querySelector('[data-testid=limits-glance]')).not.toBeNull();
});

test('several accounts: silent while one has room, then the best one\'s share, then out until the first reset', async () => {
  const windows = (used: number, resetsAt: number | null = null) => [{ id: 'week', label: 'Weekly', usedPercent: used, resetsAt }];
  let rows: AccountQuota[] = [quota, { ...quota, accountId: 'claude-work', label: 'Work', windows: windows(40) }];
  let update: (rows: AccountQuota[]) => void = () => {};
  const call = vi.fn(async () => rows);
  const store = { client: { call, on: (event: string, listener: typeof update) => { if (event === 'quotas.updated') update = listener; return () => {}; } }, connection: 'ready', owner: true, endpointUrl: 'quota-line-several', accounts: [{ id: 'claude-account', status: 'ok' }, { id: 'claude-work', status: 'ok' }] } as unknown as Store;
  mounted = mount(QuotaLine, { target: document.body, props: { store } });
  await settle();

  // Home is nearly spent, Work has 60 % left: nothing is blocked, the line only names the glance.
  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-limits]')!;
  expect(document.querySelector('[data-testid=limits-gauge]')).toBeNull();
  expect(button.textContent?.trim()).toBe('Account limits');

  rows = [quota, { ...rows[1]!, windows: windows(85) }];
  update(rows);
  await settle();
  expect(document.querySelector('[data-testid=limits-gauge]')!.textContent).toBe('15% of Claude\'s weekly limit left on Work');

  rows = [{ ...quota, windows: windows(100, Date.now() + 3_600_000) }, { ...rows[1]!, windows: windows(100, Date.now() + 7_200_000) }];
  update(rows);
  await settle();
  const line = document.querySelector<HTMLElement>('[data-testid=limits-gauge]')!;
  expect(line.dataset.limit).toBe('out');
  expect(line.textContent).toMatch(/^Every Claude account is out, first one back \S/);
});
