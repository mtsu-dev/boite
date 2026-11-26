import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'bun:test';
import { TOOL_FREE_CONTEXT } from '@boite/contracts';
import type { FileAttachment, ImageAttachment, MessagePart, RpcEvents, RpcParams, Settings } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { forgetProbes, getDriver } from '../src/drivers/index.ts';
import { setPiStopDeadlineForTests } from '../src/drivers/pi/session.ts';
import { BACKGROUND_COMPACT } from '../src/threads/background-compact.ts';
import { startTestCore, startTurn, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';
import { rejection } from './settle.ts';
import { countLogLines, countProcesses, readScriptedLog, writeScriptedProvider } from './scripted-provider.ts';

/** The fake pi in RPC mode: a real JSON-lines process over stdio, run by bun. */
const FAKE_AGENT = fileURLToPath(new URL('./fixtures/pi-agent.ts', import.meta.url));

test('pi subagent extension calls reach the native team through the real protocol', async () => {
  const { client, threadId } = await startThread();
  const { finished } = await startTurn(client, threadId, '[agents]');
  expect((await finished).status).toBe('done');
  expect((await client.call('delegation.get', { threadId })).nativeAgents).toEqual([
    expect.objectContaining({ toolId: 'native-pi', name: 'reviewer', task: 'Review parser boundaries', status: 'done', result: 'Parser checked' }),
  ]);
  const { finished: second } = await startTurn(client, threadId, '[agents]');
  expect((await second).status).toBe('done');
  const agents = (await client.call('delegation.get', { threadId })).nativeAgents;
  expect(agents).toHaveLength(2);
  expect(new Set(agents.map(agent => agent.id)).size).toBe(2);
  expect(agents.every(agent => agent.toolId === 'native-pi' && agent.status === 'done')).toBe(true);
});

test('coordination steers a running pi turn over its RPC connection', async () => {
  const { client, threadId } = await startThread(undefined, 'fake-a/smart');
  await client.call('turns.start', { threadId, prompt: '[slow] Deploy' });
  await waitFor(() => fakeLog().includes('waiting for abort'));
  await waitFor(() => harness!.core.journal.listMessages(threadId).some(m => m.role === 'assistant'));
  expect(await harness!.core.threads.steer(threadId, 'Boite agent coordination. Wait for the VM.')).toBe(true);
  expect(fakeLog()).toContain('steering Boite agent coordination');
  const turn = harness!.core.journal.listTurns(threadId)[0]!;
  const correction: RpcParams<'turns.steer'> = { threadId, turnId: turn.id, prompt: 'User correction [steer-delta]',
    attachments: [{ kind: 'image', mimeType: 'image/png', data: 'aGVsbG8=', name: 'sample.png' }], clientRequestId: 'pi_steer_01' };
  expect(await client.call('turns.steer', correction)).toEqual({ accepted: true });
  expect(fakeLog()).toContain('steering User correction');
  expect(fakeLog()).toContain('steer-image image/png 8');
  expect(harness!.core.journal.listTurns(threadId)).toHaveLength(1);
  const replied = () => harness!.core.journal.listMessages(threadId).findIndex(m => m.parts.some(part => part.type === 'text' && part.text.includes('Steer answered')));
  await waitFor(() => replied() >= 0);
  expect(replied()).toBeGreaterThan(harness!.core.journal.listMessages(threadId).findLastIndex(m => m.role === 'user'));
  await client.call('turns.stop', { threadId });
  await waitFor(() => fakeLog().includes('clear_queue\nabort'));
  expect(fakeLog()).toContain('clear_queue\nabort');
  await waitFor(() => harness!.core.journal.getTurn(turn.id)?.status === 'stopped');
  await client.call('threads.update', { threadId, model: 'fake-b/plain' });
  expect(await client.call('turns.steer', correction)).toEqual({ accepted: true });
});

test('a text-only pi model refuses images on start and steer and still accepts files', async () => {
  const { client, threadId } = await startThread(undefined, 'fake-b/plain');
  const prompt = '[slow] Read this';
  const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
  const file: FileAttachment = { kind: 'file', name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' };
  const refusal = { rpc: { message: 'Fake-b / Fake Plain takes no images: send the prompt without them' } };
  expect((await rejection(client.call('turns.start', { threadId, prompt, attachments: [image] }))).reason).toMatchObject(refusal);
  // A direct client can send after a core restart without opening a picker first.
  forgetProbes({ providerId: 'pi-fake', accountId: harness!.core.threads.require(threadId).accountId });
  expect((await rejection(client.call('turns.start', { threadId, prompt, attachments: [image] }))).reason).toMatchObject(refusal);
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ available: false, reason: 'unsupported' });
  const turn = await client.call('turns.start', { threadId, prompt, attachments: [file] });
  await waitFor(() => fakeLog().includes('waiting for abort'));
  expect(harness!.core.journal.listMessages(threadId).find(message => message.role === 'user')?.parts).toContainEqual({ type: 'file', name: file.name, mimeType: file.mimeType, data: file.data });
  expect((await rejection(client.call('turns.steer', { threadId, turnId: turn.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_text_only' }))).reason).toMatchObject(refusal);
  await client.call('turns.stop', { threadId });
});

let harness: TestCore | null = null;
let logFile = '';

afterEach(async () => {
  const open = harness;
  harness = null;
  delete process.env['PI_FAKE_LOG'];
  if (open !== null) await open.stop();
});

async function startCore(settings?: Partial<Settings>): Promise<CoreClient> {
  const started = await startTestCore(settings === undefined ? {} : { settings });
  harness = started;
  logFile = join(started.dataDir, 'pi-fake.log');
  // `spawnChild` gets `process.env` plus the account environment, so this is
  // what reaches the fake agent.
  process.env['PI_FAKE_LOG'] = logFile;
  return started.connect();
}

/** Ends the running core so the next `startCore` gets a fresh data directory and log. */
async function stopCore(): Promise<void> {
  const open = harness;
  harness = null;
  if (open !== null) await open.stop();
}

function fakeLog(): string {
  return readScriptedLog(logFile);
}

/** Every `argv ...` line the fake wrote, one per agent process it started. */
function argvLines(): string[] {
  return fakeLog()
    .split('\n')
    .filter((line) => line.startsWith('argv '));
}

/** The `BOITE_COMPACTION` each agent process the fake started was given, in launch order. */
function compactionLines(): { tokens: number; background: boolean; ratios: Record<string, number> }[] {
  return fakeLog().split('\n').filter((line) => line.startsWith('compaction ')).map((line) => JSON.parse(line.slice('compaction '.length)));
}

/** How many times the fake was sent one command, so a cached probe is provable. */
function countLines(line: string): number {
  return countLogLines(fakeLog(), line);
}

/**
 * Waits for something without failing on the wait, so the assertion that
 * follows is what names whatever did not happen.
 */
async function settle(predicate: () => boolean): Promise<void> {
  try {
    await waitFor(predicate, 3000);
  } catch {
    // the expectation after this call reports what is missing
  }
}

/**
 * A second fake pi, as small as the one thing it proves: it raises an extension
 * dialog once the run has settled, which is a dialog reaching the client with
 * no prompt in flight. The shared fixture only ever asks inside a run.
 */
function writeLateDialogAgent(dataDir: string): string {
  const path = join(dataDir, 'pi-late-dialog.mjs');
  writeFileSync(
    path,
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "const LOG = process.env.PI_FAKE_LOG ?? '';",
      `const READY = ${JSON.stringify(join(dataDir, 'pi-late-dialog-ready'))};`,
      "function log(line) { if (LOG.length > 0) appendFileSync(LOG, line + '\\n', 'utf8'); }",
      "function send(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }",
      'const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,',
      '  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };',
      'function run() {',
      "  send({ type: 'message_update', usage: ZERO,",
      "    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'done' } });",
      "  send({ type: 'agent_settled' });",
      '  // The test releases this dialog after turn.finished, so context reads',
      '  // cannot leave a closing turn attached when the request arrives.',
      '  const ready = setInterval(() => {',
      '    if (!existsSync(READY)) return;',
      '    clearInterval(ready);',
      "    send({ type: 'extension_ui_request', id: 'late-1', method: 'confirm',",
      "      title: 'Late', message: 'after the run' });",
      '  }, 10);',
      '}',
      'function handle(message) {',
      "  if (message.type === 'extension_ui_response') {",
      "    log('late-answer ' + message.id + ' cancelled=' + (message.cancelled === true));",
      '    return;',
      '  }',
      "  if (message.type === 'prompt') {",
      "    send({ id: message.id, type: 'response', command: 'prompt', success: true });",
      '    setTimeout(run, 0);',
      '    return;',
      '  }',
      "  if (message.type === 'get_state') {",
      "    send({ id: message.id, type: 'response', command: 'get_state', success: true, data: { isStreaming: false } });",
      '    return;',
      '  }',
      "  if (message.type === 'get_commands') {",
      "    send({ id: message.id, type: 'response', command: 'get_commands', success: true, data: { commands: [] } });",
      '    return;',
      '  }',
      "  send({ id: message.id, type: 'response', command: message.type, success: false, error: 'not implemented' });",
      '}',
      "let buffer = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      '  buffer += chunk;',
      '  for (;;) {',
      "    const at = buffer.indexOf('\\n');",
      '    if (at < 0) break;',
      '    const line = buffer.slice(0, at).trim();',
      '    buffer = buffer.slice(at + 1);',
      '    if (line.length === 0) continue;',
      '    handle(JSON.parse(line));',
      '  }',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  return path;
}

/** A user descriptor for the fake agent: `protocol: "pi"`, launched as `bun <fixture>`. */
function writeDescriptor(dataDir: string, agent: string = FAKE_AGENT): void {
  writeScriptedProvider(dataDir, agent, {
    id: 'pi-fake',
    schemaVersion: 1,
    name: 'Fake pi',
    shortName: 'PiFake',
    protocol: 'pi',
    roots: ['{isolationDir}'],
    auth: { kind: 'none' },
    models: [
      // Like the shipped descriptor: "the agent keeps its own", plus one entry
      // written down, so a thread can pick a model before anything is probed.
      { id: 'default', name: 'pi default', default: true },
      {
        id: 'anthropic/claude-sonnet-5',
        name: 'Fake pi model',
        effort: {
          levels: [
            { id: 'low', label: 'Low' },
            { id: 'high', label: 'High' },
          ],
          default: 'low',
        },
      },
    ],
    capabilities: {
      approvals: false,
      hooks: false,
      checkpoint: true,
      images: true,
      planMode: false,
      resume: true,
    },
  });
}

async function piAccount(
  client: CoreClient,
  agent: string = FAKE_AGENT,
): Promise<{ dataDir: string; projectId: string; accountId: string }> {
  const dataDir = harness?.dataDir ?? '';
  writeDescriptor(dataDir, agent);
  const loaded = await client.call('providers.reload', {});
  expect(loaded.rejected).toEqual([]);
  expect(loaded.loaded.some((provider) => provider.id === 'pi-fake' && provider.available)).toBe(true);

  const project = await client.call('projects.add', { path: dataDir, name: 'pi' });
  const account = await client.call('accounts.add', {
    providerId: 'pi-fake',
    label: 'Fake',
    useDefaultLocation: true,
  });
  return { dataDir, projectId: project.id, accountId: account.id };
}

async function piThread(client: CoreClient, model?: string, effort?: string): Promise<string> {
  const { projectId, accountId } = await piAccount(client);
  const thread = await client.call('threads.create', {
    projectId,
    providerId: 'pi-fake',
    accountId,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  });
  // Pin the title for tests that measure the lifetime of the conversation process.
  await client.call('threads.update', { threadId: thread.id, title: 'pi thread' });
  await client.call('threads.subscribe', { threadId: thread.id });
  return thread.id;
}

/** A fresh core with one Pi thread on it, the opening of most tests here. */
async function startThread(
  settings?: Partial<Settings>,
  ...thread: [model?: string, effort?: string]
): Promise<{ client: CoreClient; threadId: string }> {
  const client = await startCore(settings);
  return { client, threadId: await piThread(client, ...thread) };
}

test('pi titles a new thread with a tool-free request on its chosen model', async () => {
  const client = await startCore();
  const { projectId, accountId } = await piAccount(client);
  const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, model: 'anthropic/claude-sonnet-5' });
  expect((await (await startTurn(client, threadId, 'Add a feature')).finished).status).toBe('done');
  await settle(() => harness!.core.threads.require(threadId).titleSource === 'agent');
  expect(await client.call('threads.get', { threadId })).toMatchObject({ title: 'Name the feature', titleSource: 'agent' });
  const invocation = fakeLog().split('\n').find(line => line.startsWith('one-shot [') && line.includes('--no-tools'))!;
  const args = JSON.parse(invocation.slice('one-shot '.length)) as string[];
  expect(args).toEqual(expect.arrayContaining(['--no-session', '--no-tools', '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates']));
  expect(args[args.indexOf('--model') + 1]).toBe('anthropic/claude-sonnet-5');
});

test('pi answers /btw from a disposable session copy and leaves the source intact', async () => {
  const { client, threadId } = await startThread();
  expect((await (await startTurn(client, threadId, 'The release color is amber.')).finished).status).toBe('done');
  expect((await client.call('threads.capabilities', { threadId })).btw).toMatchObject({ available: true });
  const source = piSessionFile(threadId);
  const before = readFileSync(source, 'utf8');
  const answered = client.next('thread.btw', event => event.requestId === 'side_pi_01');
  await client.call('threads.btw', { threadId, question: 'What is the release color?', requestId: 'side_pi_01' });
  expect(await answered).toMatchObject({ answer: expect.stringContaining('The release color is amber.'), error: null });
  const invocation = fakeLog().split('\n').find(line => line.startsWith('one-shot [') && line.includes('"--session"'))!;
  const args = JSON.parse(invocation.slice('one-shot '.length)) as string[];
  const copy = args[args.indexOf('--session') + 1]!;
  expect(copy).not.toBe(source);
  expect(existsSync(copy)).toBe(false);
  expect(readFileSync(source, 'utf8')).toBe(before);
  expect(fakeLog()).toContain('What is the release color?');
});

function piSessionFile(threadId: string): string {
  const sessionId = harness!.core.threads.require(threadId).sessionId;
  const dir = join(harness!.dataDir, 'pi-sessions', threadId);
  return join(dir, readdirSync(dir).find(name => name.endsWith(`_${sessionId}.jsonl`))!);
}

test('pi forks and rewinds at a finished turn, keeping only its native ancestors', async () => {
  const { client, threadId } = await startThread();
  const first = await (await startTurn(client, threadId, 'Keep the amber release')).finished;
  expect(first.checkpoint).toMatchObject({ sessionId: expect.any(String), entry: expect.any(String) });
  const source = piSessionFile(threadId);
  const firstMessages = await client.call('threads.get', { threadId });
  const reply = firstMessages.messages.at(-1)!;
  const unusedBranch = JSON.stringify({ type: 'message', id: 'unused', parentId: null, message: { role: 'user', content: 'Unrelated branch' } });
  const initial = readFileSync(source, 'utf8');
  const [header, ...entries] = initial.trimEnd().split('\n');
  writeFileSync(source, `${[header, unusedBranch, ...entries].join('\n')}\n`);
  expect((await (await startTurn(client, threadId, 'Discard the cyan release')).finished).status).toBe('done');
  const before = readFileSync(source, 'utf8');
  const capability = await client.call('threads.capabilities', { threadId });
  expect(capability.fork.native.available).toBe(true);
  expect(capability.rewind.native.available).toBe(true);

  const fork = await client.call('threads.fork', { threadId, messageId: reply.id });
  expect(fork.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(fork.sessionId).not.toBe(first.checkpoint!.sessionId);
  await client.call('threads.subscribe', { threadId: fork.id });
  expect((await (await startTurn(client, fork.id, '[read-session]')).finished).status).toBe('done');

  const second = (await client.call('threads.get', { threadId })).messages.filter(message => message.role === 'user')[1]!;
  const rewind = await client.call('threads.rewind', { threadId, messageId: second.id });
  expect(rewind.session).toBe('native');
  expect(rewind.thread.sessionId).not.toBe(first.checkpoint!.sessionId);
  expect((await (await startTurn(client, threadId, '[read-session]')).finished).status).toBe('done');
  expect(readFileSync(source, 'utf8')).toBe(before);
  for (const id of [fork.id, threadId]) {
    const message = (await client.call('threads.get', { threadId: id })).messages.at(-1)!;
    expect(message.parts).toEqual([{ type: 'text', text: expect.stringContaining('Native context: ') }]);
    const text = JSON.stringify(message.parts);
    expect(text).toContain('Keep the amber release');
    expect(text).not.toContain('Discard the cyan release');
    expect(text).not.toContain('Unrelated branch');
  }
});

test('pi takes a thinking level while its turn runs', async () => {
  const client = await startCore({ warmProcessMinutes: 5 });
  const { projectId, accountId } = await piAccount(client);
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  const created = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'live level', model: 'fake-a/smart', effort: 'low' });
  const threadId = created.id;
  await client.call('threads.subscribe', { threadId });
  const turn = await client.call('turns.start', { threadId, prompt: '[slow] Deploy' });
  await waitFor(() => fakeLog().includes('waiting for abort'));
  await client.call('threads.update', { threadId, effort: 'high' });
  await waitFor(() => harness!.core.journal.getTurn(turn.id)?.execution?.effort === 'high');
  expect(fakeLog().split('\n').filter(line => line === 'level high')).toHaveLength(1);
  expect(harness!.core.journal.getTurn(turn.id)?.status).toBe('running');
  await client.call('turns.stop', { threadId });
  await waitFor(() => harness!.core.journal.getTurn(turn.id)?.status === 'stopped');
});

test('manual compaction uses the compact RPC response without sending a prompt', async () => {
  const { client, threadId } = await startThread();
  let finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('turns.start', { threadId, prompt: 'remember this' });
  await finished;
  finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('threads.compact', { threadId });
  expect((await finished).status).toBe('done');
  const thread = await client.call('threads.get', { threadId });
  expect(thread.messages.flatMap((m) => m.parts).some((p) => p.type === 'compaction' && p.preTokens === 150000)).toBe(true);
  expect(countLines('prompt')).toBe(1);
  expect(countLines('compact')).toBe(1);
  client.close();
});

test('a Compact with nothing to summarize ends as a quiet notice, not a failed turn', async () => {
  const { client, threadId } = await startThread();
  let finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('turns.start', { threadId, prompt: '[small] hi' });
  await finished;
  finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('threads.compact', { threadId });
  expect((await finished).status).toBe('done');
  const parts = (await client.call('threads.get', { threadId })).messages.flatMap((m) => m.parts);
  expect(parts.find((p) => p.type === 'notice')).toMatchObject({ notice: { kind: 'nothing_to_compact' } });
  expect(parts.some((p) => p.type === 'error' || p.type === 'compaction')).toBe(false);
  client.close();
});

test('a second Compact right after one is a quiet notice too', async () => {
  const { client, threadId } = await startThread();
  let finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('turns.start', { threadId, prompt: 'hi' });
  await finished;
  for (const expected of ['compaction', 'notice'] as const) {
    finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
    await client.call('threads.compact', { threadId });
    expect((await finished).status).toBe('done');
    const last = (await client.call('threads.get', { threadId })).messages.at(-1)!;
    expect(last.parts.map((p) => p.type)).toContain(expected);
  }
  const parts = (await client.call('threads.get', { threadId })).messages.flatMap((m) => m.parts);
  expect(parts.find((p) => p.type === 'notice')).toMatchObject({ notice: { kind: 'nothing_to_compact' }, detail: 'Already compacted' });
  client.close();
});

/** The same thread, on a fake pi the test wrote rather than the shared fixture. */
async function threadOnAgent(client: CoreClient, agent: string): Promise<string> {
  const { projectId, accountId } = await piAccount(client, agent);
  const thread = await client.call('threads.create', {
    projectId,
    providerId: 'pi-fake',
    accountId,
  });
  await client.call('threads.update', { threadId: thread.id, title: 'pi thread' });
  await client.call('threads.subscribe', { threadId: thread.id });
  return thread.id;
}

/** Everything the core logged on this connection, as `<level> <message>` lines. */
function collectLogs(client: CoreClient): string[] {
  const lines: string[] = [];
  client.on('core.log', (entry) => {
    lines.push(`${entry.level} ${entry.message}`);
  });
  return lines;
}

describe('pi driver', () => {
  test('getDriver returns the pi driver', () => {
    expect(getDriver('pi').protocol).toBe('pi');
  });

  test('a plain prompt streams back as one text part, and the session id is kept', async () => {
    const { client, threadId } = await startThread();

    const deltas: string[] = [];
    client.on('message.delta', (event) => {
      if (event.threadId === threadId) deltas.push(event.text);
    });

    const prompt = 'the fake pi agent echoes this back';
    const { finished } = await startTurn(client, threadId, prompt, 20000);

    const done = await finished;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.join('')).toBe(prompt);

    const thread = await client.call('threads.get', { threadId });
    // The driver minted a uuid and launched pi on it; it is the thread's session.
    expect(thread.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(thread.messages[1]?.parts).toEqual([{ type: 'text', text: prompt }]);
    expect(fakeLog()).toContain('prompt\n');
    expect(argvLines()).toHaveLength(1);
    expect(argvLines()[0]).toContain(`sessionId=${thread.sessionId ?? ''}`);
  });

  test('get_commands lists the agent commands once the process is up', async () => {
    const { client, threadId } = await startThread();

    const { finished } = await startTurn(client, threadId, 'hello', 20000);
    expect((await finished).status).toBe('done');

    const thread = await client.call('threads.get', { threadId });
    expect(thread.commands).toEqual([
      { name: 'fake-report', description: 'Write a status report', hint: null },
      { name: 'skill:fake-search', description: 'Search fake docs', hint: null },
    ]);
    expect(fakeLog()).toContain('get_commands\n');
  });

  test('an image attachment rides the prompt command as an images entry', async () => {
    const { client, threadId } = await startThread();

    const PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20000);
    await client.call('turns.start', {
      threadId,
      prompt: 'what is this',
      attachments: [{ kind: 'image', mimeType: 'image/png', data: PNG, name: 'pixel.png' }],
    });
    const done = await finished;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');

    // The fake logs the mimeType and the length of the string it got, which
    // proves pi received the base64 data itself, not a reference to it.
    expect(fakeLog()).toContain(`image image/png ${PNG.length}`);
  });

  test('the session directory is the thread s own, under the account s location', async () => {
    const { client, threadId } = await startThread();
    await runTurn(client, threadId, 'first');

    // The account is on the provider's own location, so the transcript lives
    // under the core's data directory and never in the user's real `~/.pi`.
    const expected = join(harness?.dataDir ?? '', 'pi-sessions', threadId);
    expect(argvLines()[0]).toContain(`sessionDir=${expected}`);
    expect(existsSync(expected)).toBe(true);
  });

  test('the model and the effort ride on the command line, as pi takes them', async () => {
    const { client, threadId } = await startThread(undefined, 'anthropic/claude-sonnet-5', 'high');
    await runTurn(client, threadId, 'first');
    expect(argvLines()[0]).toContain('model=anthropic/claude-sonnet-5:high');
  });

  test('a conversation that must run no tool starts pi with none, and no extension, context file, skill or template', async () => {
    const client = await startCore();
    const parent = harness!.core.threads.require(await piThread(client));
    // An ordinary thread keeps them.
    await runTurn(client, parent.id, 'first');
    const plain = (await client.call('trace.get', { threadId: parent.id })).find(process => process.commandLine?.includes('--session-id'));
    expect(plain?.commandLine).not.toContain('--no-tools');
    const child = harness!.core.delegation.createChild(parent, { id: 'memory', name: 'Memory', providerId: 'pi-fake', accountId: parent.accountId, model: parent.model, effort: null },
      'Memory', () => {}, undefined, false, { contextMode: TOOL_FREE_CONTEXT, permissionMode: 'plan' });
    await client.call('threads.subscribe', { threadId: child });
    await runTurn(client, child, 'Rewrite the memory');
    const launched = (await client.call('trace.get', { threadId: child })).find(process => process.commandLine?.includes('--session-id'));
    for (const flag of ['--no-tools', '--no-extensions', '--no-context-files', '--no-skills', '--no-prompt-templates']) expect(launched?.commandLine).toContain(flag);
  });

  test('a thinking delta becomes a thinking part ahead of the answer', async () => {
    const { client, threadId } = await startThread();

    const { finished } = await startTurn(client, threadId, '[thought]the answer', 20000);
    expect((await finished).status).toBe('done');

    const thread = await client.call('threads.get', { threadId });
    expect(thread.messages[1]?.parts).toEqual([
      { type: 'thinking', text: 'thinking about it', startedAt: expect.any(Number), finishedAt: expect.any(Number) },
      { type: 'text', text: 'the answer' },
    ]);
  });

  test('a tool execution arrives running, then done with its output', async () => {
    const { client, threadId } = await startThread();

    const parts: MessagePart[] = [];
    client.on('message.part', (event) => {
      if (event.threadId === threadId) parts.push(event.part);
    });

    const { finished } = await startTurn(client, threadId, '[tool]', 20000);
    expect((await finished).status).toBe('done');

    const tools = parts.filter((part) => part.type === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: 'bash', status: 'running', output: null });
    expect(tools[0]).toMatchObject({ input: { command: 'echo hello' } });
    expect(tools[1]).toMatchObject({ name: 'bash', status: 'done', output: 'ok' });
  });

  test('the turn usage carries the tokens and the price the agent reported', async () => {
    const { client, threadId } = await startThread();

    const { finished } = await startTurn(client, threadId, '[usage]', 20000);

    const done = await finished;
    expect(done.status).toBe('done');
    expect(done.usage).toEqual({
      inputTokens: 8,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      buckets: 1,
      costUsdEquivalent: 0.03,
    });
  });

  test('stopping a turn aborts it and the agent process is gone', async () => {
    const { client, threadId } = await startThread();

    const started = client.next('process.started', (record) => record.threadId === threadId, 20000);
    const exited = client.next('process.exited', (record) => record.threadId === threadId, 20000);
    const { finished } = await startTurn(client, threadId, '[slow]', 20000);
    await started;
    await waitFor(() => fakeLog().includes('waiting for abort'));

    expect(await client.call('turns.stop', { threadId })).toEqual({ stopped: true });
    expect((await finished).status).toBe('stopped');
    await exited;

    expect(fakeLog()).toContain('abort\n');
    await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
    const trace = await client.call('trace.get', { threadId });
    expect(trace).toHaveLength(1);
    expect(trace[0]?.exitedAt).not.toBeNull();
  });

  test('an agent that dies fails the turn with its exit code and stderr, and the next turn works', async () => {
    const { client, threadId } = await startThread();

    const { finished: crashed } = await startTurn(client, threadId, '[crash]', 20000);

    const failure = await crashed;
    expect(failure.status).toBe('error');
    expect(failure.error).toContain('exited with code 3');
    expect(failure.error).toContain('boom');

    const { finished: again } = await startTurn(client, threadId, 'still here', 20000);
    const done = await again;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
  });

  test('a stderr line that comes in two chunks is quoted whole when the agent dies', async () => {
    const { client, threadId } = await startThread();
    const { finished: crashed } = await startTurn(client, threadId, '[splitcrash]', 20000);
    const failure = await crashed;
    expect(failure.status).toBe('error');
    expect(failure.error).toContain('half of a line');
  });

  test('an extension dialog draws a question and returns the answer', async () => {
    const { client, threadId } = await startThread();
    const requested = client.next('question.asked', (request) => request.threadId === threadId);

    const { finished } = await startTurn(client, threadId, '[ask]', 20000);
    const request = await requested;
    await client.call('questions.answer', { threadId, questionId: request.id, optionIds: ['yes'] });
    const done = await finished;
    expect(done.status).toBe('done');
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages[thread.messages.length - 1]?.parts ?? [];
    const text = parts.find((part) => part.type === 'text');
    expect(text?.type === 'text' ? text.text : '').toBe('dialog answered');
  });

  for (const method of ['select', 'input', 'editor']) {
    test(`the ${method} dialog returns the value pi expects`, async () => {
      const { client, threadId } = await startThread();
      const asked = client.next('question.asked', (request) => request.threadId === threadId);
      const { finished } = await startTurn(client, threadId, `[${method}]`);
      const request = await asked;
      const value = method === 'select' ? 'Second choice' : 'replacement text';
      await client.call('questions.answer', { threadId, questionId: request.id,
        optionIds: method === 'select' ? ['1'] : [], ...(method === 'select' ? {} : { text: value }) });
      expect((await finished).status).toBe('done');
      const thread = await client.call('threads.get', { threadId });
      expect(thread.messages.at(-1)?.parts.some((part) => part.type === 'text' && part.text === value)).toBe(true);
    });
  }

  test('a question on a warm session is filed under the turn that asked it', async () => {
    const { client, threadId } = await startThread({ warmProcessMinutes: 5 });

    const turnIds: string[] = [];
    client.on('turn.started', (turn) => {
      if (turn.threadId === threadId) turnIds.push(turn.id);
    });

    await runTurn(client, threadId, 'first');

    const asked = client.next('question.asked', (request) => request.threadId === threadId, 20000);
    const { finished } = await startTurn(client, threadId, '[ask]', 20000);
    const request = await asked;
    await client.call('questions.answer', { threadId, questionId: request.id, optionIds: ['yes'] });
    expect((await finished).status).toBe('done');

    // One process for the two turns, so the event handler still carries the
    // first turn's context: the question belongs to the second one all the same.
    expect(argvLines()).toHaveLength(1);
    expect(turnIds).toHaveLength(2);
    expect(request.turnId).toBe(turnIds[1] ?? '');
  });

  test('a dialog raised outside a turn is refused on its id, not dropped', async () => {
    const client = await startCore({ warmProcessMinutes: 5 });
    const threadId = await threadOnAgent(client, writeLateDialogAgent(harness?.dataDir ?? ''));
    const logs = collectLogs(client);
    const refusal = client.next('core.log', (entry) => entry.message.includes('confirm dialog late-1 is refused'));

    await runTurn(client, threadId, 'first');
    // Raise the late dialog after final stats and turn cleanup have finished.
    writeFileSync(join(harness!.dataDir, 'pi-late-dialog-ready'), 'ready');

    // The process stays warm, so the extension's dialog lands with no turn to
    // draw a card on. Unanswered, it blocks that extension for the life of the
    // process and the agent waits on an id nobody holds.
    await settle(() => fakeLog().includes('late-answer'));
    // The child can write its answer before the socket delivers the warning.
    await refusal;
    expect(fakeLog()).toContain('late-answer late-1 cancelled=true');
    expect(logs.some((line) => line.includes('confirm') && line.includes('late-1'))).toBe(true);
  });

  test('stopping while a dialog waits cancels it and clears the question', async () => {
    const { client, threadId } = await startThread();
    const asked = client.next('question.asked', (request) => request.threadId === threadId);
    const { finished } = await startTurn(client, threadId, '[ask]');
    await asked;
    await client.call('turns.stop', { threadId });
    expect((await finished).status).toBe('stopped');
    expect(await client.call('questions.list', { threadId })).toEqual([]);
  });

  test('a warm thread keeps one agent process for two turns, a cold one starts a second', async () => {
    const warmClient = await startCore({ warmProcessMinutes: 5 });
    const warmThread = await piThread(warmClient);
    const warm = countProcesses(warmClient, warmThread);
    await runTurn(warmClient, warmThread, 'first');
    expect(warm.started).toHaveLength(1);
    expect(warm.exited).toHaveLength(0);
    await runTurn(warmClient, warmThread, 'second');
    expect(warm.started).toHaveLength(1);
    expect(warm.exited).toHaveLength(0);
    // One process, so one argv line for the two turns.
    expect(argvLines()).toHaveLength(1);
    await stopCore();

    const coldClient = await startCore({ warmProcessMinutes: 0 });
    const coldThread = await piThread(coldClient);
    const cold = countProcesses(coldClient, coldThread);
    await runTurn(coldClient, coldThread, 'first');
    await runTurn(coldClient, coldThread, 'second');
    expect(cold.started).toHaveLength(2);
  });

  test('a dropped session is reopened on the id and the directory the first turn used', async () => {
    const { client, threadId } = await startThread({ warmProcessMinutes: 0 });

    await runTurn(client, threadId, 'first');
    const sessionId = (await client.call('threads.get', { threadId })).sessionId ?? '';
    expect(sessionId).not.toBe('');

    // The process went with the turn, so the second one is a new pi launched on
    // the very same id and directory, which is how pi reopens its transcript.
    await runTurn(client, threadId, 'second');
    const lines = argvLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(lines[0]);
    expect(lines[0]).toContain(`sessionId=${sessionId}`);
    expect((await client.call('threads.get', { threadId })).sessionId).toBe(sessionId);
  });

  test('a probe lists the models pi offers, each with the levels that model supports', async () => {
    const client = await startCore();
    const { accountId } = await piAccount(client);

    const probed = client.next(
      'providers.probed',
      (event) => event.providerId === 'pi-fake' && event.accountId === accountId,
      20000,
    );
    const result = await client.call('providers.probe', { providerId: 'pi-fake', accountId });

    // The id is what `--model` takes, and the name carries the provider.
    expect(result.models.map((model) => model.id)).toEqual([
      'default',
      'fake-a/smart',
      'fake-a/quick',
      'fake-b/plain',
    ]);
    expect(result.models[0]).toEqual({ id: 'default', name: 'pi default', default: false });
    expect(result.models[1]?.name).toBe('Fake-a / Fake Smart');
    expect(result.models.map((model) => model.images)).toEqual([undefined, undefined, undefined, false]);
    // pi reports one model as current; that is the one the picker opens on.
    expect(result.models.find((model) => model.default === true)?.id).toBe('fake-a/smart');

    // The two opt-in levels are there only for the model that maps them, and the
    // session's own level is the default of the model it is on, and of no other.
    expect(result.models[1]?.effort).toEqual({
      levels: [
        { id: 'off', label: 'Off' },
        { id: 'minimal', label: 'Minimal' },
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'xhigh', label: 'Extra high' },
        { id: 'max', label: 'Max' },
      ],
      default: 'medium',
    });
    expect(result.models[2]?.effort?.levels.map((level) => level.id)).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    // pi keeps its own level for another model, clamped to it: the core has no default to send.
    expect(result.models[2]?.effort?.default).toBeUndefined();
    // A model without reasoning has `off` and nothing else, which is no choice.
    expect(result.models[3]?.effort).toBeUndefined();
    expect(result.probedAt).toBeGreaterThan(0);

    // A second client learns the same list from the event.
    expect((await probed).models.map((model) => model.id)).toEqual([
      'default',
      'fake-a/smart',
      'fake-a/quick',
      'fake-b/plain',
    ]);

    // The answer is cached, and the agent process is gone: a probe leaves nothing.
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    expect(countLines('get_available_models')).toBe(1);
    await waitFor(() => harness?.core.procs.liveCount(`probe:pi-fake:${accountId}`) === 0);
    const trace = await client.call('trace.get', { threadId: `probe:pi-fake:${accountId}` });
    expect(trace.length).toBeGreaterThan(0);
    expect(trace.every((row) => row.exitedAt !== null)).toBe(true);
  });

  test('creating a pi thread discovers its model and launches with its effort', async () => {
    const client = await startCore();
    const { projectId, accountId } = await piAccount(client);

    const thread = await client.call('threads.create', {
      projectId,
      providerId: 'pi-fake',
      accountId,
      title: 'after the probe',
      model: 'fake-a/quick',
      effort: 'high',
    });
    expect(thread.model).toBe('fake-a/quick');
    expect(thread.effort).toBe('high');

    await client.call('threads.subscribe', { threadId: thread.id });
    await runTurn(client, thread.id, 'first');
    const turnProcess = argvLines().find(line => line.startsWith(`argv sessionId=${harness!.core.threads.require(thread.id).sessionId} `));
    expect(turnProcess).toContain('model=fake-a/quick:high');
  });

  test('a 529 that pi retried by itself ends the turn done, with no error card', async () => {
    const { client, threadId } = await startThread();
    const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20000);
    const progress = client.next('thread.updated', thread => thread.id === threadId && thread.progress?.phase === 'retrying');
    await client.call('turns.start', { threadId, prompt: '[retry]' });
    const done = await finished;
    expect((await progress).progress?.detail).toBe('1/3');
    expect(done.status).toBe('done');
    expect(done.error).toBeNull();
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages.flatMap((message) => message.parts);
    expect(parts.some((part) => part.type === 'error')).toBe(false);
    expect(parts.some((part) => part.type === 'text' && part.text === 'recovered answer')).toBe(true);
    expect(thread.status).toBe('idle');
  });

  test('a 529 pi gave up on after its retries fails the turn with one error card', async () => {
    const { client, threadId } = await startThread();
    const { finished } = await startTurn(client, threadId, '[giveup]', 20000);
    const done = await finished;
    expect(done.status).toBe('error');
    expect(done.error).toBe('529 overloaded after 3 attempts');
    const thread = await client.call('threads.get', { threadId });
    const errors = thread.messages.flatMap((message) => message.parts).filter((part) => part.type === 'error');
    expect(errors).toEqual([{ type: 'error', message: '529 overloaded after 3 attempts' }]);
  });

  test('an extension command that starts no run ends the turn, and the process stays warm', async () => {
    const { client, threadId } = await startThread({ warmProcessMinutes: 5 });
    const { finished } = await startTurn(client, threadId, '/fake-report', 10000);
    const done = await finished;
    expect(done.status).toBe('done');
    expect(fakeLog()).toContain('extension command handled');
    expect(harness?.core.procs.liveCount(threadId)).toBe(1);
    // A normal turn on the same process still streams to its own agent_settled.
    await runTurn(client, threadId, '[tool] after the command');
    expect(argvLines()).toHaveLength(1);
  });

  test('a stop that pi never answers ends the turn stopped at the deadline, and the process is gone', async () => {
    setPiStopDeadlineForTests(300);
    try {
      const { client, threadId } = await startThread();
      const { finished } = await startTurn(client, threadId, '[deaf]', 10000);
      await waitFor(() => fakeLog().includes('waiting forever'));
      await client.call('turns.stop', { threadId });
      expect((await finished).status).toBe('stopped');
      expect(fakeLog()).toContain('abort ignored');
      await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
    } finally {
      setPiStopDeadlineForTests(null);
    }
  });

  test('a stop while pi never answers the prompt ends the turn stopped at the deadline', async () => {
    setPiStopDeadlineForTests(300);
    try {
      const { client, threadId } = await startThread();
      const { finished } = await startTurn(client, threadId, '[preflight]', 10000);
      await waitFor(() => fakeLog().includes('preflight never ends'));
      await client.call('turns.stop', { threadId });
      expect((await finished).status).toBe('stopped');
      await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
      expect((await client.call('threads.get', { threadId })).status).not.toBe('running');
    } finally {
      setPiStopDeadlineForTests(null);
    }
  });

  test.each(['noclear', 'hang-clear'])('Stop closes a steered pi when clear_queue is uncertain (%s)', async condition => {
    const { client, threadId } = await startThread();
    const { finished } = await startTurn(client, threadId, `[slow][${condition}] Deploy`, 2000);
    await waitFor(() => fakeLog().includes('waiting for abort'));
    await waitFor(() => harness!.core.journal.listMessages(threadId).some((m) => m.role === 'assistant'));
    expect(await harness!.core.threads.steer(threadId, 'Boite agent coordination. Wait.')).toBe(true);
    await client.call('turns.stop', { threadId });
    expect((await finished).status).toBe('stopped');
    expect(fakeLog()).toContain('clear_queue\n');
    expect(fakeLog()).not.toMatch(/^abort$/m);
    await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
  });

  test('a stopped pi turn settles while the context read is still unanswered', async () => {
    const { client, threadId } = await startThread();
    const { finished } = await startTurn(client, threadId, '[hang-stats] Deploy', 2000);
    await waitFor(() => fakeLog().includes('get_session_stats'));
    expect(await client.call('turns.stop', { threadId })).toEqual({ stopped: true });
    expect((await finished).status).toBe('stopped');
    await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
  });

  test('a notify is drawn in the turn and no fire-and-forget method gets an answer', async () => {
    const { client, threadId } = await startThread();
    const logs = collectLogs(client);
    const { finished } = await startTurn(client, threadId, '[notify]', 20000);
    const done = await finished;
    expect(done.status).toBe('done');
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages.flatMap((message) => message.parts);
    expect(parts).toContainEqual({ type: 'text', text: 'pi: heads up' });
    expect(parts).toContainEqual({ type: 'error', message: 'it broke' });
    expect(fakeLog()).not.toContain('ui-response');
    expect(logs.some((line) => line.includes('refused'))).toBe(false);
  });

  test('a dialog pi gave up on after its timeout takes its card away while the turn runs', async () => {
    const { client, threadId } = await startThread();
    const asked = client.next('question.asked', (request) => request.threadId === threadId, 20000);
    const withdrawn = client.next('question.answered', (event) => event.threadId === threadId, 20000);
    const { finished } = await startTurn(client, threadId, '[timeout][slow]', 20000);
    const request = await asked;
    const answered = await withdrawn;
    expect(answered.questionId).toBe(request.id);
    expect(answered.answer).toBeNull();
    await waitFor(() => fakeLog().includes('waiting for abort'));
    expect(await client.call('questions.list', { threadId })).toEqual([]);
    expect((await client.call('threads.get', { threadId })).status).toBe('running');
    expect(fakeLog()).not.toContain('ui-response');
    await client.call('turns.stop', { threadId });
    expect((await finished).status).toBe('stopped');
  });

  test('an automatic compaction draws its divider and the turn reports the context pi counts', async () => {
    const { client, threadId } = await startThread();
    const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20000);
    const progress = client.next('thread.updated', thread => thread.id === threadId && thread.progress?.phase === 'compacting');
    await client.call('turns.start', { threadId, prompt: '[compacted] go on' });
    expect((await finished).status).toBe('done');
    expect((await progress).progress?.phase).toBe('compacting');
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages.flatMap((message) => message.parts);
    expect(parts).toContainEqual({ type: 'compaction', trigger: 'auto', preTokens: 180000, postTokens: 30000 });
    expect(thread.context?.tokens).toBe(4321);
    expect(thread.context?.window).toBe(200000);
  });

  test('with background compaction on, pi loads Boite\'s extension with the thread\'s setting, and a changed setting restarts it at the next turn', async () => {
    const { client, threadId } = await startThread({ warmProcessMinutes: 5, autoCompact: { tokens: 100000, moments: [] }, backgroundCompaction: true });
    const compactionExtensions = () => fakeLog().split('\n')
      .filter(line => line.startsWith('extension ') && line.endsWith('pi-compaction.mjs'))
      .map(line => line.slice('extension '.length));
    await runTurn(client, threadId, 'first');
    await runTurn(client, threadId, 'second');
    // One process for both turns, launched with the extension and the setting it reads.
    expect(argvLines()).toHaveLength(1);
    const extensions = compactionExtensions();
    expect(extensions).toHaveLength(1);
    expect(readFileSync(extensions[0]!, 'utf8')).toContain("from '@earendil-works/pi-coding-agent'");
    expect(compactionLines()).toEqual([{ tokens: 100000, background: true, ratios: { ...BACKGROUND_COMPACT } }]);

    await client.call('settings.set', { autoCompact: { tokens: 200000, moments: [] } });
    await runTurn(client, threadId, 'third');
    expect(argvLines()).toHaveLength(2);
    expect(compactionLines().map(setting => setting.tokens)).toEqual([100000, 200000]);

    // Off: the next process runs without the compaction extension.
    await client.call('settings.set', { backgroundCompaction: false });
    await runTurn(client, threadId, 'fourth');
    expect(argvLines()).toHaveLength(3);
    expect(compactionLines()).toHaveLength(2);
    expect(compactionExtensions()).toHaveLength(2);
  });

  test('the copy Boite\'s extension hands pi draws a background divider, at a turn end or at pi\'s threshold', async () => {
    const { client, threadId } = await startThread();
    await runTurn(client, threadId, '[swapped] [taken] go on');
    const parts = (await client.call('threads.get', { threadId })).messages.flatMap((message) => message.parts).filter(part => part.type === 'compaction');
    expect(parts).toEqual([
      { type: 'compaction', trigger: 'auto', preTokens: 100000, postTokens: null, background: true },
      { type: 'compaction', trigger: 'auto', preTokens: 170000, postTokens: 40000, background: true },
    ]);
  });

  test('a warm process takes a new effort and a new model over RPC instead of restarting', async () => {
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const created = await client.call('threads.create', {
      projectId,
      providerId: 'pi-fake',
      accountId,
      title: 'switching',
      model: 'fake-a/smart',
      effort: 'low',
    });
    const threadId = created.id;
    await client.call('threads.subscribe', { threadId });
    await runTurn(client, threadId, 'first');
    await client.call('threads.update', { threadId, effort: 'high' });
    await runTurn(client, threadId, 'second');
    await client.call('threads.update', { threadId, model: 'fake-a/quick', effort: 'high' });
    await runTurn(client, threadId, 'third');
    const turnProcesses = argvLines().filter((line) => !line.includes('sessionId= '));
    expect(turnProcesses).toHaveLength(1);
    expect(turnProcesses[0]).toContain('model=fake-a/smart:low');
    expect(fakeLog()).toContain('level high\n');
    expect(fakeLog()).toContain('model fake-a/quick\nset_thinking_level\nlevel high\n');
  });

  test('core shutdown during a turn pi never settles ends it before the journal closes', async () => {
    const { client, threadId } = await startThread();
    const finished: { status: string; error: string | null }[] = [];
    const logs: string[] = [];
    harness!.core.bus.onAny((name, payload) => {
      if (name === 'core.log') logs.push((payload as RpcEvents['core.log']).message);
      if (name !== 'turn.finished') return;
      const turn = payload as RpcEvents['turn.finished'];
      if (turn.threadId === threadId) finished.push({ status: turn.status, error: turn.error });
    });
    const uncaught: string[] = [];
    const onUncaught = (error: unknown): void => {
      uncaught.push(error instanceof Error ? error.message : String(error));
    };
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUncaught);
    try {
      await client.call('turns.start', { threadId, prompt: '[deaf]' });
      await waitFor(() => fakeLog().includes('waiting forever'));
      // Nothing may write to the closed journal once the child's close lands.
      await stopCore();
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUncaught);
    }
    // The drain stops the turn, pi ignores the abort, and the driver shutdown
    // ends it stopped while the bus and the journal are still open.
    expect(finished).toEqual([{ status: 'stopped', error: null }]);
    expect(uncaught).toEqual([]);
    expect(logs.filter((line) => /closed database|database is closed/i.test(line))).toEqual([]);
  }, 20000);

  test('core shutdown before the stop deadline keeps a stopped pi turn stopped', async () => {
    const { client, threadId } = await startThread();
    const statuses: string[] = [];
    harness!.core.bus.onAny((name, payload) => {
      if (name !== 'turn.finished') return;
      const turn = payload as RpcEvents['turn.finished'];
      if (turn.threadId === threadId) statuses.push(turn.status);
    });
    await client.call('turns.start', { threadId, prompt: '[deaf]' });
    await waitFor(() => fakeLog().includes('waiting forever'));
    await client.call('turns.stop', { threadId });
    await waitFor(() => fakeLog().includes('abort ignored'));
    // The 15 s stop deadline has not run: the shutdown is what closes pi.
    await stopCore();
    expect(statuses).toEqual(['stopped']);
  }, 20000);

  async function runTurn(client: CoreClient, threadId: string, prompt: string): Promise<void> {
    const { finished } = await startTurn(client, threadId, prompt, 20000);
    const done = await finished;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
  }
});
