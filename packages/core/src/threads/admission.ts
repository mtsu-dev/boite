import { previewReferencesError, type Attachment, type ComposerChoice, type PreviewReference, type ThreadId, type ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { assertDriverRunnable } from '../drivers/index.ts';
import { refused } from '../errors.ts';
import { requireAgent } from './agentless.ts';
import { checkAttachmentArray, checkAttachments } from './inputs.ts';
import { checkSelection, checkStoredEffort, checkStoredSpeed } from './selection.ts';

/** Checks that also apply before returning a receipt for an earlier submission. */
export function checkTurnInput(core: Core, threadId: ThreadId, prompt: string, attachments: Attachment[], previews: PreviewReference[]): ThreadSummary {
  if (core.stopping) throw refused('the core is stopping; reconnect before sending another prompt');
  const thread = requireAgent(core.threads, threadId);
  core.threads.codeCheckpoints.assertAvailable(thread.cwd);
  checkAttachmentArray(attachments);
  const error = previewReferencesError(previews, prompt);
  if (error) throw refused(error);
  return thread;
}

/**
 * Why a turn on `thread`, run with the selection `choice` an input was queued
 * with, cannot be accepted, or null. `threads.startTurn` and the composer's
 * outbox (`composer.ts`) both ask it, so an input the outbox holds carries the
 * refusal a direct start gives.
 */
export function admissionRefusal(core: Core, thread: ThreadSummary, choice?: ComposerChoice): string | null {
  if (thread.archived) return 'cannot start a turn on an archived thread';
  if (choice === undefined) return null;
  const account = core.accounts.require(choice.accountId);
  if (core.providers.get(choice.providerId) === undefined || account.providerId !== choice.providerId || account.status === 'unauthenticated') {
    return 'the queued account is unavailable; choose an account and enqueue this input again';
  }
  return null;
}

/** Resolve a queued choice and check current execution policy without admitting a turn. */
export function prepareTurnExecution(core: Core, thread: ThreadSummary, attachments: Attachment[], choice?: ComposerChoice): ThreadSummary {
  if (choice) {
    const provider = core.providers.require(choice.providerId);
    const account = core.accounts.require(choice.accountId);
    const selection = checkSelection(provider, account.id, choice.model, choice.effort, choice.speed ?? null);
    const sameAccount = thread.providerId === provider.id && thread.accountId === account.id;
    thread = { ...thread, providerId: provider.id, accountId: account.id, ...selection,
      ...(!sameAccount ? { sessionId: null, sessionResumeAt: null } : {}) };
  }
  const threadId = thread.id;
  core.sharedCompute?.assertTurn(threadId);
  core.sharedAccess?.assertTurn(threadId);
  const provider = core.providers.require(thread.providerId);
  const account = core.accounts.require(thread.accountId);
  if (account.providerId !== provider.id) throw refused(`accountId: account ${account.id} belongs to provider ${account.providerId}; expected provider ${provider.id}`, {
    field: 'accountId', accountId: account.id, providerId: account.providerId, expected: provider.id,
  });
  assertDriverRunnable(provider.protocol, core.providers.summary(provider.id), account, () => core.providers.launcherScriptOnly(provider.id));
  checkStoredEffort(provider, account.id, thread.model, thread.effort);
  checkStoredSpeed(provider, account.id, thread.model, thread.speed ?? null);
  checkAttachments(attachments, provider);
  core.sharedAccess.uploads(threadId, attachments);
  return thread;
}
