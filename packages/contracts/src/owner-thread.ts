import { loggedInAccount, type Account } from './accounts';
import type { ContextPreset, ContextRequest } from './context-mode';
import type { ProjectId, ThreadId } from './ids';
import type { ProviderSummary } from './providers';
import type { ThreadsRpcMethods, ThreadSummary } from './threads';

/** The terminal's explicit arguments, before the core supplies defaults. */
export interface OwnerThreadRequest {
  project: string;
  prompt: string;
  clientRequestId: string;
  sourceThreadId?: ThreadId;
  title?: string;
  model?: string;
  effort?: string;
  speed?: string;
  worktree?: true;
  context?: ContextPreset | ContextRequest;
}

export function ownerThreadRequestKey(request: OwnerThreadRequest): string {
  return JSON.stringify([request.project, request.prompt, request.sourceThreadId, request.title, request.model,
    request.effort, request.speed, request.worktree, request.context]);
}

/** Fill in a terminal launch's picker from its source, or an available account for a first thread. */
export function ownerThreadSelection(request: OwnerThreadRequest, projectId: ProjectId, threads: ThreadSummary[], providers: ProviderSummary[], accounts: Account[]): ThreadsRpcMethods['threads.create']['params'] {
  const sources = threads.filter(thread => !thread.parentThreadId && !thread.agentSessionId).sort((a, b) => b.updatedAt - a.updatedAt);
  const base = request.sourceThreadId === undefined ? sources.find(thread => thread.projectId === projectId) ?? sources[0]
    : sources.find(thread => thread.id === request.sourceThreadId);
  if (request.sourceThreadId !== undefined && !base) throw new Error(`no source conversation ${request.sourceThreadId}; boite threads lists them`);
  const slash = request.model?.indexOf('/') ?? -1;
  const qualified = slash > 0 ? providers.find(provider => provider.id === request.model!.slice(0, slash)) : undefined;
  const model = qualified ? request.model!.slice(slash + 1) : request.model ?? base?.model ?? undefined;
  if (model === '') throw new Error('--model needs a model after the provider');
  const available = providers.filter(provider => provider.available && provider.enabled !== false);
  const providerId = qualified?.id ?? base?.providerId;
  const eligible = accounts.filter(account => providerId === undefined
    ? available.some(provider => provider.id === account.providerId && (model === undefined || provider.models.some(entry => entry.id === model)))
    : account.providerId === providerId);
  const account = eligible.find(entry => entry.id === base?.accountId && entry.status !== 'unauthenticated') ?? loggedInAccount(eligible);
  if (!account) throw new Error(`no usable account${providerId ? ` for ${providerId}` : model ? ` for model ${model}` : ''}; sign in to an installed agent in Accounts`);
  const models = providers.find(entry => entry.id === account.providerId)?.models ?? [];
  const selected = model ?? models.find(entry => entry.default === true)?.id ?? models[0]?.id;
  return {
    projectId, providerId: account.providerId, accountId: account.id, title: request.title ?? request.prompt.trim().split('\n')[0]!.slice(0, 80),
    ...(selected === undefined ? {} : { model: selected }), effort: request.effort ?? (request.model === undefined ? base?.effort ?? null : null),
    permissionMode: base?.permissionMode ?? 'default', ...(request.speed === undefined ? {} : { speed: request.speed }),
    ...(request.worktree ? { worktree: {} } : {}), ...(request.context === undefined ? {} : { context: request.context }),
  };
}
