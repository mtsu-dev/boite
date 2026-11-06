import { openCodeCompactionBuffer } from '../../providers/opencode.ts';
import type { ProbeFilter, SessionContext } from '../types.ts';
import { AGENT_OWN_MODEL } from './models.ts';

/** What the driver learns about OpenCode 2's compaction windows across processes. */
export interface CompactionCaches {
  /**
   * OpenCode 2's compaction window per `provider\0account\0folder\0model`, the
   * model the agent actually runs (`provider/model`) in the conversation's
   * folder, whose OpenCode configuration may set its own `limit.context` and
   * `limit.input`. Written as the last process there read it: the next process
   * on that model in that folder starts with its owner's limit.
   */
  compactionWindows: Map<string, number>;
  /**
   * The model a thread on the agent's own model resolved to, per thread and
   * per folder, since each OpenCode project may default to another model, with
   * the folder it resolved in. A thread first looks up its own, ignored once
   * the thread moved to another folder, then its folder's; neither known keeps
   * the native ceiling. A released thread drops its own entry.
   */
  resolvedModels: Map<string, { cwd: string; model: string }>;
}

/** Where a conversation runs, for the folder entries its account keeps. */
export interface CompactionPlace { providerId: string; accountId: string; cwd: string }

function compactionModelKey(ctx: SessionContext, model: string): string {
  return `${ctx.provider.id}\0${ctx.account.id}\0${ctx.thread.cwd}\0${model}`;
}

function resolutionKeys(ctx: SessionContext): string[] {
  const scope = `${ctx.provider.id}\0${ctx.account.id}`;
  return [`${scope}\0thread\0${ctx.thread.id}`, `${scope}\0folder\0${ctx.thread.cwd}`];
}

/** The model the thread runs: the one it names, else what its own model last resolved to in its folder. */
function resolvedModel(caches: CompactionCaches, ctx: SessionContext): string | null {
  if (ctx.thread.model !== AGENT_OWN_MODEL) return ctx.thread.model;
  for (const key of resolutionKeys(ctx)) {
    const resolved = caches.resolvedModels.get(key);
    if (resolved !== undefined && resolved.cwd === ctx.thread.cwd) return resolved.model;
  }
  return null;
}

/** The buffer the thread's limit asks for on the model it runs, null while its window is unknown or no limit applies. */
export function wantedCompactionBuffer(caches: CompactionCaches, ctx: SessionContext): number | null {
  const model = resolvedModel(caches, ctx);
  const window = model === null ? 0 : caches.compactionWindows.get(compactionModelKey(ctx, model)) ?? 0;
  return openCodeCompactionBuffer(window, ctx.autoCompactTokens?.() ?? null);
}

/** The model a process says the session runs and its window, for the next process on it. */
export function noteCompactionModel(caches: CompactionCaches, ctx: SessionContext, model: string, window: number): void {
  if (model === '') return;
  if (ctx.thread.model === AGENT_OWN_MODEL) for (const key of resolutionKeys(ctx)) caches.resolvedModels.set(key, { cwd: ctx.thread.cwd, model });
  if (window > 0) caches.compactionWindows.set(compactionModelKey(ctx, model), window);
}

/** A conversation archived, deleted or released resumes on its folder's resolution. */
export function forgetThreadResolution(caches: CompactionCaches, threadId: string): void {
  const suffix = `\0thread\0${threadId}`;
  for (const key of [...caches.resolvedModels.keys()]) if (key.endsWith(suffix)) caches.resolvedModels.delete(key);
}

/** A reloaded agent or a changed account: its windows and resolutions may no longer hold. */
export function forgetCompaction(caches: CompactionCaches, filter: ProbeFilter): void {
  const matches = (key: string): boolean => {
    const [providerId, accountId] = key.split('\0');
    return (filter.providerId === undefined || filter.providerId === providerId) && (filter.accountId === undefined || filter.accountId === accountId);
  };
  for (const key of [...caches.compactionWindows.keys()]) if (matches(key)) caches.compactionWindows.delete(key);
  for (const key of [...caches.resolvedModels.keys()]) if (matches(key)) caches.resolvedModels.delete(key);
}

/**
 * The account's last live conversation in a folder left it: the folder's
 * resolution, its windows and what other threads resolved there go. A
 * conversation resuming there starts on OpenCode's own ceiling and gets its
 * buffer once a process read the window again.
 */
export function forgetFolder(caches: CompactionCaches, place: CompactionPlace): void {
  const scope = `${place.providerId}\0${place.accountId}\0`;
  const windows = `${scope}${place.cwd}\0`;
  for (const key of [...caches.compactionWindows.keys()]) if (key.startsWith(windows)) caches.compactionWindows.delete(key);
  for (const [key, resolved] of [...caches.resolvedModels]) if (key.startsWith(scope) && resolved.cwd === place.cwd) caches.resolvedModels.delete(key);
}
