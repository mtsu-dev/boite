/*
 * What time it is at another core, for the date this core signs on what it
 * sends there.
 *
 * A signed request is taken within a minute of the receiver's clock, so that
 * one recorded and sent again goes nowhere. Two machines whose clocks differ
 * by more than that (a PC with automatic time off, a dual boot, a dead RTC
 * battery) then refuse everything from each other, for ever, in words that
 * name no clock. The receiver cannot bend: a date it accepts from the past is
 * a replay it accepts. The sender can: the receiver answers a signed request
 * dated wrong with its own time, under its key and bound to that request, and
 * the sender dates what it sends there by that clock from then on.
 *
 * Kept in memory only: a refusal teaches it again, and a clock set right
 * meanwhile is learnt the same way.
 */
import { unavailable } from './errors.ts';

/** What a core answers a signed request whose date is not its own time: `error` beside `now`, its clock. */
export const CLOCK_ERROR = 'clock';
/** A difference under this is the network's delay, not a clock: nothing to learn, and no reason to ask again. */
const NOTICEABLE_MS = 5_000;

/** The receiver's clock, read off its signed refusal of a request dated wrong. */
export class ClockRefusal extends Error {
  constructor(readonly now: number) { super('the peer\'s clock differs from this machine\'s'); }
}

export class PeerClocks {
  readonly #offsets = new Map<string, number>();

  /** The time to sign on a request to `coreId`: this machine's, moved by what that core said of its own. */
  now(coreId: string): number { return Date.now() + (this.#offsets.get(coreId) ?? 0); }

  /** How far `coreId`'s clock is from this one's, in milliseconds; 0 until it said. */
  offset(coreId: string): number { return this.#offsets.get(coreId) ?? 0; }

  /**
   * Keeps `theirNow`, read off a refusal `coreId` signed. False when it
   * teaches nothing new: asking again would be refused the same way.
   */
  learn(coreId: string, theirNow: unknown): boolean {
    if (typeof theirNow !== 'number' || !Number.isSafeInteger(theirNow)) return false;
    const offset = theirNow - Date.now();
    if (Math.abs(offset - this.offset(coreId)) < NOTICEABLE_MS) return false;
    if (Math.abs(offset) < NOTICEABLE_MS) this.#offsets.delete(coreId); else this.#offsets.set(coreId, offset);
    return true;
  }

  forget(coreId: string): void { this.#offsets.delete(coreId); }
}

/** "3 minutes", "2 hours": how far apart two clocks are, for a sentence the owner reads. */
export function clockGap(offsetMs: number): string {
  const seconds = Math.round(Math.abs(offsetMs) / 1000);
  if (seconds < 120) return `${seconds} seconds`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

/**
 * `ask`, and once more when the peer refused its date and said its own time:
 * the second one is dated by that clock. `note` takes the line for the log.
 */
export async function datedByPeer<T>(clocks: PeerClocks, peer: { coreId: string; name: string }, note: (message: string) => void, ask: () => Promise<T>): Promise<T> {
  try { return await ask(); }
  catch (error) {
    if (!(error instanceof ClockRefusal)) throw error;
    const apart = `${peer.name}'s clock and this machine's are ${clockGap(error.now - Date.now())} apart`;
    if (!clocks.learn(peer.coreId, error.now)) throw unavailable(`${apart}, and it refuses requests dated by its own clock too; turn automatic time on on both machines`);
    note(`${apart}; requests to it are dated by its clock from now on`);
    try { return await ask(); }
    catch (again) { throw again instanceof ClockRefusal ? unavailable(`${apart}; turn automatic time on on both machines`) : again; }
  }
}
