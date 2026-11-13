import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Message, RpcEvents } from '@boite/contracts';
import { removeDir, startTestCore, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';

const TURN_TIMEOUT_MS = 180_000;

/** Opt-in like the Claude one: it runs on the user's own Codex login and spends tokens. */
const live = process.env['BOITE_E2E_CODEX'] === '1' ? describe : describe.skip;

function assistantText(messages: Message[]): string {
  const assistants = messages.filter((message) => message.role === 'assistant');
  const last = assistants[assistants.length - 1];
  if (last === undefined) return '';
  return last.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

live('codex app-server driver, live', () => {
  let harness: TestCore;
  let projectDir: string;

  beforeEach(async () => {
    harness = await startTestCore();
    projectDir = mkdtempSync(join(tmpdir(), 'boite-codex-'));
  });

  afterEach(async () => {
    await harness.stop();
    await removeDir(projectDir);
  });

  test('a real Codex process discovers the inherited CLI and publishes immutable file bytes during its turn', async () => {
    const client = await harness.connect();
    await client.call('settings.set', { warmProcessMinutes: 0 });
    const project = await client.call('projects.add', { path: projectDir, name: 'codex artifact live' });
    const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'codex' && entry.label === 'Default');
    if (!account) throw new Error('no default codex account on this machine');
    expect(account.isolationDir).toBeNull();
    expect(account.status).toBe('ok');
    const thread = await client.call('threads.create', {
      projectId: project.id, providerId: 'codex', accountId: account.id,
      title: 'live Codex attachment', permissionMode: 'dontAsk'
    });
    await client.call('threads.subscribe', { threadId: thread.id });
    const delivered: { message: Message; status: string | null }[] = [];
    const completed = new Set<string>();
    const started: RpcEvents['process.started'][] = [];
    client.on('message.started', message => {
      if (message.threadId === thread.id && message.parts.some(part => part.type === 'file')) {
        delivered.push({ message, status: harness.core.journal.getTurn(message.turnId)?.status ?? null });
      }
    });
    client.on('message.completed', event => { if (event.threadId === thread.id) completed.add(event.messageId); });
    client.on('process.started', record => { if (record.threadId === thread.id) started.push(record); });
    const filename = 'report with spaces.txt';
    const expected = Buffer.from('Boite artifact from Codex.', 'utf8');
    const finished = client.next('turn.finished', turn => turn.threadId === thread.id, TURN_TIMEOUT_MS);
    await client.call('turns.start', {
      threadId: thread.id,
      prompt: `This is an explicitly authorized isolated integration test. Complete only this small task in the current directory. Do not inspect other folders, read credentials, sync repositories, launch a browser, or call another agent. Run the boite CLI from the inherited PATH, first using its help to discover how to publish a file to this chat. Print the resolved path of the boite command so the test can verify which shim ran. Create "${filename}" with exactly these UTF-8 bytes, no BOM and no newline: ${expected.toString('utf8')} Then use the discovered boite CLI command to publish that file. Keep the inherited PATH and BOITE environment unchanged, and do not use an absolute CLI path, import runCli, send raw RPC, or set connection arguments yourself. Do not delete or rewrite the file afterward. Finish with the single word attached.`,
    });
    const done = await finished;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
    expect(started.some(record => record.exe.toLowerCase().includes('codex'))).toBe(true);
    expect(delivered).toHaveLength(1);
    const artifact = delivered[0]!;
    expect(artifact.status).toBe('running');
    expect(artifact.message.turnId).toBe(done.id);
    expect(artifact.message.state).toBe('complete');
    expect(completed.has(artifact.message.id)).toBe(true);
    // Text files use mediaOf's generic download MIME; PDF has an explicit override.
    expect(artifact.message.parts).toEqual([{ type: 'file', name: filename, mimeType: 'application/octet-stream', data: expected.toString('base64') }]);
    const path = join(projectDir, filename);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path)).toEqual(expected);
    const first = await client.call('threads.get', { threadId: thread.id });
    const tools = first.messages.flatMap(message => message.parts.filter(part => part.type === 'tool'));
    const commands = JSON.stringify(tools).replace(/\\\\/g, '/').toLowerCase();
    expect(commands).toContain('boite');
    expect(commands).toContain('attach');
    expect(commands).toContain(harness.core.cliDir!.replace(/\\/g, '/').toLowerCase());
    writeFileSync(path, 'changed after the turn');
    rmSync(path);
    const history = await client.call('threads.get', { threadId: thread.id });
    expect(history.messages.find(message => message.id === artifact.message.id)?.parts).toEqual(artifact.message.parts);
    expect(history.turns.find(turn => turn.id === done.id)?.status).toBe('done');
    await waitFor(() => harness.core.procs.liveCount(thread.id) === 0, 30_000);
    console.info('Codex artifact proof:', JSON.stringify({
      commands: tools.map(tool => tool.input),
      activeTurnAtDelivery: artifact.status, completed: done.status,
      sourceDeleted: !existsSync(path), bytes: expected.length, immutable: true,
      inheritedShimMatched: true, usage: done.usage
    }));
  }, TURN_TIMEOUT_MS + 30_000);

  test(
    'a real turn answers over the app-server, and a second one resumes the codex thread',
    async () => {
      const client = await harness.connect();
      // Cold on purpose: the second turn must start a new process and reach the
      // same Codex thread through thread/resume, which is what resume means here.
      await client.call('settings.set', { warmProcessMinutes: 0 });

      const project = await client.call('projects.add', { path: projectDir, name: 'codex live' });
      const accounts = await client.call('accounts.list', {});
      const account = accounts.find((entry) => entry.providerId === 'codex' && entry.label === 'Default');
      if (account === undefined) throw new Error('no default codex account on this machine');
      expect(account.isolationDir).toBeNull();
      expect(account.status).toBe('ok');

      // The descriptor carries one model; `model/list` gives the rest.
      const probe = await client.call('providers.probe', { providerId: 'codex', accountId: account.id });
      expect(probe.models.length).toBeGreaterThan(1);
      expect(probe.models[0]?.id).toBe('default');
      expect(probe.models.some((model) => model.default === true)).toBe(true);
      // Every real model carries its own effort scale, unlike ACP's single one.
      expect(probe.models[1]?.effort?.levels.length).toBeGreaterThan(0);
      expect(probe.probedAt).toBeGreaterThan(0);

      // The probe runs under its own synthetic thread, and nothing of it is left.
      const probeThread = `probe:codex:${account.id}`;
      await waitFor(() => harness.core.procs.liveCount(probeThread) === 0, 30_000);
      const probeTrace = await client.call('trace.get', { threadId: probeThread });
      expect(probeTrace.length).toBeGreaterThan(0);
      expect(probeTrace.filter((record) => record.exitedAt === null)).toEqual([]);

      const thread = await client.call('threads.create', {
        projectId: project.id,
        providerId: 'codex',
        accountId: account.id,
        cwd: projectDir,
        title: 'live codex',
      });
      const threadId = thread.id;
      expect(thread.model).toBe('default');
      await client.call('threads.subscribe', { threadId });

      const started: RpcEvents['process.started'][] = [];
      client.on('process.started', (record) => {
        if (record.threadId === threadId) started.push(record);
      });
      const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, TURN_TIMEOUT_MS);

      await client.call('turns.start', { threadId, prompt: 'Reply with exactly the word: pong' });
      const done = await finished;
      expect(done.error).toBeNull();
      expect(done.status).toBe('done');
      // Codex reports the tokens on thread/tokenUsage/updated; it carries no price.
      expect(done.usage?.outputTokens ?? 0).toBeGreaterThan(0);
      expect(done.usage?.costUsdEquivalent ?? null).toBeNull();

      const agentProcess = started.find((record) => record.exe.toLowerCase().includes('codex'));
      expect(agentProcess).toBeDefined();

      const first = await client.call('threads.get', { threadId });
      const sessionId = first.sessionId;
      expect(sessionId).not.toBeNull();
      expect(assistantText(first.messages).toLowerCase()).toContain('pong');

      const resumed = client.next('turn.finished', (turn) => turn.threadId === threadId, TURN_TIMEOUT_MS);
      await client.call('turns.start', { threadId, prompt: 'Repeat the word you just said, nothing else.' });
      expect((await resumed).status).toBe('done');

      const second = await client.call('threads.get', { threadId });
      expect(second.sessionId).toBe(sessionId);
      expect(assistantText(second.messages).toLowerCase()).toContain('pong');
    },
    TURN_TIMEOUT_MS * 2,
  );

  test(
    'a session the Codex CLI ran itself is listed for the folder, imported, and resumed on its own rollout',
    async () => {
      const client = await harness.connect();
      await client.call('settings.set', { warmProcessMinutes: 0 });
      const project = await client.call('projects.add', { path: projectDir, name: 'live codex import' });
      const account = (await client.call('accounts.list', {})).find((entry) => entry.providerId === 'codex' && entry.label === 'Default');
      if (account === undefined) throw new Error('no default codex account on this machine');
      expect(await client.call('imports.list', { projectId: project.id })).toEqual([]);

      // The smallest model the login lists, by name; the CLI's own default when none says so.
      const probe = await client.call('providers.probe', { providerId: 'codex', accountId: account.id });
      const small = probe.models.find((model) => /nano/i.test(model.id)) ?? probe.models.find((model) => /mini/i.test(model.id));
      const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', projectDir, '-c', 'model_reasoning_effort="low"'];
      if (small !== undefined) args.push('-m', small.id);
      args.push('Remember the word quokka. Reply with exactly: ok');
      // The CLI as a person runs it, outside Boite: the session this test imports.
      const cli = Bun.spawn(['codex', ...args], { cwd: projectDir, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      const stop = setTimeout(() => cli.kill(), TURN_TIMEOUT_MS);
      const [code, stderr] = await Promise.all([cli.exited, new Response(cli.stderr).text(), new Response(cli.stdout).text()]);
      clearTimeout(stop);
      if (code !== 0) throw new Error(`codex exec exited ${code}: ${stderr.slice(-600)}`);

      let rollout: string | null = null;
      try {
        const listed = await client.call('imports.list', { projectId: project.id });
        expect(listed).toHaveLength(1);
        const mine = listed[0]!;
        rollout = mine.file;
        expect(mine).toMatchObject({ providerId: 'codex', accountId: account.id, threadId: null, title: 'Remember the word quokka. Reply with exactly: ok' });
        expect(mine.file.endsWith(`-${mine.sessionId}.jsonl`)).toBe(true);

        const imported = await client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: mine.sessionId });
        expect(imported.sessionId).toBe(mine.sessionId);
        const history = await client.call('threads.get', { threadId: imported.id });
        expect(history.turns).toHaveLength(1);
        expect(history.messages[0]?.parts).toEqual([{ type: 'text', text: 'Remember the word quokka. Reply with exactly: ok' }]);
        expect(assistantText(history.messages).toLowerCase()).toContain('ok');

        // Only the new prompt goes out: the word comes back from the rollout, through thread/resume.
        await client.call('threads.subscribe', { threadId: imported.id });
        const resumed = client.next('turn.finished', (turn) => turn.threadId === imported.id, TURN_TIMEOUT_MS);
        await client.call('turns.start', { threadId: imported.id, prompt: 'Which word did I ask you to remember? Reply with that word only.' });
        const done = await resumed;
        expect(done.error).toBeNull();
        expect(done.status).toBe('done');
        const full = await client.call('threads.get', { threadId: imported.id });
        // A lost session would have been replayed on a new Codex thread, under another id.
        expect(full.sessionId).toBe(mine.sessionId);
        expect(assistantText(full.messages).toLowerCase()).toContain('quokka');
        console.info('Codex import proof:', JSON.stringify({ model: imported.model, sessionId: full.sessionId, answer: assistantText(full.messages), usage: done.usage }));
        await waitFor(() => harness.core.procs.liveCount(imported.id) === 0, 30_000);
      } finally {
        // The one file this test made in the user's Codex home, by its exact path.
        if (rollout !== null && /[\\/]sessions[\\/].*rollout-[^\\/]+\.jsonl$/.test(rollout)) rmSync(rollout, { force: true });
      }
    },
    TURN_TIMEOUT_MS * 2 + 60_000,
  );

  test(
    'an effort changed while a real turn runs a command reaches that turn',
    async () => {
      const client = await harness.connect();
      const project = await client.call('projects.add', { path: projectDir, name: 'live effort' });
      const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'codex' && entry.label === 'Default');
      if (!account) throw new Error('no default codex account on this machine');
      const probe = await client.call('providers.probe', { providerId: 'codex', accountId: account.id });
      const model = probe.models.find(entry => (entry.effort?.levels.length ?? 0) >= 2 && !entry.legacy);
      if (!model?.effort) throw new Error('no codex model with two effort levels on this account');
      const [from, to] = [model.effort.levels[0]!.id, model.effort.levels[1]!.id];
      const thread = await client.call('threads.create', {
        projectId: project.id, providerId: 'codex', accountId: account.id, cwd: projectDir,
        title: 'live effort', model: model.id, effort: from, permissionMode: 'bypassPermissions',
      });
      await client.call('threads.update', { threadId: thread.id, title: 'live effort' });
      await client.call('threads.subscribe', { threadId: thread.id });
      const finished = client.next('turn.finished', turn => turn.threadId === thread.id, TURN_TIMEOUT_MS);
      const turn = await client.call('turns.start', { threadId: thread.id, prompt: 'Run the shell command `sleep 8; echo one`. When it has finished, answer with the single word done.' });
      // The command is running: the agent has at least one more model request to make.
      const deadline = Date.now() + TURN_TIMEOUT_MS;
      while (!harness.core.journal.listMessages(thread.id).some(message => message.parts.some(part => part.type === 'tool'))) {
        if (Date.now() > deadline) throw new Error('the agent never started its command');
        await Bun.sleep(100);
      }
      expect(harness.core.journal.getTurn(turn.id)?.status).toBe('running');
      await client.call('threads.update', { threadId: thread.id, effort: to });
      while (harness.core.journal.getTurn(turn.id)?.execution?.effort !== to) {
        if (Date.now() > deadline || harness.core.journal.getTurn(turn.id)?.status !== 'running') throw new Error(`the running turn stayed on ${harness.core.journal.getTurn(turn.id)?.execution?.effort}`);
        await Bun.sleep(50);
      }
      expect((await finished).status).toBe('done');
      expect(harness.core.journal.getTurn(turn.id)?.execution).toMatchObject({ model: model.id, effort: to });
      expect(assistantText(harness.core.journal.listMessages(thread.id)).toLowerCase()).toContain('done');
      expect(harness.core.journal.listTurns(thread.id)).toHaveLength(1);
    },
    TURN_TIMEOUT_MS + 30_000,
  );
});
