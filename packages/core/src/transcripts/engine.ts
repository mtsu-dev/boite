/*
 * What applies the transcript storage setting: it reads the provider sessions
 * on disk and the journal, plans the steps a policy takes today, and either
 * reports them (`preview`, which changes nothing) or runs them one at a time.
 *
 *   an open conversation left idle   its provider sessions are archived and
 *                                    their files removed; the journal keeps it
 *                                    whole, and its next turn replays the
 *                                    history on a fresh session
 *   a deleted family, compacted      each thread is archived from the journal
 *                                    and from its provider sessions, then the
 *                                    family leaves the journal with its usage kept
 *   a deleted family, erased         journal, provider files and archive go;
 *                                    its turns stay in the archive's index
 *   images of a compacted family     the blobs it alone refers to go
 *
 * A provider file is removed only after its archive was written, read back
 * and compared (`session.ts`), only if nothing wrote to it meanwhile, and one
 * listed file at a time (`locate.ts`). A deleted family leaves the journal
 * only once every one of its sessions is archived: one that is being read or
 * was written since the scan puts the family off to the next pass. A pass
 * stops as soon as the setting it was planned for changes.
 * With no mode picked this module does nothing: the deletion delay of before
 * (`threads/deletion-retention.ts`) stays in charge.
 */

import { rm } from 'node:fs/promises';
import type { ArchivedFailure, ArchivedTranscript, TranscriptPolicy, TranscriptPreview, TranscriptProgress } from '@boite/contracts';
import { DEFAULT_THREAD_DELETION_RETENTION_DAYS, TRANSCRIPT_READ_MAX_BYTES, TRANSCRIPT_READ_MAX_RECORDS, transcriptPolicy } from '@boite/contracts';
import { ownIsolationDir } from '../accounts.ts';
import type { Core } from '../core.ts';
import { messageOf, refused } from '../errors.ts';
import { sessionReferenced } from '../threads/native-sessions.ts';
import { transcriptJob } from '../transcript-jobs.ts';
import type { TranscriptReply } from './jobs.ts';
import { removeSession, scanSessions, unchanged, type RawSession } from './locate.ts';
import { readArchive, type ArchiveResult, type SessionResult, type TranscriptSource } from './session.ts';
import { TranscriptStore, type ArchivedThread } from './store.ts';

const DAY_MS = 86_400_000;
/** A pass an hour: nothing here is due to the minute. */
const PASS_MS = 3_600_000;
/** What a preview may read to measure how much compaction keeps. */
const SAMPLE_FILES = 6;
const SAMPLE_FILE_MAX = 32 << 20;
const SAMPLE_BYTES = 64 << 20;
/** How long a scan of the disk and a measured ratio answer the next previews. */
const SCAN_FRESH_MS = 60_000;
const RATIO_FRESH_MS = PASS_MS;
/** Statuses under which no agent holds the thread's session. */
const QUIET = new Set(['idle', 'error']);

interface ThreadInfo {
  id: string;
  title: string;
  cwd: string | null;
  provider: string | null;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  status: string;
  incognito: boolean;
  /** The deleted family the thread belongs to, and when its root was deleted. */
  rootId: string | null;
  deletedAt: number | null;
}

type Step =
  | { kind: 'compact-live'; threadId: string; sessions: RawSession[]; bytes: number }
  | { kind: 'compact-deleted'; rootId: string; deletedAt: number; threads: { id: string; sessions: RawSession[] }[]; bytes: number; keepImages: boolean }
  | { kind: 'erase-deleted'; rootId: string; deletedAt: number; threadIds: string[]; sessions: RawSession[]; bytes: number }
  | { kind: 'erase-archived'; threadId: string; bytes: number }
  | { kind: 'images'; threadId: string; bytes: number; count: number };

interface Plan {
  steps: Step[];
  /** Every provider session on disk, and those no thread names in directories Boite made. */
  rawBytes: number;
  raws: RawSession[];
  unlinked: RawSession[];
}

const idle = (): TranscriptProgress => ({ running: false, compacted: 0, erased: 0, freedBytes: 0, remaining: 0, lastError: null, finishedAt: null });
const due = (days: number | null, since: number, now: number): boolean => days !== null && now - since >= days * DAY_MS;
const pause = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

export class Transcripts {
  readonly store: TranscriptStore;
  readonly #core: Core;
  #progress = idle();
  #pass: Promise<void> | null = null;
  #stopped = false;
  #scan: { at: number; raws: Map<string, RawSession> } | null = null;
  #ratio: { at: number; value: number | null } | null = null;
  /** The policy the pass under way was planned for; null when it follows none. */
  #planned: string | null = null;

  constructor(core: Core) {
    this.#core = core;
    this.store = new TranscriptStore(core.dataDir);
  }

  /** The delays in force, or null while no mode was ever picked. */
  policy(): TranscriptPolicy | null {
    const settings = this.#core.settings.get();
    if (settings.transcriptStorage === undefined) return null;
    return transcriptPolicy(settings.transcriptStorage, settings.threadDeletionRetentionDays ?? DEFAULT_THREAD_DELETION_RETENTION_DAYS);
  }

  progress(): TranscriptProgress { return { ...this.#progress }; }

  /** Runs a pass at startup, every hour and when the setting changes. Resolves the stop once the pass under way ended. */
  start(everyMs = PASS_MS): () => Promise<void> {
    const pass = (): void => { void this.run(); };
    const startup = setTimeout(pass, 120_000);
    const timer = setInterval(pass, everyMs);
    startup.unref();
    timer.unref();
    let mode = JSON.stringify(this.#core.settings.get().transcriptStorage);
    const off = this.#core.bus.onCommitted(name => {
      if (name !== 'settings.updated') return;
      const next = JSON.stringify(this.#core.settings.get().transcriptStorage);
      if (next === mode) return;
      mode = next;
      pass();
    });
    return async () => {
      this.#stopped = true;
      clearTimeout(startup);
      clearInterval(timer);
      off();
      await this.#pass;
      this.store.close();
    };
  }

  // -- reading the disk and the journal --------------------------------------

  #roots(): { dir: string; source: TranscriptSource; own: boolean }[] {
    const roots = new Map<string, { dir: string; source: TranscriptSource; own: boolean }>();
    for (const account of this.#core.accounts.list()) {
      const provider = this.#core.providers.get(account.providerId);
      const source = provider?.protocol === 'claude-sdk' ? 'claude' : provider?.protocol === 'codex-appserver' ? 'codex' : null;
      if (provider === undefined || source === null) continue;
      const dir = account.isolationDir ?? this.#core.accounts.defaultLocation(provider);
      if (dir === null) continue;
      roots.set(`${source}\0${dir}`, { dir, source, own: ownIsolationDir(this.#core.dataDir, account) !== null });
    }
    return [...roots.values()];
  }

  async #sessions(fresh: boolean): Promise<Map<string, RawSession>> {
    if (!fresh && this.#scan !== null && Date.now() - this.#scan.at < SCAN_FRESH_MS) return this.#scan.raws;
    const raws = new Map<string, RawSession>();
    for (const root of this.#roots()) await scanSessions(root.dir, root.source, root.own, raws);
    this.#scan = { at: Date.now(), raws };
    return raws;
  }

  #threads(only?: string): Map<string, ThreadInfo> {
    const rows = this.#core.journal.db.query(`SELECT t.id, t.title, t.cwd, t.provider_id AS provider, t.model, t.created_at AS createdAt, t.updated_at AS updatedAt, t.status, t.incognito,
        d.root_id AS rootId, (SELECT r.deleted_at FROM thread_deletions r WHERE r.thread_id = d.root_id) AS deletedAt
      FROM threads t LEFT JOIN thread_deletions d ON d.thread_id = t.id WHERE ?1 IS NULL OR t.id = ?1`).all(only ?? null) as (Omit<ThreadInfo, 'incognito'> & { incognito: number })[];
    return new Map(rows.map(row => [row.id, { ...row, incognito: row.incognito === 1, deletedAt: row.rootId === null ? null : row.deletedAt ?? row.updatedAt }]));
  }

  async #plan(policy: TranscriptPolicy, now: number, fresh: boolean): Promise<Plan> {
    const raws = await this.#sessions(fresh);
    const { named } = await transcriptJob<Extract<TranscriptReply, { named: unknown }>>({ named: this.#core.journal.db.filename }, this.#core.journal.db);
    const threads = this.#threads();
    const owners = new Map<string, ThreadInfo[]>();
    for (const { threadId, sessionId } of named) {
      const thread = threads.get(threadId);
      if (thread !== undefined) owners.set(sessionId, [...(owners.get(sessionId) ?? []), thread]);
    }
    const steps: Step[] = [];
    const unlinked: RawSession[] = [];
    const live = new Map<string, RawSession[]>();
    const deleted = new Map<string, RawSession[]>();
    const idleBefore = policy.idleCompactDays === null ? null : now - policy.idleCompactDays * DAY_MS;
    let rawBytes = 0;
    for (const raw of raws.values()) {
      rawBytes += raw.bytes;
      const naming = owners.get(raw.id);
      if (naming === undefined) {
        if (raw.own) unlinked.push(raw);
        continue;
      }
      const open = naming.filter(thread => thread.rootId === null);
      if (open.length === 0) {
        deleted.set(naming[0]!.id, [...(deleted.get(naming[0]!.id) ?? []), raw]);
      } else if (idleBefore !== null && raw.modifiedAt <= idleBefore && open.every(thread => QUIET.has(thread.status) && !thread.incognito && thread.updatedAt <= idleBefore)) {
        live.set(open[0]!.id, [...(live.get(open[0]!.id) ?? []), raw]);
      }
    }
    for (const [threadId, sessions] of live) steps.push({ kind: 'compact-live', threadId, sessions, bytes: sessions.reduce((sum, raw) => sum + raw.bytes, 0) });

    const families = new Map<string, ThreadInfo[]>();
    for (const thread of threads.values()) if (thread.rootId !== null) families.set(thread.rootId, [...(families.get(thread.rootId) ?? []), thread]);
    for (const [rootId, members] of families) {
      const deletedAt = members[0]!.deletedAt!;
      const sessions = members.flatMap(thread => deleted.get(thread.id) ?? []);
      const bytes = sessions.reduce((sum, raw) => sum + raw.bytes, 0);
      if (due(policy.deletedEraseDays, deletedAt, now)) {
        const archived = members.reduce((sum, thread) => { const held = this.store.threadBytes(thread.id); return sum + held.records + held.images + held.others; }, 0);
        steps.push({ kind: 'erase-deleted', rootId, deletedAt, threadIds: members.map(thread => thread.id), sessions, bytes: bytes + archived });
      } else if (due(policy.deletedCompactDays, deletedAt, now)) {
        steps.push({
          kind: 'compact-deleted', rootId, deletedAt, bytes, keepImages: !due(policy.imagesEraseDays, deletedAt, now),
          threads: members.map(thread => ({ id: thread.id, sessions: deleted.get(thread.id) ?? [] })),
        });
      }
    }
    for (const thread of this.store.deleted()) {
      // A family still in the journal is handled above, with its rows.
      if (threads.has(thread.id)) continue;
      const held = this.store.threadBytes(thread.id);
      if (due(policy.deletedEraseDays, thread.deletedAt, now)) steps.push({ kind: 'erase-archived', threadId: thread.id, bytes: held.records + held.images + held.others });
      else if (thread.imagesErasedAt === null && held.imageCount > 0 && due(policy.imagesEraseDays, thread.deletedAt, now)) steps.push({ kind: 'images', threadId: thread.id, bytes: held.images, count: held.imageCount });
    }
    return { steps, rawBytes, raws: [...raws.values()], unlinked };
  }

  /** The share of its bytes a provider session keeps once archived, measured on some of this machine's own. */
  async #keptRatio(raws: readonly RawSession[]): Promise<number | null> {
    if (this.#ratio !== null && Date.now() - this.#ratio.at < RATIO_FRESH_MS) return this.#ratio.value;
    const fit = raws.filter(raw => raw.bytes > 0 && raw.bytes <= SAMPLE_FILE_MAX).sort((a, b) => b.bytes - a.bytes);
    const stride = Math.max(1, Math.floor(fit.length / SAMPLE_FILES));
    let read = 0;
    let kept = 0;
    let budget = SAMPLE_BYTES;
    for (let index = 0; index < fit.length && budget > 0 && !this.#stopped; index += stride) {
      const raw = fit[index]!;
      if (raw.bytes > budget) continue;
      budget -= raw.bytes;
      try {
        const { session } = await this.#measure(raw);
        read += session.rawBytes;
        kept += session.bytes + session.blobs.reduce((sum, blob) => sum + blob.stored, 0);
      } catch { /* A file that went or cannot be read is no sample. */ }
    }
    const value = read === 0 ? null : Math.min(1, kept / read);
    this.#ratio = { at: Date.now(), value };
    return value;
  }

  #measure(raw: RawSession): Promise<{ session: SessionResult }> {
    return transcriptJob({ transcript: { source: raw.source, files: raw.files, toolResults: raw.toolResults, out: null, blobs: null, keepBlobs: true } });
  }

  /** What `policy` would do right now. Reads the disk and the journal, writes nothing. */
  async preview(policy: TranscriptPolicy): Promise<TranscriptPreview> {
    const plan = await this.#plan(policy, Date.now(), false);
    const compact = { threads: 0, bytes: 0 };
    const erase = { threads: 0, bytes: 0 };
    const images = { count: 0, bytes: 0 };
    for (const step of plan.steps) {
      if (step.kind === 'compact-live') { compact.threads += 1; compact.bytes += step.bytes; }
      else if (step.kind === 'compact-deleted') { compact.threads += step.threads.length; compact.bytes += step.bytes; }
      else if (step.kind === 'erase-deleted') { erase.threads += step.threadIds.length; erase.bytes += step.bytes; }
      else if (step.kind === 'erase-archived') { erase.threads += 1; erase.bytes += step.bytes; }
      else { images.count += step.count; images.bytes += step.bytes; }
    }
    const keptRatio = await this.#keptRatio(plan.raws);
    const archiveBytes = this.store.totalBytes();
    return {
      policy, totalBytes: plan.rawBytes + archiveBytes, archiveBytes, compact, erase, images, keptRatio,
      freedBytes: Math.round(erase.bytes + images.bytes + (keptRatio === null ? 0 : compact.bytes * (1 - keptRatio))),
      unlinked: { sessions: plan.unlinked.length, bytes: plan.unlinked.reduce((sum, raw) => sum + raw.bytes, 0) },
    };
  }

  // -- applying ---------------------------------------------------------------

  /** Applies the setting once. Does nothing while no mode was picked, and waits for a pass already under way. */
  run(): Promise<void> {
    return this.#exclusive(async () => {
      const policy = this.policy();
      if (policy === null) return;
      const plan = await this.#plan(policy, Date.now(), true);
      this.#planned = JSON.stringify(policy);
      try { await this.#apply(plan.steps); } finally { this.#planned = null; }
    });
  }

  /**
   * Archives the provider sessions no thread names, left alone for `days`, in
   * the directories Boite made for its accounts. They are never erased: each
   * is filed under `session:<id>` and stays readable.
   */
  compactUnlinked(days: number): TranscriptProgress {
    if (!Number.isInteger(days) || days < 0) throw refused('days must be a whole number of days, 0 or more', { field: 'days' });
    void this.#exclusive(async () => {
      const before = Date.now() - days * DAY_MS;
      // The delays do not matter here: only the sessions no thread names are read from the plan.
      const plan = await this.#plan({ idleCompactDays: null, deletedCompactDays: null, deletedEraseDays: null, imagesEraseDays: null }, Date.now(), true);
      const sessions = plan.unlinked.filter(raw => raw.modifiedAt <= before);
      this.#progress = { ...idle(), running: true, remaining: sessions.length };
      for (const raw of sessions) {
        if (this.#halted()) break;
        await this.#step(async () => await this.#archiveSession(`session:${raw.id}`, raw, true, {
          id: `session:${raw.id}`, title: raw.folder ?? raw.id, projectPath: raw.folder, provider: raw.source, model: null,
          createdAt: null, updatedAt: Math.round(raw.modifiedAt), deletedAt: null,
        }) ?? 0);
      }
    });
    return this.progress();
  }

  #halted(): boolean { return this.#stopped || this.#core.stopping || this.#core.journal.isClosed(); }

  /** Whether the setting still asks for what the pass was planned for: a mode picked meanwhile ends it before its next step. */
  #current(): boolean { return this.#planned === null || this.#planned === JSON.stringify(this.policy()); }

  /** Whether a session can be archived now: no import reads it and nothing wrote to it since the scan. */
  async #ready(raw: RawSession): Promise<boolean> { return !this.#core.imports.busy(raw.id) && await unchanged(raw); }

  #exclusive(work: () => Promise<void>): Promise<void> {
    const after = this.#pass ?? Promise.resolve();
    const pass: Promise<void> = after.then(async () => {
      if (this.#halted()) return;
      this.#progress = { ...idle(), running: true };
      try { await work(); }
      catch (error) {
        this.#progress.lastError = messageOf(error);
        this.#core.log('error', `transcript storage: ${messageOf(error)}`);
      } finally {
        this.#progress = { ...this.#progress, running: false, remaining: 0, finishedAt: Date.now() };
        this.#emit();
        if (this.#pass === pass) this.#pass = null;
      }
    });
    this.#pass = pass;
    return pass;
  }

  #emit(): void {
    if (!this.#core.journal.isClosed()) this.#core.bus.emit('transcripts.progress', this.progress());
  }

  /** One step: a failure is logged and kept as the pass's last error, and the next step runs. */
  async #step(work: () => Promise<number>): Promise<void> {
    try { this.#progress.freedBytes += await work(); }
    catch (error) {
      this.#progress.lastError = messageOf(error);
      this.#core.log('warn', `transcript storage: ${messageOf(error)}`);
    }
    this.#progress.remaining = Math.max(0, this.#progress.remaining - 1);
    this.#emit();
    await pause();
  }

  async #apply(steps: readonly Step[]): Promise<void> {
    this.#progress.remaining = steps.length;
    for (const step of steps) {
      if (this.#halted() || !this.#current()) return;
      await this.#step(async () => {
        if (step.kind === 'compact-live') return this.#compactLive(step);
        if (step.kind === 'compact-deleted') return this.#compactDeleted(step);
        if (step.kind === 'erase-deleted') return this.#eraseDeleted(step);
        const now = Date.now();
        if (step.kind === 'erase-archived') { this.#progress.erased += 1; return this.store.eraseThread(step.threadId, now); }
        return this.store.eraseImages(step.threadId, now).bytes;
      });
    }
  }

  #archived(thread: ThreadInfo): ArchivedThread {
    return { id: thread.id, title: thread.title, projectPath: thread.cwd, provider: thread.provider, model: thread.model, createdAt: thread.createdAt, updatedAt: thread.updatedAt, deletedAt: thread.deletedAt };
  }

  /** Files an archive under a thread, unless the thread already holds the same records. Answers the bytes it added. */
  #file(threadId: string, target: { id: string; file: string; path: string }, source: string, rawBytes: number, result: ArchiveResult, thread: ArchivedThread): number {
    this.store.putThread(thread, Date.now());
    if (this.store.sameSession(threadId, result.sha256)) {
      void rm(target.path, { force: true });
      return 0;
    }
    this.store.putSession(threadId, { id: target.id, file: target.file, source, rawBytes }, result, Date.now());
    this.#progress.compacted += 1;
    return result.bytes;
  }

  /**
   * Archives one provider session under `threadId`, then removes its files when `remove` and nothing wrote to them.
   * Answers the bytes freed, or null when the session could not be read now and nothing was archived.
   */
  async #archiveSession(threadId: string, raw: RawSession, remove: boolean, thread: ArchivedThread, keepImages = true): Promise<number | null> {
    if (!(await this.#ready(raw))) return null;
    const target = this.store.sessionPath(threadId, raw.id);
    const { session } = await transcriptJob<Extract<TranscriptReply, { session: unknown }>>({
      transcript: { source: raw.source, files: raw.files, toolResults: raw.toolResults, out: target.path, blobs: this.store.blobsDir, keepBlobs: keepImages },
    });
    const added = this.#file(threadId, target, raw.source, session.rawBytes, session, thread)
      + session.blobs.reduce((sum, blob) => sum + blob.stored, 0);
    if (!remove) return -added;
    return await this.#removeRaw(raw) - added;
  }

  /** Removes a session's provider files once more checks pass. Answers the bytes that left. */
  async #removeRaw(raw: RawSession): Promise<number> {
    if (!(await this.#ready(raw))) return 0;
    this.#core.imports.removing.add(raw.id);
    try {
      await removeSession(raw);
    } finally {
      this.#core.imports.removing.delete(raw.id);
    }
    this.#scan = null;
    return raw.bytes;
  }

  async #compactLive(step: Extract<Step, { kind: 'compact-live' }>): Promise<number> {
    let freed = 0;
    for (const raw of step.sessions) {
      // Read again each time: a turn may have started while the session before this one was read.
      const thread = this.#threads(step.threadId).get(step.threadId);
      if (thread === undefined || thread.rootId !== null || !QUIET.has(thread.status) || this.#halted()) return freed;
      const before = thread.updatedAt;
      const target = this.store.sessionPath(thread.id, raw.id);
      if (!(await this.#ready(raw))) continue;
      const { session } = await transcriptJob<Extract<TranscriptReply, { session: unknown }>>({
        transcript: { source: raw.source, files: raw.files, toolResults: raw.toolResults, out: target.path, blobs: this.store.blobsDir, keepBlobs: true },
      });
      freed -= this.#file(thread.id, target, raw.source, session.rawBytes, session, this.#archived(thread)) + session.blobs.reduce((sum, blob) => sum + blob.stored, 0);
      const after = this.#threads(step.threadId).get(step.threadId);
      // The archive stays either way; the files go only if the thread did not move meanwhile.
      if (after === undefined || after.rootId !== null || !QUIET.has(after.status) || after.updatedAt !== before) return freed;
      freed += await this.#removeRaw(raw);
    }
    return freed;
  }

  async #compactDeleted(step: Extract<Step, { kind: 'compact-deleted' }>): Promise<number> {
    const db = this.#core.journal.db;
    const now = Date.now();
    let added = 0;
    // Every session of the family, or none: the journal is the only thing that says whose they are.
    for (const raw of step.threads.flatMap(member => member.sessions)) if (!(await this.#ready(raw))) return 0;
    for (const member of step.threads) {
      const thread = this.#threads(member.id).get(member.id);
      if (thread === undefined || thread.rootId !== step.rootId || thread.deletedAt !== step.deletedAt) return -added;
      const archived = this.#archived(thread);
      const target = this.store.sessionPath(thread.id, 'journal');
      const { archive } = await transcriptJob<Extract<TranscriptReply, { archive: unknown }>>(
        { journal: { path: db.filename, threadId: thread.id, out: target.path, blobs: this.store.blobsDir, keepBlobs: step.keepImages } }, db);
      added += this.#file(thread.id, target, 'journal', 0, archive, archived) + archive.blobs.reduce((sum, blob) => sum + blob.stored, 0);
      this.store.putTurns(thread.id, this.#core.journal.listTurns(thread.id).map(turn => ({
        id: turn.id, status: turn.status, queuedAt: turn.queuedAt, startedAt: turn.startedAt, finishedAt: turn.finishedAt, usage: turn.usage, error: turn.error,
      })));
      for (const raw of member.sessions) {
        const freed = await this.#archiveSession(thread.id, raw, false, archived, step.keepImages);
        // What is archived stays; the family is planned again at the next pass.
        if (freed === null) return -added;
        added -= freed;
      }
      if (!step.keepImages) this.store.eraseImages(thread.id, now);
    }
    if (this.#halted() || !this.#current()) return -added;
    // Everything is in the archive: the family leaves the journal, unless it was restored meanwhile.
    const purged = this.#core.journal.purgeDeletedFamily(step.rootId, step.deletedAt);
    if (purged.length === 0) return -added;
    for (const threadId of purged) this.#core.bus.emit('thread.removed', { threadId });
    this.#core.bus.emit('thread.deletionsUpdated', {});
    let freed = 0;
    for (const raw of step.threads.flatMap(member => member.sessions)) {
      if (!sessionReferenced(db, raw.id)) freed += await this.#removeRaw(raw);
    }
    return freed - added;
  }

  async #eraseDeleted(step: Extract<Step, { kind: 'erase-deleted' }>): Promise<number> {
    const db = this.#core.journal.db;
    const now = Date.now();
    const threads = this.#threads();
    const members = step.threadIds.flatMap(id => threads.get(id) ?? []);
    // A session being read or written is not erased under its reader: the family waits for the next pass.
    for (const raw of step.sessions) if (!(await this.#ready(raw))) return 0;
    if (!this.#current()) return 0;
    const turns = new Map(members.map(thread => [thread.id, this.#core.journal.listTurns(thread.id)]));
    const purged = this.#core.journal.purgeDeletedFamily(step.rootId, step.deletedAt);
    if (purged.length === 0) return 0;
    let freed = 0;
    // The conversation goes; its row and its turns stay in the index, so its usage is still there to audit.
    for (const thread of members) {
      if (!purged.includes(thread.id)) continue;
      this.store.putThread(this.#archived(thread), now);
      this.store.putTurns(thread.id, (turns.get(thread.id) ?? []).map(turn => ({
        id: turn.id, status: turn.status, queuedAt: turn.queuedAt, startedAt: turn.startedAt, finishedAt: turn.finishedAt, usage: turn.usage, error: turn.error,
      })));
      freed += this.store.eraseThread(thread.id, now);
      this.#progress.erased += 1;
    }
    for (const threadId of purged) this.#core.bus.emit('thread.removed', { threadId });
    this.#core.bus.emit('thread.deletionsUpdated', {});
    for (const raw of step.sessions) {
      if (!sessionReferenced(db, raw.id)) freed += await this.#removeRaw(raw);
    }
    return freed;
  }

  // -- reading the archive ------------------------------------------------------

  list(params: { query?: string | undefined; limit?: number | undefined }): ArchivedTranscript[] {
    return this.store.list(params.query, Math.min(Math.max(1, params.limit ?? 50), 500));
  }

  failures(params: { conversation?: string | undefined; query?: string | undefined; limit?: number | undefined }): ArchivedFailure[] {
    return this.store.failures({ threadId: params.conversation, query: params.query }, Math.min(Math.max(1, params.limit ?? 100), 1000));
  }

  async read(params: { conversation: string; sessionId?: string | undefined; after?: number | undefined; kinds?: string[] | undefined; query?: string | undefined; limit?: number | undefined }): Promise<{ sessionId: string | null; sessions: string[]; records: { line: number; record: Record<string, unknown> }[]; next: number | null }> {
    const sessions = this.store.sessions(params.conversation);
    const session = params.sessionId === undefined ? sessions[0] : sessions.find(item => item.id === params.sessionId);
    if (session === undefined) {
      if (params.sessionId !== undefined || sessions.length > 0) throw refused(`no session ${String(params.sessionId)} in the archive of ${params.conversation}`, { field: 'sessionId', expected: sessions.map(item => item.id) });
      return { sessionId: null, sessions: [], records: [], next: null };
    }
    const limit = Math.min(Math.max(1, params.limit ?? 100), TRANSCRIPT_READ_MAX_RECORDS);
    const after = params.after ?? 0;
    const kinds = params.kinds === undefined || params.kinds.length === 0 ? null : new Set(params.kinds);
    const query = params.query?.toLowerCase();
    const records: { line: number; record: Record<string, unknown> }[] = [];
    let bytes = 0;
    let next: number | null = null;
    await readArchive(session.path, (entry, line) => {
      if (line <= after) return;
      if (kinds !== null && !kinds.has(entry.k)) return;
      const json = JSON.stringify(entry);
      if (query !== undefined && !json.toLowerCase().includes(query)) return;
      if (records.length >= limit || (records.length > 0 && bytes + json.length > TRANSCRIPT_READ_MAX_BYTES)) {
        next = records[records.length - 1]!.line;
        return false;
      }
      bytes += json.length;
      records.push({ line, record: entry });
    });
    return { sessionId: session.id, sessions: sessions.map(item => item.id), records, next };
  }
}
