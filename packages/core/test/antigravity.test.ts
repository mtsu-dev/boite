import { antigravityCatalog } from '../src/drivers/acp/antigravity-catalog.ts';
/**
 * Antigravity's half of the ACP driver, on a fake that speaks the real
 * protocol: every account isolated, the seed file and the browser no-op written
 * before anything spawns, the environment the agent needs carried into the
 * child and the user's own Google variables stripped out of it, and a sign-in
 * that is an `authenticate` call rather than a CLI.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Attachment, Settings, ThreadId } from '@boite/contracts';
import { readAntigravityQuota, type Fetch } from '../src/antigravity-quota.ts';
import type { CoreClient } from '../src/client.ts';
import { probeTimeoutMs } from '../src/drivers/acp/probe.ts';
import { forgetProbes } from '../src/drivers/index.ts';
import { antigravityCertificates, antigravitySubagentBatch } from '../src/drivers/antigravity.ts';
import { shareProfile, variableHome } from '../src/profile-share.ts';
import { profileFor } from '../src/providers/resolve.ts';
import { saveCatalog } from '../src/providers/saved-catalogs.ts';
import { LAUNCH_TEMP_DIR } from '../src/drivers/launch-temp.ts';
import * as fsRetry from '../src/fs-retry.ts';
import { startTestCore, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';
import { thrown } from './settle.ts';

/** The fake Antigravity server: a real ACP process over stdio, run by bun. */
const FAKE_AGENT = fileURLToPath(new URL('./fixtures/antigravity-agent.ts', import.meta.url));
const SEED_FILE = join('antigravity-acp', 'settings.json');
const SEED_BODY = '{"auth":{"type":"oauth-personal"}}';

let harness: TestCore | null = null;
let logFile = '';

/**
 * A sign-in's launch folder whose removal a test holds until it releases it:
 * removing an unpacked agent takes seconds on a real machine, and a removal
 * that deleted the account around it left the account's directory behind.
 */
interface HeldScratch {
  started: ReturnType<typeof Promise.withResolvers<void>>;
  release: ReturnType<typeof Promise.withResolvers<void>>;
  done: boolean;
}
let heldScratch: HeldScratch | null = null;
const realRemoveDir = fsRetry.removeDir;
mock.module('../src/fs-retry.ts', () => ({
  removeDir: async (path: string, log?: (message: string) => void, attempts?: number, delayMs?: number): Promise<boolean> => {
    const held = heldScratch;
    if (held === null || !path.includes(`${sep}${LAUNCH_TEMP_DIR}${sep}run-`)) return realRemoveDir(path, log, attempts, delayMs);
    held.started.resolve();
    await held.release.promise;
    const removed = await realRemoveDir(path, log, attempts, delayMs);
    held.done = true;
    return removed;
  },
}));

function holdScratch(): HeldScratch {
  heldScratch = { started: Promise.withResolvers(), release: Promise.withResolvers(), done: false };
  return heldScratch;
}

afterEach(async () => {
  heldScratch?.release.resolve();
  heldScratch = null;
  const open = harness;
  harness = null;
  delete process.env['AGY_FAKE_LOG'];
  delete process.env['AGY_FAKE_CATALOG'];
  delete process.env['GEMINI_API_KEY'];
  if (open !== null) await open.stop();
});

async function startCore(settings?: Partial<Settings>): Promise<CoreClient> {
  const started = await startTestCore(settings === undefined ? {} : { settings });
  harness = started;
  logFile = join(started.dataDir, 'agy-fake.log');
  process.env['AGY_FAKE_LOG'] = logFile;
  // The variable a user set for their own Gemini login: the descriptor unsets it.
  process.env['GEMINI_API_KEY'] = 'the-users-own-key';
  return started.connect();
}

function fakeLog(): string {
  return existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
}

function loggedEnv(name: string): string | null {
  const line = fakeLog()
    .split('\n')
    .find((entry) => entry.startsWith(`env ${name}=`));
  return line === undefined ? null : line.slice(`env ${name}=`.length);
}

/** The shipped descriptor's shape, pointed at the fake instead of the release. */
function writeDescriptor(dataDir: string): void {
  const dir = join(dataDir, 'providers');
  mkdirSync(dir, { recursive: true });
  const profile = {
    detect: {},
    executable: [{ kind: 'path', value: 'bun' }],
    launch: { args: [FAKE_AGENT] },
    isolation: { GEMINI_HOME: '{isolationDir}' },
    env: {
      AGY_ACP_FORCE_FILE_STORAGE: '1',
      ANTIGRAVITY_HARNESS_PATH: '{agentsDir}/localharness_external',
      PYTHONUNBUFFERED: '1',
      ELECTRON_RUN_AS_NODE: '1',
      BROWSER: '{browserNoop}',
    },
    unsetEnv: ['GEMINI_API_KEY'],
  };
  writeFileSync(
    join(dir, 'agy-fake.json'),
    JSON.stringify({
      id: 'agy-fake',
      schemaVersion: 1,
      name: 'Fake Antigravity',
      shortName: 'AgyFake',
      protocol: 'acp',
      roots: ['{isolationDir}'],
      profiles: { windows: profile, linux: profile, macos: profile },
      auth: { kind: 'oauth-cli', session: ['antigravity-acp/acp_token.json'] },
      login: { acp: { methodId: 'oauth-personal' } },
      isolation: { alwaysIsolated: true },
      seedFiles: { 'antigravity-acp/settings.json': SEED_BODY },
      quirks: ['antigravity'],
      models: [{ id: 'default', name: 'Antigravity default', default: true }],
      capabilities: {
        approvals: true,
        hooks: false,
        checkpoint: false,
        images: true,
        planMode: false,
        resume: true,
      },
    }),
    'utf8',
  );
}

async function agyAccount(client: CoreClient): Promise<{ id: string; isolationDir: string }> {
  const dataDir = harness?.dataDir ?? '';
  writeDescriptor(dataDir);
  const loaded = await client.call('providers.reload', {});
  expect(loaded.rejected).toEqual([]);
  // The user asked for the provider's own location, which this descriptor refuses.
  const account = await client.call('accounts.add', {
    providerId: 'agy-fake',
    label: 'Antigravity',
    useDefaultLocation: true,
  });
  expect(account.isolationDir).not.toBeNull();
  return { id: account.id, isolationDir: account.isolationDir ?? '' };
}

/** A signed-in account and a thread on it, subscribed. */
async function agyThread(client: CoreClient, model?: string): Promise<{ accountId: string; threadId: ThreadId }> {
  const account = await agyAccount(client);
  writeFileSync(join(account.isolationDir, 'antigravity-acp', 'acp_token.json'), JSON.stringify({ access_token: 'fake', expiry: 0 }), 'utf8');
  expect((await client.call('accounts.check', { accountId: account.id })).status).toBe('ok');
  const projectDir = join(harness!.dataDir, 'project');
  mkdirSync(projectDir, { recursive: true });
  const project = await client.call('projects.add', { path: projectDir, name: 'agy' });
  const thread = await client.call('threads.create', { projectId: project.id, providerId: 'agy-fake', accountId: account.id, cwd: projectDir, title: 'agy', ...(model === undefined ? {} : { model }) });
  await client.call('threads.subscribe', { threadId: thread.id });
  return { accountId: account.id, threadId: thread.id };
}

async function runTurn(client: CoreClient, threadId: ThreadId, prompt: string, attachments: Attachment[] = []): Promise<void> {
  const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20_000);
  await client.call('turns.start', { threadId, prompt, attachments });
  expect((await finished).error).toBeNull();
}

/** Douane, at a loopback address nothing answers: these tests start no turn through it. */
const DOUANE = { enabled: true, kind: 'douane' as const, baseUrl: 'http://127.0.0.1:9/v1', dashboardUrl: 'http://127.0.0.1:9/admin/' };

/** The shipped Antigravity descriptor, run as the fake: the id Douane serves. */
function shippedAsFake(): void {
  const descriptor = harness!.core.providers.require('antigravity');
  for (const profile of Object.values(descriptor.profiles)) {
    if (!profile) continue;
    profile.detect = {};
    profile.executable = [{ kind: 'path', value: 'bun' }];
    profile.launch = { args: [FAKE_AGENT] };
  }
}

describe('antigravity', () => {
  test('a sign-in started while Douane serves Antigravity lands in the account, never in the gateway home', async () => {
    const client = await startCore({ subscriptionProxy: DOUANE });
    shippedAsFake();
    const account = await client.call('accounts.add', { providerId: 'antigravity', label: 'Native' });
    const states: string[] = [];
    let announced = false;
    client.on('account.login', (event) => {
      if (event.accountId !== account.id) return;
      states.push(event.state);
      if (event.url !== null) announced = true;
    });
    await client.call('accounts.login', { accountId: account.id });
    // The core takes a redirect only once it has the link the agent printed.
    await waitFor(() => announced && fakeLog().includes('callback:'), 20_000);
    const callback = fakeLog().split('\n').find((line) => line.startsWith('callback:'))?.slice('callback:'.length) ?? '';
    await client.call('accounts.loginInput', { accountId: account.id, text: callback });
    await waitFor(() => states.includes('done') || states.includes('failed'), 20_000);
    expect(states.at(-1)).toBe('done');
    // The agent's own sign-in, in the account's home, without the gateway's address or key.
    expect(loggedEnv('GEMINI_HOME')).toBe(account.isolationDir);
    expect(loggedEnv('AGY_LLM_GATEWAY_URL')).toBe('');
    expect(existsSync(join(account.isolationDir!, 'antigravity-acp', 'acp_token.json'))).toBe(true);
    // Douane off, the account is signed in by that sign-in.
    await client.call('settings.set', { subscriptionProxy: { ...DOUANE, enabled: false } });
    expect((await client.call('accounts.check', { accountId: account.id })).status).toBe('ok');
  });

  test('a sign-in while Douane serves Antigravity leaves the gateway\'s model list in place', async () => {
    const client = await startCore({ subscriptionProxy: DOUANE });
    shippedAsFake();
    const account = await client.call('accounts.add', { providerId: 'antigravity', label: 'Native' });
    // The agent in its gateway mode lists what the gateway serves.
    const gateway = (await client.call('providers.probe', { providerId: 'antigravity', accountId: account.id })).models.map((model) => model.id);
    expect(gateway).toContain('gemini-4-neon');
    const probed: string[][] = [];
    client.on('providers.probed', (event) => { if (event.accountId === account.id) probed.push(event.models.map((model) => model.id)); });

    const states: string[] = [];
    let announced = false;
    client.on('account.login', (event) => {
      if (event.accountId !== account.id) return;
      states.push(event.state);
      if (event.url !== null) announced = true;
    });
    await client.call('accounts.login', { accountId: account.id });
    // The core takes a redirect only once it has the link the agent printed.
    await waitFor(() => announced && fakeLog().includes('callback:'), 20_000);
    const callback = fakeLog().split('\n').find((line) => line.startsWith('callback:'))?.slice('callback:'.length) ?? '';
    await client.call('accounts.loginInput', { accountId: account.id, text: callback });
    await waitFor(() => states.includes('done') || states.includes('failed'), 20_000);
    expect(states.at(-1)).toBe('done');
    // The sign-in's own session listed the native models: they are not the ones the agent runs on now.
    await Bun.sleep(200);
    expect(probed).toEqual([]);
    const after = (await client.call('providers.probe', { providerId: 'antigravity', accountId: account.id })).models.map((model) => model.id);
    expect(after).toEqual(gateway);
  }, 40_000);

  test('Douane turned on after the last Antigravity account was removed gives the agent its default account again', async () => {
    const client = await startCore();
    shippedAsFake();
    harness!.core.accounts.ensureDefaults();
    const first = (await client.call('accounts.list', {})).filter((account) => account.providerId === 'antigravity');
    expect(first).toHaveLength(1);
    await client.call('accounts.remove', { accountId: first[0]!.id });
    expect((await client.call('accounts.list', {})).some((account) => account.providerId === 'antigravity')).toBe(false);

    await client.call('settings.set', { subscriptionProxy: DOUANE });
    const accounts = (await client.call('accounts.list', {})).filter((account) => account.providerId === 'antigravity');
    expect(accounts.map((account) => [account.label, account.status, account.isolationDir !== null])).toEqual([['Default', 'ok', true]]);
  });

  test('removing an account waits for its ACP login process and drops the lease', async () => {
    const client = await startCore();
    const account = await agyAccount(client);
    await client.call('accounts.login', { accountId: account.id });
    await waitFor(() => fakeLog().includes('callback:'), 20_000);
    expect(harness!.core.providers.installs.leaseCount('agy-fake')).toBe(1);
    await client.call('accounts.remove', { accountId: account.id });
    expect(harness!.core.providers.installs.leaseCount('agy-fake')).toBe(0);
    expect(existsSync(account.isolationDir)).toBe(false);
    expect(await client.call('accounts.logins', {})).toEqual([]);
  });

  test('removing an account waits for the launch folder its cancelled sign-in is still removing', async () => {
    const client = await startCore();
    const account = await agyAccount(client);
    await client.call('accounts.login', { accountId: account.id });
    await waitFor(() => fakeLog().includes('callback:'), 20_000);
    const held = holdScratch();
    let doneWhenRemoved = null as boolean | null;
    const removing = client.call('accounts.remove', { accountId: account.id }).then(() => {
      doneWhenRemoved = held.done;
    });
    await held.started.promise;
    // Released once the removal answered, or after a second it spent waiting.
    await Promise.race([removing, Bun.sleep(1000)]);
    held.release.resolve();
    await removing;
    expect(doneWhenRemoved).toBe(true);
    expect(existsSync(account.isolationDir)).toBe(false);
  }, 40_000);

  test('a sign-in answers before its launch folder is gone', async () => {
    const client = await startCore();
    const account = await agyAccount(client);
    const states: string[] = [];
    let announced = false;
    client.on('account.login', (event) => {
      if (event.accountId !== account.id) return;
      states.push(event.state);
      if (event.url !== null) announced = true;
    });
    await client.call('accounts.login', { accountId: account.id });
    // The core takes a redirect only once it has the link the agent printed.
    await waitFor(() => announced && fakeLog().includes('callback:'), 20_000);
    const callback = fakeLog()
      .split('\n')
      .find((line) => line.startsWith('callback:'))
      ?.slice('callback:'.length);
    const held = holdScratch();
    await client.call('accounts.loginInput', { accountId: account.id, text: callback ?? '' });
    await held.started.promise;
    await waitFor(() => states.includes('done') || states.includes('failed'), 20_000);
    expect(states.at(-1)).toBe('done');
    expect(held.done).toBe(false);
    held.release.resolve();
    await client.call('accounts.remove', { accountId: account.id });
    expect(held.done).toBe(true);
    expect(existsSync(account.isolationDir)).toBe(false);
  }, 40_000);
  test('every account is isolated, and the seed file and the browser no-op are written before any spawn', async () => {
    const client = await startCore();
    const account = await agyAccount(client);

    // T3 Code never uses the user's own IDE login, and neither does Boite: the
    // account has a home of its own even though the user asked for the default.
    expect(account.isolationDir.length).toBeGreaterThan(0);
    const seed = join(account.isolationDir, SEED_FILE);
    expect(existsSync(seed)).toBe(true);
    expect(readFileSync(seed, 'utf8')).toBe(SEED_BODY);

    // The launcher `BROWSER` points at, so the agent opens no window here.
    // Windows needs no file: its `BROWSER` is a cmd.exe command line.
    const dataDir = harness?.dataDir ?? '';
    expect(existsSync(join(dataDir, 'browser-noop.sh'))).toBe(process.platform !== 'win32');
    expect(existsSync(join(dataDir, 'browser-noop.cmd'))).toBe(false);

    // No token yet: this is the account the Accounts page offers a login on.
    const accounts = await client.call('accounts.list', {});
    expect(accounts.find((entry) => entry.id === account.id)?.status).toBe('unauthenticated');
  });

  test('the sign-in link streams back, the pasted redirect finishes it, and the account is rechecked', async () => {
    const client = await startCore();
    const account = await agyAccount(client);

    const lines: string[] = [];
    const urls: string[] = [];
    const states: string[] = [];
    client.on('account.login', (event) => {
      if (event.accountId !== account.id) return;
      lines.push(event.output);
      if (event.url !== null) urls.push(event.url);
      states.push(event.state);
    });

    await client.call('accounts.login', { accountId: account.id });
    // The link the agent printed on stdout, as a line that is not JSON: the
    // driver kept it out of the protocol stream and handed it to the client.
    await waitFor(() => urls.length > 0, 20000);
    expect(urls[0]).toContain('https://accounts.google.com/');
    // The whole link, whichever stream brought it first: one cut at 400
    // characters asked Google for the scope `https://www.googleapis.`.
    expect(new URL(urls[0] ?? '').searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    );
    expect(urls[0]).toEndWith('&access_type=offline');
    expect(lines.some((line) => line.startsWith('Open the following link'))).toBe(true);

    // The agent carries the account's home, the flags it needs and none of the
    // user's own Google variables.
    expect(loggedEnv('GEMINI_HOME')).toBe(account.isolationDir);
    expect(loggedEnv('AGY_ACP_FORCE_FILE_STORAGE')).toBe('1');
    expect(loggedEnv('ANTIGRAVITY_HARNESS_PATH')).toContain('localharness_external');
    expect(loggedEnv('BROWSER')).toContain(process.platform === 'win32' ? 'cmd.exe' : 'browser-noop.sh');
    expect(loggedEnv('GEMINI_API_KEY')).toBe('');

    // A pasted code is what a CLI login takes; this one takes the redirect URL.
    expect(await thrown(client.call('accounts.loginInput', { accountId: account.id, text: '1234-5678' }))).toThrow(
      /redirect URL/,
    );

    const callback = fakeLog()
      .split('\n')
      .find((line) => line.startsWith('callback:'))
      ?.slice('callback:'.length);
    expect(callback).toContain('http://127.0.0.1:');

    // A loopback URL that is not the one the agent announced is refused before
    // anything is fetched. Without the check, a paste was a GET at any port on
    // the user's machine, sent from the core.
    const elsewhere = new URL(callback ?? '');
    const otherPort = String(Number(elsewhere.port) + 1);
    expect(await thrown(client.call('accounts.loginInput', { accountId: account.id, text: `http://127.0.0.1:${otherPort}/oauth2callback?code=x` }))).toThrow(/this login listens on/);
    expect(await thrown(client.call('accounts.loginInput', { accountId: account.id, text: `http://127.0.0.1:${elsewhere.port}/admin/shutdown` }))).toThrow(/this login listens on/);

    await client.call('accounts.loginInput', { accountId: account.id, text: callback ?? '' });

    // The core fetched it, the agent's own listener saw the hit and answered
    // `authenticate` once it had written its token.
    await waitFor(() => states.includes('done') || states.includes('failed'), 20000);
    expect(states.at(-1)).toBe('done');
    expect(fakeLog()).toContain('authenticated');
    expect(existsSync(join(account.isolationDir, 'antigravity-acp', 'acp_token.json'))).toBe(true);

    const accounts = await client.call('accounts.list', {});
    expect(accounts.find((entry) => entry.id === account.id)?.status).toBe('ok');
  }, 40000);

  test('the sign-in lists the models from its own process, which unpacks in a folder that goes with it', async () => {
    const client = await startCore();
    const account = await agyAccount(client);
    // What a core stopped mid-launch left in the account's launch folders.
    const stale = join(account.isolationDir, LAUNCH_TEMP_DIR, 'run-stale');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'base_library.zip'), 'unpacked');

    const probed = client.next('providers.probed', (event) => event.accountId === account.id, 20_000);
    const states: string[] = [];
    let announced = false;
    client.on('account.login', (event) => {
      if (event.accountId !== account.id) return;
      states.push(event.state);
      if (event.url !== null) announced = true;
    });
    await client.call('accounts.login', { accountId: account.id });
    // The core takes a redirect only once it has the link the agent printed.
    await waitFor(() => announced && fakeLog().includes('callback:'), 20_000);
    const callback = fakeLog().split('\n').find((line) => line.startsWith('callback:'))?.slice('callback:'.length) ?? '';
    await client.call('accounts.loginInput', { accountId: account.id, text: callback });
    await waitFor(() => states.includes('done') || states.includes('failed'), 20_000);
    expect(states.at(-1)).toBe('done');

    // The models came from the sign-in, and a probe after it starts nothing:
    // on a slow machine one launch of the real agent is a minute of unpacking.
    // 1.4.5 lists each family once in its model option, Claude and GPT only
    // for a client named zed; the legacy ids of its `models` list stay out.
    const ids = ['default', 'gemini-3.8-flash', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'];
    const catalog = (await probed).models;
    expect(catalog.map((model) => model.id)).toEqual(ids);
    expect(fakeLog()).toContain('client:zed');
    expect(catalog.find((model) => model.id === 'gemini-3.8-flash')?.effort?.levels.map((level) => level.id)).toEqual(['low', 'medium', 'high']);
    const probe = await client.call('providers.probe', { providerId: 'agy-fake', accountId: account.id });
    expect(probe.models.map((model) => model.id)).toEqual(ids);
    expect(fakeLog().split('\n').filter((line) => line === 'initialize')).toHaveLength(1);

    // That session opened in an empty folder, not the account's home.
    const sessionCwd = fakeLog().split('\n').find((line) => line.startsWith('new:'))?.slice('new:'.length) ?? '';
    expect(sessionCwd.length).toBeGreaterThan(0);
    expect(sessionCwd).not.toBe(account.isolationDir);

    // Every name a temp folder is read from points at this launch's own
    // folder, and that folder, the session's and the stale one all go.
    const temp = loggedEnv('TEMP') ?? '';
    expect(temp.startsWith(join(account.isolationDir, LAUNCH_TEMP_DIR, 'run-'))).toBe(true);
    expect([loggedEnv('TMP'), loggedEnv('TMPDIR')]).toEqual([temp, temp]);
    await waitFor(() => !existsSync(temp) && !existsSync(sessionCwd) && !existsSync(stale), 10_000);
  }, 40000);

  test('a probe of a signed-in account unpacks in its own folder, gone once it answered', async () => {
    const client = await startCore();
    const account = await agyAccount(client);
    const token = join(account.isolationDir, 'antigravity-acp', 'acp_token.json');
    writeFileSync(token, JSON.stringify({ access_token: 'fake', expiry: 0 }), 'utf8');
    expect((await client.call('accounts.check', { accountId: account.id })).status).toBe('ok');

    const probe = await client.call('providers.probe', { providerId: 'agy-fake', accountId: account.id });
    expect(probe.models.map((model) => model.id)).toContain('claude-opus-4-6-thinking');
    const temp = loggedEnv('TEMP') ?? '';
    expect(temp.startsWith(join(account.isolationDir, LAUNCH_TEMP_DIR, 'run-'))).toBe(true);
    await waitFor(() => !existsSync(temp), 10_000);
  }, 30000);

  test('a turn unpacks in its own folder, which goes with the process', async () => {
    // No warm process: the session's process ends with its turn.
    const client = await startCore({ warmProcessMinutes: 0 });
    const account = await agyAccount(client);
    writeFileSync(join(account.isolationDir, 'antigravity-acp', 'acp_token.json'), JSON.stringify({ access_token: 'fake', expiry: 0 }), 'utf8');
    expect((await client.call('accounts.check', { accountId: account.id })).status).toBe('ok');
    const projectDir = join(harness!.dataDir, 'project');
    mkdirSync(projectDir, { recursive: true });
    const project = await client.call('projects.add', { path: projectDir, name: 'agy' });
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'agy-fake', accountId: account.id, cwd: projectDir, title: 'agy' });
    await client.call('threads.subscribe', { threadId: thread.id });

    const finished = client.next('turn.finished', (turn) => turn.threadId === thread.id, 20_000);
    await client.call('turns.start', { threadId: thread.id, prompt: 'ping' });
    const done = await finished;
    expect(done.error).toBeNull();
    expect(fakeLog()).toContain('prompt:');
    const temp = loggedEnv('TEMP') ?? '';
    expect(temp.startsWith(join(account.isolationDir, LAUNCH_TEMP_DIR, 'run-'))).toBe(true);
    await waitFor(() => !existsSync(temp), 10_000);
  }, 30000);

  test.each([[null, 'low'], ['medium', 'medium']] as const)('a thread saved on a pre-1.4 model ID and effort %s runs without the workflow tool', async (saved, expected) => {
    const client = await startCore();
    const { threadId } = await agyThread(client);
    const core = harness!.core;
    core.journal.putThread({ ...core.threads.require(threadId), model: 'gemini-3.8-flash-low', effort: saved });
    await runTurn(client, threadId, 'ping');
    const log = fakeLog().split('\n');
    expect(log).toContain(`set:thinking_level=${expected}`);
    expect(log).toContain('client:zed');
    const metas = log.filter((line) => line.startsWith('meta:'));
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of metas) expect(meta).toBe('meta:{"antigravity":{"disabledTools":["run_workflow"]}}');
  }, 30000);

  test('an agent that unpacks itself first gets longer to list its models than one that starts at once', async () => {
    const client = await startCore();
    await agyAccount(client);
    const unpacking = harness!.core.providers.require('agy-fake');
    // The real one took 45 to 54 s before its server read a line on an 8 GB laptop.
    expect(probeTimeoutMs(unpacking)).toBeGreaterThanOrEqual(90_000);
    expect(probeTimeoutMs({ ...unpacking, quirks: [] })).toBe(20_000);
  });
  test('a start_subagent or invoke_subagent launch lists its batch, unknown once the turn ended since its children report nothing; a failed launch keeps its error', async () => {
    const client = await startCore();
    const { threadId } = await agyThread(client);
    await runTurn(client, threadId, 'review with readers scenario:subagents');
    const agents = (await client.call('delegation.get', { threadId })).nativeAgents.filter((agent) => agent.source !== 'process');
    // The launch said only what it launched: once the turn ended, nobody knows
    // how its children fared. The MCP tool of the same title is no launch.
    expect(agents.map(({ id, status, task, result }) => ({ id: id.slice(id.lastIndexOf(':') + 1), status, task, result }))).toEqual([
      { id: '2', status: 'unknown', task: 'Launch readers', result: undefined },
      { id: '3', status: 'error', task: undefined, result: 'Subagent exceeded its limit.' },
      { id: '5', status: 'unknown', task: 'Launch reviewers', result: undefined },
    ]);
    // While the turn runs, a launch that returned stays running: its output is no child's answer.
    expect(antigravitySubagentBatch('t:2', 'done', 'Launch readers')).toEqual({ id: 't:2', status: 'running', task: 'Launch readers' });
  }, 30000);

  test('a command that outlived its turn is background work that keeps the process, and Stop ends both', async () => {
    // No warm process: only the running command keeps it.
    const client = await startCore({ warmProcessMinutes: 0 });
    const { threadId } = await agyThread(client);
    const background = client.next('thread.background', (event) => event.threadId === threadId && event.tasks.length > 0, 20_000);
    await runTurn(client, threadId, 'build it scenario:command');
    const [command] = (await background).tasks;
    expect(command).toMatchObject({ kind: 'shell', description: 'sleep 600' });
    expect(fakeLog().split('\n').filter((line) => line === 'initialize')).toHaveLength(1);

    // Another turn of the thread, never focused, runs on the same process: the command goes on.
    await runTurn(client, threadId, 'meanwhile');
    expect(fakeLog().split('\n').filter((line) => line === 'initialize')).toHaveLength(1);
    const history = (await client.call('threads.get', { threadId })).backgroundHistory ?? [];
    expect(history.find((task) => task.id === command!.id)?.state).toBe('running');

    const cleared = client.next('thread.background', (event) => event.threadId === threadId && event.tasks.length === 0, 20_000);
    expect((await client.call('turns.stop', { threadId })).stopped).toBe(true);
    await cleared;
    // The process went with the command: the next turn starts another one.
    await runTurn(client, threadId, 'again');
    expect(fakeLog().split('\n').filter((line) => line === 'initialize').length).toBeGreaterThan(1);
  }, 40000);

  test('a command that ends after its turn leaves the background list on its own', async () => {
    const client = await startCore();
    const { threadId } = await agyThread(client);
    const background = client.next('thread.background', (event) => event.threadId === threadId && event.tasks.length > 0, 20_000);
    const cleared = client.next('thread.background', (event) => event.threadId === threadId && event.tasks.length === 0, 20_000);
    await runTurn(client, threadId, 'build it scenario:short-command');
    await background;
    await cleared;
    const history = (await client.call('threads.get', { threadId })).backgroundHistory ?? [];
    expect(history.map((task) => task.state)).toEqual(['completed']);
  }, 30000);

  test('a GIF, which the server takes no block of, goes as a saved file beside the native PNG', async () => {
    const client = await startCore();
    const { threadId } = await agyThread(client);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const gif = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    await runTurn(client, threadId, 'look', [
      { kind: 'image', mimeType: 'image/png', data: png, name: 'shot.png' },
      { kind: 'image', mimeType: 'image/gif', data: gif, name: 'clip.gif' },
    ]);
    const lines = fakeLog().split('\n');
    expect(lines.filter((line) => line.startsWith('block:'))).toEqual(['block:image:image/png']);
    expect(lines).toContain('prompt names a saved file');
  }, 30000);

  test('the quota merges both endpoints, so Gemini limits show when one endpoint leaves them out', async () => {
    await startCore();
    const home = join(harness!.dataDir, 'agy-home');
    mkdirSync(join(home, 'antigravity-acp'), { recursive: true });
    writeFileSync(join(home, 'antigravity-acp', 'acp_token.json'), JSON.stringify({ client_id: 'c', client_secret: 's', refresh_token: 'merge-refresh' }), 'utf8');
    const bucket = (bucketId: string, remainingFraction: number) => ({ bucketId, window: 'weekly', remainingFraction });
    const fakeFetch: Fetch = async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'merge-access', expires_in: 3600 });
      if (!url.endsWith(':retrieveUserQuotaSummary')) return new Response('', { status: 404 });
      // The daily endpoint answers with the Claude and GPT group alone.
      return url.startsWith('https://daily-')
        ? Response.json({ groups: [{ displayName: 'Claude and GPT', buckets: [bucket('3p-weekly', 0.4)] }] })
        : Response.json({ groups: [{ displayName: 'Gemini', buckets: [bucket('gemini-weekly', 0.75)] }, { displayName: 'Claude and GPT', buckets: [bucket('3p-weekly', 0.9)] }] });
    };
    const windows = await readAntigravityQuota(home, fakeFetch);
    expect(windows.map((row) => [row.label, Math.round(row.usedPercent)])).toEqual([['Claude and GPT · Weekly', 60], ['Gemini · Weekly', 25]]);
  });

  test('on Linux the server is named a CA bundle that exists, unless the user names one', async () => {
    const exists = (path: string): boolean => path === '/etc/ssl/certs/ca-certificates.crt' || path === '/nix/store/ca.crt';
    expect(antigravityCertificates('linux', {}, exists)).toEqual({ SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt' });
    expect(antigravityCertificates('linux', { NIX_SSL_CERT_FILE: '/nix/store/ca.crt' }, exists)).toEqual({ SSL_CERT_FILE: '/nix/store/ca.crt' });
    expect(antigravityCertificates('linux', { NIX_SSL_CERT_FILE: 'relative.crt' }, exists)).toEqual({ SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt' });
    expect(antigravityCertificates('linux', { SSL_CERT_FILE: '/mine.pem' }, exists)).toEqual({});
    expect(antigravityCertificates('linux', { SSL_CERT_DIR: '/certs' }, exists)).toEqual({});
    expect(antigravityCertificates('windows', {}, exists)).toEqual({});
    expect(antigravityCertificates('linux', {}, () => false)).toEqual({});
    // The agent itself gets what this machine has.
    const client = await startCore();
    const { threadId } = await agyThread(client);
    await runTurn(client, threadId, 'ping');
    const os = process.platform === 'linux' ? 'linux' : 'other';
    expect(loggedEnv('SSL_CERT_FILE')).toBe(process.env['SSL_CERT_FILE'] ?? antigravityCertificates(os, process.env, existsSync)['SSL_CERT_FILE'] ?? '');
  }, 30000);
  test('the user\'s own skills under ~/.gemini reach every account, whose GEMINI_HOME is its own', async () => {
    await startCore();
    const shipped = harness!.core.providers.require('antigravity');
    const profile = profileFor(shipped);
    expect(profile).toBeDefined();
    const before = process.env['GEMINI_HOME'];
    delete process.env['GEMINI_HOME'];
    // Unset, the variable means the agent's own default.
    expect(variableHome('GEMINI_HOME')).toBe(join(homedir(), '.gemini'));
    const own = join(harness!.dataDir, 'own-gemini');
    const account = join(harness!.dataDir, 'accounts', 'acc_agy');
    mkdirSync(join(own, 'config', 'skills', 'review'), { recursive: true });
    mkdirSync(join(own, 'antigravity-cli', 'skills', 'deploy'), { recursive: true });
    writeFileSync(join(own, 'config', 'skills', 'review', 'SKILL.md'), 'review');
    writeFileSync(join(own, 'antigravity-cli', 'skills', 'deploy', 'SKILL.md'), 'deploy');
    // Neither the user's MCP servers nor anything else of that home is shared.
    writeFileSync(join(own, 'mcp_config.json'), '{}');
    mkdirSync(account, { recursive: true });
    process.env['GEMINI_HOME'] = own;
    try {
      expect(shareProfile(account, profile!, shipped.shared ?? [])).toEqual([]);
    } finally {
      if (before === undefined) delete process.env['GEMINI_HOME'];
      else process.env['GEMINI_HOME'] = before;
    }
    expect(readFileSync(join(account, 'config', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('review');
    expect(readFileSync(join(account, 'antigravity-cli', 'skills', 'deploy', 'SKILL.md'), 'utf8')).toBe('deploy');
    expect(existsSync(join(account, 'mcp_config.json'))).toBe(false);
  });
});

test('a council member named by its family resolves over a list an earlier core saved, on the scale its session reads', async () => {
  const client = await startCore();
  const { accountId, threadId } = await agyThread(client);
  // What a core from before the family list saved: the level in the id, no family and no scale.
  saveCatalog(harness!.core, 'agy-fake', accountId, { models: ['high', 'medium', 'low'].map(level => ({ id: `gemini-3.8-flash-${level}`, name: `Gemini 3.8 Flash (${level})` })), probedAt: Date.now() });
  await client.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: [], labels: {} });
  const council = await client.call('council.start', { threadId, request: 'Review the plan.', models: ['agy-fake/gemini-3.8-flash', 'echo/echo'] });
  expect(council.members[0]).toMatchObject({ providerId: 'agy-fake', model: 'gemini-3.8-flash', effort: 'high', readOnly: 'approvals' });
  expect(council.warnings).toContain(`${council.members[0]!.name} has no xhigh effort, so it runs at high.`);
});

test('a saved Antigravity variant catalog resolves an old model choice with its effort', async () => {
  const client = await startCore();
  const { accountId } = await agyThread(client);
  const families = [
    ['gemini-4-hydrogen', 'Gemini 4 Hydrogen (Preview)'],
    ['gemini-4-argon', 'Gemini 4 Argon'],
    ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
    ['claude-opus-5-5', 'Claude Opus 5.5'],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ] as const;
  saveCatalog(harness!.core, 'agy-fake', accountId, {
    models: [
      { id: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash (Low)', default: true },
      { id: 'gemini-3.5-flash-extra-low', name: 'Gemini 3.5 Flash' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS' },
      { id: 'gemini-3-flash-agent', name: 'Gemini 3 Flash Agent' },
      ...families.flatMap(([id, name]) => [
        { id: `${id}-minimal`, name: `${name} (Minimal)` },
        { id: `${id}-high`, name: `${name} (High)` },
        { id: `${id}-max`, name: `${name} (Max)` },
      ]),
    ],
    probedAt: Date.now(),
  });
  const { models } = await client.call('providers.probe', { providerId: 'agy-fake', accountId });
  expect(models.map(row => row.id)).toEqual(['gemini-3.5-flash', 'gpt-oss-120b-medium', 'gemini-3-flash-agent', ...families.map(([id]) => id)]);
  expect(models[0]).toMatchObject({
    name: 'Gemini 3.5 Flash', default: true,
    aliases: [{ id: 'gemini-3.5-flash-low', effort: 'low' }, { id: 'gemini-3.5-flash-extra-low', effort: 'extra-low' }],
    effort: { default: 'extra-low', levels: [{ id: 'extra-low' }, { id: 'low' }] },
  });
  expect(models[1]?.effort).toBeUndefined();
  expect(models[2]?.effort).toBeUndefined();
  expect(models.slice(3)).toMatchObject(families.map(([id, name]) => ({
    id, name, effort: { default: 'high', levels: [{ id: 'minimal' }, { id: 'high' }, { id: 'max' }] },
  })));
});

test('a thread started by an agent inherits a saved Antigravity alias from a cold catalog', async () => {
  const client = await startCore();
  const { accountId, threadId } = await agyThread(client);
  const core = harness!.core;
  const parent = core.threads.require(threadId);
  core.journal.putThread({ ...parent, model: 'gemini-3.8-flash-low' });
  forgetProbes({ accountId });
  const spawned = await client.call('agent.spawn', {
    threadId, project: parent.projectId!, prompt: 'Continue on the old choice', requestId: 'antigravity-alias',
  });
  expect(spawned.thread).toMatchObject({ model: 'gemini-3.8-flash', effort: 'low' });
});

test.each(['option', 'option:base', 'list'])('Antigravity folded settings select exact wire IDs via %s', async mode => {
  const client = await startCore({ warmProcessMinutes: 5 });
  process.env['AGY_FAKE_CATALOG'] = mode;
  const { accountId, threadId } = await agyThread(client);
  const { models } = await client.call('providers.probe', { providerId: 'agy-fake', accountId, refresh: true });
  expect(models.filter(row => row.id !== 'default').map(row => row.id)).toEqual(['gemini-4-neon', 'gpt-oss-120b-medium', 'gemini-3.5-flash']);
  expect(models.find(row => row.id === 'gemini-4-neon')).toMatchObject({
    name: mode === 'option:base' ? 'Gemini 4 Neon Preview' : 'Gemini 4 Neon',
    default: true, effort: { default: mode === 'option:base' ? 'xhigh' : 'medium', levels: [{ id: 'low' }, { id: 'medium' }, { id: 'xhigh' }] },
  });
  const selected = await client.call('threads.update', { threadId, model: 'gemini-4-neon-xhigh' });
  expect(selected).toMatchObject({ model: 'gemini-4-neon', effort: 'xhigh' });
  await runTurn(client, threadId, 'first');
  await client.call('threads.update', { threadId, effort: 'medium' });
  await runTurn(client, threadId, 'second');
  await client.call('threads.update', { threadId, model: 'default' });
  await runTurn(client, threadId, 'account default');
  const wire = mode === 'list' ? 'listed-model:' : 'set:model=';
  const calls = fakeLog().trim().split('\n').filter(line => line.startsWith(wire) || line.startsWith('prompt:'));
  const prompt = calls[1]!;
  expect(calls).toEqual([
    wire + 'gemini-4-neon-xhigh', prompt, wire + 'gemini-4-neon-medium', prompt, wire + 'gemini-4-neon-low', prompt,
  ]);
  expect(prompt).toStartWith('prompt:');
});

test.each(['option', 'option:no-controls', 'list'])('Antigravity cold resume restores the account model via %s', async mode => {
  const client = await startCore({ warmProcessMinutes: 0 });
  process.env['AGY_FAKE_CATALOG'] = mode;
  const { accountId, threadId } = await agyThread(client, 'gemini-4-neon-xhigh');
  await runTurn(client, threadId, 'first');
  const temp = loggedEnv('TEMP')!;
  await waitFor(() => !existsSync(temp), 10_000);
  forgetProbes({ accountId });
  await client.call('threads.update', { threadId, model: 'default' });
  await runTurn(client, threadId, 'back to default');
  const wire = mode === 'list' ? 'listed-model:' : 'set:model=';
  expect(fakeLog().trim().split('\n').filter(line => line.startsWith('load:') || line.startsWith(wire))).toEqual([
    wire + 'gemini-4-neon-xhigh', 'load:gemini-4-neon-xhigh', wire + 'gemini-4-neon-low',
  ]);
});

test.each([
  ['option:removed', 'offers no xhigh effort'],
  ['missing', 'offers no model gemini-4-neon'],
])('Antigravity refuses a saved selection on cold resume without a matching wire choice (%s)', async (catalog, error) => {
  const client = await startCore({ warmProcessMinutes: 0 });
  process.env['AGY_FAKE_CATALOG'] = 'option';
  const { accountId, threadId } = await agyThread(client, 'gemini-4-neon-xhigh');
  await runTurn(client, threadId, 'first');
  const temp = loggedEnv('TEMP')!;
  await waitFor(() => !existsSync(temp), 10_000);
  forgetProbes({ accountId });
  process.env['AGY_FAKE_CATALOG'] = catalog;
  const finished = client.next('turn.finished', turn => turn.threadId === threadId, 20_000);
  await client.call('turns.start', { threadId, prompt: 'must not reach the agent' });
  expect((await finished).error).toContain(error);
  expect(fakeLog().match(/^prompt:/gm)).toHaveLength(1);
});

test('Antigravity keeps the saved effort when only its wire variant and the base remain', async () => {
  const client = await startCore({ warmProcessMinutes: 0 });
  process.env['AGY_FAKE_CATALOG'] = 'option';
  const { accountId, threadId } = await agyThread(client, 'gemini-4-neon-medium');
  await runTurn(client, threadId, 'first');
  const temp = loggedEnv('TEMP')!;
  await waitFor(() => !existsSync(temp), 10_000);
  await client.call('threads.update', { threadId, effort: 'xhigh' });
  forgetProbes({ accountId });
  process.env['AGY_FAKE_CATALOG'] = 'option:last-variant';
  await runTurn(client, threadId, 'resume');
  expect(fakeLog().trim().split('\n').filter(line => line.startsWith('set:model=') || line.startsWith('load:'))).toEqual([
    'set:model=gemini-4-neon-medium', 'load:gemini-4-neon-medium', 'set:model=gemini-4-neon-xhigh',
  ]);
});

test('cold Antigravity discovery resolves old IDs for a model other than the current family', async () => {
  const client = await startCore();
  process.env['AGY_FAKE_CATALOG'] = 'family-history';
  const { accountId, threadId } = await agyThread(client);
  const parent = harness!.core.threads.require(threadId);
  const { models } = await client.call('providers.probe', { providerId: 'agy-fake', accountId });
  expect(models.find(model => model.default)?.id).toBe('gemini-3.8-flash');
  expect(models.find(model => model.id === 'gemini-4-neon')?.aliases).toEqual([
    { id: 'gemini-4-neon-low', effort: 'low' }, { id: 'gemini-4-neon-xhigh', effort: 'xhigh' },
  ]);
  const route = { projectId: parent.projectId!, providerId: parent.providerId, accountId, model: 'gemini-4-neon-xhigh' };
  expect(await thrown(client.call('threads.create', { ...route, effort: 'medium' }))).toThrow('the model does not offer this reasoning effort');
  const thread = await client.call('threads.create', route);
  expect(thread).toMatchObject({ model: 'gemini-4-neon', effort: 'xhigh' });
  await client.call('threads.subscribe', { threadId: thread.id });
  await runTurn(client, thread.id, 'use the old effort');
  expect(fakeLog()).toContain('set:model=gemini-4-neon\nset:thinking_level=xhigh\n');
  await client.call('delegation.configure', { threadId, config: { enabled: true, paused: false, profiles: [] } });
  expect((await client.call('delegation.spawn', {
    threadId, model: route.model, task: 'Delegate on the old model', requestId: 'old-id',
  })).thread).toMatchObject({ model: 'gemini-4-neon', effort: 'xhigh' });
});

test('Antigravity selects the base to check a historical effort missing from the wire variants', async () => {
  const client = await startCore();
  process.env['AGY_FAKE_CATALOG'] = 'mixed';
  const { accountId, threadId } = await agyThread(client);
  await client.call('providers.probe', { providerId: 'agy-fake', accountId });
  const selected = await client.call('threads.update', { threadId, model: 'gemini-4-neon-xhigh' });
  expect(selected).toMatchObject({ model: 'gemini-4-neon', effort: 'xhigh' });
  await runTurn(client, threadId, 'use the native effort');
  expect(fakeLog()).toMatch(/set:model=gemini-4-neon\nset:thinking_level=xhigh\nprompt:/);
});

test('local delegation keeps the effort encoded in an allowed legacy model', async () => {
  const client = await startCore();
  process.env['AGY_FAKE_CATALOG'] = 'option';
  const { threadId } = await agyThread(client, 'gemini-4-neon-low');
  const core = harness!.core;
  const thread = core.threads.require(threadId);
  core.journal.putThread({ ...thread, model: 'gemini-4-neon-low', effort: null });
  await client.call('delegation.configure', { threadId, config: { enabled: true, paused: false, profiles: [], anyModel: false } });
  expect(await thrown(client.call('delegation.spawn', {
    threadId, model: 'gemini-4-neon-xhigh', task: 'Outside the allowed effort', requestId: 'wrong-level',
  }))).toThrow('limited subagents');
  expect(await thrown(client.call('delegation.spawn', {
    threadId, model: 'gemini-4-neon', effort: 'xhigh', task: 'Explicit override', requestId: 'wrong-override',
  }))).toThrow('limited subagents');
  expect(await thrown(client.call('delegation.spawn', {
    threadId, effort: 'xhigh', task: 'Override without a model', requestId: 'override-without-model',
  }))).toThrow('limited subagents');
  expect((await client.call('delegation.spawn', {
    threadId, model: 'gemini-4-neon', task: 'Within the allowed effort', requestId: 'right-level',
  })).thread).toMatchObject({ model: 'gemini-4-neon', effort: 'low' });
});

test('a mochi created on a legacy Antigravity model keeps its level unless explicitly overridden', async () => {
  const client = await startCore({ agentBotCreation: 'free' });
  process.env['AGY_FAKE_CATALOG'] = 'option';
  const { threadId, accountId } = await agyThread(client, 'gemini-4-neon-low');
  await client.call('providers.probe', { providerId: 'agy-fake', accountId });
  for (const [name, effort] of [['Alias', undefined], ['Explicit', 'low']] as const) {
    const result = await client.call('agents.create', { threadId, name, model: 'gemini-4-neon-xhigh', effort });
    expect(result).toMatchObject({ agent: { selection: { model: 'gemini-4-neon', effort: effort ?? 'xhigh' } } });
  }
});

test.each([null, 'low'])('Antigravity with a single remaining variant and saved effort %s', async effort => {
  const client = await startCore({ warmProcessMinutes: 0 });
  process.env['AGY_FAKE_CATALOG'] = 'option';
  const { accountId, threadId } = await agyThread(client, 'gemini-4-neon-low');
  await runTurn(client, threadId, 'first');
  await waitFor(() => !existsSync(loggedEnv('TEMP')!), 10_000);
  await client.call('threads.update', { threadId, effort });
  forgetProbes({ accountId });
  process.env['AGY_FAKE_CATALOG'] = 'option:only-variant';
  const finished = client.next('turn.finished', turn => turn.threadId === threadId, 20_000);
  await client.call('turns.start', { threadId, prompt: 'continue' });
  const result = await finished;
  if (effort === null) {
    expect(result.error).toBeNull();
    expect(fakeLog()).toContain('set:model=gemini-4-neon-xhigh');
    expect(fakeLog().match(/^prompt:/gm)).toHaveLength(2);
  } else {
    expect(result.error).toContain('offers no low effort');
    expect(fakeLog().match(/^prompt:/gm)).toHaveLength(1);
  }
});

test('antigravityCatalog merges a primary variant and a historical alias when the base has no native scale yet', () => {
  const models = antigravityCatalog(
    [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon' },
      { id: 'gemini-4-neon-low', name: 'Gemini 4 Neon (Low)' },
    ],
    [
      { id: 'gemini-4-neon-xhigh', name: 'Gemini 4 Neon (XHigh)' },
    ],
  );
  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    id: 'gemini-4-neon',
    name: 'Gemini 4 Neon',
    effort: { levels: [{ id: 'low', label: 'Low' }, { id: 'xhigh', label: 'Extra high' }] },
    aliases: [{ id: 'gemini-4-neon-low', effort: 'low' }, { id: 'gemini-4-neon-xhigh', effort: 'xhigh' }],
  });
});
