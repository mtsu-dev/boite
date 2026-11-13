/**
 * The machine that runs the core stays awake while agents work: a turn
 * running or waiting for a scheduler slot holds the platform's sleep
 * inhibitor (`ProcessPlatform.keepAwake`), whoever is connected and whether
 * or not a window is open. A thread waiting for the user (an approval, a
 * question card) holds nothing: the machine may sleep until they come back.
 *
 * The hold is taken on the first working thread and given back
 * `RELEASE_AFTER_MS` after the last one rests, so turns that follow each
 * other keep one hold. It is given back at once when the `keepAwake` setting
 * goes off and when the core closes. A machine with no inhibitor, or one that
 * refuses it, is logged once; the setting toggled on again retries.
 */
import type { RpcEventName } from '@boite/contracts';
import type { Core } from './core.ts';
import type { ProcessPlatform } from './platform/types.ts';

/** How long after the last working thread the hold is given back. */
export const RELEASE_AFTER_MS = 5_000;
/** Thread and turn events come in bursts: one check serves them. */
const SETTLE_MS = 100;

const WATCHED: ReadonlySet<RpcEventName> = new Set(['thread.created', 'thread.updated', 'thread.removed', 'turn.started', 'turn.finished', 'settings.updated']);

export type KeepAwakeHold = NonNullable<ProcessPlatform['keepAwake']>;

export class KeepAwake {
  readonly #core: Core;
  readonly #hold: KeepAwakeHold | null;
  readonly #releaseAfterMs: number;
  readonly #unsubscribe: () => void;
  #release: (() => void) | null = null;
  #check: ReturnType<typeof setTimeout> | null = null;
  #rest: ReturnType<typeof setTimeout> | null = null;
  /** The machine refused or has no inhibitor: no new attempt until the setting changes. */
  #unavailable = false;
  #enabled: boolean;
  #closed = false;

  /** `hold` null: this core holds nothing and says nothing (`BOITE_KEEP_AWAKE=0`, a platform without the call). */
  constructor(core: Core, hold: KeepAwakeHold | null, releaseAfterMs = RELEASE_AFTER_MS) {
    this.#core = core;
    this.#hold = hold;
    this.#releaseAfterMs = releaseAfterMs;
    this.#enabled = core.settings.get().keepAwake !== false;
    this.#unsubscribe = hold === null ? () => {} : core.bus.onCommitted(name => { if (WATCHED.has(name)) this.#schedule(); });
    // Turns a previous core left queued start without an event this listener saw.
    if (hold !== null) this.#schedule();
  }

  /** Whether the inhibitor is held now. */
  get held(): boolean { return this.#release !== null; }

  /** A turn runs or waits for a slot; `waiting` is a thread waiting for the user. */
  #working(): boolean {
    return this.#core.journal.db.query("SELECT 1 FROM threads WHERE status IN ('queued', 'running') LIMIT 1").get() !== null;
  }

  #schedule(): void {
    if (this.#closed || this.#check !== null) return;
    this.#check = setTimeout(() => { this.#check = null; this.#apply(); }, SETTLE_MS);
    this.#check.unref?.();
  }

  #apply(): void {
    if (this.#closed || this.#hold === null) return;
    const enabled = this.#core.settings.get().keepAwake !== false;
    if (enabled !== this.#enabled) { this.#enabled = enabled; this.#unavailable = false; }
    if (!enabled) return this.#giveBack();
    if (!this.#working()) {
      if (this.#release !== null && this.#rest === null) {
        this.#rest = setTimeout(() => { this.#rest = null; if (!this.#working()) this.#giveBack(); }, this.#releaseAfterMs);
        this.#rest.unref?.();
      }
      return;
    }
    if (this.#rest !== null) { clearTimeout(this.#rest); this.#rest = null; }
    if (this.#release !== null || this.#unavailable) return;
    let lost = false;
    // A helper that cannot start reports inside the call, before there is anything to give back.
    let release: (() => void) | null = null;
    release = this.#hold(reason => {
      lost = true;
      if (release !== null && this.#release === release) this.#release = null;
      this.#lost(reason);
    });
    if (release === null) return this.#lost('this machine has no sleep inhibitor Boite can hold');
    if (!lost) this.#release = release;
  }

  #lost(reason: string): void {
    if (this.#unavailable || this.#closed) return;
    this.#unavailable = true;
    this.#core.logs.warn(`The machine is not kept awake while agents work: ${reason}`, { source: 'process', event: 'keepAwake.unavailable' });
  }

  #giveBack(): void {
    if (this.#rest !== null) { clearTimeout(this.#rest); this.#rest = null; }
    const release = this.#release;
    this.#release = null;
    release?.();
  }

  close(): void {
    this.#closed = true;
    this.#unsubscribe();
    if (this.#check !== null) { clearTimeout(this.#check); this.#check = null; }
    this.#giveBack();
  }
}
