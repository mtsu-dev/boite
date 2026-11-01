import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveEnded, moveRequestId } from './agent-move';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('moveRequestId', () => {
  it('keeps one id per move while storage refuses to write, and a new one after the move ends', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const first = moveRequestId('m1', 'agent-1', 'm2');
    expect(moveRequestId('m1', 'agent-1', 'm2')).toBe(first);
    expect(moveRequestId('m1', 'agent-1', 'm3')).not.toBe(first);
    moveEnded('m1', 'agent-1', 'm2');
    expect(moveRequestId('m1', 'agent-1', 'm2')).not.toBe(first);
  });
});
