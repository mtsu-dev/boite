/**
 * Records one real turn of Claude, Codex and OpenCode as the fixtures
 * `measure.ts` replays (docs/internals/ci.md#thread-transfer). Live: it runs
 * the installed CLIs on their own logins and spends a short turn of each.
 *
 *   BOITE_BENCH_HOST_AGENTS=1 bun bench/transfer/record.ts [claude] [codex] [opencode]
 *
 * Each agent runs in a fresh temporary project and data directory:
 * - Claude on its default login, with no user settings, memory, hooks or MCP
 *   server (`settingSources: []`), so its stream carries none of the machine's;
 * - Codex on an isolated account holding a copy of `~/.codex/auth.json`,
 *   copied back when the CLI refreshed it;
 * - OpenCode on an isolated account whose one provider is an OpenAI-compatible
 *   endpoint serving the OpenCode Go subscription: `BOITE_BENCH_OPENCODE_URL`,
 *   its key in the file `BOITE_BENCH_OPENCODE_KEY_FILE`, which OpenCode reads
 *   itself, and `BOITE_BENCH_OPENCODE_MODEL` (an `opencode_go/` model,
 *   DeepSeek V4.1 Flash by default). Any other model is refused, so the turn
 *   never lands on a route billed per token. Its process gets an empty home
 *   too: OpenCode also lists the skills it finds under the user's home.
 *
 * What the driver reads is kept: the SDK messages for Claude, the agent's
 * stdout lines for the two others, from the prompt to the end of the turn.
 * `anonymize.ts` then replaces paths, ids and names before anything is written.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, Query, SDKMessage } from '../../packages/core/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts';
import type { CoreClient } from '../../packages/core/src/client.ts';
import { createClaudeDriver } from '../../packages/core/src/drivers/claude.ts';
import { setDriver } from '../../packages/core/src/drivers/index.ts';
import { removeDir, startTestCore, type TestCore } from '../../packages/core/test/harness.ts';
import { anonymize, type Fixture } from './anonymize.ts';
import { FIXTURE_PROMPT, NOTES_FILE, NOTES_TEXT, PROVIDERS, fixturePath, type ProviderName } from './fixture.ts';

if (process.env.BOITE_BENCH_HOST_AGENTS !== '1') throw new Error('BOITE_BENCH_HOST_AGENTS: unset, expected 1: this records live turns on the installed CLIs');
/** The provider id OpenCode's isolated configuration gives the subscription endpoint. */
const ROUTE = 'subscription';
const OPENCODE_MODEL = process.env.BOITE_BENCH_OPENCODE_MODEL ?? 'opencode_go/deepseek-v4.1-flash';
const TURN_MS = 300_000;
const CODEX_AUTH = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
// An isolated account takes the user's own configuration from these homes
// (profile-share.ts): empty ones, so no instruction, skill or MCP server of
// this machine reaches the recorded turn.
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'boite-transfer-codex-home-'));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'boite-transfer-config-home-'));
const EMPTY_HOME = mkdtempSync(join(tmpdir(), 'boite-transfer-home-'));
const wanted = process.argv.slice(2).filter((name): name is ProviderName => (PROVIDERS as readonly string[]).includes(name));
const targets = wanted.length ? wanted : [...PROVIDERS];

/** Lines one agent process wrote and read, in order. */
interface Tapped { cmd: string; args: string[]; lines: { dir: 'in' | 'out'; value: unknown }[] }

/** Every process the core starts gets its stdin and stdout copied, line by line. */
function tap(harness: TestCore): Tapped[] {
  const tapped: Tapped[] = [];
  const procs = harness.core.procs;
  const spawnChild = procs.spawnChild.bind(procs);
  procs.spawnChild = (threadId, cmd, args, opts) => {
    const child = spawnChild(threadId, cmd, args, opts);
    const entry: Tapped = { cmd, args, lines: [] };
    tapped.push(entry);
    const reader = (dir: 'in' | 'out') => {
      let buffer = '';
      return (chunk: Buffer | string) => {
        buffer += chunk.toString();
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (!line) continue;
          try { entry.lines.push({ dir, value: JSON.parse(line) }); } catch { /* a log line, not protocol */ }
        }
      };
    };
    child.stdout?.on('data', reader('out'));
    const write = child.stdin?.write.bind(child.stdin);
    const fromCore = reader('in');
    if (child.stdin && write) child.stdin.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string') fromCore(chunk);
      else if (chunk instanceof Uint8Array) fromCore(Buffer.from(chunk));
      return (write as (...all: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof child.stdin.write;
    return child;
  };
  return tapped;
}

async function project(client: CoreClient, name: string): Promise<{ id: string; path: string }> {
  const path = mkdtempSync(join(tmpdir(), 'boite-transfer-'));
  writeFileSync(join(path, NOTES_FILE), NOTES_TEXT);
  return client.call('projects.add', { path, name });
}

async function runTurn(client: CoreClient, threadId: string): Promise<void> {
  await client.call('threads.update', { threadId, title: 'transfer fixture' });
  await client.call('threads.subscribe', { threadId });
  const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, TURN_MS);
  await client.call('turns.start', { threadId, prompt: FIXTURE_PROMPT });
  const done = await finished;
  if (done.status !== 'done') throw new Error(`the recorded turn ended ${done.status}: ${JSON.stringify(done.error)}`);
}

async function claude(client: CoreClient): Promise<Fixture> {
  const messages: SDKMessage[] = [];
  let version = '';
  const sdk = await import(Bun.resolveSync('@anthropic-ai/claude-agent-sdk', join(import.meta.dir, '../../packages/core')));
  const restore = setDriver('claude-sdk', createClaudeDriver({
    loadQuery: async () => ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Options }) => {
      const query = sdk.query({
        prompt,
        // Nothing of this machine's Claude setup reaches the stream.
        options: { ...options, settingSources: [], strictMcpConfig: true, mcpServers: {}, settings: { ...(typeof options.settings === 'object' ? options.settings : {}), disableAllHooks: true } },
      }) as Query;
      const iterate = query[Symbol.asyncIterator].bind(query);
      query[Symbol.asyncIterator] = async function* () {
        for await (const message of { [Symbol.asyncIterator]: iterate }) {
          messages.push(message);
          if (message.type === 'system' && message.subtype === 'init') version = message.claude_code_version ?? '';
          yield message;
        }
      } as Query[typeof Symbol.asyncIterator];
      return query;
    },
  }));
  try {
    const { id: projectId } = await project(client, 'claude');
    const account = (await client.call('accounts.list', {})).find((entry) => entry.providerId === 'claude' && entry.label === 'Default');
    if (account?.status !== 'ok') throw new Error(`claude: no logged-in default account (${account?.status ?? 'none'})`);
    const thread = await client.call('threads.create', { projectId, providerId: 'claude', accountId: account.id, title: 'transfer fixture', model: 'claude-sonnet-5-5', effort: 'low', permissionMode: 'bypassPermissions' });
    await runTurn(client, thread.id);
    return { provider: 'claude', agentVersion: version, model: 'claude-sonnet-5-5', lines: messages };
  } finally {
    restore();
  }
}

/** The account's isolation directory with one login file copied in, and a way to keep a refresh the CLI wrote there. */
function isolatedLogin(isolationDir: string, from: string, relative: string): () => void {
  if (!existsSync(from)) throw new Error(`${from}: missing, expected the CLI's login`);
  const to = join(isolationDir, relative);
  mkdirSync(join(to, '..'), { recursive: true });
  copyFileSync(from, to);
  const before = readFileSync(to);
  return () => {
    // A rotated refresh token is the only valid one left: it goes back to the CLI's own file.
    if (existsSync(to) && !readFileSync(to).equals(before)) copyFileSync(to, from);
  };
}

/**
 * OpenCode's isolated configuration: one provider, the subscription endpoint,
 * whose key OpenCode reads from its file (`{file:}`), so the key never passes
 * through here.
 */
function subscriptionRoute(isolationDir: string): () => void {
  const url = process.env.BOITE_BENCH_OPENCODE_URL;
  const keyFile = process.env.BOITE_BENCH_OPENCODE_KEY_FILE;
  if (!url) throw new Error('BOITE_BENCH_OPENCODE_URL: unset, expected the OpenAI-compatible base URL serving the OpenCode Go subscription');
  if (!keyFile || !existsSync(keyFile)) throw new Error(`BOITE_BENCH_OPENCODE_KEY_FILE: ${keyFile ?? 'unset'}, expected the file holding that endpoint's key`);
  if (!/^opencode[-_]go\//.test(OPENCODE_MODEL)) throw new Error(`BOITE_BENCH_OPENCODE_MODEL: ${OPENCODE_MODEL}, expected an OpenCode Go model (opencode_go/...)`);
  const dir = join(isolationDir, 'opencode');
  mkdirSync(dir, { recursive: true });
  // The account check looks for a login file; this one holds no credential.
  writeFileSync(join(dir, 'auth.json'), '{}');
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [ROUTE]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'OpenCode Go',
        options: { baseURL: url, apiKey: `{file:${keyFile.replaceAll('\\', '/')}}` },
        models: { [OPENCODE_MODEL]: { name: OPENCODE_MODEL } },
      },
    },
  }, null, 2));
  return () => {};
}

async function stdioAgent(client: CoreClient, tapped: Tapped[], provider: 'codex' | 'opencode'): Promise<Fixture> {
  const { id: projectId } = await project(client, provider);
  const account = await client.call('accounts.add', { providerId: provider, label: 'transfer fixture' });
  if (account.isolationDir === null) throw new Error(`${provider}: the fixture account must be isolated`);
  const keep = provider === 'codex'
    ? isolatedLogin(account.isolationDir, CODEX_AUTH, 'auth.json')
    : subscriptionRoute(account.isolationDir);
  try {
    const checked = await client.call('accounts.check', { accountId: account.id });
    if (checked.status !== 'ok') throw new Error(`${provider}: the copied login reads as ${checked.status}`);
    let model: string | undefined;
    if (provider === 'opencode') {
      const probe = await client.call('providers.probe', { providerId: provider, accountId: account.id });
      model = probe.models.find((entry) => entry.id === `${ROUTE}/${OPENCODE_MODEL}`)?.id;
      // Only the subscription route: never a model billed per token.
      if (model === undefined) throw new Error(`opencode: ${ROUTE}/${OPENCODE_MODEL} is not listed, refusing any other route (${probe.models.map((entry) => entry.id).slice(0, 12).join(', ')})`);
    }
    const thread = await client.call('threads.create', { projectId, providerId: provider, accountId: account.id, title: 'transfer fixture', ...(model ? { model } : {}), permissionMode: 'bypassPermissions' });
    // OpenCode also lists the skills of `~/.claude` and `~/.agents`: an empty
    // home for the turn's process, set once its executable was found.
    const homes = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    if (provider === 'opencode') process.env.HOME = process.env.USERPROFILE = EMPTY_HOME;
    try {
      await runTurn(client, thread.id);
    } finally {
      for (const [name, value] of Object.entries(homes)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    const turn = tapped.findLast((entry) => entry.lines.some(({ dir, value }) => dir === 'in' && isTurnRequest(provider, value)));
    if (turn === undefined) throw new Error(`${provider}: no process carried the turn request`);
    const start = turn.lines.findIndex(({ dir, value }) => dir === 'in' && isTurnRequest(provider, value));
    const lines = turn.lines.slice(start + 1).filter(({ dir }) => dir === 'out').map(({ value }) => value);
    const kept = provider === 'codex' ? untilCodexTurnEnd(lines) : lines;
    return { provider, agentVersion: cliVersion(turn.lines), model: provider === 'codex' ? codexModel(kept) : OPENCODE_MODEL, lines: kept };
  } finally {
    keep();
  }
}

function isTurnRequest(provider: 'codex' | 'opencode', value: unknown): boolean {
  const method = (value as { method?: unknown })?.method;
  return provider === 'codex' ? method === 'turn/start' : method === 'session/prompt';
}

/** The model the app-server says it opened the thread on, since Codex was left on its default. */
function codexModel(lines: unknown[]): string {
  const started = lines.find((value) => (value as { method?: unknown })?.method === 'thread/started') as { params?: { thread?: { model?: unknown } } } | undefined;
  const model = started?.params?.thread?.model;
  return typeof model === 'string' ? model : 'default';
}

function untilCodexTurnEnd(lines: unknown[]): unknown[] {
  const end = lines.findIndex((value) => (value as { method?: unknown })?.method === 'turn/completed');
  return end < 0 ? lines : lines.slice(0, end + 1);
}

/** The version the agent gave in its `initialize` answer, when it gave one. */
function cliVersion(lines: Tapped['lines']): string {
  for (const { dir, value } of lines) {
    if (dir !== 'out') continue;
    const result = (value as { result?: Record<string, unknown> })?.result;
    const info = (result?.agentInfo ?? result?.serverInfo) as { version?: unknown } | undefined;
    const agent = typeof result?.userAgent === 'string' ? /\/([\d.]+)/.exec(result.userAgent)?.[1] : undefined;
    if (typeof info?.version === 'string') return info.version;
    if (agent) return agent;
  }
  return '';
}

const harness = await startTestCore();
const tapped = tap(harness);
try {
  const client = await harness.connect();
  await client.call('settings.set', { warmProcessMinutes: 0 });
  for (const provider of targets) {
    const raw = provider === 'claude' ? await claude(client) : await stdioAgent(client, tapped, provider);
    const fixture = anonymize(raw, { home: homedir(), temp: tmpdir(), user: process.env.USERNAME ?? process.env.USER ?? '' });
    writeFileSync(fixturePath(provider), `${fixture.map((line) => JSON.stringify(line)).join('\n')}\n`);
    console.log(`${provider}: ${fixture.length - 1} lines, agent ${raw.agentVersion || 'unknown'}, model ${raw.model}`);
  }
} finally {
  const projects = (await harness.connect().then((client) => client.call('projects.list', {}))).map((entry) => entry.path);
  await harness.stop();
  for (const path of [...projects, process.env.CODEX_HOME!, process.env.XDG_CONFIG_HOME!, EMPTY_HOME]) if (path.includes('boite-transfer-')) await removeDir(path);
}
