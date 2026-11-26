import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AGENT_ENV, TOOL_FREE_CONTEXT } from '@boite/contracts';
import { sessionMcp } from '../src/drivers/mcp.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { museMcpConfig, museMcpSupport } from '../src/drivers/muse/mcp.ts';
import type { SessionContext } from '../src/drivers/types.ts';
import { withOpenCodeMcp } from '../src/providers/opencode.ts';
import { startTestCore, startTurn, testProject, type TestCore } from './harness.ts';
import { readScriptedLog, writeScriptedProvider } from './scripted-provider.ts';

let harness: TestCore;
beforeEach(async () => { harness = await startTestCore({ settings: { warmProcessMinutes: 0 } }); });
afterEach(async () => { await harness?.stop(); });

const options = [
  { protocol: 'codex-appserver', fixture: 'codex-server.ts', log: 'CODEX_FAKE_LOG', model: 'fake-codex', start: 'config:thread/start ', resume: 'config:thread/resume ' },
  { protocol: 'acp', fixture: 'acp-agent.ts', log: 'ACP_FAKE_LOG', model: 'default', start: 'mcp:new ', resume: 'mcp:load ' },
] as const;

test.each(options)('$protocol receives scoped MCP on start and resume and skips it in a tool-free context', async option => {
  const name = 'mcp-fixture';
  const logPath = join(harness.dataDir, 'driver.log');
  process.env[option.log] = logPath;
  if (option.protocol === 'acp') process.env['ACP_FAKE_HTTP_MCP'] = '1';
  try {
    const client = await harness.connect();
    writeScriptedProvider(harness.dataDir, join(import.meta.dir, 'fixtures', option.fixture), {
      id: name, schemaVersion: 1, name, shortName: 'McpFake', protocol: option.protocol, auth: { kind: 'none' }, roots: ['{isolationDir}'],
      models: [{ id: option.model, name: 'Fixture', default: true }],
      capabilities: { approvals: true, hooks: false, checkpoint: false, images: true, planMode: false, resume: true },
    });
    expect((await client.call('providers.reload', {})).rejected).toEqual([]);
    const account = await client.call('accounts.add', { providerId: name, label: 'Fixture', useDefaultLocation: true });
    const project = await testProject(harness, client);
    const input = { projectId: project.id, providerId: name, accountId: account.id, title: 'MCP fixture' };
    const thread = await client.call('threads.create', input);
    const server = await client.call('mcp.save', {
      name: 'Fixture MCP', transport: 'http', enabled: true, scope: 'projects', projectIds: [project.id],
      url: 'http://127.0.0.1:1/mcp', secretHeaders: { Authorization: 'Bearer local-upstream-fixture' },
    });
    const open = async (threadId: string, prompt: string) => {
      const turn = await startTurn(client, threadId, prompt, 15000);
      expect((await turn.finished).status).toBe('done');
    };
    const matching = (prefix: string) => readScriptedLog(logPath).split('\n').filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length));
    const entry = (line: string) => {
      const parsed = JSON.parse(line);
      const key = 'boite-managed-fixture-mcp';
      return option.protocol === 'acp' ? parsed.find((value: { name: string }) => value.name === key) : parsed.mcp_servers?.[key];
    };
    await open(thread.id, 'First');
    const first = entry(matching(option.start)[0]!);
    expect(first.url).toContain('/mcp/lazy/');
    if (option.protocol === 'acp') expect(first.headers).toEqual([{ name: 'Authorization', value: 'Bearer ' + harness.core.agents.tokenFor(thread.id) }]);
    else expect(first.bearer_token_env_var).toBe(AGENT_ENV.token);
    await client.call('mcp.save', { ...server, url: 'http://127.0.0.1:2/mcp' });
    expect((await fetch(first.url, { headers: { Authorization: 'Bearer ' + harness.core.agents.tokenFor(thread.id) } })).status).toBe(404);
    await open(thread.id, 'Next');
    const resumed = entry(matching(option.resume).at(-1)!);
    expect(resumed.url).toContain('/mcp/lazy/');
    expect(resumed.url).not.toBe(first.url);
    const light = harness.core.delegation.createChild(harness.core.threads.require(thread.id), {
      id: 'fixture-route', name: 'Fixture route', providerId: name, accountId: account.id, model: option.model, effort: null,
    }, 'Without configured tools', () => {}, undefined, false, { contextMode: TOOL_FREE_CONTEXT, permissionMode: 'default' });
    await open(light, 'Without configured tools');
    expect(entry(matching(option.start).at(-1)!)).toBeUndefined();
    expect(readScriptedLog(logPath)).not.toContain('local-upstream-fixture');
  } finally {
    delete process.env[option.log];
    delete process.env['ACP_FAKE_HTTP_MCP'];
  }
}, 30000);

test('protected and tool-free sessions never register; Muse and OpenCode use their native HTTP config', () => {
  const url = 'http://127.0.0.1:1/mcp/lazy/fixture/name';
  const registration = {
    entries: { fixture: { type: 'http' as const, url, headers: {} } }, authorization: 'Bearer test-thread-token', release() {},
  };
  let registrations = 0;
  const ctx = { thread: { contextMode: null }, lazyMcp: () => { registrations += 1; return registration; } } as unknown as SessionContext;
  expect(sessionMcp({ ...ctx, thread: { ...ctx.thread, contextMode: TOOL_FREE_CONTEXT } })).toBeNull();
  expect(sessionMcp({ ...ctx, protectedExecution: {} as SessionContext['protectedExecution'] })).toBeNull();
  expect(registrations).toBe(0);
  const active = sessionMcp(ctx);
  expect(active).toBe(registration);
  const muse = museMcpConfig(active);
  expect(muse.args).toEqual(['-c', 'mcp_servers.fixture=' + JSON.stringify({
    transport: 'streamable_http', url, headers: { Authorization: '${BOITE_MCP_AUTHORIZATION}' },
  })]);
  expect(muse.args.join(' ')).not.toContain('test-thread-token');
  expect(Object.values(muse.env)).toEqual([registration.authorization]);
  const config = withOpenCodeMcp({ OPENCODE_CONFIG_CONTENT: '{"model":"fixture/model"}' }, active);
  expect(JSON.parse(config.OPENCODE_CONFIG_CONTENT!)).toMatchObject({ model: 'fixture/model', mcp: { fixture: { type: 'remote', url } } });
});

test('Muse detects MCP config support via --version when no .muse-version file exists', async () => {
  const modernDir = join(harness.dataDir, 'muse-modern');
  const legacyDir = join(harness.dataDir, 'muse-legacy');
  mkdirSync(modernDir, { recursive: true });
  mkdirSync(legacyDir, { recursive: true });
  const modernBin = join(modernDir, 'muse');
  const legacyBin = join(legacyDir, 'muse');
  writeFileSync(modernBin, '#!/bin/sh\necho muse 1.4.14\n');
  writeFileSync(legacyBin, '#!/bin/sh\necho muse 1.3.0\n');
  expect(await museMcpSupport(modernBin, async () => { throw new Error('fixture spawn failure'); })).toBeNull();
  expect(await museMcpSupport(modernBin, async () => null)).toBeNull();
  expect(await museMcpSupport(modernBin, async () => '')).toBeNull();
  expect(await museMcpSupport(modernBin, async () => 'fixture without a version')).toBe(false);
  let calls = 0;
  const probeModern = async () => { calls += 1; return 'muse 1.4.14'; };
  expect(await museMcpSupport(modernBin, probeModern)).toBe(false);
  expect(calls).toBe(0);
  writeFileSync(modernBin, '#!/bin/sh\necho muse version 1.4.14\n');
  expect(await museMcpSupport(modernBin, probeModern)).toBe(true);
  expect(await museMcpSupport(modernBin, probeModern)).toBe(true);
  expect(calls).toBe(1);
  expect(await museMcpSupport(legacyBin, async () => 'muse 1.3.0')).toBe(false);
  expect(await museMcpSupport(legacyBin, async () => 'muse 1.4.14')).toBe(false);
});
