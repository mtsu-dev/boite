import { expect, test } from 'bun:test';
import { IdleTimer } from '../src/drivers/idle-timer.ts';

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('an idle session ends at its deadline, once, and a second arm replaces the first', async () => {
  let expired = 0;
  const idle = new IdleTimer(() => { expired += 1; });
  idle.arm(10);
  idle.arm(40);
  await after(25);
  // The first deadline was replaced, not left to fire beside the second.
  expect(expired).toBe(0);
  await after(40);
  expect(expired).toBe(1);
});

test('a cleared idle timer never fires and can be armed again', async () => {
  let expired = 0;
  const idle = new IdleTimer(() => { expired += 1; });
  idle.arm(10);
  idle.clear();
  idle.clear();
  await after(30);
  expect(expired).toBe(0);
  idle.arm(5);
  await after(30);
  expect(expired).toBe(1);
});
