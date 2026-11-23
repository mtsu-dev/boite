import { afterEach, expect, test } from 'bun:test';
import type { AccountQuota, RpcEvents, SubscriptionProxy } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { parseGatewayQuotas } from '../src/subscription-proxy-quotas.ts';
import { startTestCore, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

let harness: TestCore | undefined;
let gateway: ReturnType<typeof Bun.serve> | undefined;
afterEach(async () => { gateway?.stop(true); gateway = undefined; await harness?.stop(); harness = undefined; });

function config(baseUrl: string, kind: SubscriptionProxy['kind'] = 'douane'): SubscriptionProxy {
  return { enabled: true, kind, baseUrl, dashboardUrl: `${baseUrl.replace(/\/v1\/?$/, '')}/admin/#quotas` };
}

/** Douane's answer exactly as the contract spells it: one provider per display mode. */
const DOUANE = {
  object: 'quotas',
  updated_at: '2026-10-04T12:00:00Z',
  providers: [
    { provider: 'claude', name: 'Claude', display: 'accounts', entries: [
      { id: '3b317ce1e503', label: 'Claude Max x20 · chris@…', plan: 'Claude Max x20', accounts: 1, status: 'ready', error: null,
        updated_at: '2026-10-04T11:59:00Z',
        windows: [{ id: 'five-hour', label: '5 hours', used_percent: 11.0, remaining_percent: 89.0, reset_at: '2026-10-04T13:49:59Z' }],
        credits: [{ id: 'codex-credits', label: 'Credits', unit: 'credits', remaining: 62500.0, limit: null, used: null }] },
      { id: 'c00l', label: 'Claude Pro · work@…', plan: 'Claude Pro', accounts: 1, status: 'cooldown', error: null, updated_at: null,
        windows: [{ id: 'weekly', label: 'Weekly', used_percent: 100, remaining_percent: 0, reset_at: null }], credits: [] },
    ] },
    { provider: 'antigravity', name: 'Antigravity', display: 'average', entries: [
      { id: 'antigravity', label: 'Antigravity · 10 comptes', plan: null, accounts: 10, status: 'ready', error: null,
        updated_at: '2026-10-04T11:58:00Z',
        windows: [{ id: 'gemini-pro', label: 'Gemini Pro', used_percent: 40.5, remaining_percent: 59.5, reset_at: '2026-10-04T17:00:00Z' }],
        credits: [] },
    ] },
  ],
};

test('quotas come from Douane through the core, in both display modes, with the key as Bearer and the native cadence', async () => {
  const seen: { path: string; auth: string | null }[] = [];
  const searches: string[] = [];
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const { pathname: path, search } = new URL(request.url);
    seen.push({ path, auth: request.headers.get('authorization') });
    searches.push(search);
    return path === '/v1/quotas' ? Response.json(DOUANE) : new Response('not found', { status: 404 });
  } });
  harness = await startTestCore();
  const owner = await harness.connect();
  const key = 'douane-quota-test-token';
  await owner.call('subscriptionProxy.configure', { subscriptionProxy: config(`http://127.0.0.1:${gateway.port}/v1`), key });
  const events: RpcEvents['subscriptionProxy.quotasUpdated'][] = [];
  harness.core.bus.onAny((name, payload) => { if (name === 'subscriptionProxy.quotasUpdated') events.push(payload as RpcEvents['subscriptionProxy.quotasUpdated']); });

  const state = await owner.call('subscriptionProxy.quotas', {});
  expect(state).toMatchObject({ status: 'ready', error: null, updatedAt: Date.parse('2026-10-04T12:00:00Z') });
  expect(state.providers.map((provider) => [provider.providerId, provider.display, provider.entries.length])).toEqual([['claude', 'accounts', 2], ['antigravity', 'average', 1]]);
  expect(state.providers[0]!.entries[0]).toEqual({
    id: '3b317ce1e503', label: 'Claude Max x20 · chris@…', plan: 'Claude Max x20', accounts: 1, status: 'ready', error: null,
    updatedAt: Date.parse('2026-10-04T11:59:00Z'),
    windows: [{ id: 'five-hour', label: '5 hours', usedPercent: 11, resetsAt: Date.parse('2026-10-04T13:49:59Z') }],
    credits: [{ id: 'codex-credits', label: 'Credits', unit: 'credits', remaining: 62500, limit: null, used: null }],
  });
  expect(seen).toEqual([{ path: '/v1/quotas', auth: `Bearer ${key}` }]);

  // quotas.list carries the same entries, after the accounts, without asking again within a minute.
  const rows = await owner.call('quotas.list', {});
  expect(seen).toHaveLength(1);
  const proxied = rows.filter((row) => row.gateway);
  expect(proxied.map((row) => [row.accountId, row.providerName, row.status, row.gateway!.accounts])).toEqual([
    ['proxy:claude:3b317ce1e503', 'Claude', 'ready', 1],
    ['proxy:claude:c00l', 'Claude', 'ready', 1],
    ['proxy:antigravity:antigravity', 'Antigravity', 'ready', 10],
  ]);
  expect(proxied[1]!.gateway).toMatchObject({ kind: 'douane', display: 'accounts', status: 'cooldown', plan: 'Claude Pro' });
  expect(proxied[2]!.gateway).toMatchObject({ display: 'average', accounts: 10, entryId: 'antigravity' });
  // The machine's own Claude and Codex accounts are the gateway's now.
  expect(rows.filter((row) => !row.gateway && ['claude', 'codex'].includes(row.providerId)).every((row) => row.status === 'unsupported')).toBe(true);
  // A gateway entry is not an account: no switch, no reset.
  expect(await thrown(owner.call('quotas.configure', { accountId: 'proxy:claude:c00l', enabled: false }))).toThrow();

  // Refresh asks again, and every client hears the answer.
  const progress: string[] = [];
  owner.on('quotas.progress', (event) => progress.push(event.quota.accountId));
  await owner.call('quotas.list', { refresh: true, requestId: 'gateway-refresh' });
  expect(seen).toHaveLength(2);
  // Only the refresh asked by hand tells Douane to read its accounts first.
  expect(searches).toEqual(['', '?refresh=1']);
  expect(progress).toEqual(expect.arrayContaining(['proxy:claude:3b317ce1e503', 'proxy:antigravity:antigravity']));
  expect(events.at(-1)?.status).toBe('ready');

  // A paired phone reads the bars the core holds; asking Douane again stays the owner's.
  const { grant } = await owner.call('pairing.grant', {});
  const phone = await connect(harness.url, '', { grant, client: { name: 'pwa', version: 'test' } });
  try {
    expect((await phone.call('subscriptionProxy.quotas', {})).providers.map((provider) => provider.providerId)).toEqual(['claude', 'antigravity']);
    expect(await thrown(phone.call('subscriptionProxy.quotas', { refresh: true }))).toThrow('refresh must be false or absent');
  }
  finally { phone.close(); }

  // Turning the proxy off drops the entries at once, from the quota rows every reader keeps too.
  const updates: AccountQuota[][] = [];
  harness.core.bus.onAny((name, payload) => { if (name === 'quotas.updated') updates.push(payload as AccountQuota[]); });
  await owner.call('settings.set', { subscriptionProxy: { ...config(`http://127.0.0.1:${gateway.port}/v1`), enabled: false } });
  expect(events.at(-1)?.status).toBe('off');
  expect(updates).toHaveLength(1);
  expect(updates[0]!.some((row) => row.gateway)).toBe(false);
  expect((await owner.call('quotas.list', {})).some((row) => row.gateway)).toBe(false);
  expect(seen).toHaveLength(2);
});

test('an older Douane answering 404 and CLIProxyAPI fall back to the dashboard', async () => {
  let hits = 0;
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { hits++; return new Response('<html>no route</html>', { status: 404 }); } });
  harness = await startTestCore({ settings: { subscriptionProxy: config(`http://127.0.0.1:${gateway.port}`) } });
  const owner = await harness.connect();
  expect(await owner.call('subscriptionProxy.quotas', { refresh: true })).toEqual({ status: 'unsupported', providers: [], updatedAt: null, checkedAt: null, error: null });
  expect((await owner.call('quotas.list', {})).some((row) => row.gateway)).toBe(false);
  expect(hits).toBe(1);

  await owner.call('settings.set', { subscriptionProxy: config(`http://127.0.0.1:${gateway.port}`, 'cliproxyapi') });
  expect((await owner.call('subscriptionProxy.quotas', { refresh: true })).status).toBe('unsupported');
  expect(hits).toBe(1);
});

test('an oversized, invalid or failing answer is refused without its body and keeps the last good reading stale', async () => {
  let mode: 'good' | 'declared' | 'chunked' | 'invalid' | 'error' = 'good';
  const secret = 'raw-gateway-secret-in-body';
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    if (mode === 'good') return Response.json(DOUANE);
    if (mode === 'declared') return new Response(`{"providers":[],"pad":"${secret}${'x'.repeat(4096)}"}`);
    if (mode === 'chunked') return new Response(new ReadableStream({ start(controller) {
      for (let index = 0; index < 8; index++) controller.enqueue(new TextEncoder().encode(`${secret}${'y'.repeat(1024)}`));
      controller.close();
    } }));
    if (mode === 'invalid') return new Response(`not json ${secret}`, { headers: { 'content-type': 'application/json' } });
    return new Response(secret, { status: 500 });
  } });
  harness = await startTestCore({ settings: { subscriptionProxy: config(`http://127.0.0.1:${gateway.port}`) } });
  // A small cap keeps the oversized bodies small in the test.
  const { GatewayQuotas } = await import('../src/subscription-proxy-quotas.ts');
  const quotas = new GatewayQuotas(harness.core, 2048);
  const good = await quotas.read(true);
  expect(good.status).toBe('ready');

  for (const [next, message] of [['declared', 'exceeded 2048 bytes'], ['chunked', 'exceeded 2048 bytes'], ['invalid', 'invalid JSON'], ['error', 'HTTP 500']] as const) {
    mode = next;
    const state = await quotas.read(true);
    expect(state.status).toBe('unavailable');
    expect(state.error).toContain(message);
    expect(JSON.stringify(state)).not.toContain(secret);
    // The last good answer stays, marked stale on every row.
    expect(state.providers).toEqual(good.providers);
    expect(state.checkedAt).toBe(good.checkedAt);
    expect(quotas.rows(state).every((row) => row.status === 'unavailable' && row.error === state.error)).toBe(true);
  }
  expect(JSON.stringify(await (await harness.connect()).call('core.logs', {}))).not.toContain(secret);
});


test('gateway quota readings stay independent of cooldown and account errors across refreshes', async () => {
  const [claude, antigravity] = DOUANE.providers;
  const fresh = claude!.entries[0]!;
  const average = antigravity!.entries[0]!;
  const reason = 'upstream quota exceeded';
  const retryAt = '2026-10-04T12:45:00Z';
  const cooldown = { ...fresh, status: 'cooldown', error: reason, read_error: null, status_reason: reason, retry_at: retryAt };
  const legacy = { ...fresh, id: 'legacy', status: 'cooldown', error: reason };
  const websocket = { ...legacy, id: 'websocket', error: 'websocket upstream quota exceeded' };
  const auth = { ...fresh, id: 'auth', status: 'error', error: 'OAuth token expired', read_error: null, status_reason: 'OAuth token expired' };
  const readError = 'r'.repeat(300);
  const readWithError = { ...cooldown, error: reason, read_error: `quota\u0000 read failed ${readError}`, windows: [], credits: [], updated_at: null };
  const averageCooldown = { ...average, status: 'cooldown', error: 'legacy aggregate text', read_error: 'one account timed out', status_reason: reason };
  const averageEmpty = { ...averageCooldown, windows: [], updated_at: null };
  const body = (entries: object[], aggregate: object) => ({ ...DOUANE, providers: [
    { ...claude, entries }, { ...antigravity, entries: [aggregate] },
  ] });
  let answer: ReturnType<typeof body> | null = body([fresh], average);
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    return answer ? Response.json(answer) : new Response('unavailable', { status: 502 });
  } });
  harness = await startTestCore({ settings: { subscriptionProxy: config(`http://127.0.0.1:${gateway.port}/v1`) } });
  const owner = await harness.connect();
  const read = async () => (await owner.call('quotas.list', { refresh: true })).filter(row => row.gateway);

  const [initial] = await read();
  expect(initial).toMatchObject({ status: 'ready', error: null, gateway: { status: 'ready' } });

  answer = body([cooldown, legacy, websocket, auth], averageCooldown);
  const [first, old, oldWebsocket, failedAuth, pool] = await read();
  const reading = { windows: first!.windows, checkedAt: first!.checkedAt };
  const credits = first!.gateway!.credits;
  expect(first).toMatchObject({ status: 'ready', error: null, checkedAt: Date.parse(fresh.updated_at!),
    gateway: { status: 'cooldown', statusReason: reason, retryAt } });
  expect(reading.windows).toHaveLength(1);
  expect(credits).toHaveLength(1);
  expect(old).toMatchObject({ status: 'ready', error: null, gateway: { status: 'cooldown', statusReason: legacy.error } });
  expect(oldWebsocket).toMatchObject({ status: 'ready', error: null, gateway: { status: 'cooldown', statusReason: websocket.error } });
  expect(failedAuth).toMatchObject({ status: 'unavailable', error: auth.status_reason, gateway: { status: 'error', statusReason: auth.status_reason } });
  expect(pool).toMatchObject({ status: 'ready', error: null, gateway: { display: 'average', status: 'cooldown', statusReason: reason } });

  answer = body([readWithError, { ...legacy, error: 'could not read the quota', retry_at: 'invalid' },
    { ...cooldown, id: 'explicit', read_error: reason, status_reason: undefined }], averageEmpty);
  const [failedRead, ambiguous, explicit, failedPool] = await read();
  expect(failedRead).toMatchObject({ ...reading, status: 'unavailable', error: `quota  read failed ${readError}`.slice(0, 300),
    gateway: { status: 'cooldown', statusReason: reason, retryAt, credits } });
  expect(ambiguous).toMatchObject({ status: 'unavailable', error: 'could not read the quota', gateway: { status: 'cooldown', retryAt: null } });
  expect(explicit).toMatchObject({ status: 'unavailable', error: reason, gateway: { status: 'cooldown' } });
  expect(explicit!.gateway!.statusReason).toBeUndefined();
  expect(failedPool).toMatchObject({ status: 'unavailable', error: 'one account timed out', windows: pool!.windows,
    gateway: { display: 'average', status: 'cooldown', statusReason: reason } });

  answer = null;
  const [globalFailure] = await read();
  expect(globalFailure).toMatchObject({ ...reading, status: 'unavailable', error: 'Douane quotas returned HTTP 502.',
    gateway: { status: 'cooldown', statusReason: reason, credits } });

  answer = body([{ ...fresh, error: reason, read_error: null, status_reason: null, retry_at: null, credits: [],
    windows: [{ ...fresh.windows[0]!, used_percent: 5 }] }], average);
  const [recovered, recoveredPool] = await read();
  expect(recovered).toMatchObject({ status: 'ready', error: null, windows: [{ usedPercent: 5 }],
    gateway: { status: 'ready', statusReason: null, retryAt: null, credits: [] } });
  expect(recoveredPool).toMatchObject({ status: 'ready', error: null, windows: [{ usedPercent: 40.5 }] });
});

test('rows that break the contract are dropped and strings are bounded', () => {
  expect(() => parseGatewayQuotas({ data: [] })).toThrow('providers array');
  const parsed = parseGatewayQuotas({ providers: [
    { provider: 'bad provider id', entries: [{ id: 'a', label: 'A' }] },
    { provider: 'codex', display: 'sideways', entries: [
      { id: 'no-label' },
      { id: 'x', label: `Codex\u0000 ${'n'.repeat(400)}`, accounts: -3, status: 'exploded', error: 'e'.repeat(900),
        windows: [{ id: 'primary', label: 'Weekly', used_percent: 180, reset_at: 'not a date', primary: 'yes' }, { id: 'missing' }, { id: 'left', remaining_percent: 25, primary: true }, { id: 'left', remaining_percent: 50 }],
        credits: [{ id: 'c', remaining: '12' }] },
      { id: 'x', label: 'duplicate' },
    ] },
    { provider: 'codex', entries: [] },
  ] }, (id) => id === 'codex' ? 'Codex CLI' : null);
  expect(parsed.providers).toHaveLength(1);
  const [codex] = parsed.providers;
  expect(codex).toMatchObject({ providerId: 'codex', name: 'Codex CLI', display: 'accounts' });
  expect(codex!.entries).toHaveLength(1);
  const entry = codex!.entries[0]!;
  expect(entry.label.length).toBe(200);
  expect(entry.label).not.toContain('\u0000');
  expect(entry.error!.length).toBe(300);
  expect(entry).toMatchObject({ accounts: 1, status: 'ready' });
  // Only a literal `true` marks Douane's primary window.
  expect(entry.windows).toEqual([
    { id: 'primary', label: 'Weekly', usedPercent: 100, resetsAt: null },
    { id: 'left', label: 'left', usedPercent: 75, resetsAt: null, primary: true },
  ]);
  expect(entry.credits).toEqual([{ id: 'c', label: 'c', unit: null, remaining: null, limit: null, used: null }]);
});

test('quota caps preserve the first provider, entry and line even after the shared entry budget runs out', () => {
  const windows = Array.from({ length: 64 }, (_, index) => ({ id: `window-${index}`, used_percent: index }));
  const entries = Array.from({ length: 1050 }, (_, index) => ({ id: `entry-${index}`, label: `Entry ${index}` }));
  const { providers } = parseGatewayQuotas({ providers: [
    { provider: 'first', entries: [{ ...entries[0], windows }, { ...entries[0], label: 'Duplicate' }, ...entries.slice(1)] },
    { provider: 'first', entries: [] },
    ...Array.from({ length: 40 }, (_, index) => ({ provider: `more-${index}`, entries: [{ id: 'later', label: 'Later' }] })),
  ] });
  expect(providers.map(provider => provider.providerId)).toEqual(['first', ...Array.from({ length: 31 }, (_, index) => `more-${index}`)]);
  const first = providers[0]!;
  expect(first.entries).toHaveLength(1024);
  expect(first.entries.at(-1)?.id).toBe('entry-1023');
  expect(providers.slice(1).every(provider => provider.entries.length === 0)).toBe(true);
  expect(first.entries[0]?.label).toBe('Entry 0');
  expect(first.entries[0]?.windows.map(window => window.id)).toEqual(windows.slice(0, 16).map(window => window.id));
});

test('the share used outside Douane is kept per window only when it is a percent', () => {
  const windows = (outside: unknown[]) => parseGatewayQuotas({ providers: [{ provider: 'claude', entries: [{ id: 'a', label: 'A',
    windows: outside.map((value, index) => ({ id: `w${index}`, label: 'Weekly', used_percent: 50, ...(value === undefined ? {} : { outside_percent: value }) })) }] }] },
  () => 'Claude').providers[0]!.entries[0]!.windows;
  const parsed = windows([40, 0, 100, 12.5, undefined, 140, -3, '40', null, Number.NaN]);
  expect(parsed.map((window) => window.outsidePercent)).toEqual([40, 0, 100, 12.5, undefined, undefined, undefined, undefined, undefined, undefined]);
  // Absent means absent, not zero: the field is left out of the window.
  expect(parsed.slice(4).every((window) => !('outsidePercent' in window))).toBe(true);
  expect(parsed[0]).toEqual({ id: 'w0', label: 'Weekly', usedPercent: 50, resetsAt: null, outsidePercent: 40 });
});

test('local accounts stay stored and come back unchanged when the proxy goes off', async () => {
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return Response.json(DOUANE); } });
  harness = await startTestCore();
  const owner = await harness.connect();
  const work = await owner.call('accounts.add', { providerId: 'claude', label: 'Work' });
  const before = await owner.call('accounts.list', {});
  const proxy = config(`http://127.0.0.1:${gateway.port}`);
  await owner.call('subscriptionProxy.configure', { subscriptionProxy: proxy });
  const during = await owner.call('accounts.list', {});
  // Nothing synthetic is stored or listed: clients draw the gateway account from settings.
  expect(during.map((account) => account.id)).toEqual(before.map((account) => account.id));
  expect(during.find((account) => account.id === work.id)?.label).toBe('Work');
  await owner.call('settings.set', { subscriptionProxy: { ...proxy, enabled: false } });
  const after = await owner.call('accounts.list', {});
  expect(after.map(({ id, label, isolationDir }) => ({ id, label, isolationDir }))).toEqual(before.map(({ id, label, isolationDir }) => ({ id, label, isolationDir })));
});

test('remote Douane reports a missing client key without creating a client through its admin API', async () => {
  const paths: string[] = [];
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    paths.push(new URL(request.url).pathname);
    return new Response('private response', { status: 401 });
  } });
  harness = await startTestCore({ settings: { subscriptionProxy: config(`http://127.0.0.1:${gateway.port}/v1`) } });
  const owner = await harness.connect();
  const state = await owner.call('subscriptionProxy.quotas', {});
  expect(state.error).toContain('valid client API key (HTTP 401)');
  expect(state.error).not.toContain('private response');
  expect(paths).toEqual(['/v1/quotas']);
});

test('a new key is asked again at once, whether saved alone or with the configuration', async () => {
  const seen: string[] = [];
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const auth = request.headers.get('authorization') ?? '';
    seen.push(auth);
    return auth === 'Bearer good-key' ? Response.json(DOUANE) : Response.json({ error: 'bad key' }, { status: 401 });
  } });
  harness = await startTestCore();
  const owner = await harness.connect();
  const proxy = config(`http://127.0.0.1:${gateway.port}/v1`);
  await owner.call('subscriptionProxy.configure', { subscriptionProxy: proxy, key: 'wrong-key' });
  expect((await owner.call('subscriptionProxy.quotas', {})).status).toBe('unavailable');

  // The corrected key: the next plain read asks the gateway with it.
  await owner.call('subscriptionProxy.configure', { subscriptionProxy: proxy, key: 'good-key' });
  expect((await owner.call('subscriptionProxy.quotas', {})).status).toBe('ready');
  expect(seen).toEqual(['Bearer wrong-key', 'Bearer good-key']);

  // The same settings with another key: no settings change, still a new answer.
  await owner.call('subscriptionProxy.configure', { subscriptionProxy: proxy, key: 'wrong-key' });
  expect((await owner.call('subscriptionProxy.quotas', {})).status).toBe('unavailable');
  expect(seen).toEqual(['Bearer wrong-key', 'Bearer good-key', 'Bearer wrong-key']);
});

test('a user refresh requested during an in-flight read still asks Douane with ?refresh=1', async () => {
  const seen: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    seen.push(`${url.pathname}${url.search}`);
    if (seen.length === 1) await firstGate;
    return Response.json(DOUANE);
  } });
  harness = await startTestCore({ settings: { subscriptionProxy: config(`http://127.0.0.1:${gateway.port}/v1`) } });
  const owner = await harness.connect();
  const initial = owner.call('subscriptionProxy.quotas', {});
  const refreshed = owner.call('subscriptionProxy.quotas', { refresh: true });
  releaseFirst();
  await Promise.all([initial, refreshed]);
  expect(seen).toEqual(['/v1/quotas', '/v1/quotas?refresh=1']);
});
