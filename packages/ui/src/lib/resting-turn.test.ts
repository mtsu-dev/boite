import { expect, test } from 'vitest';
import type { Turn } from '@boite/contracts';
import { restingTurn } from './resting-turn';

const turn = (id: string, extra: Partial<Turn> = {}) =>
  ({ id, status: 'done', queuedAt: 0, startedAt: 1_000, finishedAt: 253_000, execution: undefined, ...extra }) as Turn;

test('a finished thread rests on its last turn, a cache ping after it included', () => {
  expect(restingTurn([turn('t1'), turn('t2')])).toBe('t2');
  expect(restingTurn([turn('t1'), turn('ping', { execution: { operation: 'keepalive' } as Turn['execution'] })])).toBe('t1');
});

test('no resting turn while a turn waits or runs, after a stop or a failure, or before any turn', () => {
  expect(restingTurn([turn('t1'), turn('t2', { status: 'running', finishedAt: null })])).toBeNull();
  expect(restingTurn([turn('t1'), turn('t2', { status: 'queued', startedAt: null, finishedAt: null })])).toBeNull();
  expect(restingTurn([turn('t1', { status: 'stopped' })])).toBeNull();
  expect(restingTurn([turn('t1', { status: 'error' })])).toBeNull();
  expect(restingTurn([])).toBeNull();
});
