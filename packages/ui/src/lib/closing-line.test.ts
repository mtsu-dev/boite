import { expect, test } from 'vitest';
import type { Message, MessagePart, Turn } from '@boite/contracts';
import { closingLine } from './closing-line';

const turn = (id: string, extra: Partial<Turn> = {}) =>
  ({ id, status: 'done', queuedAt: 0, startedAt: 1_000, finishedAt: 253_000, execution: undefined, ...extra }) as Turn;
const edit = (path: string, oldText: string, newText: string) =>
  ({ type: 'tool', toolId: path, name: 'Edit', input: {}, status: 'done', documents: [{ kind: 'diff', path, oldText, newText }] }) as MessagePart;
const answer = (turnId: string, parts: MessagePart[]) => ({ id: `m-${turnId}`, role: 'assistant', turnId, parts }) as unknown as Message;

test('a finished thread ends on how long it worked and what its last turn changed', () => {
  const messages = [answer('t1', [edit('C:\\w\\a.ts', 'one\n', 'one\ntwo\n'), edit('C:\\w\\b.ts', 'x\n', '')])];
  expect(closingLine([turn('t1')], messages, 'C:\\w')).toBe('Done · Worked for 4m 12s · 2 files, +1 −1');
  // Nothing changed: the time alone.
  expect(closingLine([turn('t1')], [answer('t1', [])], 'C:\\w')).toBe('Done · Worked for 4m 12s');
});

test('no closing line while a turn waits or runs, after a stop or a failure, or before any turn', () => {
  expect(closingLine([turn('t1'), turn('t2', { status: 'running', finishedAt: null })], [], 'C:\\w')).toBeNull();
  expect(closingLine([turn('t1'), turn('t2', { status: 'queued', startedAt: null, finishedAt: null })], [], 'C:\\w')).toBeNull();
  expect(closingLine([turn('t1', { status: 'stopped' })], [], 'C:\\w')).toBeNull();
  expect(closingLine([turn('t1', { status: 'error' })], [], 'C:\\w')).toBeNull();
  expect(closingLine([], [], 'C:\\w')).toBeNull();
});
