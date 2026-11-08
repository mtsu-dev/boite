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

test('the list foot says the tightest window in words, keeps the limits test ids and opens the glance', async () => {
  const call = vi.fn(async () => [quota]);
  const store = { client: { call, on: () => () => {} }, connection: 'ready', owner: true, endpointUrl: 'quota-line-core', accounts: [{ id: 'claude-account', status: 'ok' }] } as unknown as Store;
  mounted = mount(QuotaLine, { target: document.body, props: { store } });
  await settle();

  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-limits]')!;
  const figure = document.querySelector<HTMLElement>('[data-testid=limits-gauge]')!;
  expect(figure.dataset.left).toBe('12');
  expect(figure.textContent).toBe('12% left · Weekly');
  // The account is in the tooltip; the line itself stays short enough for a narrow column.
  expect(button.getAttribute('aria-label')).toContain('12% left: Weekly, Home');
  expect(button.querySelector('svg')!.classList.contains('low')).toBe(true);

  button.click();
  await settle();
  expect(document.querySelector('[data-testid=limits-glance]')).not.toBeNull();
});
