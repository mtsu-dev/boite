import { doneQuestion, pullRequestAddress, settledLinks, type LinkedPullRequest, type SettledPullRequests, type ThreadSummary } from '@boite/contracts';
import type { Core } from './core.ts';
import { messageOf } from './errors.ts';
import { linkedPullRequestSignature } from './linked-pull-requests.ts';
import { archiveState, archiveStateKey } from './merged-pr-archive-state.ts';
import { repositoryOf, type MergedPrProof, type PullRequests } from './pull-requests.ts';

const ARCHIVE_SCAN_ROWS = 128;
const ARCHIVE_PROOFS = 8;
const ARCHIVE_YIELD_ROWS = 8;
/** A merge can happen elsewhere without changing the conversation. Check again next minute. */
const NEGATIVE_RETRY_MS = 60_000;
const NEGATIVE_ENTRIES = 2_000;
/** How long after its last turn a thread whose agent reports no prompt cache may still be asked. */
const UNKNOWN_CACHE_MS = 60 * 60_000;

/**
 * The question is worth a turn only while the agent's prompt cache still
 * holds the conversation: later it would pay the whole context again for one
 * line. A thread past it stays as it is, for the user to mark done; a watch's
 * wake still carries the hint, since that turn happens anyway.
 */
export function warmForQuestion(thread: Pick<ThreadSummary, 'promptCache' | 'model' | 'accountId'>, lastFinishedAt: number | null, now = Date.now()): boolean {
  const cache = thread.promptCache;
  // Another model or account starts cold, as for the keepalive.
  if (cache) return cache.model === thread.model && cache.accountId === thread.accountId && now < cache.at + cache.ttlSeconds * 1000;
  return lastFinishedAt !== null && now - lastFinishedAt < UNKNOWN_CACHE_MS;
}

/** What a thread looked like when its proof failed: any update or new PR link starts over. */
interface Negative { signature: string; nextAt: number }

/**
 * Once every pull request of a worktree conversation is merged or closed,
 * Boite asks its agent, once, whether the thread can go to Done; the agent
 * answers with `boite thread done` (`agent.done`) or leaves it open. Nothing
 * is put away by itself: an agent often has a last thing to say after a
 * merge. The question waits for the thread to rest, so it never lands in the
 * middle of the agent's own answer. One timer and one bounded,
 * non-overlapping pass, plus merges a badge or a watch already saw.
 */
export class MergedPrAsk {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: Promise<number> | null = null;
  #controller: AbortController | null = null;
  #closed = false;
  #cursor = 0;
  #scanEnd = 0;
  /** Threads whose last proof found nothing, so each lap does not ask git and GitHub again. */
  #negative = new Map<string, Negative>();
  /** A failed scan must not delay the first detected merge, or replace a detection's retry deadline. */
  readonly #detectedNegative = new Map<string, Negative>();
  readonly #readyAt: number;
  readonly #detected = new Set<string>();
  #detection: Promise<void> | null = null;
  readonly #detectionController = new AbortController();
  /** Threads a detected merge found at work: checked again once their turn ends and `settleMs` passed. */
  readonly #afterTurn = new Set<string>();
  readonly #afterTurnTimers = new Set<ReturnType<typeof setTimeout>>();
  readonly #unlisten: () => void;
  #core: Core;
  #pullRequests: PullRequests;
  #settleMs: number;

  constructor(core: Core, pullRequests: PullRequests, settleMs = 60_000, graceMs = 90_000) { this.#core = core; this.#pullRequests = pullRequests; this.#settleMs = settleMs;
    this.#readyAt = Date.now() + graceMs;
    this.#unlisten = core.bus.onCommitted((name, payload) => {
      if (name === 'turn.finished') {
        const threadId = (payload as { threadId: string }).threadId;
        if (!this.#afterTurn.delete(threadId) || this.#closed) return;
        // The user gets a moment to read the answer and write first; their message keeps the question away.
        const timer = setTimeout(() => { this.#afterTurnTimers.delete(timer); this.observe(threadId); }, this.#settleMs);
        timer.unref();
        this.#afterTurnTimers.add(timer);
        return;
      }
      if (name !== 'threads.pullRequestsChanged') return;
      const event = payload as { threadId: string; pullRequests: LinkedPullRequest[] };
      if (event.pullRequests.some(pr => pr.state === 'MERGED') || settledLinks(event.pullRequests)) this.observe(event.threadId);
    });
  }
  /** A badge or watch already detected the merge. Check this thread without waiting for the history scan. */
  observe(threadId: string): void {
    if (this.#closed) return;
    this.#detected.add(threadId);
    this.#detection ??= this.#drainDetected().finally(() => {
      this.#detection = null;
      const next = this.#detected.values().next().value;
      if (next !== undefined) this.observe(next);
    });
  }
  async #drainDetected(): Promise<void> {
    // Coalesce badge and linked-PR notifications, and leave their RPC free to return.
    await new Promise<void>(resolve => setImmediate(resolve));
    for (const id of this.#detected) {
      this.#detected.delete(id);
      if (this.#closed || this.#core.journal.isClosed()) return;
      try {
        const thread = this.#core.journal.getThread(id);
        if (!thread || this.#backingOff(thread, true)) continue;
        if (!this.eligible(thread, true)) {
          // The agent merged its own pull request in this turn: ask once the turn ended.
          if (this.#core.threads.isBusy(id) && !thread.archived) this.#afterTurn.add(id);
          continue;
        }
        const signal = AbortSignal.any([this.#detectionController.signal, AbortSignal.timeout(30_000)]);
        await this.#ask(thread, signal, true);
      } catch {
        if (!this.#closed && !this.#core.journal.isClosed()) this.#core.log('warn', 'Merged PR detection failed; nothing was asked', { source: 'merged-pr-ask', event: 'ask.detectionFailed', threadId: id });
      }
    }
  }
  start(): void {
    const run = (): void => {
      if (this.#closed) return;
      this.#timer = setTimeout(() => { void this.sweep().catch(() => {
        this.#core.log('warn', 'Merged PR sweep failed; nothing was asked', { source: 'merged-pr-ask', event: 'ask.sweepFailed' });
      }).finally(run); }, Math.max(1, this.#readyAt - Date.now(), 60_000));
      this.#timer.unref();
    };
    run();
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#unlisten();
    this.#detected.clear();
    this.#afterTurn.clear();
    for (const timer of this.#afterTurnTimers) clearTimeout(timer);
    this.#afterTurnTimers.clear();
    this.#detectionController.abort();
    if (this.#timer) clearTimeout(this.#timer);
    this.#controller?.abort();
    await this.#pending;
    await this.#detection;
    if (this.#timer) clearTimeout(this.#timer);
  }
  eligible(thread: ThreadSummary, detected = false): boolean {
    return this.#eligibleWithScheduler(thread, this.#busyThreads(), detected);
  }
  /** A thread Boite may ask at all: a top-level worktree conversation of a project that keeps the setting on. */
  mayAsk(thread: ThreadSummary): boolean {
    if (thread.archived || thread.parentThreadId || thread.agentSessionId || !thread.projectId || !thread.branch || thread.branch === 'HEAD') return false;
    const project = this.#core.journal.getProject(thread.projectId);
    return !!project && !project.archived && project.path !== thread.cwd && this.#core.journal.getSetting(`project-auto-archive-merged-pr:${project.id}`) !== false;
  }
  /**
   * The pull requests a watch's wake may ask about: every linked one settled,
   * one at least not asked about yet, and not a checkout the user restored.
   */
  watchHint(thread: ThreadSummary): SettledPullRequests | null {
    if (!this.mayAsk(thread)) return null;
    const settled = settledLinks(this.#core.linkedPullRequests.saved(thread.id));
    return settled && this.#fresh(thread, settled.urls) ? settled : null;
  }
  /** One of `urls` not asked about or dismissed yet, on a checkout the user did not restore. */
  #fresh(thread: ThreadSummary, urls: readonly string[]): boolean {
    const state = archiveState(this.#core.journal, thread.id);
    const restored = state.restoredCheckout;
    if (restored && restored.cwd === thread.cwd && restored.branch === thread.branch && restored.projectId === thread.projectId) return false;
    const seen = [...(state.asked ?? []), ...(state.dismissed ?? [])].map(url => url.toLowerCase());
    return urls.some(url => !seen.includes(url.toLowerCase()));
  }
  /** A watch's wake already asked about these: the sweep does not ask again. */
  asked(threadId: string, urls: readonly string[]): void {
    const state = archiveState(this.#core.journal, threadId);
    this.#core.journal.setSetting(archiveStateKey(threadId), { ...state, asked: [...new Set([...(state.asked ?? []), ...urls])] });
  }
  #eligibleWithScheduler(thread: ThreadSummary, busy: ReadonlySet<string>, detected = false): boolean {
    const core = this.#core;
    if (this.#closed || (!detected && Date.now() < this.#readyAt) || core.stopping || core.threads.handoff.active || core.threads.isRemoving(thread.id)) return false;
    if (thread.archived || thread.parentThreadId || thread.agentSessionId || !thread.projectId || !thread.branch || thread.branch === 'HEAD' || thread.branchNamingPending) return false;
    const project = core.journal.getProject(thread.projectId);
    if (!project || project.archived || project.path === thread.cwd || core.journal.getSetting(`project-auto-archive-merged-pr:${project.id}`) === false) return false;
    if (!this.#quiescent(thread, busy, false, detected)) return false;
    if (!warmForQuestion(thread, core.journal.lastTurn(thread.id)?.finishedAt ?? null)) return false;
    // Retained children remain history. Every visible or archived member must
    // have completed and delivered its work before the agent is asked about Done.
    const children = core.journal.db.query('WITH RECURSIVE family(id) AS (SELECT id FROM threads WHERE parent_thread_id = ? UNION SELECT child.id FROM threads child JOIN family ON child.parent_thread_id = family.id) SELECT id FROM family WHERE id <> ? AND id NOT IN (SELECT thread_id FROM thread_deletions)').all(thread.id, thread.id) as { id: string }[];
    if (children.some(({ id }) => { const child = core.journal.getThread(id); return !child || !this.#quiescent(child, busy, true, detected); })) return false;
    const repository = repositoryOf(thread.cwd);
    const holders = core.journal.db.query('SELECT id, cwd, project_id FROM threads WHERE branch = ? AND parent_thread_id IS NULL AND agent_session_id IS NULL').all(thread.branch) as { id: string; cwd: string; project_id: string | null }[];
    return holders.filter(row => row.project_id === thread.projectId || repositoryOf(row.cwd) === repository).length === 1;
  }
  #quiescent(thread: ThreadSummary, busy: ReadonlySet<string>, child = false, detected = false): boolean {
    const core = this.#core;
    // The question is a turn of its own: it waits for the thread to rest, whoever saw the merge.
    if (core.threads.isRemoving(thread.id) || thread.agentSessionId || thread.status !== 'idle' || thread.pinned || (!detected && Date.now() - thread.updatedAt < this.#settleMs) || core.threads.focus.hasProtectedInput(thread.id)) return false;
    if (core.threads.sideQuestions.active(thread.id) || core.threads.runner.handles.has(thread.id) || core.threads.runner.steering.has(thread.id) || core.threads.agentState.background.get(thread.id)?.length || core.threads.moves.pendingOf(thread.id) || core.threads.agentDone.pending(thread.id)) return false;
    if (busy.has(thread.id)) return false;
    if (core.procs.liveCount(thread.id) || core.terminals.threadProcesses(thread.id) || core.threads.cards.listPermissions(thread.id).length || [...core.threads.cards.questions.values()].some(entry => entry.request.threadId === thread.id) || [...core.threads.cards.asyncCards.values()].some(entry => entry.threadId === thread.id)) return false;
    if (core.threads.deferred.deferredAnswers.get(thread.id)?.length || core.threads.deferred.consumed.has(thread.id) || core.threads.deferred.pendingWakes.has(thread.id)) return false;
    const activity = core.activity.get(thread.id);
    if ((activity.goal && activity.goal.status !== 'complete') || (activity.loop && activity.loop.status !== 'complete') || core.workflows.active(thread.id)) return false;
    if (core.journal.db.query("SELECT 1 FROM workflow_runs WHERE root_id = ? AND status IN ('done', 'failed') AND json_extract(data, '$.delivered') IS NOT 1 LIMIT 1").get(thread.id)) return false;
    const last = core.journal.db.query('SELECT status FROM turns WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1').get(thread.id) as { status: string } | null;
    if ((child && !last) || (last && last.status !== 'done')) return false;
    if (core.journal.db.query("SELECT 1 FROM delegation_messages WHERE root_id = ? AND status NOT IN ('delivered', 'expired', 'rejected') LIMIT 1").get(thread.id) || core.journal.db.query("SELECT 1 FROM coordination_letters WHERE thread_id = ? AND status NOT IN ('delivered', 'expired', 'rejected') LIMIT 1").get(thread.id) || core.journal.db.query('SELECT 1 FROM coordination_wakes WHERE thread_id = ? LIMIT 1').get(thread.id)) return false;
    return true;
  }
  sweep(): Promise<number> {
    if (this.#closed || this.#core.journal.isClosed()) return Promise.resolve(0);
    if (this.#pending) return this.#pending;
    const controller = new AbortController();
    this.#controller = controller;
    const deadline = setTimeout(() => controller.abort(), 30_000);
    deadline.unref();
    this.#pending = this.#pass(controller.signal).finally(() => {
      clearTimeout(deadline);
      this.#controller = null;
      this.#pending = null;
    });
    return this.#pending;
  }
  #busyThreads(): ReadonlySet<string> {
    const state = this.#core.scheduler.state();
    return new Set([...state.running, ...state.queued].map(entry => entry.threadId));
  }
  async #select(signal: AbortSignal): Promise<ThreadSummary[]> {
    if (this.#closed || signal.aborted || this.#core.journal.isClosed()) return [];
    if (Date.now() < this.#readyAt || this.#core.stopping || this.#core.threads.handoff.active) return [];
    if (!this.#scanEnd) {
      this.#scanEnd = (this.#core.journal.db.query('SELECT MAX(rowid) AS last FROM threads').get() as { last: number | null }).last ?? 0;
    }
    // LIMIT bounds physical rows, including blocked and deleted roots. Filtering
    // before LIMIT would scan the entire database when qualifying roots are sparse.
    const rows = this.#core.journal.db.query(`SELECT rowid, id,
      archived = 0 AND parent_thread_id IS NULL AND agent_session_id IS NULL
      AND project_id IS NOT NULL AND branch IS NOT NULL AND branch NOT IN ('', 'HEAD')
      AND COALESCE(branch_naming_pending, 0) = 0 AND status = 'idle' AND pinned = 0
      AND updated_at <= ? AND NOT EXISTS (SELECT 1 FROM thread_deletions WHERE thread_id = threads.id) AS candidate
      FROM threads WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`)
      .all(Date.now() - this.#settleMs, this.#cursor, this.#scanEnd, ARCHIVE_SCAN_ROWS) as { rowid: number; id: string; candidate: number | null }[];
    const selected: ThreadSummary[] = [];
    let busy: ReadonlySet<string> | undefined;
    for (let index = 0; index < rows.length; index++) {
      if (index % ARCHIVE_YIELD_ROWS === 0) {
        await new Promise<void>(resolve => setImmediate(resolve));
        busy = undefined;
      }
      if (this.#closed || signal.aborted || this.#core.journal.isClosed()) break;
      const row = rows[index]!;
      this.#cursor = row.rowid;
      if (!row.candidate) continue;
      const thread = this.#core.journal.getThread(row.id);
      if (!thread || this.#backingOff(thread) || !this.#eligibleWithScheduler(thread, busy ??= this.#busyThreads())) continue;
      selected.push(thread);
      if (selected.length === ARCHIVE_PROOFS) break;
    }
    if (this.#cursor >= this.#scanEnd || rows.length === 0 || (rows.length < ARCHIVE_SCAN_ROWS && this.#cursor === rows.at(-1)!.rowid)) {
      this.#cursor = 0;
      this.#scanEnd = 0;
    }
    return selected;
  }
  #signature(thread: ThreadSummary): string {
    return `${thread.updatedAt}\n${linkedPullRequestSignature(this.#core.journal, thread.id)}`;
  }
  #backingOff(thread: ThreadSummary, detected = false): boolean {
    const entry = (detected ? this.#detectedNegative : this.#negative).get(thread.id);
    return entry !== undefined && entry.signature === this.#signature(thread) && Date.now() < entry.nextAt;
  }
  /** Suppress repeated reads within one round, without delaying an external merge for an hour. */
  #remember(thread: ThreadSummary, signature: string, detected = false): void {
    const entries = detected ? this.#detectedNegative : this.#negative;
    entries.delete(thread.id);
    entries.set(thread.id, { signature, nextAt: Date.now() + NEGATIVE_RETRY_MS });
    if (entries.size > NEGATIVE_ENTRIES) entries.delete(entries.keys().next().value!);
  }
  async #pass(signal: AbortSignal): Promise<number> {
    let asked = 0;
    const deadline = Date.now() + 30_000;
    const selected = await this.#select(signal);
    for (const thread of selected) {
      if (Date.now() >= deadline || this.#closed || signal.aborted || this.#core.journal.isClosed()) break;
      if (await this.#ask(thread, signal)) asked++;
    }
    return asked;
  }
  /**
   * The exact tip merged (`proveMerged`, as for a settled worktree), or, with
   * no such proof, every linked pull request closed as last read: one closed
   * without a merge has no tip to prove, and the agent judges what is left.
   */
  async #settled(thread: ThreadSummary, signal: AbortSignal): Promise<{ settled: SettledPullRequests; proof: MergedPrProof | null } | null> {
    const links = this.#core.linkedPullRequests.saved(thread.id);
    const proof = await askRead(this.#pullRequests.proveMerged(thread, signal), signal);
    if (proof) {
      // The proof read every link of its own repository from GitHub; a link to another one, as last read, still open holds the question.
      const home = repositoryKey(proof.url);
      if (links.some(pr => repositoryKey(pr.url) !== home && pr.state !== 'MERGED' && pr.state !== 'CLOSED')) return null;
      const others = links.filter(pr => pr.url.toLowerCase() !== proof.url.toLowerCase() && (pr.state === 'MERGED' || pr.state === 'CLOSED'));
      return { proof, settled: { urls: [proof.url, ...others.map(pr => pr.url)], summary: [`#${proof.number} merged`, ...others.map(pr => `#${pr.number} ${pr.state.toLowerCase()}`)].join(', ') } };
    }
    const settled = settledLinks(links);
    return settled && !links.some(pr => pr.state === 'MERGED') ? { settled, proof: null } : null;
  }
  async #ask(thread: ThreadSummary, signal: AbortSignal, detected = false): Promise<boolean> {
    const generation = archiveState(this.#core.journal, thread.id).generation;
    const signature = this.#signature(thread);
    try {
      const found = await this.#settled(thread, signal);
      if (this.#closed || signal.aborted || this.#core.journal.isClosed()) return false;
      if (!found) { this.#remember(thread, signature, detected); return false; }
      const { settled, proof } = found;
      const current = this.#core.journal.getThread(thread.id);
      if (!current || (!detected && current.updatedAt !== thread.updatedAt) || !this.eligible(current, detected) || archiveState(this.#core.journal, thread.id).generation !== generation) return false;
      // Asked once per pull request: a restored thread or one the agent kept open is not asked again for the same work.
      if (!this.#fresh(thread, settled.urls)) { this.#remember(thread, signature, detected); return false; }
      // A close the watch saw wakes the agent with the question in that turn: no second one here.
      if (this.#core.pullRequestWatches.holdsClose(thread.id)) return false;
      const state = archiveState(this.#core.journal, thread.id);
      if (proof) {
        this.#core.journal.setSetting(archiveStateKey(thread.id), { ...state, binding: proof });
        if (!await askRead(this.#pullRequests.validateMergedCheckout(thread, proof, signal), signal)) { this.#remember(thread, signature, detected); return false; }
        if (this.#closed || signal.aborted || this.#core.journal.isClosed()) return false;
      }
      // No await between the final state check and the turn.
      const latest = this.#core.journal.getThread(thread.id);
      if (!latest || !this.eligible(latest, detected) || archiveState(this.#core.journal, thread.id).generation !== generation) return false;
      // A close the watch received or told during the validation is its wake's to ask.
      if (this.#core.pullRequestWatches.holdsClose(thread.id) || !this.#fresh(latest, settled.urls)) return false;
      const { text, label } = doneQuestion(settled);
      try {
        this.#core.threads.startTurn(thread.id, { prompt: text, display: label }, { kind: 'pull-request' });
      } catch (error) {
        this.#core.log('warn', `thread ${thread.id}: the Done question waits, no turn could open: ${messageOf(error)}`, { source: 'merged-pr-ask', threadId: thread.id });
        return false;
      }
      this.asked(thread.id, settled.urls);
      this.#negative.delete(thread.id);
      this.#detectedNegative.delete(thread.id);
      return true;
    } catch {
      // Missing auth, unavailable repositories and failed validation ask nothing.
      if (!signal.aborted && !this.#closed) this.#remember(thread, signature, detected);
    }
    return false;
  }
}

/** `host/owner/name` of a pull request URL, lowercase; null for one that names none. */
function repositoryKey(url: string): string | null {
  try { const address = pullRequestAddress(url); return `${address.host}/${address.repository}`.toLowerCase(); } catch { return null; }
}

/** A late provider result cannot resume a closed pass, even if it ignored cancellation. */
function askRead<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const canceled = (): void => { reject(new Error('merged PR pass canceled')); };
    signal.addEventListener('abort', canceled, { once: true });
    pending.then(value => {
      signal.removeEventListener('abort', canceled);
      if (!signal.aborted) resolve(value);
    }, error => {
      signal.removeEventListener('abort', canceled);
      if (!signal.aborted) reject(error);
    });
    if (signal.aborted) canceled();
  });
}
