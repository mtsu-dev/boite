import type { GatewayQuotaProvider, ProviderDescriptor, Settings, ThreadSummary, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf } from '../errors.ts';
import { activeSubscriptionProxy } from '../subscription-proxy.ts';
import { RESUME_TEXT } from './resume-text.ts';
import { RESUME_TIMING, type ResumePlanner } from './resume.ts';

/** Mutable so a test can shorten them (`threads/resume.ts`). */
export const LIMIT_RESUME = RESUME_TIMING.limit;

/** Two readings of the same window can differ by the second their reset was rounded to. */
const SAME_WINDOW_MS = 120_000;

/**
 * The opt-in `autoResumeLimitedThreads` at work. A turn that failed on a spent
 * subscription window plans one resume for its thread, a little after that
 * window resets: the reset the agent reported, else the spent window of the
 * account's quota reading (or Douane pool when routed through Douane).
 * `ResumePlanner` journals the plan and checks everything again when it fires:
 * a thread answered, stopped, archived, switched to another account, model or
 * provider, a paused team or a pending approval cancels it. A failure that
 * reports a window already reset plans nothing, and a thread resumes once per
 * window, so a limit never turns into a retry loop.
 */
export class LimitResumes {
  constructor(private readonly core: Core, private readonly resumes: ResumePlanner) {
    // A setting that rolls back keeps the plans.
    core.bus.onCommitted((name, payload) => {
      if (name === 'settings.updated' && (payload as Settings).autoResumeLimitedThreads !== true) {
        resumes.cancelAll('automatic resume was turned off', plan => plan.reason === 'limit');
      }
    });
  }

  /**
   * A turn of the thread failed on a spent usage window. `resetsAt` is the
   * reset the agent reported, null when it said none. Nothing waits on it.
   */
  turnFailed(thread: ThreadSummary, turn: Turn, resetsAt: number | null): void {
    // Sub-threads answer to their parent; a compaction or a letter is not worth repeating. A bot's wake is:
    // its routine may not come due again for a day, and the facts an event turn carried are spent.
    if (thread.parentThreadId) return;
    const operation = turn.execution?.operation;
    if (operation !== undefined && operation !== 'resume' && operation !== 'routine' && operation !== 'event') return;
    this.resumes.offer(turn, { kind: 'usage-limit', resetsAt });
    if (this.core.settings.get().autoResumeLimitedThreads !== true) return;
    const providerId = turn.execution?.providerId ?? thread.providerId;
    const accountId = turn.execution?.accountId ?? thread.accountId;
    const model = turn.execution ? turn.execution.model : thread.model;
    const failedAt = turn.finishedAt ?? Date.now();
    void (async () => {
      const freshReported = resetsAt !== null && resetsAt > failedAt ? resetsAt : null;
      const reset = freshReported ?? await this.spentWindowReset(providerId, accountId, model, failedAt) ?? resetsAt;
      this.plan(thread.id, turn, reset);
    })().catch(error => this.resumes.log('warn', thread.id, `Planning the usage limit resume failed: ${messageOf(error)}`, 'failed', null, {}, 'limit'));
  }

  private plan(threadId: string, turn: Turn, resetsAt: number | null): void {
    if (this.core.journal.isClosed()) return;
    if (this.core.settings.get().autoResumeLimitedThreads !== true) return;
    const skip = (message: string, reason: string) => {
      this.resumes.offer(turn, { kind: 'usage-limit', resetsAt, detail: message });
      this.resumes.log('info', threadId, `Turn ${turn.id}: ${message}`, 'skipped', null, { reason }, 'limit');
    };
    const failedAt = turn.finishedAt ?? Date.now();
    if (resetsAt === null) return skip('the quota reset time is unknown', 'unknown-reset');
    // A failure that reports a window already reset would resume at once and fail again: no loop.
    if (resetsAt <= failedAt) return skip('the reported quota window already reset', 'expired-window');
    const resumed = this.resumes.entry(threadId)?.resumedWindow;
    if (resumed !== undefined && Math.abs(resumed - resetsAt) < SAME_WINDOW_MS) return skip('the thread already resumed once for this quota window', 'same-window');
    const thread = this.core.journal.getThread(threadId);
    // The user moved on while the reset was read.
    if (thread === null || thread.archived || this.resumes.lastTurn(threadId)?.id !== turn.id) return;
    if (this.resumes.recoveryOf(thread)?.resetsAt !== resetsAt) this.resumes.offer(turn, { kind: 'usage-limit', resetsAt });
    const at = resetsAt + LIMIT_RESUME.marginMs;
    this.resumes.schedule(threadId, turn, {
      reason: 'limit', at, prompt: RESUME_TEXT.limit.prompt, resetsAt,
      selection: {
        providerId: turn.execution?.providerId ?? thread.providerId,
        accountId: turn.execution?.accountId ?? thread.accountId,
        model: turn.execution ? turn.execution.model : thread.model,
        sessionGeneration: thread.sessionGeneration ?? 0,
      },
    }, `Turn ${turn.id} failed on a usage limit; the thread resumes at ${new Date(at).toISOString()}`);
  }

  /**
   * The reset of the latest future spent window of the turn's account (or
   * Douane pool when the provider routes through Douane), or null when none is
   * spent or none could be read.
   */
  private async spentWindowReset(providerId: string, accountId: string, model: string | null, failedAt: number): Promise<number | null> {
    const provider = this.core.providers.get(providerId);
    const proxy = provider ? activeSubscriptionProxy(this.core, provider) : null;
    if (proxy?.kind === 'douane' && provider) {
      const gateway = await this.core.quotas.gateway.read(true).catch(() => null);
      if (gateway && gateway.providers.length > 0) {
        const matched = matchGatewayProvider(gateway.providers, provider, model);
        if (matched !== null) return gatewayPoolReset(matched, failedAt);
      }
      return null;
    }
    const quota = await this.core.quotas.readAccount(accountId, true, true).catch(() => null);
    let latest: number | null = null;
    for (const window of quota?.windows ?? []) {
      if (window.usedPercent < 100 || window.resetsAt === null || window.resetsAt <= failedAt) continue;
      if (latest === null || window.resetsAt > latest) latest = window.resetsAt;
    }
    return latest;
  }
}

const GATEWAY_ALIAS: Record<string, string[]> = {
  grok: ['xai', 'grok'],
  anthropic: ['claude', 'anthropic'],
  openai: ['codex', 'openai'],
};

function gatewayCandidates(provider: ProviderDescriptor, model: string | null): string[] {
  const out: string[] = [];
  const add = (id: string | null | undefined): void => {
    if (!id) return;
    const lower = id.toLowerCase();
    if (!out.includes(lower)) out.push(lower);
    for (const alias of GATEWAY_ALIAS[lower] ?? []) if (!out.includes(alias)) out.push(alias);
  };
  if (model) {
    const stripped = model.replace(/^douane\//i, '');
    const slash = stripped.indexOf('/');
    if (slash > 0) add(stripped.slice(0, slash));
  }
  add(provider.id);
  if (provider.protocol === 'claude-sdk') add('claude');
  if (provider.protocol === 'codex-appserver') add('codex');
  return out;
}

function matchGatewayProvider(providers: GatewayQuotaProvider[], provider: ProviderDescriptor, model: string | null): GatewayQuotaProvider | null {
  for (const candidate of gatewayCandidates(provider, model)) {
    const found = providers.find((entry) => entry.providerId.toLowerCase() === candidate);
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * In a Douane pool, one entry is blocked until its latest spent window resets,
 * and the pool as a whole unblocks as soon as the earliest active entry does.
 */
function gatewayPoolReset(provider: GatewayQuotaProvider, failedAt: number): number | null {
  let earliest: number | null = null;
  for (const entry of provider.entries) {
    if (entry.status === 'disabled') continue;
    let blocking: number | null = null;
    for (const window of entry.windows) {
      if (window.usedPercent < 100 || window.resetsAt === null || window.resetsAt <= failedAt) continue;
      if (blocking === null || window.resetsAt > blocking) blocking = window.resetsAt;
    }
    if (blocking !== null && (earliest === null || blocking < earliest)) earliest = blocking;
  }
  return earliest;
}
