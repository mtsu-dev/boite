import { expect, test } from 'vitest';
import type { PullRequestWatch } from '@boite/contracts';
import { pullRequestWait } from './pull-request-watch';

const seen = (running: number) => ({ checkedAt: 1, head: 'abc1234', base: 'main', checks: { total: 3, running, failed: 0 }, conflicting: false, queue: null });
const watch = (number: number, running: number, paused: boolean) => ({
  number, since: 1, seen: seen(running), ...(paused ? { paused: { reason: 'rate-limit', until: 2 } } : {}),
}) as unknown as PullRequestWatch;

test('a paused watch counts as a wait only while its pull request still has work to follow', () => {
  // Checks settled, then GitHub's limit paused the watch: the thread waits for nothing.
  expect(pullRequestWait([watch(1, 0, true)]).paused).toBeUndefined();
  // Among several paused watches the one still waiting is the one shown.
  expect(pullRequestWait([watch(1, 0, true), watch(2, 1, true)]).paused?.number).toBe(2);
  // A live watch with running checks hides every pause.
  expect(pullRequestWait([watch(1, 1, true), watch(2, 1, false)])).toMatchObject({ active: [{ number: 2 }], paused: undefined });
});
