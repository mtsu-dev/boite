import { resumeModelSelection, resumeReceiptConflict, threadActive, type Attachment, type RpcParams, type ThreadRecovery, type Turn } from '@boite/contracts';
import type { FakeContext } from './context';
import { checkEffort, checkModel, checkRunnable } from './checks';
import { modelsOf } from './provider-catalog';
import { refusal } from './shared';
import { requireFakeCwd } from './worktrees';

/** A fixture for an accepted prompt whose core stopped before its provider ran. */
export function holdAfterRestart(ctx: FakeContext, threadId: string, prompt: string): Turn {
  const thread = ctx.thread(threadId);
  if (threadActive(thread.status)) throw refusal('this thread already has an in-flight turn');
  const now = ctx.now();
  const turn: Turn = {
    id: `turn-${++ctx.seq}`, threadId, status: 'queued', queuedAt: now, startedAt: null, finishedAt: null, usage: null, error: null,
    queueHold: { reason: 'core-restarted', since: now },
    execution: { providerId: thread.providerId, accountId: thread.accountId, model: thread.model, effort: thread.effort,
      speed: thread.speed ?? null, permissionMode: thread.permissionMode, sessionId: thread.sessionId,
      sessionGeneration: thread.sessionGeneration ?? 0, selectionVersion: thread.selectionVersion ?? 0 },
  };
  thread.turns.push(turn);
  const message = { id: `m-${++ctx.seq}`, threadId, turnId: turn.id, role: 'user' as const, state: 'complete' as const, parts: [{ type: 'text' as const, text: prompt }], createdAt: now };
  thread.messages.push(message);
  thread.status = 'queued';
  ctx.scheduler.queued.push({ turnId: turn.id, threadId, queuedAt: now, position: ctx.scheduler.queued.length, queueHold: turn.queueHold });
  ctx.emitToThread(threadId, 'message.started', structuredClone(message));
  ctx.emit('scheduler.updated', structuredClone(ctx.scheduler));
  ctx.touch(thread);
  return structuredClone(turn);
}

export async function recoverTurn(ctx: FakeContext, params: RpcParams<'turns.recover'>): Promise<Turn> {
  const thread = ctx.thread(params.threadId);
  if (params.action !== 'resume' && params.action !== 'discard') throw refusal('action must be resume or discard');
  const turn = thread.turns.find(entry => entry.id === params.turnId);
  if (!turn) throw ctx.notFound('turnId', params.turnId);
  if (turn.status !== 'queued' || !turn.queueHold) return structuredClone(turn);
  if (params.action === 'discard') {
    await ctx.stopTurn(thread.id);
    return structuredClone(turn);
  }
  if (thread.archived || thread.parentThreadId || thread.agentSessionId || !turn.execution || turn.execution.operation) throw refusal('only an unsent conversation prompt can be resumed');
  requireFakeCwd(ctx, thread);
  const provider = ctx.providers.find(entry => entry.id === turn.execution!.providerId);
  const account = ctx.accounts.find(entry => entry.id === turn.execution!.accountId);
  if (!provider || !account || account.providerId !== provider.id) throw refusal('the saved provider and account must be available');
  checkRunnable(provider, account);
  const input = thread.messages.find(message => message.turnId === turn.id && message.role === 'user');
  const text = input?.parts.find(part => part.type === 'text');
  const attachments: Attachment[] = (input?.parts ?? []).flatMap((part): Attachment[] => part.type === 'image'
    ? [{ kind: 'image', mimeType: part.mimeType, data: part.data, name: part.alt }]
    : part.type === 'file' ? [{ kind: 'file', mimeType: part.mimeType, data: part.data, name: part.name }] : []);
  return ctx.startTurn(thread.id, text?.type === 'text' ? text.displayText ?? text.text : '', attachments, undefined, undefined, turn, text?.type === 'text' ? text.previewReferences ?? [] : []);
}

export function offerRecovery(ctx: FakeContext, threadId: string, recovery: ThreadRecovery): void {
  const thread = ctx.thread(threadId);
  thread.recovery = recovery;
  ctx.touch(thread);
}

export function resumeTurn(ctx: FakeContext, { threadId, turnId, model, effort, expectedSelectionVersion }: RpcParams<'turns.resume'>): Turn {
  const thread = ctx.thread(threadId);
  const key = `${threadId}:manual-resume_${turnId}`;
  const receipt = ctx.turnRequests.get(key);
  if (receipt) {
    const execution = receipt.turn.execution;
    const conflict = resumeReceiptConflict(execution ? modelsOf(ctx, execution.providerId, execution.accountId) : [], execution, { model, effort }, receipt.requested);
    if (conflict === 'model') throw refusal('this turn already resumed on another model');
    if (conflict === 'effort') throw refusal('this turn already resumed with another reasoning effort');
    return structuredClone(receipt.turn);
  }
  const recovery = thread.recovery;
  if (!recovery || recovery.turnId !== turnId || thread.archived || thread.parentThreadId || thread.turns.findLast(turn => turn.execution?.operation !== 'keepalive')?.id !== turnId) {
    throw refusal('turnId must name the latest interrupted turn of this thread', { field: 'turnId', threadId, turnId });
  }
  if (expectedSelectionVersion !== undefined && expectedSelectionVersion !== (thread.selectionVersion ?? 0)) throw refusal('the agent selection changed');
  requireFakeCwd(ctx, thread);
  const models = modelsOf(ctx, thread.providerId, thread.accountId);
  const { model: requestedModel, effort: nextEffort, aliasEffort, changedModel, changed } = resumeModelSelection(models, thread, { model, effort });
  if (changed && (recovery.kind !== 'usage-limit' || thread.agentSessionId)) throw refusal('the model or reasoning effort can only change when resuming an ordinary conversation after a usage limit');
  const provider = ctx.providers.find(entry => entry.id === thread.providerId);
  const account = ctx.accounts.find(entry => entry.id === thread.accountId);
  if (!provider || !account) throw refusal('the saved provider and account must be available');
  checkRunnable(provider, account);
  const selected = changed ? checkModel(provider, account.id, models, requestedModel, ctx.modelCatalogs.has(`${provider.id}::${account.id}`)) : null;
  if (changed) checkEffort(provider, models, selected, nextEffort);
  const messages = thread.messages.filter(message => message.turnId === turnId && (message.role === 'user' || message.role === 'system'));
  const parts = messages.flatMap(message => message.parts);
  const text = parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n');
  const attachments: Attachment[] = parts.flatMap((part): Attachment[] => part.type === 'image'
    ? [{ kind: 'image', mimeType: part.mimeType, data: part.data, name: part.alt }]
    : part.type === 'file' ? [{ kind: 'file', mimeType: part.mimeType, data: part.data, name: part.name }] : []);
  const turn = ctx.startTurn(threadId, `Continue the interrupted task.\n\n${text}`, attachments, 'resume', undefined, undefined, [], false, 'Resumed interrupted work',
    changed ? { model: selected, effort: nextEffort, speed: changedModel ? null : thread.speed } : undefined);
  ctx.turnRequests.set(key, {
    content: text,
    turn: thread.turns.find(entry => entry.id === turn.id)!,
    messageId: thread.messages.find(message => message.turnId === turn.id)!.id,
    requested: { model, effort, aliasEffort },
  });
  return turn;
}
