import { RpcErrorCode, deriveThreadCapabilities, providerSupportsSteering, providerEnabled, threadActive } from '@boite/contracts';
import type { FakeContext, FakeMethods } from './context';
import { RpcFailure } from '../client';
import { threadModel } from './provider-catalog';

/** The fixture reports its implemented controls through the same pure mapping as the core. */
export function capabilityMethods(ctx: FakeContext): Pick<FakeMethods, 'threads.capabilities' | 'drafts.images'> {
  return {
    // The fixture has no folders of pi settings: the account's catalog answers, as the core's does for a folder that changes nothing.
    'drafts.images': async ({ projectId, providerId, accountId, model, threadId, worktree }) => {
      if (!ctx.projects.some(project => project.id === projectId)) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `unknown project ${projectId}` });
      if (threadId !== undefined && ctx.thread(threadId).projectId !== projectId) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `drafts.images.threadId: ${threadId} is a thread of project ${ctx.thread(threadId).projectId}, not ${projectId}`, data: { field: 'threadId', expected: projectId } });
      const provider = ctx.providers.find(item => item.id === providerId);
      if (!provider) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `unknown provider ${providerId}` });
      const account = ctx.accounts.find(item => item.id === accountId);
      if (!account) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `unknown account ${accountId}`, data: { accountId } });
      if (account.providerId !== providerId) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `drafts.images.accountId: ${accountId} is an account of ${account.providerId}, not ${providerId}`, data: { field: 'accountId', expected: providerId } });
      if (threadId !== undefined && worktree) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `drafts.images.worktree: ${threadId} already runs in ${ctx.thread(threadId).cwd}`, data: { field: 'worktree', expected: 'absent with threadId' } });
      // No preparation here reserves a worktree: the first turn's admission there decides, as the core's does before it exists.
      if (worktree) return { supported: provider.capabilities.images };
      return { supported: provider.capabilities.images && threadModel(ctx, { providerId, accountId, model: model ?? (provider.protocol === 'pi' ? 'default' : null) })?.images !== false };
    },
    'threads.capabilities': async ({ threadId }) => {
      const thread = ctx.thread(threadId);
      const provider = ctx.providers.find(item => item.id === thread.providerId);
      const account = ctx.accounts.find(item => item.id === thread.accountId);
      const protocol = provider?.protocol ?? null;
      const turn = thread.turns.findLast(item => item.status === 'running');
      const running = ctx.inFlight.get(threadId);
      const pendingApprovals = [...ctx.pendingPermissions.values()].some(item => item.request.threadId === threadId);
      const pendingQuestions = [...ctx.pendingQuestions.values()].filter(item => item.request.threadId === threadId);
      const steeringSupported = providerSupportsSteering(provider);
      const steeringReason = thread.status !== 'running' || !turn || !running || running.cancelled ? 'not-running'
        : turn.execution?.operation === 'compact' ? 'busy'
        : !steeringSupported ? 'unsupported'
        : (turn.execution?.selectionVersion ?? 0) !== (thread.selectionVersion ?? 0) ? 'selection-changed'
        : pendingApprovals || pendingQuestions.some(item => !item.request.async) ? 'awaiting-input' : null;
      return deriveThreadCapabilities({
        threadId, providerId: thread.providerId, protocol, selectionVersion: thread.selectionVersion ?? 0,
        providerCapabilities: provider?.capabilities ?? null, modelImages: threadModel(ctx, thread)?.images,
        runtimeReason: !provider ? 'provider-unavailable' : !providerEnabled(provider) ? 'provider-disabled' : !provider.available ? 'provider-unavailable' : !account || account.providerId !== thread.providerId || account.status === 'unauthenticated' ? 'account-unavailable' : null,
        // A persistent agent's own thread takes the user's messages like any thread; only a projectless one of no agent has no conversation.
        conversationReason: thread.archived ? 'archived' : !thread.agentSessionId && thread.projectId === null ? 'agent-session' : null,
        busy: threadActive(thread.status) || Boolean(running), steeringSupported, steeringReason,
        compactionReason: !thread.sessionId ? 'no-session' : protocol === 'acp' && !thread.commands.some(command => command.name === 'compact') ? 'no-command' : null,
        preparationSupported: protocol === 'claude-sdk' || protocol === 'codex-appserver' || protocol === 'pi',
        pendingApprovals, pendingQuestions: pendingQuestions.length > 0,
        hasForkHistory: thread.messages.some(message => message.state !== 'streaming'),
        hasRewindHistory: thread.messages.some(message => message.role === 'user'),
        // Fixture branching deliberately seeds history; it owns no native transcript.
        nativeForkSupported: false, nativeForkAvailable: false,
        nativeRewindSupported: false, nativeRewindAvailable: false,
        backgroundSupported: protocol === 'claude-sdk' || (thread.background?.length ?? 0) > 0,
      });
    },
  };
}

/** The whole conversation's compactions and prompts, as `journal/thread-stats.ts` counts them in the core. */
export function threadStatsMethods(ctx: FakeContext): Pick<FakeMethods, 'threads.stats'> {
  return {
    'threads.stats': async ({ threadId }) => {
      const thread = ctx.thread(threadId);
      const compactions = thread.messages.filter(message => message.role !== 'user')
        .reduce((sum, message) => sum + message.parts.filter(part => part.type === 'compaction').length, 0);
      return { threadId, compactions, prompts: thread.messages.filter(message => message.role === 'user').length };
    }
  };
}
