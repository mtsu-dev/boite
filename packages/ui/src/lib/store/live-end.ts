import type { Thread, ThreadId } from '@boite/contracts';
import { READING_CACHE_BYTES, READING_CACHE_MESSAGES, messageChars } from '../reading-cache';
import type { StoreContext } from './context';
import type { LiveWeights } from './live-weights.svelte';

/** The message count each open thread was last weighed at, so a delta weighs nothing. */
const weighed = new WeakMap<Thread, number>();

/**
 * The live end of the open thread, followed by the reader, lets its head go
 * once it holds twice what a kept timeline may: a thread watched for a day
 * gains every message its agent writes, and the core keeps them on disk. It
 * keeps the newest messages within the reading cache's bound, so a leave can
 * keep the thread, and their turns; scrolling up reads the rest again through
 * `messagesBefore`. It never lets go of the `near()` newest messages, those the
 * timeline draws within reach of the screen: a song an agent published weighs
 * more than the bound on its own, and every message above it went, the answer
 * on screen became a skeleton and its page, read again, went the same way.
 * Weighed only when a message came in, never on a delta, and never while a
 * page above or below is in flight. Returns how many left.
 */
export function releaseOlder(ctx: StoreContext, threadId: ThreadId, near: () => number = () => 1, weights?: LiveWeights): number {
  const open = ctx.threads.openThread;
  if (!open || open.id !== threadId || ctx.threads.loadingOlder || ctx.positions.loading || (open.messagesAfter ?? null) !== null) return 0;
  const messages = open.messages;
  if (weighed.get(open) === messages.length) return 0;
  weighed.set(open, messages.length);
  if (messages.length <= READING_CACHE_MESSAGES &&
    (weights?.total(messages) ?? messages.reduce((sum, message) => sum + messageChars(message), 0)) <= READING_CACHE_BYTES) return 0;
  let kept = 0, chars = 0;
  for (let at = messages.length - 1; at >= 0 && kept < READING_CACHE_MESSAGES / 2; at--) {
    const message = messages[at]!;
    chars += weights?.message(message) ?? messageChars(message);
    if (kept > 0 && chars * 2 > READING_CACHE_BYTES) break;
    kept++;
  }
  const gone = messages.length - Math.max(kept, near());
  if (gone <= 0) return 0;
  const first = messages[gone]!;
  const turn = open.turns.findIndex((held) => held.id === first.turnId);
  open.messages = messages.slice(gone);
  if (turn > 0) open.turns = open.turns.slice(turn);
  open.messagesBefore = first.id;
  weighed.set(open, open.messages.length);
  return gone;
}
