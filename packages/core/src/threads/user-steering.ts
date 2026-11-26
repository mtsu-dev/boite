import { createHash } from 'node:crypto';
import { previewPrompt, previewReferencesError, type Message, type MessagePart, type PluginActor, type RpcParams, type SentFrom, type ThreadCapabilityReason, type Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { prepareAttachments } from '../attachments.ts';
import { messageOf, refused } from '../errors.ts';
import { requireAgent } from './agentless.ts';
import { newId } from '../ids.ts';
import type { ThreadStore } from '../threads.ts';
import { checkAttachmentArray, checkAttachments } from './inputs.ts';
import { imageInputModel } from './selection.ts';
import { saveThread } from './records.ts';
import { expandSlashPrompt } from '../plugins/extensions.ts';

/** Shared read-only gate for the composer and the live submission path. */
export function userSteeringUnavailable(core: Core, threads: ThreadStore, threadId: string, turn: Turn | null): ThreadCapabilityReason | null {
  const thread = threads.require(threadId);
  if (core.stopping) return 'stopping';
  if (thread.archived) return 'archived';
  const handle = threads.runner.handles.get(threadId);
  if (thread.status !== 'running' || !turn || turn.threadId !== threadId || turn.status !== 'running') return 'not-running';
  if (turn.execution?.operation === 'compact' || turn.execution?.operation === 'keepalive' || threads.runner.steering.has(threadId)) return 'busy';
  if (!handle?.steerUser && !handle?.steer) return 'unsupported';
  if ((turn.execution?.selectionVersion ?? 0) !== (thread.selectionVersion ?? 0)) return 'selection-changed';
  if (threads.listPermissions(threadId).length || threads.listQuestions(threadId).some(question => !question.async)) return 'awaiting-input';
  return null;
}

/**
 * User input keeps its own provenance and receipt while sharing the active provider turn.
 * `plugin`: the plugin that steered, named on the message as `turns.start` names it.
 */
export async function steerUser(core: Core, threads: ThreadStore, params: RpcParams<'turns.steer'>, sentFrom: SentFrom | null = null, plugin?: PluginActor): Promise<{ accepted: boolean }> {
  const { threadId, turnId, prompt, clientRequestId, expectedSelectionVersion } = params;
  const thread = requireAgent(threads, threadId);
  if (core.stopping || thread.archived) throw refused('user steering requires an active, unarchived conversation');
  if (typeof prompt !== 'string') throw refused('prompt must be a string', { field: 'prompt', expected: 'a string' });
  if (typeof clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(clientRequestId)) throw refused('clientRequestId must contain 8 to 128 URL-safe characters');
  const attachments = params.attachments ?? [];
  const references = params.previewReferences ?? [];
  checkAttachmentArray(attachments);
  const referenceError = previewReferencesError(references, prompt);
  if (referenceError) throw refused(referenceError);
  const previous = core.journal.turnRequest(threadId, clientRequestId);
  // The input joins the active turn, so its images go to that turn's model, which a queued prompt may have picked.
  const active = core.journal.getTurn(turnId);
  const runs = active?.threadId === threadId && active.execution ? { ...active.execution, id: threadId } : thread;
  const provider = core.providers.require(runs.providerId);
  // A receipt belongs to the turn that accepted it, even after the model changes.
  checkAttachments(attachments, provider, previous ? undefined : () => imageInputModel(core, provider, runs));
  const fingerprint = createHash('sha256').update(JSON.stringify([turnId, prompt, attachments, references])).digest('hex');
  if (previous) {
    if (!previous.fingerprint.endsWith(`:${fingerprint}`)) throw refused('clientRequestId was already used for different content');
    if (previous.fingerprint === `steer:accepted:${fingerprint}`) return { accepted: true };
    throw refused('delivery of this message is unconfirmed; it will not be submitted again automatically', { reason: 'delivery-uncertain', threadId });
  }
  if (expectedSelectionVersion !== undefined && expectedSelectionVersion !== (thread.selectionVersion ?? 0)) throw refused('the model selection changed; review the selected model and send again');
  const turn = core.journal.getTurn(turnId);
  const runner = threads.runner;
  const handle = runner.handles.get(threadId);
  const submit = handle?.steerUser?.bind(handle) ?? handle?.steer?.bind(handle);
  if (userSteeringUnavailable(core, threads, threadId, turn) !== null || !handle || !submit) return { accepted: false };
  core.sharedAccess.uploads(threadId, attachments);
  const expanded = expandSlashPrompt(core, prompt, threads.agentState.commands.get(threadId));
  const offset = expanded.length - prompt.length;
  const expandedReferences = references.map(reference => reference.mention ? {
    ...reference, mention: { start: reference.mention.start + offset, end: reference.mention.end + offset },
  } : reference);
  const text = previewPrompt(expanded, expandedReferences);
  const prepared = prepareAttachments(core.dataDir, { prompt: text, attachments });
  const message: Message = { id: newId('msg_'), threadId, turnId, role: 'user', state: 'complete', createdAt: Date.now(), parts: [
    { type: 'text', text, ...(sentFrom ? { sentFrom } : {}), ...(plugin ? { byPlugin: plugin } : {}), ...(references.length ? { displayText: expanded, previewReferences: structuredClone(expandedReferences) } : {}) },
    ...attachments.map((attachment): MessagePart => attachment.kind === 'file'
      ? { type: 'file', mimeType: attachment.mimeType, data: attachment.data, name: attachment.name }
      : { type: 'image', mimeType: attachment.mimeType, data: attachment.data, alt: attachment.name }),
  ] };
  const steering = runner.beginSteering(threadId, handle);
  if (!steering) return { accepted: false };
  let published = false;
  const publish = (): void => {
    if (published || steering.signal.aborted) return;
    core.bus.afterCommit(() => core.journal.db.transaction(() => {
      core.journal.append({ type: 'message.started', threadId, version: 1, payload: message }, () => {
        core.journal.putMessage(message);
        core.journal.db.query('UPDATE turn_requests SET fingerprint = ?, message_id = ? WHERE thread_id = ? AND request_id = ?').run(`steer:accepted:${fingerprint}`, message.id, threadId, clientRequestId);
      });
      core.bus.emit('message.started', message);
      core.bus.emit('message.completed', { threadId, messageId: message.id, state: 'complete' });
      runner.answerAfter.set(turnId, message.createdAt);
      saveThread(core, threads.require(threadId), 'thread.userInput');
    })());
    // A `/goal2`'s checklist reads what the user adds, drops or changes.
    core.activity.userMessage(threadId, expanded);
    published = true;
  };
  try {
    // Reserve before crossing the native boundary. A lost acknowledgement or crash cannot cause duplicate work.
    core.journal.putTurnRequest(threadId, clientRequestId, `steer:pending:${fingerprint}`, turnId);
    if (!await steering.send(submit, prepared.prompt, prepared.attachments, publish) && !published) {
      core.journal.db.query('DELETE FROM turn_requests WHERE thread_id = ? AND request_id = ?').run(threadId, clientRequestId);
      return { accepted: false };
    }
    publish();
    return { accepted: true };
  } catch (error) {
    if (published) return { accepted: true };
    throw refused(`delivery of this message is unconfirmed: ${messageOf(error)}`, { reason: 'delivery-uncertain', threadId });
  } finally {
    steering.release();
    void threads.deferred.flushRunning(threadId);
  }
}
