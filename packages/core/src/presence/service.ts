/**
 * The rich presence of this machine's desktop app: one activity, shown in
 * every chat app listening on a Discord IPC socket here, and kept there while
 * they come and go (docs/internals/presence.md). Several at once on purpose:
 * Discord takes `discord-ipc-0` and a bridge to Fluxer or another app the next
 * free number, and a game that connects to the first socket only reaches one.
 */
import { markFeature, PRESENCE_LINK, PRESENCE_LOGO_ASSET, type PresenceActivity, type PresenceStatus } from '@boite/contracts';
import { existsSync } from 'node:fs';
import { IpcConnection, socketCandidates, socketLabel, type DiscordActivity } from './ipc.ts';

markFeature('boite-feature:discord-presence');

/** Discord takes five updates in twenty seconds: one every four keeps under it. */
export const PRESENCE_PACE_MS = 4_000;
/** How often the sockets are looked for again while an activity is set: a chat app started later shows it within this. */
export const PRESENCE_SCAN_MS = 15_000;

export interface PresenceOptions {
  applicationId: string;
  log(level: 'info' | 'warn', message: string): void;
  /** Where chat apps listen; `socketCandidates()` by default. */
  candidates?: () => string[];
  paceMs?: number;
  scanMs?: number;
}

/** The socket that set the activity: it hears the status, and its close clears the presence. */
export interface PresenceOwner {
  readonly id: string;
  sendEvent(name: 'presence.status', payload: PresenceStatus): void;
  onClose?(callback: () => void): () => void;
}

interface Target {
  connection: IpcConnection;
  user: string | null;
  /** The activity this chat app holds, as sent. */
  sent: string | null;
  /** The chat app answered the last activity without an error: only then is it listed as showing it. */
  shown: boolean;
  lastSent: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function discordActivity(activity: PresenceActivity): DiscordActivity {
  return {
    type: 0,
    details: activity.details,
    ...(activity.state ? { state: activity.state } : {}),
    ...(activity.startedAt ? { timestamps: { start: activity.startedAt } } : {}),
    assets: { large_image: PRESENCE_LOGO_ASSET, large_text: 'Boite' },
    ...(activity.button ? { buttons: [{ label: activity.button, url: PRESENCE_LINK }] } : {}),
  };
}

export class PresenceService {
  readonly #options: Required<Omit<PresenceOptions, 'candidates'>> & { candidates: () => string[] };
  readonly #targets = new Map<string, Target>();
  /** Sockets being opened, so a scan does not open one twice. */
  readonly #opening = new Set<string>();
  #activity: DiscordActivity | null = null;
  #owner: PresenceOwner | null = null;
  #dropOwner: (() => void) | null = null;
  #scanTimer: ReturnType<typeof setInterval> | null = null;
  #scanning: Promise<void> | null = null;
  #closed = false;

  constructor(options: PresenceOptions) {
    this.#options = { paceMs: PRESENCE_PACE_MS, scanMs: PRESENCE_SCAN_MS, candidates: () => socketCandidates(), ...options };
  }

  status(): PresenceStatus {
    return { active: this.#activity !== null, targets: [...this.#targets.values()].filter(t => t.connection.ready && t.shown).map(t => ({ socket: socketLabel(t.connection.path), user: t.user })) };
  }

  /** Sets or clears the activity for `owner`'s socket; answers once the sockets present now were tried. */
  async set(activity: PresenceActivity | null, owner: PresenceOwner): Promise<PresenceStatus> {
    if (this.#closed) return this.status();
    // Only the socket that set it takes it away: another window's clear leaves the desktop app's presence alone.
    if (activity === null) { if (this.#owner === null || this.#owner.id === owner.id) this.#clear(); return this.status(); }
    this.#adopt(owner);
    this.#activity = discordActivity(activity);
    for (const target of this.#targets.values()) this.#pace(target);
    if (this.#scanTimer === null) {
      this.#scanTimer = setInterval(() => void this.#scan(), this.#options.scanMs);
      this.#scanTimer.unref?.();
    }
    await this.#scan();
    return this.status();
  }

  close(): void {
    this.#clear();
    this.#closed = true;
  }

  #adopt(owner: PresenceOwner): void {
    if (this.#owner?.id === owner.id) return;
    this.#dropOwner?.();
    this.#owner = owner;
    // The app that set it is gone: nothing keeps the presence true any more.
    this.#dropOwner = owner.onClose?.(() => { if (this.#owner === owner) this.#clear(); }) ?? null;
  }

  #clear(): void {
    this.#activity = null;
    if (this.#scanTimer !== null) clearInterval(this.#scanTimer);
    this.#scanTimer = null;
    const owner = this.#owner;
    this.#dropOwner?.();
    this.#dropOwner = null;
    this.#owner = null;
    const hadTargets = this.#targets.size > 0;
    // Each chat app drops the activity of a socket that closes; the explicit clear is for those slow to notice.
    for (const target of [...this.#targets.values()]) {
      if (target.timer !== null) clearTimeout(target.timer);
      target.connection.setActivity(null);
      target.connection.close('the presence was cleared');
    }
    this.#targets.clear();
    if (hadTargets) owner?.sendEvent('presence.status', this.status());
  }

  #scan(): Promise<void> {
    if (this.#scanning !== null) return this.#scanning;
    this.#scanning = this.#scanOnce().finally(() => { this.#scanning = null; });
    return this.#scanning;
  }

  async #scanOnce(): Promise<void> {
    if (this.#activity === null) return;
    const windows = process.platform === 'win32';
    const paths = this.#options.candidates().filter(path => !this.#targets.has(path) && !this.#opening.has(path) && (windows || existsSync(path)));
    await Promise.all(paths.map(path => this.#open(path)));
  }

  async #open(path: string): Promise<void> {
    this.#opening.add(path);
    let target: Target | null = null;
    const connection = await IpcConnection.open(path, this.#options.applicationId, {
      ready: (user) => {
        if (target === null) return;
        target.user = user;
        this.#options.log('info', `rich presence: ${socketLabel(path)} answered${user ? ` as ${user}` : ''}`);
        this.#pace(target);
      },
      answered: (refusal) => {
        if (target === null || this.#activity === null) return;
        if (refusal !== null) this.#options.log('warn', `rich presence: ${socketLabel(path)} refused the activity: ${refusal}`);
        const shown = refusal === null;
        if (shown === target.shown) return;
        target.shown = shown;
        this.#owner?.sendEvent('presence.status', this.status());
      },
      closed: (reason) => {
        if (target === null || this.#targets.get(path) !== target) return;
        if (target.timer !== null) clearTimeout(target.timer);
        this.#targets.delete(path);
        if (this.#activity !== null) this.#options.log('info', `rich presence: ${socketLabel(path)} closed: ${reason}`);
        if (target.shown) this.#owner?.sendEvent('presence.status', this.status());
      },
    }).finally(() => this.#opening.delete(path));
    if (connection === null) return;
    // Cleared while the socket opened: it closes without showing anything.
    if (this.#activity === null || this.#closed) { connection.close('the presence was cleared'); return; }
    target = { connection, user: null, sent: null, shown: false, lastSent: 0, timer: null };
    this.#targets.set(path, target);
  }

  /** Sends the activity to one chat app now, or at its next free slot when it had one under `paceMs` ago. */
  #pace(target: Target): void {
    if (!target.connection.ready || target.timer !== null) return;
    const wait = target.lastSent + this.#options.paceMs - Date.now();
    if (wait > 0) {
      target.timer = setTimeout(() => { target.timer = null; this.#pace(target); }, wait);
      target.timer.unref?.();
      return;
    }
    const text = JSON.stringify(this.#activity);
    if (this.#activity === null || text === target.sent) return;
    target.connection.setActivity(this.#activity);
    target.sent = text;
    target.lastSent = Date.now();
  }
}
