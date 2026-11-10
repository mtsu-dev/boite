import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { GatewayOrder, SubscriptionProxy } from '@boite/contracts';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import LimitsGlance from './LimitsGlance.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let detach: (() => void) | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined; detach?.(); detach = undefined;
  document.body.innerHTML = ''; vi.restoreAllMocks();
});

const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
const proxy = (baseUrl: string): SubscriptionProxy => ({ enabled: true, kind: 'douane', baseUrl, dashboardUrl: `${baseUrl}/admin/#quotas` });
const $ = <T extends Element = HTMLElement>(id: string, within: ParentNode = document) => within.querySelector<T>(`[data-testid="${id}"]`);
const all = (id: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const section = (provider: string) => document.querySelector<HTMLElement>(`[data-testid="quota-order-provider"][data-provider="${provider}"]`)!;
const accounts = (provider: string) => all('quota-order-account', section(provider)).map(row => row.dataset.account);

/** The glance of a core whose gateway is the fake Douane, opened by a press on the gauge. */
async function glance(baseUrl = 'http://127.0.0.1:8787', arrange?: (client: FakeClient, store: Store) => void) {
  const store = new Store();
  const client = new FakeClient({ delayMs: 0 });
  store.attach(client);
  await store.connect();
  store.settings = await client.call('subscriptionProxy.configure', { subscriptionProxy: proxy(baseUrl) });
  detach = () => { store.detach(); client.close(); };
  arrange?.(client, store);
  mounted = mount(LimitsGlance, { target: document.body, props: { store } });
  $<HTMLButtonElement>('nav-limits')!.click();
  await vi.waitFor(() => expect(all('quota-provider').length).toBeGreaterThan(2));
  await settle();
  return { store, client };
}
const order = async (client: FakeClient, provider = 'claude') => (await client.call('subscriptionProxy.order', {})).providers.find(entry => entry.providerId === provider)!;

test('order mode opens in the panel, writes each press to Douane at once, and a second press leaves it', async () => {
  const { client } = await glance();
  expect($('limits-glance-order')!.getAttribute('aria-pressed')).toBe('false');
  $<HTMLButtonElement>('limits-glance-order')!.click();
  await vi.waitFor(() => expect($('quota-order-provider')).not.toBeNull());
  expect($('limits-glance-order')!.getAttribute('aria-pressed')).toBe('true');

  // Claude first; Codex has one account and nothing to order; Antigravity follows a strategy of Douane's own.
  expect(all('quota-order-provider').map(entry => entry.dataset.provider)).toEqual(['claude', 'antigravity']);
  expect($('quota-order-other', section('claude'))).toBeNull();
  expect($('quota-order-other', section('antigravity'))!.textContent).toContain('smart');
  expect(all('quota-order-mine').concat(all('quota-order-reset')).filter(button => section('antigravity').contains(button)).map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
  expect($('quota-order-spare', section('antigravity'))).toBeNull();

  // Soonest reset: the account whose week ends first leads, and nothing moves by hand.
  expect($('quota-order-reset', section('claude'))!.getAttribute('aria-pressed')).toBe('true');
  expect(accounts('claude')).toEqual(['claude-2', 'claude-1']);
  expect($('quota-order-up', section('claude'))).toBeNull();
  // The rows are the panel's own: name, bars and reset.
  expect(all('quota-provider', section('claude'))).toHaveLength(2);

  $<HTMLButtonElement>('quota-order-mine', section('claude'))!.click();
  flushSync();
  expect($('quota-order-mine', section('claude'))!.getAttribute('aria-pressed')).toBe('true');
  expect(accounts('claude')).toEqual(['claude-1', 'claude-2']);
  await settle();
  expect((await order(client)).strategy).toBe('fill-first');
  const [up, secondUp] = all('quota-order-up', section('claude')) as HTMLButtonElement[];
  expect(up!.disabled).toBe(true);
  expect(secondUp!.getAttribute('aria-label')).toBe('Move work@… up');
  secondUp!.click();
  await settle();
  expect(accounts('claude')).toEqual(['claude-2', 'claude-1']);
  expect((await order(client)).accounts.map(account => [account.id, account.position])).toEqual([['claude-2', 0], ['claude-1', 1]]);
  expect(all('quota-order-account', section('claude')).map(row => row.querySelector('.rank')!.textContent)).toEqual(['1', '2']);

  $<HTMLInputElement>('quota-order-spare', section('claude'))!.click();
  await settle();
  expect((await order(client)).spareFamilies).toEqual(['fable']);
  expect($<HTMLInputElement>('quota-order-spare')!.checked).toBe(true);

  $<HTMLButtonElement>('limits-glance-order')!.click();
  await settle();
  expect($('limits-glance-order-mode')).toBeNull();
  expect($('quota-order-provider')).toBeNull();
  expect(all('quota-provider').length).toBeGreaterThan(2);
});

test('a change Douane refuses goes back to what Douane holds and says why', async () => {
  const { client } = await glance();
  await client.call('subscriptionProxy.setOrder', { providerId: 'claude', strategy: 'fill-first' });
  $<HTMLButtonElement>('limits-glance-order')!.click();
  await vi.waitFor(() => expect(all('quota-order-down').length).toBeGreaterThan(0));
  let refuse!: (error: Error) => void;
  const real = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => method === 'subscriptionProxy.setOrder'
    ? new Promise((_, reject) => { refuse = reject; }) : real(method as never, params as never)) as never);
  $<HTMLButtonElement>('quota-order-down', section('claude'))!.click();
  await settle();
  // Shown before Douane answers.
  expect(accounts('claude')).toEqual(['claude-2', 'claude-1']);
  refuse(new Error('Douane at http://127.0.0.1:8787 refused the change: ids must list every claude account exactly once'));
  await settle();
  expect(accounts('claude')).toEqual(['claude-1', 'claude-2']);
  expect($('limits-glance-order-error')!.textContent).toContain('ids must list every claude account exactly once');
  expect((await real('subscriptionProxy.order', {})).providers[0]!.accounts.every(account => account.position === null)).toBe(true);
});

test('a Douane that predates the account order adds nothing to the panel', async () => {
  const old: GatewayOrder = { status: 'unsupported', origin: 'http://127.0.0.1:8787', managementToken: false, providers: [] };
  await glance('http://127.0.0.1:8787', (client) => {
    const real = client.call.bind(client);
    vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => method === 'subscriptionProxy.order' ? Promise.resolve(old) : real(method as never, params as never)) as never);
  });
  expect($('limits-glance-page')).not.toBeNull();
  expect($('limits-glance-order')).toBeNull();
});

test('a Douane that wants its management token says where to enter it', async () => {
  await glance('https://douane.example.test');
  $<HTMLButtonElement>('limits-glance-order')!.click();
  await settle();
  expect($('limits-glance-order-token')!.textContent).toContain('management token');
  expect($('quota-order-provider')).toBeNull();
});

test('a paired device is told where the order is set, and asks Douane nothing', async () => {
  const calls: string[] = [];
  await glance('http://127.0.0.1:8787', (client, store) => {
    client.becomes('session');
    store.principal = 'session';
    const real = client.call.bind(client);
    vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => { calls.push(method); return real(method as never, params as never); }) as never);
  });
  $<HTMLButtonElement>('limits-glance-order')!.click();
  await settle();
  expect($('limits-glance-order-remote')!.textContent).toContain('A paired device only reads the limits');
  expect($('quota-order-provider')).toBeNull();
  expect($('quota-order-spare')).toBeNull();
  expect(calls.filter(method => method.startsWith('subscriptionProxy.order') || method === 'subscriptionProxy.setOrder')).toEqual([]);
});
