import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, test } from 'bun:test';
import { createCodexDriver } from '../src/drivers/codex.ts';
import type { TurnContext } from '../src/drivers/types.ts';
import type { SpawnedChild } from '../src/procs.ts';

/** Drain the mock server's RPC promises, without a clock or a real process. */
const drain = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function fixture(warmProcessMinutes = 0) {
  const driver = createCodexDriver();
  const children: { child: SpawnedChild; closing: boolean; close(): void }[] = [];
  const prompts: string[] = [];
  const opened: string[] = [];
  let owner: SpawnedChild | null = null;
  const profile = { executable: [{ kind: 'path', value: process.execPath }], launch: { args: [] } };
  const ctx = {
    thread: { id: 'lifecycle', cwd: process.cwd(), permissionMode: 'default', model: null, effort: null },
    account: { id: 'mock-account' },
    provider: { id: 'mock-codex', profiles: { linux: profile, macos: profile, windows: profile } },
    turn: {}, prompt: 'first', attachments: [], sessionId: null,
    accountEnv: {}, warmProcessMinutes,
    commands() {}, context() {}, log() {},
    emit: { startMessage: () => 'answer', part() {}, delta() {}, complete() {} },
    spawnChild() {
      const emitter = new EventEmitter();
      const stdout = new PassThrough(), stderr = new PassThrough();
      const child = Object.assign(emitter, {
        stdout, stderr,
        stdin: new Writable({ write(chunk, _encoding, done) {
          const { id, method, params } = JSON.parse(chunk.toString());
          if (id === undefined) { done(); return; }
          let result: unknown = {};
          let error: unknown;
          if (method === 'thread/start' || method === 'thread/resume') {
            if (owner !== null && owner !== child) error = { code: -32600, message: 'session already has an active writer' };
            else { owner = child; opened.push(method); result = { thread: { id: 'native-history' } }; }
          }
          if (method === 'turn/start') {
            prompts.push(params.input[0].text);
            result = { turn: { id: `turn-${prompts.length}`, status: 'completed' } };
          }
          stdout.write(`${JSON.stringify(error ? { id, error } : { id, result })}\n`);
          done();
        } }),
        kill() { record.closing = true; return true; },
      }) as unknown as SpawnedChild;
      const record = { child, closing: false, close() {
        if (owner === child) owner = null;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      } };
      children.push(record);
      return child;
    },
  } as unknown as TurnContext;
  const cleanup = () => { driver.shutdown?.(); for (const child of children) child.close(); };
  return { driver, ctx, children, prompts, opened, cleanup };
}

describe('Codex writer lifecycle', () => {
  test('an event wake resumes only after the previous writer closes, keeping the native history', async () => {
    const f = fixture();
    try {
      const first = await f.driver.startTurn(f.ctx).done;
      expect(first.status).toBe('done');
      expect(f.children[0]!.closing).toBe(true);
      const next = f.driver.startTurn({ ...f.ctx, sessionId: first.sessionId, prompt: 'pending event' });
      await drain();
      expect(f.children).toHaveLength(1);
      f.children[0]!.close();
      expect(await next.done).toMatchObject({ status: 'done', sessionId: first.sessionId });
      expect(f.opened).toEqual(['thread/start', 'thread/resume']);
      expect(f.prompts).toEqual(['first', 'pending event']);
    } finally { f.cleanup(); }
  });

  test.each(['setup', 'release'] as const)('%s replacement and preparation wait through an abandoned intermediate session', async source => {
    const f = fixture(1);
    try {
      const first = await f.driver.startTurn(f.ctx).done;
      const resumed = { ...f.ctx, sessionId: first.sessionId };
      if (source === 'release') f.driver.releaseThread?.(f.ctx.thread.id);
      const middle = { ...resumed, thread: { ...resumed.thread, permissionMode: 'bypassPermissions' as const } };
      const preparing = f.driver.prepare!(middle).catch(error => error);
      const last = { ...resumed, thread: { ...resumed.thread, permissionMode: 'plan' as const } };
      const ready = f.driver.prepare!(last);
      await drain();
      expect(f.children).toHaveLength(1);
      f.children[0]!.close();
      await ready;
      await preparing;
      expect(f.children).toHaveLength(2);
      expect(f.opened).toEqual(['thread/start', 'thread/resume']);
      expect((await f.driver.startTurn({ ...last, prompt: 'after setup' }).done).status).toBe('done');
      expect(f.prompts).toEqual(['first', 'after setup']);
    } finally { f.cleanup(); }
  });

  test('stopping a wake waiting on closure sends no prompt and preserves the barrier for the next wake', async () => {
    const f = fixture();
    try {
      const first = await f.driver.startTurn(f.ctx).done;
      const resumed = { ...f.ctx, sessionId: first.sessionId };
      const cancelled = f.driver.startTurn({ ...resumed, prompt: 'cancelled' });
      await drain();
      cancelled.stop();
      await drain();
      expect(await cancelled.done).toMatchObject({ status: 'stopped', sessionId: first.sessionId });
      const next = f.driver.startTurn({ ...resumed, prompt: 'retained event' });
      await drain();
      expect(f.children).toHaveLength(1);
      f.children[0]!.close();
      expect((await next.done).status).toBe('done');
      expect(f.prompts).toEqual(['first', 'retained event']);
    } finally { f.cleanup(); }
  });
});
