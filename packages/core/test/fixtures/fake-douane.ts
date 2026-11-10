/**
 * A stand-in for Douane: `--config <file>`, the `listen` line of that file,
 * `/health`, `/v1/models`, `/admin/api/summary` and the account order
 * (`/admin/api/settings`, `/admin/api/accounts`, `/admin/api/accounts/order`).
 * Environment:
 * FAKE_DOUANE_VERSION names its version; FAKE_DOUANE_CRASH_FILE, when that
 * file exists, makes it delete the file and exit with code 3 a moment after
 * it answers; FAKE_DOUANE_IN_FLIGHT_FILE holds the number `in_flight` reports;
 * FAKE_DOUANE_RUNS_FILE, when it exists, holds one word per start to come:
 * `exit` exits with code 1 at once, `late` listens a second late, and each
 * start takes its word off the top. FAKE_DOUANE_MANAGEMENT_KEY is the
 * management token its `/admin/api` account routes then ask for;
 * FAKE_DOUANE_LEGACY=1 answers as a Douane that predates the account order (no
 * `spare_families`, no `position`); FAKE_DOUANE_ECHO_KEY=1 makes a refused
 * order repeat the management key it was sent.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const runs = process.env.FAKE_DOUANE_RUNS_FILE;
if (runs && existsSync(runs)) {
  const [word, ...rest] = readFileSync(runs, 'utf8').split('\n').filter(Boolean);
  writeFileSync(runs, rest.map((line) => `${line}\n`).join(''));
  if (word === 'exit') process.exit(1);
  if (word === 'late') await Bun.sleep(1_000);
}

const at = process.argv.indexOf('--config');
const config = at > 0 ? process.argv[at + 1] : undefined;
if (!config) {
  console.error('ERROR fake douane: --config is required');
  process.exit(2);
}
const listen = /^listen\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1];
const [hostname, port] = (listen ?? '').split(':');
if (!hostname || !port) {
  console.error(`ERROR fake douane: no listen line in ${config}`);
  process.exit(2);
}
const version = process.env.FAKE_DOUANE_VERSION ?? '0.3.0';
const clientFile = `${config}.client-key`;
const clientsRequired = process.env.FAKE_DOUANE_CLIENT_KEYS === '1';

const managementKey = process.env.FAKE_DOUANE_MANAGEMENT_KEY;
const legacy = process.env.FAKE_DOUANE_LEGACY === '1';
const STRATEGIES = ['round-robin', 'fill-first', 'reset-first', 'smart'];
const settings: Record<string, unknown> = {
  strategy: 'smart', provider_strategies: { claude: 'reset-first', codex: 'reset-first' }, quota_refresh_seconds: 300,
  ...(legacy ? {} : { spare_families: {} }),
};
interface FakeAccount { id: string; provider: string; name: string | null; email: string | null; enabled: boolean; position?: number | null }
const accounts: FakeAccount[] = [
  { id: 'c3aa', provider: 'claude', name: 'Magali', email: 'magali@example.test', enabled: true },
  { id: 'c1bb', provider: 'claude', name: null, email: 'chris@example.test', enabled: true },
  { id: 'c2cc', provider: 'claude', name: null, email: null, enabled: false },
  { id: 'x1dd', provider: 'codex', name: 'Work', email: 'work@example.test', enabled: true },
].map(account => (legacy ? account : { ...account, position: null }));
/** The account-order writes received, without any header. */
const writes: { method: string; path: string; body: unknown }[] = [];

/** Douane's account order and settings, as the shared contract words them. */
async function admin(request: Request, path: string): Promise<Response | null> {
  if (path === '/debug/writes') return Response.json({ writes });
  if (path !== '/admin/api/settings' && path !== '/admin/api/accounts' && path !== '/admin/api/accounts/order') return null;
  const key = request.headers.get('x-management-key');
  if (managementKey && key !== managementKey) return Response.json({ error: 'management authentication required' }, { status: 401 });
  const reading = request.method === 'GET';
  const body = reading ? null : await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!reading) writes.push({ method: request.method, path, body });
  if (path === '/admin/api/accounts') return reading ? Response.json({ accounts }) : null;
  if (path === '/admin/api/settings') {
    if (reading) return Response.json(settings);
    if (request.method !== 'PATCH' && request.method !== 'PUT') return new Response('method not allowed', { status: 405 });
    if (body === null) return Response.json({ error: 'expected a JSON object' }, { status: 400 });
    for (const strategy of Object.values(body.provider_strategies ?? {})) {
      if (!STRATEGIES.includes(String(strategy))) return Response.json({ error: `unknown strategy ${String(strategy)}` }, { status: 400 });
    }
    if ('spare_families' in body && legacy) return Response.json({ error: 'unknown field `spare_families`' }, { status: 400 });
    Object.assign(settings, body);
    return Response.json(settings);
  }
  if (request.method !== 'PUT' || legacy) return new Response('not found', { status: 404 });
  const provider = typeof body?.provider === 'string' ? body.provider : '';
  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  const owned = accounts.filter(account => account.provider === provider);
  if (owned.length === 0 || ids.length !== owned.length || new Set(ids).size !== ids.length || owned.some(account => !ids.includes(account.id))) {
    const echo = process.env.FAKE_DOUANE_ECHO_KEY === '1' ? ` (asked with ${key ?? 'no key'})` : '';
    return new Response(`ids must list every ${provider} account exactly once${echo}`, { status: 400, headers: { 'content-type': 'text/plain' } });
  }
  for (const account of owned) account.position = ids.indexOf(account.id);
  return Response.json({ accounts: owned });
}

Bun.serve({
  hostname, port: Number(port),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/health') return Response.json({ status: 'ok', version, service: 'douane' });
    const managed = await admin(request, path);
    if (managed !== null) return managed;
    if (clientsRequired && path === '/admin/api/clients' && request.method === 'POST') {
      if (existsSync(clientFile)) return new Response('client already created', { status: 409 });
      const body = await request.json() as { name?: string; access?: { all?: boolean } };
      if (body.name !== 'Boite' || body.access?.all !== true) return new Response('bad client', { status: 400 });
      const key = 'dk_fixture-local-client';
      writeFileSync(clientFile, key);
      return Response.json({ key, client: { name: 'Boite' } }, { status: 201 });
    }
    if (clientsRequired && path.startsWith('/v1/') && (!existsSync(clientFile) || request.headers.get('authorization') !== `Bearer ${readFileSync(clientFile, 'utf8')}`)) return new Response('client key required', { status: 401 });
    if (path === '/v1/quotas') return Response.json({ object: 'quotas', updated_at: null, providers: [] });
    if (path === '/v1/models') return Response.json({ object: 'list', data: [{ id: 'claude-sonnet-5', object: 'model', supported_endpoint_types: ['anthropic'] }] });
    // What the core left in its environment: a gateway gets no owner token and no agent variable.
    if (path === '/debug/env') return Response.json({ token: process.env.BOITE_TOKEN !== undefined, thread: process.env.BOITE_THREAD_ID !== undefined, cwd: process.cwd() });
    if (path === '/admin/api/summary') {
      const file = process.env.FAKE_DOUANE_IN_FLIGHT_FILE;
      const inFlight = file && existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) || 0 : 0;
      return Response.json({ in_flight: inFlight, version });
    }
    return new Response('not found', { status: 404 });
  },
});
console.log(`INFO fake douane ${version} listening on ${listen}`);

const crash = process.env.FAKE_DOUANE_CRASH_FILE;
if (crash && existsSync(crash)) {
  rmSync(crash, { force: true });
  setTimeout(() => {
    console.error('ERROR fake douane: crashing on purpose');
    process.exit(3);
  }, 300);
}
