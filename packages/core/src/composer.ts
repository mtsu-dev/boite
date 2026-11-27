import type { ComposerChoice, ComposerQueuedPrompt, ComposerRecord, ComposerValue, RpcEvents, RpcParams, ThreadSummary, Turn } from '@boite/contracts';
import { composerInputThreadId, isComposerKey, privateTerminalComposerId } from '@boite/contracts';
import type { Core } from './core.ts';
import type { Connection } from './router.ts';
import { promptOrigin } from './client-preferences.ts';
import { invalidParams, messageOf, notFound, refused } from './errors.ts';
import { ComposerStorage, digest, recordKey } from './composer-storage.ts';
import type { TurnHandle } from './drivers/types.ts';
import { steerUser, userSteeringUnavailable } from './threads/user-steering.ts';
import { DraftReservationLedger, type DraftOwnership } from './threads/draft-reservation-ledger.ts';
import { needsModelDiscovery } from './threads/selection.ts';
import { admissionRefusal, checkTurnInput, prepareTurnExecution } from './threads/admission.ts';
import { composerActivity, isComposerActivity, startsAutoGoal } from './composer-activity.ts';
import { composerBatch } from './composer-batch.ts';
import { checkTurnRequest } from './threads/inputs.ts';
import { ensureThreadCwd, folderPresent } from './threads/cwd.ts';

const choiceOf = (thread: ThreadSummary): ComposerChoice => ({ providerId: thread.providerId, accountId: thread.accountId, model: thread.model, effort: thread.effort, speed: thread.speed ?? null, permissionMode: thread.permissionMode });
const sameChoice = (a: ComposerChoice, b: ComposerChoice): boolean => a.providerId === b.providerId && a.accountId === b.accountId && a.model === b.model && a.effort === b.effort && (a.speed ?? null) === (b.speed ?? null);

/** Durable owner outbox. No browser or subscription participates in execution. */
export class Composer {
  readonly storage: ComposerStorage;
  #closed = false;
  #scheduled = false;
  readonly #running = new Map<string, Promise<void>>();
  readonly #pending = new Map<string, Pick<ComposerRecord, 'section' | 'id'>>();
  readonly #dirty = new Set<string>();
  readonly #captured = new Map<string, ComposerQueuedPrompt[]>();
  readonly #boundaries = new Map<string, RpcEvents['turn.toolCompleted'] & { fresh: boolean }>();
  readonly #forced = new Map<string, string>();
  #stopWaiting!: () => void;
  readonly #stopped = new Promise<null>(resolve => { this.#stopWaiting = () => resolve(null); });
  readonly #unsubscribe: () => void;
  readonly #connection: Connection = { id: 'core-composer', subscriptions: new Set(), identity: { principal: 'owner', sessionId: null, threadId: null }, sendEvent() {}, close() {} };

  readonly #core: Core;

  constructor(core: Core) { this.#core = core;
    this.storage = new ComposerStorage(core);
    this.#unsubscribe = core.bus.onCommitted((name, payload) => {
      if (name === 'turn.toolCompleted') {
        const boundary = { ...payload as RpcEvents['turn.toolCompleted'], fresh: true };
        if (!this.storage.queued.has(recordKey('inputs', boundary.threadId))) return;
        this.#boundaries.set(boundary.threadId, boundary);
        this.#schedule([{ section: 'inputs', id: boundary.threadId }]);
        // A later wake may still steer natively, but only this completion can stop a prompt.
        queueMicrotask(() => { boundary.fresh = false; });
      } else if (['turn.finished', 'thread.updated', 'permission.resolved', 'question.answered'].includes(name)) {
        const thread = payload as { threadId?: string; id?: string };
        const id = thread.threadId ?? thread.id!;
        this.#schedule([{ section: 'inputs', id }, { section: 'inputs', id: privateTerminalComposerId(id) }]);
      } else if (name === 'project.updated') this.#schedule(this.storage.queued.values());
      else if (name === 'thread.removed' && !(payload as { undoable?: boolean }).undoable) {
        const { threadId } = payload as { threadId: string };
        this.storage.forgetThread(threadId);
        for (const id of [threadId, privateTerminalComposerId(threadId)]) {
          this.#pending.delete(recordKey('inputs', id)); this.#dirty.delete(recordKey('inputs', id));
        }
        this.#boundaries.delete(threadId);
        this.#forced.delete(threadId);
      }
    });
    core.router.register('composer.list', (_params, ctx) => this.storage.list(ctx.connection.id));
    core.router.register('composer.listPage', (params, ctx) => this.storage.listPage(ctx.connection.id, params?.after));
    core.router.register('composer.get', (params, ctx) => {
      if (!isComposerKey(params)) throw invalidParams('composer.get: expected section inputs/drafts and a nonempty id');
      this.storage.requireOwner(params, ctx.connection.id);
      return this.storage.get(params.section, params.id);
    });
    // The owner terminal has no shared draft state. It appends one prompt through the same outbox.
    core.router.register('composer.enqueue', (params, ctx) => this.enqueue(params, ctx.connection));
    core.router.register('composer.asset.put', (params, ctx) => this.storage.putAsset(params.attachment, params.incognito === true, ctx.connection));
    core.router.register('composer.asset.get', (params, ctx) => this.storage.getAsset(params.assetId, ctx.connection.id));
    core.router.register('composer.put', async (params, ctx) => {
      const { composerValue } = await import('./composer-validation.ts');
      return this.#put(params, ctx.connection, composerValue);
    });
  }

  start(): void {
    // Native submissions without confirmation stay held. A start admitted by
    // the durable turn ledger is never submitted a second time.
    for (const ref of this.storage.queued.values()) {
      const record = this.storage.get(ref.section, ref.id);
      for (const item of record.value?.input.queued ?? []) {
        const delivery = this.storage.delivery(item.id);
        if (delivery?.status === 'submitting') {
          const receipt = delivery.thread_id ? this.#core.journal.turnRequest(delivery.thread_id, delivery.request_id) : null;
          if (receipt && !receipt.fingerprint.includes(':pending:')) this.storage.status(item.id, 'delivered');
          else if (receipt) this.storage.status(item.id, 'uncertain');
          else this.storage.release(item.id);
        }
      }
    }
    // Existing recovery holds every never-started turn. Server-owned accepted
    // queues may resume those safe rows; legacy client queues remain held.
    const held = this.#core.journal.db.query(`SELECT t.id, t.thread_id FROM turns t
      WHERE t.status = 'queued' AND t.started_at IS NULL AND t.queue_hold IS NOT NULL AND EXISTS (
        SELECT 1 FROM turn_requests r JOIN composer_deliveries d ON d.thread_id = r.thread_id AND d.request_id = r.request_id
        WHERE r.thread_id = t.thread_id AND r.turn_id = t.id AND d.status = 'delivered')`).all() as { id: string; thread_id: string }[];
    for (const { id, thread_id } of held) {
      const thread = this.#core.journal.getThread(thread_id);
      const project = thread?.projectId ? this.#core.journal.getProject(thread.projectId) : null;
      if (!thread || thread.archived || (thread.projectId && (!project || project.archived))) continue;
      try { this.#core.threads.recoverTurn({ threadId: thread.id, turnId: id, action: 'resume' }); }
      catch (error) { this.#core.log('warn', `queued composer input remains held: ${messageOf(error)}`); }
    }
    this.#schedule(this.storage.queued.values());
  }

  /** Retry requested input once the native turn can accept it, before any tool output. */
  inputReady(threadId: string): void { this.#schedule([{ section: 'inputs', id: threadId }]); }

  async enqueue(params: RpcParams<'composer.enqueue'>, connection: Connection) {
    if (typeof params?.threadId !== 'string' || typeof params.prompt !== 'string' || !params.prompt.trim() || typeof params.clientRequestId !== 'string') {
      throw invalidParams('composer.enqueue: expected threadId, a non-empty prompt and clientRequestId');
    }
    // Load the schema before reading the outbox. Validation and the CAS write
    // can then run together when the record is ready.
    const { composerValue } = await import('./composer-validation.ts');
    const { threadId, prompt, clientRequestId: requestId } = params;
    const thread = this.#core.threads.require(threadId);
    const { turn } = checkTurnRequest(this.#core.journal, threadId, prompt, [], [], requestId);
    if (turn) return { requestId, status: 'sent' as const, turnId: turn.id };
    if (this.#core.delegation.retirements.revivable(thread)) {
      const started = await this.#core.router.dispatch('turns.start', params, { connection }) as Turn;
      return { requestId, status: 'sent' as const, turnId: started.id };
    }
    const recordId = thread.incognito ? privateTerminalComposerId(threadId) : threadId;
    const record = this.storage.get('inputs', recordId);
    const id = `cli_${digest([threadId, requestId])}`;
    const queued = record.value?.input.queued.find(item => item.id === id);
    const delivery = this.storage.delivery(id);
    if ((queued && queued.text !== prompt) || (delivery && delivery.fingerprint !== digest(prompt))) throw refused('clientRequestId was already used for different content');
    if (delivery?.status === 'delivered') return { requestId, status: 'sent' as const };
    if (queued) {
      const reason = queued.request?.failed;
      // A private terminal queue has no composer UI. An explicit retry may resume
      // its held first item only when delivery never reached the turn ledger.
      if (thread.incognito && reason && !delivery && record.value?.input.queued[0] === queued) {
        delete queued.request!.failed;
        record.value.input.paused = false;
        this.storage.save('inputs', recordId, record.value, this.#connection);
        this.#schedule([record]);
        return { requestId, status: 'queued' as const };
      }
      return { requestId, status: record.value?.input.paused ? 'held' as const : 'queued' as const, ...(reason ? { reason } : {}) };
    }
    if (delivery) throw refused('delivery of this message is unconfirmed; review the conversation before sending again');
    if (this.#closed || this.#core.stopping) throw refused('the core is stopping; reconnect before sending another prompt');
    const refusal = admissionRefusal(this.#core, thread);
    if (refusal !== null) throw refused(refusal);
    if (thread.projectId && this.#core.projects.require(thread.projectId).archived) throw refused('cannot send a prompt in an archived project');
    const value: ComposerValue = record.value ?? { input: { text: '', attachments: [], queued: [], paused: false } };
    const preferences = this.#core.clients.use(connection);
    value.input.queued.push({ id, text: prompt, attachments: [], request: { id: requestId, choice: null, queuedAt: Date.now() },
      experiments: preferences?.experiments ?? [], sentFrom: promptOrigin(connection, preferences) });
    if (thread.incognito) {
      this.storage.save('inputs', recordId, value, this.#connection);
      this.#schedule([record]);
    } else {
      const saved = this.#put({ section: 'inputs', id: recordId, expectedRevision: record.revision, value }, connection, composerValue, false);
      if (!saved.accepted) throw refused('the composer changed; retry with the same clientRequestId');
    }
    return { requestId, status: value.input.paused ? 'held' as const : 'queued' as const };
  }

  #put(params: RpcParams<'composer.put'>, connection: Connection, parseValue: (value: unknown) => ComposerValue | null, returnsRecord = true): { accepted: boolean; record: ComposerRecord } {
    if (!params || !['inputs', 'drafts'].includes(params.section) || typeof params.id !== 'string' || !params.id || !Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 0) throw invalidParams('composer.put: expected section inputs/drafts, non-empty id and non-negative expectedRevision');
    if (params.section === 'inputs' && composerInputThreadId(params.id) !== params.id) throw notFound('composer.id: expected an existing thread');
    // Soft-deleted rows remain undoable. Missing rows cannot adopt an offline
    // client's old input again, regardless of its remembered CAS revision.
    if (params.section === 'inputs' && params.value !== null && !this.#core.journal.db.query('SELECT 1 FROM threads WHERE id = ?').get(params.id)) {
      throw notFound('composer.id: expected an existing thread; this conversation was permanently deleted', { reason: 'thread-deleted', threadId: params.id, field: 'composer.id' });
    }
    this.storage.requireOwner(params, connection.id);
    const current = this.storage.get(params.section, params.id);
    if (current.revision !== params.expectedRevision) return { accepted: false, record: current };
    const value = parseValue(params.value);
    const captured = this.#captured.get(recordKey(params.section, params.id)) ?? [];
    if (captured.some(item => !value?.input.queued.some(next => next.id === item.id && digest(next) === digest(item)))) return { accepted: false, record: current };
    if (value) {
      const thread = params.section === 'inputs' ? this.#core.journal.getThread(params.id) : null;
      this.storage.validateAssets(value, this.storage.privateMode(params.section, params.id, value), connection.id);
      value.input.queued = value.input.queued.filter(item => this.storage.delivery(item.id)?.status !== 'delivered');
      for (const item of value.input.queued) {
        const previous = current.value?.input.queued.find(previous => previous.id === item.id);
        const preferences = this.#core.clients.use(connection);
        item.experiments = previous?.experiments ?? item.experiments ?? preferences?.experiments ?? [];
        item.sentFrom = previous?.sentFrom !== undefined ? previous.sentFrom : promptOrigin(connection, preferences);
        const delivery = this.storage.delivery(item.id);
        if (delivery && delivery.status !== 'delivered' && (delivery.section !== params.section || delivery.record_id !== params.id)) throw refused('composer.queued.id: this queued input already belongs to another composer');
        item.choice ??= item.request?.choice ?? value.choice ?? (thread ? choiceOf(thread) : undefined);
        if (params.section === 'drafts' && item === value.input.queued[0] && !item.request?.start) {
          item.request = { ...item.request, id: item.request?.id ?? this.#requestId(item), choice: item.choice ?? null, queuedAt: item.request?.queuedAt ?? Date.now(),
            start: { projectId: value.draft?.projectId ?? this.#core.projects.drafts().id, worktree: value.draft?.worktree ?? false, incognito: value.draft?.incognito === true } };
        }
        // A reconnect may retain an uncertain request but may not clear its hold.
        if (delivery?.status === 'uncertain') {
          value.input.paused = true;
          item.request = { ...item.request, id: item.request?.id ?? delivery.request_id, choice: item.choice ?? null, queuedAt: item.request?.queuedAt ?? Date.now(), failed: 'Delivery is unconfirmed; review this input before sending it as a new request.' };
        }
      }
    }
    const record = this.#atomic(() => this.storage.save(params.section, params.id, value, connection, returnsRecord ? connection.id : undefined));
    if (params.section === 'inputs') {
      if (!record.value?.input.queued.length) { this.#boundaries.delete(params.id); this.#forced.delete(params.id); }
      else if (params.sendNow) this.#forced.set(params.id, record.value.input.queued[0]!.id);
    }
    this.#schedule([{ section: params.section, id: params.id }]);
    return { accepted: true, record };
  }

  #atomic<T>(write: () => T): T { return this.#core.bus.afterCommit(() => this.#core.journal.db.transaction(write)()); }

  #schedule(records: Iterable<Pick<ComposerRecord, 'section' | 'id'>>): void {
    if (this.#closed) return;
    for (const record of records) {
      const key = recordKey(record.section, record.id);
      if (!this.storage.queued.has(key)) continue;
      if (this.#running.has(key)) this.#dirty.add(key);
      else this.#pending.set(key, record);
    }
    if (this.#scheduled || !this.#pending.size) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (this.#closed || this.#core.stopping) return;
      const pending = [...this.#pending.values()]; this.#pending.clear();
      for (const record of pending) {
        const key = recordKey(record.section, record.id);
        if (this.#running.has(key)) continue;
        const task = this.#pump(record.section, record.id).catch(error => this.#core.log('error', `composer delivery failed: ${messageOf(error)}`)).finally(() => {
          this.#running.delete(key); this.#captured.delete(key);
          if (this.#dirty.delete(key)) this.#schedule([record]);
        });
        this.#running.set(key, task);
      }
    });
  }

  async #pump(section: ComposerRecord['section'], recordId: string): Promise<void> {
    const key = recordKey(section, recordId);
    const id = section === 'inputs' ? composerInputThreadId(recordId) : recordId;
    let checkedFolder: { boundary: RpcEvents['turn.toolCompleted']; handle: TurnHandle; cwd: string; revision: number } | undefined;
    while (!this.#closed && !this.#core.stopping) {
      const record = this.storage.get(section, recordId), value = record.value;
      if (!value || !value.input.queued.length) { this.storage.queued.delete(key); if (section === 'inputs') { this.#boundaries.delete(recordId); this.#forced.delete(recordId); } return; }
      if (value.input.paused) return;
      const item = value.input.queued[0]!;
      const delivery = this.storage.delivery(item.id);
      if (delivery?.status === 'delivered') { this.#complete(section, recordId, item.id); continue; }
      // An app that sent this prompt itself and died before the answer queues it
      // again under the same request id: the receipt says whether it arrived.
      // None means it never did, and its start goes once, as the receipt dedups
      // a late copy of the first request; a pending one stays held.
      const receipt = section === 'inputs' && item.request?.sent && !item.request.failed ? this.#core.journal.turnRequest(id, item.request.id) : null;
      if (receipt && !/^(start|steer):pending:/.test(receipt.fingerprint)) { this.#complete(section, recordId, item.id); continue; }
      if (delivery?.status === 'uncertain' || item.request?.failed || (item.request?.sent && (section !== 'inputs' || receipt))) {
        this.#hold(section, recordId, item.id, item.request?.failed ?? 'Delivery is unconfirmed; review before sending a new request.'); return;
      }
      this.#captured.set(key, section === 'drafts' ? value.input.queued : [item]);
      try {
        if (section === 'drafts') { await this.#launch(record, item); return; }
        const thread = this.#core.journal.getThread(id);
        if (!thread || thread.archived || (thread.projectId && this.#core.projects.require(thread.projectId).archived)) return;
        if (this.#core.threads.listPermissions(id).length || this.#core.threads.listQuestions(id).some(question => !question.async)) return;
        const boundary = this.#boundaries.get(recordId);
        const followsThread = item.id.startsWith('cli_');
        const choice = followsThread ? undefined : item.choice;
        if (!followsThread && !choice) throw refused('No agent selection was saved for this queued prompt. Choose an agent and enqueue it again.');
        const refusal = admissionRefusal(this.#core, thread, choice);
        if (refusal !== null) throw refused(refusal);
        const active = this.#core.threads.isBusy(id);
        const forced = this.#forced.get(recordId) === item.id;
        // Startup may be awaiting native preparation without a stoppable handle.
        // inputReady wakes us as soon as that handle exists, before any tool output.
        const runner = this.#core.threads.runner;
        if (active && forced && this.#core.journal.runningTurn(id) && !runner.handles.has(id) && !runner.retryOf(id) && !runner.isPaused(id)) return;
        this.#forced.delete(recordId);
        if (active && forced) {
          // Only the current turn stops. Its children and coordination remain available to the new user turn.
          await Promise.race([this.#stopped, this.#core.scheduler.stopAndWait(id)]);
          continue;
        }
        const turn = active ? this.#core.journal.runningTurn(id) : null;
        if (active && (!turn || boundary?.turnId !== turn.id || boundary.boundary === item.afterBoundary || item.request || isComposerActivity(item.text)
          || !choice || !sameChoice(choice, choiceOf({ ...thread, ...turn.execution })))) return;
        const steeringReason = turn ? userSteeringUnavailable(this.#core, this.#core.threads, id, turn) : null;
        const handle = turn && boundary && (boundary.fresh || checkedFolder?.boundary === boundary)
          && steeringReason === 'unsupported' && this.#canCancelForQueuedInput(turn)
          ? runner.handles.get(id) : undefined;
        if (steeringReason !== null && !handle?.cancelForQueuedInput) return;
        if (boundary && handle?.cancelForQueuedInput && !(checkedFolder?.boundary === boundary && checkedFolder.handle === handle
          && checkedFolder.cwd === thread.cwd && checkedFolder.revision === record.revision)) {
          if (!boundary.fresh) return;
          // Check shares asynchronously. The next pass rechecks the turn and queue before cancelling.
          this.#captured.delete(key);
          if (!(await Promise.race([this.#stopped, folderPresent(thread.cwd)]))) return;
          checkedFolder = { boundary, handle, cwd: thread.cwd, revision: record.revision };
          continue;
        }
        const batch = composerBatch(value.input.queued, this.storage);
        const attachments = batch.attachments;
        this.#captured.set(key, batch.entries);
        if (choice && handle?.cancelForQueuedInput) {
          // Discovery can yield past this tool boundary. The idle pump can discover and start the turn.
          if (this.#providerNeedingDiscovery(choice)) return;
          // Share the synchronous admission checks. Settlement wakes the queue to recheck and admit the input.
          const target = checkTurnInput(this.#core, id, batch.text, attachments, batch.previewReferences);
          prepareTurnExecution(this.#core, target, attachments, choice);
          if (handle.cancelForQueuedInput(attachments)) this.#boundaries.delete(recordId);
          return;
        }
        if (turn) {
          for (const entry of batch.entries) this.#reserve(record, entry, id, batch.requestId);
          const accepted = await Promise.race([this.#stopped, steerUser(this.#core, this.#core.threads, { threadId: id, turnId: turn.id, prompt: batch.text, attachments, previewReferences: batch.previewReferences, clientRequestId: batch.requestId, expectedSelectionVersion: thread.selectionVersion ?? 0 }, batch.entries[0]!.sentFrom ?? null)]);
          if (!accepted || this.#closed) return;
          if (!accepted.accepted) { for (const entry of batch.entries) this.storage.release(entry.id); return; }
          this.#complete(section, recordId, batch.entries.map(entry => entry.id)); continue;
        }
        this.#boundaries.delete(recordId);
        if (choice) await this.#discover(choice);
        // A discovery RPC can yield while the user archives the target or stops the core.
        const current = this.#core.journal.getThread(id);
        if (this.#closed || this.#core.stopping || !current || current.archived || (current.projectId && this.#core.projects.require(current.projectId).archived)) return;
        // As `turns.start`: the project's folder is only reported (a shared worktree outlives it); the turn's own cwd decides.
        if (current.projectId) void this.#core.projects.requireFolder(current.projectId).catch(() => undefined);
        await ensureThreadCwd(this.#core, current);
        const activity = composerActivity(item.text);
        this.#atomic(() => {
          const target = this.#core.journal.getThread(id);
          if (this.#core.stopping || this.#closed || !this.storage.queued.has(key) || !target || target.archived || target.cwd !== current.cwd || this.#core.threads.isBusy(id)
            || (target.projectId && this.#core.projects.require(target.projectId).archived)) return;
          for (const entry of batch.entries) this.#reserve(record, entry, id, batch.requestId);
          if (activity) {
            if (item.previewReferences?.length) throw refused('Activity commands do not accept page references.');
            this.#core.activity.set({ threadId: id, ...activity, attachments }, undefined, choice);
          } else this.#core.threads.startTurn(id, { prompt: batch.text, attachments, previews: batch.previewReferences }, { kind: 'user', requestId: batch.requestId, sentFrom: batch.entries[0]!.sentFrom ?? null }, { expectedSelectionVersion: (followsThread ? target : current).selectionVersion ?? 0, choice,
            autoGoal: startsAutoGoal(batch.text, this.#core.settings.get()) ? batch.text : undefined });
          this.#complete(section, recordId, batch.entries.map(entry => entry.id));
        });
      } catch (error) {
        for (const entry of this.#captured.get(key) ?? [item]) {
          const pending = this.storage.delivery(entry.id);
          if (pending?.status !== 'submitting') continue;
          // This memory-only queue starts turns synchronously, but its reservations
          // are outside the transaction. Release one if no turn was admitted.
          if (recordId !== id && !isComposerActivity(item.text) && !this.#core.journal.turnRequest(id, pending.request_id)) this.storage.release(entry.id);
          else this.storage.status(entry.id, 'uncertain');
        }
        this.#hold(section, recordId, item.id, messageOf(error)); return;
      } finally { this.#captured.delete(key); }
    }
  }

  #canCancelForQueuedInput(turn: Turn): boolean {
    const { threadId } = turn;
    const { threads, activity, scheduler } = this.#core;
    if (turn.execution?.operation || scheduler.stopTarget(threadId) !== turn.id || threads.handoff.toolsRunning(threadId) > 0) return false;
    // These prompts must finish to acknowledge their history or report their first result.
    if (threads.accountSessions.carrying(threadId) === turn.id || threads.backgroundCompact.carrying(threadId) === turn.id
      || threads.spawns.awaitingFirstResult(threadId)) return false;
    const { goal, loop } = activity.get(threadId);
    return goal?.status !== 'active' && loop?.status !== 'active' && !activity.ownsReviewer(threadId) && !activity.ownsTracker(threadId);
  }

  #providerNeedingDiscovery(choice: ComposerChoice) {
    const provider = this.#core.providers.require(choice.providerId);
    return needsModelDiscovery(provider, choice.accountId, choice.model, choice.effort, choice.speed ?? null) ? provider : null;
  }

  /** Reads the agent's models once when the queued selection names one Boite has not seen yet. */
  async #discover(choice: ComposerChoice): Promise<void> {
    const provider = this.#providerNeedingDiscovery(choice);
    if (!provider) return;
    await this.#core.router.dispatch('providers.probe', { providerId: choice.providerId, accountId: choice.accountId, ...(provider.protocol === 'acp' && choice.model !== null && choice.effort !== null ? { model: choice.model } : {}) }, { connection: this.#connection });
  }

  #requestId(item: ComposerQueuedPrompt): string { return `composer_${digest(item.id)}`; }

  #reserve(record: ComposerRecord, item: ComposerQueuedPrompt, threadId: string, requestId: string): void {
    const fingerprint = digest(item.id.startsWith('cli_') ? item.text : item);
    this.storage.reserve({ id: item.id, section: record.section, record_id: record.id, status: 'submitting', thread_id: threadId, request_id: requestId, fingerprint }, this.storage.privateMode(record.section, record.id, record.value));
  }

  #complete(section: ComposerRecord['section'], id: string, itemId: string | string[]): void {
    const ids = new Set(typeof itemId === 'string' ? [itemId] : itemId);
    this.#atomic(() => {
      for (const itemId of ids) this.storage.status(itemId, 'delivered');
      const record = this.storage.get(section, id);
      if (!record.value) return;
      record.value.input.queued = record.value.input.queued.filter(item => !ids.has(item.id));
      this.storage.save(section, id, record.value);
    });
  }

  #hold(section: ComposerRecord['section'], id: string, itemId: string, reason: string): void {
    const record = this.storage.get(section, id);
    const item = record.value?.input.queued.find(item => item.id === itemId);
    if (!record.value || !item) return;
    item.request = { ...item.request, id: item.request?.id ?? this.#requestId(item), choice: item.choice ?? null, queuedAt: item.request?.queuedAt ?? Date.now(), failed: reason };
    record.value.input.paused = true;
    this.#atomic(() => this.storage.save(section, id, record.value));
  }

  async #launch(record: ComposerRecord, item: ComposerQueuedPrompt): Promise<void> {
    const value = record.value!, choice = item.choice;
    if (!choice) throw refused('No agent selection was saved for this draft. Choose an agent and enqueue it again.');
    const draft = value.draft;
    const projectId = item.request?.start?.projectId ?? draft?.projectId ?? this.#core.projects.drafts().id;
    if (this.#core.projects.require(projectId).archived) return;
    const launchId = `draft-${digest([record.section, record.id, item.id])}`;
    const previous = this.storage.delivery(launchId);
    if (previous) throw refused(previous.status === 'delivered' ? 'This draft already started a conversation. Review its queued messages before starting a new one.' : 'Core restarted during draft creation. Review this draft before starting a new one.');
    const params: RpcParams<'threads.create'> = { projectId, providerId: choice.providerId, accountId: choice.accountId, model: choice.model ?? undefined, effort: choice.effort, speed: choice.speed ?? null, permissionMode: choice.permissionMode, title: item.text.slice(0, 120),
      ...((item.request?.start?.worktree ?? draft?.worktree) ? { worktree: {} } : {}), ...((item.request?.start?.incognito ?? draft?.incognito) ? { incognito: true } : {}) };
    await this.#core.projects.requireFolder(projectId);
    // Reuse discovery and draft workspace machinery, but keep publication and
    // the queue transfer in one commit so restart cannot create another thread.
    await this.#discover(choice);
    const ledger = new DraftReservationLedger(this.#core);
    const mutations: DraftOwnership[] = [];
    const beforeMutation = (ownership: DraftOwnership) => { mutations.push(ownership); return ledger.record(ownership); };
    this.storage.reserve({ id: launchId, section: record.section, record_id: record.id, status: 'creating', thread_id: null, request_id: launchId, fingerprint: digest(params) }, this.storage.privateMode(record.section, record.id, value));
    const creation = this.#core.threads.creation;
    let thread: ThreadSummary | undefined;
    const cleanup = async () => {
      let clean = true;
      for (const ownership of mutations) if (!await ledger.cleanup(ownership)) clean = false;
      if (clean) this.storage.release(launchId);
    };
    try {
      const planned = params.worktree ? await creation.createInWorktree(params, false, beforeMutation) : creation.create(params, undefined, false, beforeMutation);
      thread = planned;
      if (this.#closed || this.#core.stopping || this.#core.projects.require(projectId).archived) { await cleanup(); return; }
      this.#atomic(() => {
        creation.publish(planned);
        const latest = this.storage.get(record.section, record.id).value!;
        const transferred: ComposerValue = { ...latest, input: { ...latest.input, text: '', attachments: [], previewReferences: [], queued: latest.input.queued }, draft: undefined };
        this.storage.save('inputs', planned.id, transferred, this.storage.owner(record));
        const retained = { ...latest, input: { ...latest.input, queued: [] } };
        this.storage.save(record.section, record.id, retained.input.text || retained.input.attachments.length || retained.input.previewReferences?.length ? retained : null);
        this.storage.status(launchId, 'delivered', planned.id);
        ledger.forget(planned.id);
      });
      this.#schedule([{ section: 'inputs', id: planned.id }]);
    } catch (error) {
      // Only this launch's unpublished workspaces are ours to remove. A crash
      // or failed cleanup retains its receipt rather than risking a duplicate.
      if ((!thread || !this.#core.journal.getThread(thread.id)) && !mutations.some(ownership => this.#core.journal.getThread(ownership.threadId))) await cleanup();
      throw error;
    }
  }

  stop(): void { this.#closed = true; this.#unsubscribe(); this.#stopWaiting(); }
  async close(): Promise<void> { this.stop(); this.storage.close(); await Promise.all(this.#running.values()); }
}
