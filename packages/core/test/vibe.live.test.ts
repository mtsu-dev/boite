import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Message, RpcEvents } from '@boite/contracts';
import { removeDir, startTestCore, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';

const TURN_TIMEOUT_MS = 120_000;

/**
 * Opt-in: it runs on the user's own Vibe login (`VIBE_HOME`, else `~/.vibe`)
 * and spends tokens.
 */
const live = process.env['BOITE_E2E_VIBE'] === '1' ? describe : describe.skip;

function assistantText(messages: Message[]): string {
  const assistants = messages.filter((message) => message.role === 'assistant');
  const last = assistants[assistants.length - 1];
  if (last === undefined) return '';
  return last.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

live('mistral vibe over acp, live', () => {
  let harness: TestCore;
  let projectDir: string;

  beforeEach(async () => {
    harness = await startTestCore();
    projectDir = mkdtempSync(join(tmpdir(), 'boite-vibe-'));
  });

  afterEach(async () => {
    await harness.stop();
    await removeDir(projectDir);
  });

  test(
    'the probe reads the thinking scale, a turn on high answers, and a cold second turn resumes',
    async () => {
      const client = await harness.connect();
      await client.call('settings.set', { warmProcessMinutes: 0 });

      const project = await client.call('projects.add', { path: projectDir, name: 'vibe live' });
      const accounts = await client.call('accounts.list', {});
      const account = accounts.find((entry) => entry.providerId === 'vibe' && entry.label === 'Default');
      if (account === undefined) throw new Error('no default vibe account on this machine');
      expect(account.status).toBe('ok');

      // The machine's own agents are found at startup, and the descriptors that
      // finding reloads void a probe that started before: refresh once.
      const read = () => client.call('providers.probe', { providerId: 'vibe', accountId: account.id, refresh: true });
      const probe = await read().catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('changed during discovery')) return read();
        throw error;
      });
      const current = probe.models.find((model) => model.default === true);
      expect(current).toBeDefined();
      // Vibe files its effort under the `thinking` category, `off` and `high`.
      expect(current?.effort?.levels.map((level) => level.id)).toEqual(['off', 'high']);
      await waitFor(() => harness.core.procs.liveCount(`probe:vibe:${account.id}`) === 0, 20_000);

      const thread = await client.call('threads.create', {
        projectId: project.id,
        providerId: 'vibe',
        accountId: account.id,
        model: current?.id ?? 'default',
        effort: 'high',
        cwd: projectDir,
        title: 'live vibe',
      });
      const threadId = thread.id;
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
      expect(started.some((record) => /vibe-acp(\.exe)?$/i.test(record.exe))).toBe(true);

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
});
