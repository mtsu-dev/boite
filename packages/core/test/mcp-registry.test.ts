import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServerInput } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { redactMcpMessage } from '../src/mcp/http.ts';
import { echoThread, startTestCore, testProject, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

const GLOBAL = { enabled: true, scope: 'global', projectIds: [] } as const;
const INIT = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } };
const FIXTURE = join(import.meta.dir, 'fixtures', 'stdio-mcp.ts');
const MOCK_SECRET = 'fixture-value-with-a-quote"';
const HTTP_CREDENTIAL = 'mock-http-credential';
const UPSTREAM_SESSION = 'fixture-upstream-session';
const stdio = (name: string) => ({ ...GLOBAL, projectIds: [], name, transport: 'stdio' as const, command: process.execPath, args: [FIXTURE] });
const http = (url: string) => ({ ...GLOBAL, projectIds: [], name: 'HTTP fixture', transport: 'http' as const, url });
const req = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, params });

let harness: TestCore;
beforeEach(async () => { harness = await startTestCore(); });
afterEach(async () => { await harness.stop(); });

test('owner CRUD emits changes and persists only credential metadata in the journal', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const input = { ...stdio('Local tools'), secretEnv: { LAZY_MCP_TOOL: MOCK_SECRET, OTHER_VALUE: 'another-fixture' }, env: { PUBLIC: 'visible' } };
  const changed = client.next('mcp.changed', () => true, 3000);
  const server = await client.call('mcp.save', input);
  expect(await changed).toEqual({});
  expect(server).toMatchObject({ id: 'local-tools', env: input.env, envKeys: ['PUBLIC'], secretEnvKeys: ['LAZY_MCP_TOOL', 'OTHER_VALUE'] });
  expect((await client.call('mcp.list', {})).presets).toHaveLength(9);
  expect(await thrown(client.call('mcp.save', input))).toThrow('unique server name and slug');
  expect(await thrown(client.call('mcp.save', { ...input, name: 'bad', scope: 'projects', projectIds: ['missing'] }))).toThrow('projectIds');
  const path = join(harness.dataDir, 'mcp-secrets.json');
  const onDisk = () => JSON.parse(readFileSync(path, 'utf8'));
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(onDisk()).toEqual({ 'local-tools': { env: input.secretEnv, headers: {} } });
  const patch: McpServerInput = { ...input, id: server.id, name: 'Project tools', scope: 'projects', projectIds: [project.id], secretEnv: { OTHER_VALUE: null } };
  expect(await client.call('mcp.save', patch)).toMatchObject({ id: server.id, secretEnvKeys: ['LAZY_MCP_TOOL'] });
  expect(onDisk()).toEqual({ 'local-tools': { env: { LAZY_MCP_TOOL: MOCK_SECRET }, headers: {} } });
  const otherPath = join(harness.dataDir, 'other');
  mkdirSync(otherPath);
  const other = await client.call('projects.add', { name: 'Other', path: otherPath });
  await client.call('mcp.save', stdio('Global tools'));
  expect([...harness.core.mcp.resolve(project.id).keys()]).toEqual(['boite-managed-local-tools', 'boite-managed-global-tools']);
  expect([...harness.core.mcp.resolve(other.id).keys()]).toEqual(['boite-managed-global-tools']);
  expect([...harness.core.mcp.resolve(null).keys()]).toEqual(['boite-managed-global-tools']);
  const saved = JSON.stringify(await client.call('mcp.list', {}));
  const journal = JSON.stringify(harness.core.journal.getSetting('mcp:servers'));
  for (const text of [saved, journal]) {
    expect(text).not.toContain('fixture-value');
    expect(text).not.toContain('another-fixture');
  }
  await client.call('mcp.toggle', { id: server.id, enabled: false });
  expect([...harness.core.mcp.resolve(project.id).keys()]).toEqual(['boite-managed-global-tools']);
  expect(await client.call('mcp.remove', { id: server.id })).toEqual({ removed: true });
  expect(onDisk()).toEqual({});
});

test('agent and paired device principals cannot list or test the owner credentials and servers', async () => {
  const owner = await harness.connect();
  const { threadId } = await echoThread(harness, owner);
  const { grant } = await owner.call('pairing.grant', {});
  const phone = await connect(harness.url, '', { grant, client: { name: 'pwa', version: 'test' } });
  const agent = await connect(harness.url, harness.core.agents.tokenFor(threadId));
  try {
    for (const client of [phone, agent]) {
      expect(await thrown(client.call('mcp.list', {}))).toThrow('owner only');
      expect(await thrown(client.call('mcp.test', { id: 'any' }))).toThrow('owner only');
    }
  } finally { phone.close(); agent.close(); }
});

test('credential patches follow the stdio host environment case rules', async () => {
  const client = await harness.connect();
  const installed = await client.call('mcp.save', { ...stdio('Local tools'), secretEnv: { TOKEN: 'upper-fixture' } });
  expect(await thrown(client.call('mcp.save', { ...installed, env: { boite_fixture: 'reserved' } }))).toThrow('reserved keys');
  const removed = await client.call('mcp.save', { ...installed, secretEnv: { token: null } });
  if (process.platform === 'win32') {
    expect(removed.secretEnvKeys).toEqual([]);
    expect(JSON.parse(readFileSync(join(harness.dataDir, 'mcp-secrets.json'), 'utf8'))).toEqual({});
  } else {
    expect(removed.secretEnvKeys).toEqual(['TOKEN']);
    const patched = await client.call('mcp.save', { ...removed, secretEnv: { token: 'lower-fixture' } });
    expect(patched.secretEnvKeys).toEqual(['TOKEN', 'token']);
    expect(harness.core.mcp.runtime(patched)).toMatchObject({ env: { TOKEN: 'upper-fixture', token: 'lower-fixture' } });
  }
});

test('an owner can send credentials only over an encrypted connection', async () => {
  const client = await harness.connect();
  const saved = await client.call('mcp.save', { ...stdio('Saved tools'), secretEnv: { TOKEN: MOCK_SECRET } });
  const plain = await connect(harness.url, harness.token, { headers: { host: 'owner.example' } });
  try {
    expect((await plain.call('mcp.list', {})).encrypted).toBe(false);
    expect((await client.call('mcp.list', {})).encrypted).toBe(true);
    expect(await thrown(plain.call('mcp.save', { ...stdio('Local tools'), secretEnv: { TOKEN: MOCK_SECRET } }))).toThrow('encrypted link');
    expect(await thrown(plain.call('mcp.save', { ...http('https://example.test/mcp'), secretHeaders: { Authorization: MOCK_SECRET } }))).toThrow('encrypted link');
    expect(await plain.call('mcp.save', stdio('Local tools'))).toMatchObject({ secretEnvKeys: [] });
    expect(await plain.call('mcp.save', { ...saved, secretEnv: { TOKEN: null } })).toMatchObject({ secretEnvKeys: [] });
  } finally { plain.close(); }
});

test('HTTP credentials require HTTPS except on loopback', async () => {
  const client = await harness.connect();
  const secretHeaders = { Authorization: HTTP_CREDENTIAL };
  expect(await thrown(client.call('mcp.save', { ...http('http://example.test/mcp'), secretHeaders }))).toThrow('HTTPS');
  const server = await client.call('mcp.save', { ...http('http://example.test/mcp') });
  for (const url of ['https://example.test/mcp', 'http://127.0.0.1:5000/mcp', 'http://[::1]:5000/mcp', 'http://localhost:5000/mcp']) {
    expect(await client.call('mcp.save', { ...server, url, secretHeaders })).toMatchObject({ url, secretHeaderKeys: ['Authorization'] });
  }
});

test('HTTP credentials stay on the same origin and require explicit replacement on a new origin', async () => {
  const client = await harness.connect();
  const original = await client.call('mcp.save', {
    ...http('https://one.example.test/mcp'), secretHeaders: { Authorization: HTTP_CREDENTIAL, 'X-Custom': MOCK_SECRET },
  });
  const same = await client.call('mcp.save', { ...original, url: 'https://one.example.test:443/other' });
  expect(same.secretHeaderKeys).toEqual(['Authorization', 'X-Custom']);
  const moved = await client.call('mcp.save', { ...same, url: 'https://two.example.test/mcp', secretHeaders: { Authorization: 'new-origin-value' } });
  expect(moved.secretHeaderKeys).toEqual(['Authorization']);
  expect(harness.core.mcp.runtime(moved)).toMatchObject({ headers: { Authorization: 'new-origin-value' } });
  const cleared = await client.call('mcp.save', { ...moved, url: 'https://two.example.test:8443/mcp' });
  expect(cleared.secretHeaderKeys).toEqual([]);
  expect(JSON.parse(readFileSync(join(harness.dataDir, 'mcp-secrets.json'), 'utf8'))).toEqual({});
});

test('repairing a stored HTTP URL with an unreadable origin discards its old credentials', async () => {
  const client = await harness.connect();
  const original = await client.call('mcp.save', {
    ...http('https://one.example.test/mcp'), secretHeaders: { Authorization: HTTP_CREDENTIAL },
  });
  harness.core.journal.setSetting('mcp:servers', [{ ...original, url: 'https://' }]);
  const repaired = await client.call('mcp.save', { ...original, url: 'https://two.example.test/mcp' });
  expect(repaired.secretHeaderKeys).toEqual([]);
  expect(JSON.parse(readFileSync(join(harness.dataDir, 'mcp-secrets.json'), 'utf8'))).toEqual({});
});

test('recovery reads the current credential file on either side of the journal commit', async () => {
  const client = await harness.connect();
  const server = await client.call('mcp.save', { ...stdio('Local tools'), secretEnv: { LAZY_MCP_TOOL: 'prior-fixture' } });
  const pending = join(harness.dataDir, 'mcp-secrets.pending.json');
  writeFileSync(pending, JSON.stringify({ [server.id]: { env: { LAZY_MCP_TOOL: 'updated-fixture' }, headers: {} } }), { mode: 0o600 });
  const tool = async () => (await client.call('mcp.test', { id: server.id })).tools[0]?.name;
  const state = () => harness.core.mcp.runtime(server);
  expect(state()).toMatchObject({ env: { LAZY_MCP_TOOL: 'prior-fixture' } });
  harness.core.journal.setSetting('mcp:secrets-pending', true);
  expect(state()).toMatchObject({ env: { LAZY_MCP_TOOL: 'updated-fixture' } });
  expect(existsSync(pending)).toBe(false);
  expect(harness.core.journal.getSetting('mcp:secrets-pending')).toBeUndefined();
  expect(await tool()).toBe('[redacted]');
});

test('machine policy blocks probes, revokes registrations and refreshes sessions after re-enabling', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const mcp = harness.core.mcp;
  const server = await client.call('mcp.save', stdio('Local tools'));
  const previous = mcp.revision(null);
  const { authorization, entries } = harness.core.lazyMcp.register(threadId, harness.dataDir, process.env, new Map(), mcp.resolve(null));
  const url = entries['boite-managed-local-tools']!.url;
  const policy = join(harness.dataDir, 'no-policy.json');
  writeFileSync(policy, JSON.stringify({ mcp: false }));
  await client.call('policy.get', {});
  expect(await thrown(client.call('mcp.test', { id: server.id }))).toThrow('key mcp');
  expect(mcp.revision(null)).toBeNull();
  expect(mcp.resolve(null).size).toBe(0);
  expect((await fetch(url, { headers: { authorization } })).status).toBe(404);
  rmSync(policy);
  await client.call('policy.get', {});
  expect(mcp.revision(null)).not.toBe(previous);
  expect(mcp.resolve(null).size).toBe(1);
});

function processExited(pid: number): boolean {
  try { process.kill(pid, 0); return false; } catch { return true; }
}

test('disabling MCP aborts in-flight stdio and HTTP probes before their tool lists', async () => {
  const client = await harness.connect();
  const starts = join(harness.dataDir, 'slow-stdio-starts');
  const local = await client.call('mcp.save', { ...stdio('Slow stdio'), env: { LAZY_MCP_STARTS: starts, LAZY_MCP_INIT_DELAY_MS: '3000' } });
  const methods: string[] = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const rpc = request.method === 'POST' ? await request.json() as { id: number; method: string } : null;
    methods.push(rpc?.method ?? request.method);
    if (rpc?.method === 'initialize') return Response.json({
      jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: INIT.protocolVersion },
    }, { headers: { 'mcp-session-id': UPSTREAM_SESSION } });
    return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const remote = await client.call('mcp.save', http(upstream.url.href));
    const pending = Promise.allSettled([local, remote].map(({ id }) => client.call('mcp.test', { id })));
    await waitFor(() => existsSync(starts) && methods.length === 2);
    const pid = Number(readFileSync(starts, 'utf8').trim());
    writeFileSync(join(harness.dataDir, 'no-policy.json'), JSON.stringify({ mcp: false }));
    await client.call('policy.get', {});
    await waitFor(() => processExited(pid), 1200);
    for (const result of await pending) expect(result).toMatchObject({ status: 'fulfilled', value: { ok: false, error: expect.stringContaining('key mcp') } });
    expect(methods).toEqual(['initialize', 'notifications/initialized']);
  } finally { await upstream.stop(true); }
});

test('managed stdio probes and sessions redact reflected secrets and stop their own process', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const starts = join(harness.dataDir, 'stdio-starts');
  const server = await client.call('mcp.save', {
    ...stdio('Stdio fixture'), env: { LAZY_MCP_STARTS: starts }, secretEnv: { LAZY_MCP_TOOL: MOCK_SECRET, LAZY_MCP_OWN: 'result' },
  });
  const tested = await client.call('mcp.test', { id: server.id });
  expect(tested).toMatchObject({ ok: true, serverName: 'fixture', tools: [{ name: '[redacted]' }, { name: 'roots' }] });
  const pids = () => readFileSync(starts, 'utf8').trim().split('\n').map(Number);
  await waitFor(() => pids().every(processExited));
  const registration = harness.core.lazyMcp.register(threadId, harness.dataDir, process.env, new Map(), harness.core.mcp.resolve(null));
  const url = registration.entries['boite-managed-stdio-fixture']!.url;
  const post = (message: unknown, session?: string) => fetch(url, {
    method: 'POST',
    headers: { authorization: registration.authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify(message),
  });
  const opened = await post(req(1, 'initialize', INIT));
  const session = opened.headers.get('mcp-session-id')!;
  expect(opened.status).toBe(200);
  await opened.text();
  expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session)).status).toBe(202);
  const list = await (await post(req(2, 'tools/list'), session)).text();
  const echo = await (await post(req(3, 'tools/call', { name: 'echo', arguments: {} }), session)).text();
  expect(list).toContain('[redacted]');
  expect(echo).toContain('[redacted]');
  expect(echo).toContain('"result":');
  expect(list + echo).not.toContain('fixture-value');
  const manifestKey = 'mcp-manifest:managed:' + server.id;
  await waitFor(() => harness.core.journal.getSetting(manifestKey) !== undefined);
  expect(JSON.stringify(harness.core.journal.getSetting(manifestKey))).not.toContain('fixture-value');
  const redact = harness.core.mcp.resolve(null).get('boite-managed-stdio-fixture')!.redact;
  const redactedMessage = redactMcpMessage({
    jsonrpc: '2.0', id: 1, [MOCK_SECRET]: 'top-level-leak',
    result: { tools: [{ name: 'probe', inputSchema: { type: 'object', properties: { [MOCK_SECRET]: { type: 'string' } } } }], [MOCK_SECRET]: 'leaked' },
  }, redact);
  expect(JSON.stringify(redactedMessage)).toContain('"result":');
  expect(JSON.stringify(redactedMessage)).not.toContain('fixture-value');
  const pid = pids().at(-1)!;
  expect(processExited(pid)).toBe(false);
  await client.call('mcp.toggle', { id: server.id, enabled: false });
  expect((await post(req(4, 'ping'), session)).status).toBe(404);
  expect(harness.core.journal.getSetting(manifestKey)).toBeUndefined();
  await waitFor(() => processExited(pid));
});

test('HTTP probe and proxy forward the negotiated session and static credentials, redact streamed output, and close upstream', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const seen: { method: string; session: string | null; authorization: string | null; protocol: string | null; forwarded: string | null }[] = [];
  const upstream = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const body = request.method === 'POST' ? await request.json() as { id?: number; method: string } : null;
      const method = body?.method ?? request.method;
      seen.push({ method, session: request.headers.get('mcp-session-id'), authorization: request.headers.get('authorization'), protocol: request.headers.get('mcp-protocol-version'), forwarded: request.headers.get('x-forwarded-for') });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'initialize') return Response.json({
        jsonrpc: '2.0', id: body!.id, result: { protocolVersion: INIT.protocolVersion, serverInfo: { name: 'HTTP fixture', version: '1' }, capabilities: { tools: {} } },
      }, { headers: { 'mcp-session-id': UPSTREAM_SESSION } });
      if (method === 'notifications/initialized') return new Response(null, { status: 202 });
      const event = JSON.stringify({
        jsonrpc: '2.0', id: body?.id, result: { tools: [{ name: 'lookup', description: HTTP_CREDENTIAL }] },
      }, null, 2).replace(HTTP_CREDENTIAL, '\\u006d' + HTTP_CREDENTIAL.slice(1));
      const probe = seen.length < 4;
      const lineEnd = probe ? '\r' : '\r\n';
      const payload = event.split('\n').map(line => 'data: ' + line).join(lineEnd) + lineEnd.repeat(2);
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(payload.slice(0, -1)));
        controller.enqueue(encoder.encode(payload.slice(-1)));
        if (!probe) controller.close();
      } });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  try {
    const server = await client.call('mcp.save', {
      ...GLOBAL, projectIds: [], name: 'HTTP fixture', transport: 'http', url: new URL('/mcp', upstream.url).href,
      secretHeaders: { Authorization: ` Bearer ${HTTP_CREDENTIAL} ` },
    });
    expect(await client.call('mcp.test', { id: server.id })).toMatchObject({
      ok: true, serverName: 'HTTP fixture', tools: [{ name: 'lookup', description: '[redacted]' }],
    });
    await waitFor(() => seen.length === 4);
    expect(seen.map(item => item.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'DELETE']);
    expect(seen.slice(1).map(item => item.protocol)).toEqual([INIT.protocolVersion, INIT.protocolVersion, INIT.protocolVersion]);
    const registration = harness.core.lazyMcp.register(threadId, harness.dataDir, process.env, new Map(), harness.core.mcp.resolve(null));
    const url = registration.entries['boite-managed-http-fixture']!.url;
    const post = (message: unknown, session?: string) => fetch(url, { method: 'POST', body: JSON.stringify(message), headers: {
      authorization: registration.authorization, 'x-forwarded-for': 'must-stay-local', 'mcp-protocol-version': INIT.protocolVersion, ...(session ? { 'mcp-session-id': session } : {}),
    } });
    const opened = await post(req(1, 'initialize', INIT));
    const session = opened.headers.get('mcp-session-id')!;
    expect(session).toBeTruthy();
    expect(session).not.toBe(UPSTREAM_SESSION);
    await opened.text();
    expect((await post(req(2, 'tools/list'), 'unknown')).status).toBe(404);
    const answer = await (await post(req(3, 'tools/list'), session)).text();
    expect(answer).toContain('[redacted]');
    expect(answer).not.toContain(HTTP_CREDENTIAL);
    harness.core.lazyMcp.release(registration.id);
    await waitFor(() => seen.length === 7);
    expect(seen.at(-1)?.method).toBe('DELETE');
    expect(seen.at(-1)?.protocol).toBe(INIT.protocolVersion);
    expect(seen.every(item => item.authorization === 'Bearer ' + HTTP_CREDENTIAL && item.forwarded === null)).toBe(true);
    expect(seen.every(item => item.session === (item.method === 'initialize' ? null : UPSTREAM_SESSION))).toBe(true);
  } finally { await upstream.stop(true); }
});

test('managed stdio reuses its cached manifest across working directories and spawns only for tools/call', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const starts = join(harness.dataDir, 'cross-cwd-starts');
  const dirA = join(harness.dataDir, 'worktree-a');
  const dirB = join(harness.dataDir, 'worktree-b');
  mkdirSync(dirA);
  mkdirSync(dirB);
  await client.call('mcp.save', { ...stdio('Cross cwd'), env: { LAZY_MCP_STARTS: starts } });
  const callProxy = (url: string, authorization: string, message: unknown, session?: string) => fetch(url, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify(message),
  });
  const first = harness.core.lazyMcp.register(threadId, dirA, process.env, new Map(), harness.core.mcp.resolve(null));
  const urlA = first.entries['boite-managed-cross-cwd']!.url;
  const openA = await callProxy(urlA, first.authorization, req(1, 'initialize', INIT));
  const sessionA = openA.headers.get('mcp-session-id')!;
  await openA.text();
  await callProxy(urlA, first.authorization, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionA);
  expect(await (await callProxy(urlA, first.authorization, req(2, 'tools/list'), sessionA)).text()).toContain('echo');
  await waitFor(() => harness.core.journal.getSetting('mcp-manifest:managed:cross-cwd') !== undefined);
  harness.core.lazyMcp.release(first.id);
  const pids = () => readFileSync(starts, 'utf8').trim().split('\n').map(Number);
  await waitFor(() => pids().every(processExited));
  expect(pids()).toHaveLength(1);

  const second = harness.core.lazyMcp.register(threadId, dirB, process.env, new Map(), harness.core.mcp.resolve(null));
  try {
    const urlB = second.entries['boite-managed-cross-cwd']!.url;
    const openB = await callProxy(urlB, second.authorization, req(1, 'initialize', INIT));
    const sessionB = openB.headers.get('mcp-session-id')!;
    await openB.text();
    await callProxy(urlB, second.authorization, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionB);
    expect(await (await callProxy(urlB, second.authorization, req(2, 'tools/list'), sessionB)).text()).toContain('echo');
    expect(pids()).toHaveLength(1);
    const echo = await (await callProxy(urlB, second.authorization, req(3, 'tools/call', { name: 'echo', arguments: {} }), sessionB)).text();
    expect(echo).toContain('worktree-b');
    expect(pids()).toHaveLength(2);
  } finally {
    harness.core.lazyMcp.release(second.id);
    await waitFor(() => pids().every(processExited));
  }
});

test('corrupt mcp-secrets.json skips managed servers on session start without breaking user stdio servers', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const secretServer = await client.call('mcp.save', { ...stdio('Secret server'), secretEnv: { TOKEN: MOCK_SECRET } });
  const secretsPath = join(harness.dataDir, 'mcp-secrets.json');
  const thread = harness.core.threads.require(threadId);
  const provider = harness.core.providers.get(thread.providerId)!;
  const account = harness.core.accounts.list().find(item => item.id === thread.accountId)!;
  for (const broken of ['null', '{not-json', '{"a":{"env":{"T": leaked_secret_token_123}}}']) {
    writeFileSync(secretsPath, broken, { mode: 0o600 });
    let message = '';
    try { harness.core.mcp.resolve(null); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain(`Cannot read MCP credentials file ${secretsPath}`);
    expect(message).not.toContain('leaked_secret_token_123');
    if (broken !== 'null') expect(message).toContain('invalid JSON');
    const ctx = harness.core.threads.contexts.makeSessionContext(thread, provider, account);
    const userStdio = new Map([['user-tool', { command: process.execPath, args: [FIXTURE], env: {} }]]);
    const active = ctx.lazyMcp!(process.env, userStdio);
    expect(active).not.toBeNull();
    expect(Object.keys(active!.entries)).toEqual(['user-tool']);
    active!.release();
  }
  expect(await client.call('mcp.remove', { id: secretServer.id })).toEqual({ removed: true });
  expect((await client.call('mcp.list', {})).servers).toEqual([]);
});

test('global stdio probe runs outside dataDir, surfaces redacted stderr, and ignores short secrets in redact', async () => {
  const client = await harness.connect();
  const shortServer = await client.call('mcp.save', { ...stdio('Short secret'), secretEnv: { SHORT: 'id', LONG: 'long-secret-value' } });
  const redact = harness.core.mcp.resolve(null).get('boite-managed-' + shortServer.id)!.redact;
  expect(redact('{"id":1,"value":"long-secret-value"}')).toBe('{"id":1,"value":"[redacted]"}');
  const failing = await client.call('mcp.save', {
    ...GLOBAL, projectIds: [], name: 'Failing probe', transport: 'stdio',
    command: process.execPath,
    args: ['-e', 'const cwd = " cwd=" + process.cwd(); console.error("x".repeat(40) + " " + process.env.SECRET_DIAG + " " + "y".repeat(Math.max(10, 488 - cwd.length)) + cwd); process.exit(1)'],
    secretEnv: { SECRET_DIAG: 'secret-stderr-token' },
  });
  const result = await client.call('mcp.test', { id: failing.id });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('[redacted]');
  expect(result.error).not.toContain('secret-stderr-token');
  expect(result.error).not.toContain('stderr-token');
  expect(result.error).not.toContain(harness.dataDir);
});
