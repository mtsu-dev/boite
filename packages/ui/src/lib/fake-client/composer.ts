import { sha256 } from '@noble/hashes/sha2.js';
import {
  answerAttachmentError, ATTACHMENTS_PER_TURN, ATTACHMENTS_TOTAL_MAX_BYTES, composerActivity, composerBatch, composerBytes, composerInputThreadId,
  composerPage, composerRevision, COMPOSER_RECORD_MAX_BYTES, decodedBytes, isComposerActivity, isComposerKey, privateTerminalComposerId, providerSupportsSteering, RpcErrorCode,
  type Attachment, type ComposerChoice, type ComposerCursor, type ComposerQueuedPrompt, type ComposerRecord, type ComposerValue, type RpcEventName, type RpcEvents,
} from '@boite/contracts';
import { RpcFailure } from '../client';
import type { FakeContext, FakeMethods } from './context';
import { refusal } from './shared';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const keyOf = (section: ComposerRecord['section'], id: string) => JSON.stringify([section, id]);
/** Permission mode stays live; the other execution settings remain frozen. */
function sameExecutionChoice(a: ComposerChoice, b: ComposerChoice): boolean {
  return a.providerId === b.providerId && a.accountId === b.accountId && a.model === b.model
    && a.effort === b.effort && (a.speed ?? null) === (b.speed ?? null);
}

/** One fake core's durable composer, shared by explicit peer clients only. */
export class FakeComposerState {
  readonly records = new Map<string, ComposerRecord>();
  readonly assets = new Map<string, Attachment>();
  readonly clients = new Set<FakeContext>();
  readonly consumed = new Map<string, Set<string>>();
  readonly cliPrompts = new Map<string, string>();
  readonly delivering = new Map<string, ComposerQueuedPrompt[]>();
  readonly owners = new Map<string, FakeContext>();
  readonly assetOwners = new Map<string, FakeContext>();
  private pending = false;
  private methods = new Map<FakeContext, () => FakeMethods>();
  private boundaries = new Map<string, RpcEvents['turn.toolCompleted']>();
  private forced = new Map<string, string>();

  attach(ctx: FakeContext, methods: () => FakeMethods): void {
    this.clients.add(ctx);
    this.methods.set(ctx, methods);
    this.schedule(ctx);
  }

  detach(ctx: FakeContext): void {
    this.clients.delete(ctx); this.methods.delete(ctx);
    for (const [key, owner] of this.owners) if (owner === ctx) {
      this.records.delete(key); this.owners.delete(key);
    }
    for (const [id, owner] of this.assetOwners) if (owner === ctx) { this.assets.delete(id); this.assetOwners.delete(id); }
  }

  visible(key: string, ctx: FakeContext): boolean { return !this.records.get(key)?.privateMode || this.owners.get(key) === ctx; }


  forgetThread(id: string): void {
    for (const recordId of [id, privateTerminalComposerId(id)]) {
      const key = keyOf('inputs', recordId);
      this.records.delete(key); this.consumed.delete(key); this.owners.delete(key);
    }
    this.boundaries.delete(id);
    this.forced.delete(id);
    for (const request of this.cliPrompts.keys()) if (request.startsWith(`cli_${id}:`)) this.cliPrompts.delete(request);
  }

  write(section: ComposerRecord['section'], id: string, value: ComposerValue | null, owner?: FakeContext, writer?: FakeContext): ComposerRecord {
    const key = keyOf(section, id);
    const privateMode = !!owner || this.owners.has(key) || (section === 'inputs' && composerInputThreadId(id) !== id);
    const previous = this.records.get(key);
    const record: ComposerRecord = { section, id, revision: (previous?.revision ?? 0) + 1, updatedAt: Date.now(), value: copy(value), ...(privateMode ? { privateMode: true } : {}) };
    const bytes = composerBytes(record);
    if (bytes > COMPOSER_RECORD_MAX_BYTES) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `composer.value: expected at most ${COMPOSER_RECORD_MAX_BYTES} serialized UTF-8 bytes` });
    if (owner) this.owners.set(key, owner);
    this.records.set(key, record);
    // As the core, a boundary or a Send now lasts only while the queue holds something.
    if (section === 'inputs' && !value?.input.queued.length) { this.boundaries.delete(id); this.forced.delete(id); }
    const revision = previous && composerRevision(record, previous, () => bytes);
    for (const client of this.clients) if (client !== writer && this.visible(key, client)) {
      if (revision && client.core.features?.composerPages) client.emit('composer.revision', copy(revision));
      else client.emit('composer.updated', copy(record));
    }
    return copy(record);
  }

  observe<E extends RpcEventName>(ctx: FakeContext, event: E, payload: RpcEvents[E]): void {
    if (event === 'composer.updated') return;
    if (event === 'turn.toolCompleted') {
      const boundary = payload as RpcEvents['turn.toolCompleted'];
      if (this.records.get(keyOf('inputs', boundary.threadId))?.value?.input.queued.length) this.boundaries.set(boundary.threadId, boundary);
    }
    if (event === 'thread.removed') {
      const { threadId, undoable } = payload as RpcEvents['thread.removed'];
      if (!undoable) this.forgetThread(threadId);
    }
    if (['turn.finished', 'turn.toolCompleted', 'permission.resolved', 'question.answered', 'thread.updated'].includes(event)) this.schedule(ctx);
  }

  /** As the core, interrupt for this queued item once pending cards have settled. */
  sendNow(id: string): void {
    const head = this.records.get(keyOf('inputs', id))?.value?.input.queued[0];
    if (head) this.forced.set(id, head.id);
  }

  schedule(ctx: FakeContext): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      const active = this.clients.has(ctx) ? ctx : this.clients.values().next().value;
      if (!active) return;
      for (const [key, row] of this.records) {
        if (!row.value?.input.queued.length || row.value.input.paused || this.delivering.has(key)) continue;
        void this.deliver(this.owners.get(key) ?? active, key);
      }
    });
  }

  private async deliver(ctx: FakeContext, key: string): Promise<void> {
    const row = this.records.get(key);
    const value = row?.value;
    const methods = this.methods.get(ctx)?.();
    if (!row || !value || !methods) return;
    const owner = this.owners.get(key);
    const head = value.input.queued[0]!;
    if (head.request?.failed !== undefined) return;
    if (row.section === 'drafts') { await this.launch(ctx, row, methods); return; }
    const threadId = composerInputThreadId(row.id);
    const thread = ctx.threads.get(threadId);
    if (!thread || thread.archived || ['queued', 'waiting'].includes(thread.status)) return;
    if ([...ctx.pendingPermissions.values()].some(item => item.request.threadId === threadId) || [...ctx.pendingQuestions.values()].some(item => item.request.threadId === threadId && !item.request.async)) return;
    const running = thread.status === 'running';
    const forced = this.forced.get(row.id) === head.id;
    this.forced.delete(row.id);
    if (running && forced) {
      this.delivering.set(key, [head]);
      try { await ctx.stopTurn(threadId); }
      finally { this.delivering.delete(key); this.schedule(ctx); }
      return;
    }
    const boundary = this.boundaries.get(row.id);
    const turn = running ? thread.turns.findLast(item => item.status === 'running') : undefined;
    if (running && (!turn || boundary?.turnId !== turn.id || head.afterBoundary === boundary.boundary || head.request || isComposerActivity(head.text)
      || !sameExecutionChoice(choiceOf({ ...thread, ...turn.execution }), choiceOf(head.choice ?? thread))
      || (turn.execution?.selectionVersion ?? 0) !== (thread.selectionVersion ?? 0))) return;
    const batch = composerBatch(value.input.queued, id => {
      const asset = this.assets.get(id);
      if (!asset) throw refusal(`assetId ${id}: expected an uploaded composer attachment`);
      return copy(asset);
    });
    const entries = batch.entries;
    this.delivering.set(key, entries);
    try {
      const payload = { prompt: batch.text, attachments: batch.attachments, previewReferences: batch.previewReferences };
      const requestId = head.request?.id ?? head.id;
      if (turn) {
        const provider = ctx.providers.find(item => item.id === thread.providerId);
        if (provider?.protocol === 'acp' && !providerSupportsSteering(provider)) {
          if (turn.execution?.operation || thread.activity?.goal?.status === 'active' || thread.activity?.loop?.status === 'active'
            || (thread.background?.length ?? 0) > 0 || ctx.inFlight.get(threadId)?.cancelled !== false
            || thread.messages.some(message => message.turnId === turn.id && message.parts.some(part => part.type === 'tool'
              && (part.status === 'running' || part.nativeAgents?.some(agent => agent.status === 'running'))))) return;
          this.boundaries.delete(row.id);
          await ctx.stopTurn(threadId);
          this.schedule(ctx);
          return;
        }
        const outcome = await methods['turns.steer']({ threadId, turnId: turn.id, ...payload, clientRequestId: requestId, expectedSelectionVersion: thread.selectionVersion ?? 0 });
        if (!outcome.accepted) { this.boundaries.delete(row.id); return; }
      } else {
        this.boundaries.delete(row.id);
        const command = composerActivity(payload.prompt);
        if (command) await methods['threads.activity.set']({ threadId, ...command, ...(payload.attachments.length ? { attachments: payload.attachments } : {}) });
        else {
          const chosen = head.id.startsWith('cli_') ? undefined : head.request?.choice ?? head.choice;
          const selection = choiceOf(thread);
          if (chosen) Object.assign(thread, chosen, { permissionMode: selection.permissionMode });
          // `turns.start` fixes the turn's execution before its first await: the whole picker goes back at once, before any update can land.
          const started = methods['turns.start']({ threadId, ...payload, clientRequestId: requestId });
          if (chosen) Object.assign(thread, selection);
          await started;
        }
      }
      const consumed = this.consumed.get(key) ?? new Set<string>();
      for (const entry of entries) consumed.add(entry.id);
      this.consumed.set(key, consumed);
      const latest = this.records.get(key)?.value;
      if (!latest || (owner && this.owners.get(key) !== owner)) return;
      const current = copy(latest);
      current.input.queued = current.input.queued.filter(item => !consumed.has(item.id));
      this.write('inputs', row.id, current, owner);
    } catch (error) {
      const current = this.records.get(key)?.value;
      if (current) {
        const held = copy(current);
        held.input.paused = true;
        const first = held.input.queued[0];
        if (first) first.request = { id: first.request?.id ?? first.id, choice: first.request?.choice ?? first.choice ?? null, queuedAt: first.request?.queuedAt ?? Date.now(), ...first.request, failed: error instanceof Error ? error.message : String(error) };
        this.write(row.section, row.id, held);
      }
    } finally { this.delivering.delete(key); }
  }

  private async launch(ctx: FakeContext, row: ComposerRecord, methods: FakeMethods): Promise<void> {
    const value = row.value!, head = value.input.queued[0]!;
    const key = keyOf(row.section, row.id);
    const owner = this.owners.get(key);
    const choice = head.request?.choice ?? head.choice ?? value.choice;
    if (!choice || !value.draft) return;
    this.delivering.set(key, [head]);
    try {
      const projectId = value.draft.projectId ?? (await methods['projects.drafts']({})).id;
      const { model, ...selection } = choice;
      const thread = await methods['threads.create']({ ...selection, ...(model ? { model } : {}), projectId, title: head.text.slice(0, 60), clientRequestId: head.request?.id ?? head.id, ...(value.draft.worktree ? { worktree: {} } : {}), ...(value.draft.incognito ? { incognito: true } : {}) });
      const latest = this.records.get(key)?.value;
      if (!latest || (owner && this.owners.get(key) !== owner)) return;
      const transferred = copy(latest);
      delete transferred.draft;
      transferred.input.text = ''; transferred.input.attachments = []; transferred.input.previewReferences = [];
      this.write('inputs', thread.id, transferred, owner);
      const kept = copy(latest);
      kept.input.queued = [];
      this.write('drafts', row.id, kept.input.text || kept.input.attachments.length || kept.input.previewReferences?.length ? kept : null, owner);
      // Peers share composer metadata. The fixture's owning core creates and runs the thread.
      this.schedule(ctx);
    } catch (error) {
      const latest = this.records.get(key)?.value;
      if (!latest || (owner && this.owners.get(key) !== owner)) return;
      const held = copy(latest);
      held.input.paused = true;
      const first = held.input.queued[0]!;
      first.request = { id: first.request?.id ?? first.id, choice, queuedAt: Date.now(), ...first.request, failed: error instanceof Error ? error.message : String(error) };
      this.write('drafts', row.id, held, owner);
    } finally { this.delivering.delete(key); }
  }
}

function choiceOf(thread: ComposerChoice): ComposerChoice {
  return { providerId: thread.providerId, accountId: thread.accountId, permissionMode: thread.permissionMode, model: thread.model, effort: thread.effort, speed: thread.speed ?? null };
}

export function composerMethods(ctx: FakeContext, methods: () => FakeMethods): Pick<FakeMethods, 'composer.list' | 'composer.listPage' | 'composer.get' | 'composer.put' | 'composer.enqueue' | 'composer.asset.put' | 'composer.asset.get'> {
  const state = ctx.composer;
  state.attach(ctx, methods);
  return {
    'composer.list': async () => copy([...state.records].filter(([key]) => state.visible(key, ctx)).map(([, row]) => row)),
    'composer.listPage': async params => {
      const after = params?.after;
      if (after !== undefined && (!isComposerKey(after) || (after.privateMode !== undefined && after.privateMode !== true))) {
        throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'composer.listPage.after: expected a cursor from an earlier page' });
      }
      const byText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
      const compare = (a: ComposerCursor, b: ComposerCursor) => Number(!!a.privateMode) - Number(!!b.privateMode) || byText(a.section, b.section) || byText(a.id, b.id);
      const rows = [...state.records].filter(([key, row]) => state.visible(key, ctx) && (!after || compare(row, after) > 0)).map(([, row]) => row).sort(compare);
      return copy(composerPage(rows));
    },
    'composer.get': async params => {
      if (!isComposerKey(params)) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'composer.get: expected section inputs/drafts and a nonempty id' });
      const { section, id } = params, key = keyOf(section, id);
      if (!state.visible(key, ctx)) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: 'composer.id: this private composer belongs to another connection' });
      return copy(state.records.get(key) ?? { section, id, revision: 0, updatedAt: 0, value: null });
    },
    'composer.enqueue': async params => {
      // Type-check before testing the request ID's format.
      if (typeof params?.threadId !== 'string' || typeof params.prompt !== 'string' || !params.prompt.trim() || typeof params.clientRequestId !== 'string') {
        throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'composer.enqueue: expected threadId, a non-empty prompt and clientRequestId' });
      }
      const { threadId, prompt, clientRequestId: requestId } = params;
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw refusal('clientRequestId must contain 8 to 128 URL-safe characters');
      const thread = ctx.thread(threadId);
      const id = `cli_${threadId}:${requestId}`;
      const previous = ctx.turnRequests.get(`${threadId}:${requestId}`);
      if (previous) {
        if (previous.content !== JSON.stringify([prompt, []])) throw refusal('clientRequestId was already used for different content');
        return { requestId, status: 'sent', turnId: previous.turn.id };
      }
      if (ctx.canRevive(thread)) {
        const started = await methods()['turns.start'](params);
        return { requestId, status: 'sent', turnId: started.id };
      }
      const recordId = thread.incognito ? privateTerminalComposerId(threadId) : threadId;
      const key = keyOf('inputs', recordId);
      const record = state.records.get(key);
      const queued = record?.value?.input.queued.find(item => item.id === id);
      const consumed = state.consumed.get(key)?.has(id);
      if ((queued && queued.text !== prompt) || (consumed && state.cliPrompts.get(id) !== prompt)) throw refusal('clientRequestId was already used for different content');
      if (consumed) return { requestId, status: 'sent' };
      if (queued) {
        if (thread.incognito && queued.request?.failed && record?.value?.input.queued[0] === queued) {
          const value = copy(record.value);
          delete value.input.queued[0]!.request!.failed;
          value.input.paused = false;
          state.write('inputs', recordId, value);
          state.schedule(ctx);
          return { requestId, status: 'queued' };
        }
        return { requestId, status: record?.value?.input.paused ? 'held' : 'queued', ...(queued.request?.failed ? { reason: queued.request.failed } : {}) };
      }
      if (thread.archived || ctx.projects.some(project => project.id === thread.projectId && project.archived)) throw refusal('cannot send a prompt in an archived conversation or project');
      const value: ComposerValue = copy(record?.value ?? { input: { text: '', attachments: [], queued: [], paused: false } });
      value.input.queued.push({ id, text: prompt, attachments: [], request: { id: requestId, choice: null, queuedAt: Date.now() }, experiments: ctx.clientPreferences?.experiments ?? [], sentFrom: null });
      if (thread.incognito) {
        state.write('inputs', recordId, value);
        state.schedule(ctx);
      } else {
        const saved = await methods()['composer.put']({ section: 'inputs', id: recordId, expectedRevision: record?.revision ?? 0, value });
        if (!saved.accepted) throw refusal('the composer changed; retry with the same clientRequestId');
      }
      state.cliPrompts.set(id, prompt);
      return { requestId, status: value.input.paused ? 'held' : 'queued' };
    },
    'composer.put': async params => {
      if (params.section === 'inputs' && composerInputThreadId(params.id) !== params.id) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: 'composer.id: expected an existing thread' });
      if (params.section === 'inputs' && params.value !== null && !ctx.threads.has(params.id)
        && ![...ctx.deletedThreads.values()].some(family => family.threads.some(thread => thread.id === params.id))
        && ![...ctx.removedProjects.values()].some(project => project.threads.some(thread => thread.id === params.id))) {
        throw new RpcFailure({ code: RpcErrorCode.NotFound, message: 'composer.id: expected an existing thread; this conversation was permanently deleted', data: { reason: 'thread-deleted', threadId: params.id, field: 'composer.id' } });
      }
      const key = keyOf(params.section, params.id);
      if (!state.visible(key, ctx)) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: 'composer.id: this private composer belongs to another connection' });
      const existing = state.records.get(key) ?? { section: params.section, id: params.id, revision: 0, updatedAt: 0, value: null };
      if (params.expectedRevision !== existing.revision) return { accepted: false, record: copy(existing) };
      const value = copy(params.value);
      const privateMode = state.owners.has(key) || value?.draft?.incognito || (params.section === 'inputs' && ctx.threads.get(params.id)?.incognito);
      if (privateMode && existing.revision && !state.owners.has(key)) throw refusal('composer: a persisted composer cannot become incognito; use a new draft');
      const locked = state.delivering.get(key);
      if (locked?.some((entry, index) => JSON.stringify(value?.input.queued[index]) !== JSON.stringify(entry))) return { accepted: false, record: copy(existing) };
      if (value) {
        const consumed = state.consumed.get(key);
        value.input.queued = value.input.queued.filter(entry => !consumed?.has(entry.id));
        const selected = params.section === 'inputs' ? ctx.threads.get(params.id) : null;
        for (const queued of value.input.queued) {
          if (!queued.choice && selected) queued.choice = choiceOf(selected);
          // The first experiments the core saw for an item stay its own; an app that sent none lends its current ones.
          const previous = existing.value?.input.queued.find(previous => previous.id === queued.id);
          queued.experiments = previous?.experiments ?? queued.experiments ?? ctx.clientPreferences?.experiments ?? [];
          // The core stamps the origin it first saw; the fake's one connection names no app.
          queued.sentFrom = previous?.sentFrom !== undefined ? previous.sentFrom : null;
        }
        for (const file of [...value.input.attachments, ...value.input.queued.flatMap(entry => entry.attachments)]) if (!state.assets.has(file.assetId) || (state.assetOwners.has(file.assetId) && (!privateMode || state.assetOwners.get(file.assetId) !== ctx))) throw refusal(`assetId ${file.assetId}: expected an uploaded composer attachment`);
        // The core's `validateAssets`: each prompt, box or queued, within what one message may carry.
        for (const input of [value.input, ...value.input.queued]) {
          if (input.attachments.length > ATTACHMENTS_PER_TURN) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `composer.attachments: expected at most ${ATTACHMENTS_PER_TURN} attachments per input` });
          if (input.attachments.reduce((sum, file) => sum + decodedBytes(state.assets.get(file.assetId)!.data), 0) > ATTACHMENTS_TOTAL_MAX_BYTES) {
            throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `composer.attachments: expected at most ${ATTACHMENTS_TOTAL_MAX_BYTES} bytes per input` });
          }
        }
      }
      const record = state.write(params.section, params.id, value, privateMode ? ctx : undefined, ctx);
      if (params.section === 'inputs' && params.sendNow && value?.input.queued.length) state.sendNow(params.id);
      state.schedule(ctx);
      return { accepted: true, record };
    },
    'composer.asset.put': async ({ attachment, incognito }) => {
      const error = answerAttachmentError([attachment]);
      if (error) throw refusal(error.message);
      const bytes = sha256(new TextEncoder().encode(JSON.stringify(attachment)));
      const assetId = `${incognito ? `private-${ctx.composerClientId}-` : ''}${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
      if (incognito) state.assetOwners.set(assetId, ctx);
      state.assets.set(assetId, copy(attachment));
      return { assetId };
    },
    'composer.asset.get': async ({ assetId }) => {
      const referenced = [...state.records].some(([key, row]) => state.visible(key, ctx) && row.value && [...row.value.input.attachments, ...row.value.input.queued.flatMap(entry => entry.attachments)].some(file => file.assetId === assetId));
      const attachment = state.assets.get(assetId);
      if (!referenced || !attachment) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `assetId ${assetId}: expected a referenced composer attachment` });
      return copy(attachment);
    },
  };
}
