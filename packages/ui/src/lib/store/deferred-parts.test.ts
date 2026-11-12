import { expect, test, vi } from 'vitest';
import { RpcErrorCode, type Message, type Thread } from '@boite/contracts';
import { RpcFailure } from '../client';
import { DeferredParts } from './deferred-parts';
import type { StoreContext } from './context';
import type { ToolPart } from '../tool-groups';

function fixture() {
  const compact: ToolPart = { type: 'tool', toolId: 'tool', name: 'Write', status: 'done', input: { file_path: 'a.ts' }, inputDeferred: true,
    output: 'preview', outputDeferred: true, documents: [{ kind: 'diff', path: 'a.ts', oldText: '', newText: '' }], documentsDeferred: true };
  const full: ToolPart = { ...compact, input: { file_path: 'a.ts', content: 'whole input' }, output: 'whole output',
    documents: [{ kind: 'diff', path: 'a.ts', oldText: 'old', newText: 'new' }] };
  const message = { id: 'message', parts: [compact] } as Message;
  const call = vi.fn(async (_method: string, _params: unknown): Promise<unknown> => ({ part: full }));
  const ctx = { client: { call }, clientGeneration: 0, store: { core: { features: { deferredToolParts: true } } } } as unknown as StoreContext;
  const snapshots = { messages: () => [message], threadSnapshots: () => [{ messages: [message] } as Thread] };
  return { parts: new DeferredParts(ctx, snapshots), compact, full, call, ctx };
}

test('last disclosure release restores only fetched fields, keeps stubs and refetches on reopen', async () => {
  const { parts, compact, call } = fixture();
  const first = parts.acquireToolOutput('thread', 'message', 'tool');
  await first.ready;
  expect(compact.output).toBe('whole output');
  expect(compact.inputDeferred).toBeUndefined();
  const second = parts.acquireToolOutput('thread', 'message', 'tool');
  await second.ready;
  expect(call).toHaveBeenCalledTimes(1);
  first.release(); first.release();
  expect(compact.output).toBe('whole output');
  second.release();
  expect(compact).toMatchObject({ output: 'preview', outputDeferred: true, input: { file_path: 'a.ts' }, inputDeferred: true,
    documents: [{ kind: 'diff', path: 'a.ts', oldText: '', newText: '' }], documentsDeferred: true });
  const reopened = parts.acquireToolOutput('thread', 'message', 'tool');
  await reopened.ready;
  expect(call).toHaveBeenCalledTimes(2);
  expect(compact.output).toBe('whole output');
  reopened.release();
});

test('close during fetch and a stale release cannot hydrate or release a later visit', async () => {
  const { parts, compact, full, call } = fixture();
  let finish!: (value: { part: ToolPart }) => void;
  call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = parts.acquireToolOutput('thread', 'message', 'tool');
  old.release();
  finish({ part: full }); await old.ready;
  expect(compact.output).toBe('preview');
  const current = parts.acquireToolOutput('thread', 'message', 'tool');
  await current.ready;
  old.release();
  expect(compact.output).toBe('whole output');
  parts.leave();
  expect(compact.output).toBe('preview');
  const next = parts.acquireToolOutput('thread', 'message', 'tool');
  await next.ready;
  current.release();
  expect(compact.output).toBe('whole output');
  next.release();
});

test('reopening during the same fetch shares it and releasing never overwrites live state', async () => {
  const { parts, compact, full, call } = fixture();
  let finish!: (value: { part: ToolPart }) => void;
  call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = parts.acquireToolOutput('thread', 'message', 'tool'); old.release();
  const reopened = parts.acquireToolOutput('thread', 'message', 'tool');
  finish({ part: full }); await reopened.ready;
  expect(call).toHaveBeenCalledTimes(1);
  compact.output = 'new provider output';
  reopened.release();
  expect(compact.output).toBe('new provider output');
  expect(compact.outputDeferred).toBeUndefined();
});

test('a previous visit still loading cannot hydrate or unpin the new visit', async () => {
  const { parts, compact, full, call } = fixture();
  let finish!: (value: { part: ToolPart }) => void;
  call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = parts.acquireToolOutput('thread', 'message', 'tool');
  parts.leave();
  const current = parts.acquireToolOutput('thread', 'message', 'tool'); await current.ready;
  finish({ part: { ...full, output: 'stale' } }); await old.ready;
  old.release();
  expect(compact.output).toBe('whole output');
  current.release();
  expect(compact.output).toBe('preview');
});

test('legacy full-message fallback remains releasable and running provider state is retained', async () => {
  const { parts, compact, full, call } = fixture();
  call.mockImplementation(async method => {
    if (method === 'messages.toolPart') throw new RpcFailure({ code: RpcErrorCode.MethodNotFound, message: 'old core' });
    return { messages: [{ id: 'message', parts: [full] }] };
  });
  const legacy = parts.acquireToolOutput('thread', 'message', 'tool'); await legacy.ready;
  expect(compact.output).toBe('whole output');
  legacy.release();
  expect(compact.outputDeferred).toBe(true);
  expect(compact.input).toEqual({ file_path: 'a.ts' });
  const live = parts.acquireToolOutput('thread', 'message', 'tool'); await live.ready;
  compact.status = 'running';
  live.release();
  expect(compact.output).toBe('whole output');
  expect(compact.input).toEqual(full.input);
  expect(compact.documents).toEqual(full.documents);
  expect(compact.outputDeferred).toBeUndefined();
});

test.each(['leased-first', 'legacy-first'])('a legacy reader survives the last lease closing during a shared fetch (%s)', async order => {
  const { parts, compact, full, call } = fixture();
  let finish!: (value: { part: ToolPart }) => void;
  call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const legacyFirst = order === 'legacy-first' ? parts.toolOutput('thread', 'message', 'tool') : undefined;
  const card = parts.acquireToolOutput('thread', 'message', 'tool');
  const legacy = legacyFirst ?? parts.toolOutput('thread', 'message', 'tool');
  card.release(); finish({ part: full }); await legacy;
  expect(compact.input).toEqual(full.input);
  expect(compact.documents).toEqual(full.documents);
  expect(compact.documentsDeferred).toBeUndefined();
  const reopened = parts.acquireToolOutput('thread', 'message', 'tool'); await reopened.ready;
  reopened.release();
  expect(compact.output).toBe(full.output);
  expect(call).toHaveBeenCalledTimes(1);
});
