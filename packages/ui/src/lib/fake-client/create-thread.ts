import type { Message, RpcParams, Thread, Turn } from '@boite/contracts';
import { RpcErrorCode, resolveModelSelection } from '@boite/contracts';
import { RpcFailure } from '../client';
import type { FakeContext } from './context';
import { fakeContextMode } from './context-mode';
import { checkCwd, checkEffort, checkModel, defaultModel } from './checks';
import { modelsOf, checkSpeed, discoverSelection } from './provider-catalog';
import { requireFakeFolder, archiveProject } from './project-archive';
import { registerFakeWorktree } from './worktrees';
import { DATA_DIR, fakeWorktree, fakeDraftFolder, refusal, toSummary } from './shared';

/** Build the same workspace for preparation and ordinary creation. */
export async function createFakeThread(ctx: FakeContext, params: RpcParams<'threads.create'>): Promise<Thread> {
  const project = ctx.projects.find((p) => p.id === params.projectId);
  if (!project) throw ctx.notFound('project', params.projectId);
  requireFakeFolder(ctx, project);
  const provider = ctx.providers.find(entry => entry.id === params.providerId);
  if (!provider) throw ctx.notFound('provider', params.providerId);
  const account = ctx.accounts.find((entry) => entry.id === params.accountId);
  if (!account) throw ctx.notFound('account', params.accountId);
  if (account.providerId !== provider.id) {
    throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'the account belongs to another provider', data: { accountId: account.id, accountProviderId: account.providerId, providerId: provider.id } });
  }
  await discoverSelection(ctx, provider.id, account.id, params.model ?? defaultModel(provider), params.effort ?? null, params.speed ?? null);
  const models = modelsOf(ctx, provider.id, account.id);
  const model = checkModel(provider, account.id, models, params.model ?? defaultModel(provider), ctx.modelCatalogs.has(provider.id + '::' + account.id));
  const selected = resolveModelSelection(models, params.model, params.effort);
  const effort = checkEffort(provider, models, model, selected?.effort ?? params.effort ?? null);
  checkSpeed(ctx, params.providerId, params.accountId, model, params.speed ?? null);
  const contextMode = fakeContextMode(provider, params.context);
  if (params.incognito === true) {
    // The core's refusals, by field: the drafts only, and a folder it makes itself.
    if (project.kind !== 'drafts') throw refusal('an incognito conversation starts in the drafts project only', { projectId: project.id, field: 'incognito', expected: 'the drafts project' });
    if (params.worktree !== undefined) throw refusal('incognito and worktree exclude each other: an incognito conversation works in a folder the core makes', { field: 'incognito', expected: 'absent or false with worktree' });
    if (params.cwd) throw refusal('incognito and cwd exclude each other: an incognito conversation works in a folder the core makes', { field: 'cwd', expected: 'absent with incognito' });
  }
  if (params.cwd !== undefined && params.cwd.length > 0 && params.worktree === undefined) checkCwd(project.path, params.cwd);
  const at = ctx.now();
  const title = params.title !== undefined && params.title.length > 0 ? params.title : 'New thread';
  // The core's own placement: a short temporary branch and the
  // worktree in the configured storage. No git here, only the two strings.
  if (params.worktree !== undefined && project.kind === 'drafts') throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'a draft has no worktree: the drafts folder is not a git repository', data: { projectId: project.id } });
  const placed = params.worktree === undefined ? null : fakeWorktree(project.path, title, params.worktree.branch, ctx.settings.worktreeStorage, project.id);
  if (placed) registerFakeWorktree(ctx, project.id, placed);
  // The core makes a dated folder per draft; the fake only names it.
  const id = `t-${++ctx.seq}`;
  const draftFolder = params.incognito === true ? `${DATA_DIR}/incognito/${id}`
    : project.kind === 'drafts' && !params.cwd
    ? fakeDraftFolder(project.path, title, new Date(at), new Set([...ctx.threads.values()].map((thread) => thread.cwd)))
    : null;
  const thread: Thread = {
    id,
    ...(params.incognito === true ? { incognito: true as const } : {}),
    ...(contextMode ? { contextMode } : {}),
    projectId: params.projectId,
    title,
    titleSource: 'prompt',
    providerId: params.providerId,
    accountId: params.accountId,
    model,
    effort,
    speed: params.speed ?? null,
    cwd: placed?.path ?? draftFolder ?? (params.cwd || project.path),
    branch: placed?.branch ?? null,
    branchNamingPending: placed?.namingPending ?? false,
    permissionMode: params.permissionMode ?? 'default',
    status: 'idle',
    unread: false,
    archived: false,
    pinned: false,
    sessionId: null,
    load: null,
    context: null,
    createdAt: at,
    updatedAt: at,
    messages: [],
    commands: [],
    messagesBefore: null,
    turns: []
  };
  return thread;
}

export function publishFakeThread(ctx: FakeContext, thread: Thread, subscribe = false) {
  if (subscribe) ctx.bus.subscribed.add(thread.id);
  ctx.threads.set(thread.id, thread);
  ctx.emit('thread.created', structuredClone(toSummary(thread)));
  const project = ctx.projects.find(p => p.id === thread.projectId);
  if (project?.archived === true) archiveProject(ctx, project.id, false);
  return structuredClone(toSummary(thread));
}

export function writeFakeFork(ctx: FakeContext, source: Thread, kept: Message[], placed: ReturnType<typeof fakeWorktree> | null = null) {
  const title = `${source.title} (fork)`;
  const now = ctx.now();
  const id = `t-${++ctx.seq}`;
  const turnIds = new Map<string, string>();
  const messages: Message[] = kept.map((message) => {
    if (!turnIds.has(message.turnId)) turnIds.set(message.turnId, `turn-${++ctx.seq}`);
    return { ...structuredClone(message), id: `m-${++ctx.seq}`, threadId: id, turnId: turnIds.get(message.turnId) ?? message.turnId, state: message.state === 'streaming' ? 'complete' : message.state };
  });
  const turns: Turn[] = source.turns.filter((turn) => turnIds.has(turn.id)).map((turn) => ({
    ...structuredClone(turn),
    id: turnIds.get(turn.id) ?? turn.id,
    threadId: id,
    status: turn.status === 'queued' || turn.status === 'running' ? 'stopped' : turn.status,
    queueHold: null,
    startedAt: turn.startedAt ?? turn.queuedAt,
    finishedAt: turn.finishedAt ?? now,
    usage: null,
  }));
  const thread: Thread = {
    id, projectId: source.projectId, title, titleSource: source.titleSource,
    providerId: source.providerId, accountId: source.accountId, model: source.model, effort: source.effort, speed: source.speed ?? null,
    cwd: placed?.path ?? source.cwd, branch: placed?.branch ?? source.branch, branchNamingPending: placed?.namingPending ?? false, permissionMode: source.permissionMode,
    status: 'idle', unread: false, archived: false, doneAt: null, pinned: false,
    forkOrigin: { threadId: source.id, messageId: kept.at(-1)?.id ?? null, turnId: kept.at(-1)?.turnId ?? null, mode: 'seeded' },
    sessionId: null, sessionGeneration: 1, selectionVersion: 0, load: null, context: null,
    createdAt: now, updatedAt: now, messages, turns, commands: [], messagesBefore: null,
  };
  ctx.threads.set(id, thread);
  ctx.emit('thread.created', structuredClone(toSummary(thread)));
  return structuredClone(toSummary(thread));
}
