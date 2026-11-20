import { expect, test } from 'bun:test';
import { TabsJoining } from '../src/browser/joining.ts';

const THREAD = 'thread-1';
/** Whether `windows` is still waiting `ms` after it began. */
const waitsFor = async (joining: TabsJoining, ms: number) => {
  let done = false;
  const waited = joining.windows(THREAD).then(value => { done = true; return value; });
  await Bun.sleep(ms);
  return { still: !done, waited };
};

test('a window its page announced is waited for until Chrome announces it too, in either order', async () => {
  // Page.windowOpen first, targetCreated late (a slow runner): the command waits for the attach.
  const late = new TabsJoining();
  late.announce(THREAD, 'opener');
  const first = await waitsFor(late, 50);
  expect(first.still).toBe(true);
  let attached = false;
  void late.window(THREAD, async () => { await Bun.sleep(30); attached = true; });
  late.adopted('opener');
  expect(await first.waited).toBe(true);
  expect(attached).toBe(true);

  // targetCreated first: the announcement after it holds nothing once that attach ended.
  const early = new TabsJoining();
  await early.window(THREAD, async () => {});
  early.adopted('opener');
  early.announce(THREAD, 'opener');
  expect(await early.windows(THREAD)).toBe(false);

  // The opener closed before Chrome announced its window: nothing is left to wait for.
  const gone = new TabsJoining();
  gone.announce(THREAD, 'opener');
  const pending = await waitsFor(gone, 20);
  expect(pending.still).toBe(true);
  gone.forget('opener');
  expect(await pending.waited).toBe(true);
  expect(await gone.windows(THREAD)).toBe(false);
});
