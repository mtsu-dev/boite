import type { ModelInfo, ProviderDescriptor, QuotaResetOutcome } from '@boite/contracts';
import { modelCapabilities } from '../model-capabilities.ts';
import pkg from '../../../package.json';
import { messageOf, unavailable } from '../../errors.ts';
import { profileFor, resolveExecutable } from '../../providers/resolve.ts';
import type { ProbeContext, SessionContext } from '../types.ts';
import { probeModels } from '../model-probe.ts';
import { subscriptionProxyCodexArgs } from '../../subscription-proxy.ts';
import type { CodexModel, CodexModelListResponse, Timer } from './protocol.ts';
import { AGENT_OWN_MODEL, CLIENT_NAME, PROBE_MAX_PAGES, PROBE_TIMEOUT_MS, STDERR_MAX } from './protocol.ts';
import { CodexRpc } from './rpc.ts';
import { QuotaResetError, quotaResetOutcome, type QuotaResetSelection } from '../../quota-resets.ts';
import { codexNextResetCredit } from '../../quota-details.ts';

// ---------------------------------------------------------------------------
// The probe: the models the server itself lists
// ---------------------------------------------------------------------------

/**
 * A `model/list` answer as a model list. The descriptor's `default` stays first
 * so the choice can always go back to Codex's own configuration, and it carries
 * no effort of its own: the scale belongs to the model that is picked. A server
 * that lists nothing leaves the descriptor's models standing.
 */
function modelsFrom(provider: ProviderDescriptor, data: CodexModel[]): ModelInfo[] {
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  const own = provider.models.find((model) => model.id === AGENT_OWN_MODEL);
  if (own !== undefined) {
    models.push({ id: AGENT_OWN_MODEL, name: own.name, default: false });
    seen.add(AGENT_OWN_MODEL);
  }
  for (const entry of data) {
    const id = entry.id;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: entry.displayName ?? id,
      default: entry.isDefault === true,
      ...modelCapabilities({ ...entry }),
    });
  }
  // Only the descriptor's own entry came back: the server said nothing useful.
  return models.length === (own === undefined ? 0 : 1) ? provider.models : models;
}

/** Same bounded pagination for a prepared host and a disposable discovery process. */
async function listModels(rpc: CodexRpc, provider: ProviderDescriptor): Promise<ModelInfo[]> {
  const data: CodexModel[] = [];
  let cursor: string | null = null;
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  for (let page = 0; page < PROBE_MAX_PAGES; page += 1) {
    const answer: CodexModelListResponse = await rpc.request<CodexModelListResponse>('model/list', cursor === null ? {} : { cursor }, { timeoutMs: Math.max(1, deadline - Date.now()) });
    data.push(...(answer.data ?? []));
    cursor = answer.nextCursor ?? null;
    if (cursor === null) break;
  }
  return modelsFrom(provider, data);
}

export function preparedModels(ctx: ProbeContext, opener: SessionContext | null, rpc: CodexRpc | null): Promise<ModelInfo[] | null> {
  const scope = ctx.catalogThread;
  if (!opener || !scope || !rpc || opener.provider.id !== ctx.provider.id || opener.account.id !== ctx.accountId
    || opener.thread.cwd !== scope.cwd || JSON.stringify(opener.thread.contextMode ?? null) !== JSON.stringify(scope.contextMode ?? null)
    || JSON.stringify(opener.accountEnv) !== JSON.stringify(ctx.accountEnv)
    || JSON.stringify(opener.provider) !== JSON.stringify(ctx.provider)) return Promise.resolve(null);
  return listModels(rpc, ctx.provider);
}

/**
 * One short-lived `codex app-server`: `initialize`, the `initialized`
 * notification, then `model/list` until the server stops handing back a cursor.
 * The child goes through the registry that traced it on every path. Nothing of
 * this process is kept; a turn opens its own.
 */
export async function readModels(ctx: ProbeContext): Promise<ModelInfo[]> {
  const profile = profileFor(ctx.provider);
  const executable = profile === undefined ? null : resolveExecutable(profile);
  if (executable === null) {
    throw unavailable(`no ${ctx.provider.id} executable on this machine`, { providerId: ctx.provider.id });
  }

  const args = await subscriptionProxyCodexArgs(profile?.launch?.args ?? [], ctx.accountEnv);
  const child = ctx.spawnChild(executable, args, {
    cwd: ctx.cwd,
    env: { ...process.env, ...ctx.accountEnv },
  });
  const rpc = new CodexRpc(child, {
    // A probe draws nothing and answers nothing: the server has no turn to
    // report on and no approval to ask for.
    notification: () => undefined,
    request: (method) => Promise.reject(new Error(`boite does not implement ${method}`)),
    log: (level, message, context) => {
      ctx.log(level, message, context);
    },
  });

  return probeModels(ctx, child, { noun: 'agent', timeoutMs: PROBE_TIMEOUT_MS, stderrMax: STDERR_MAX, over: () => rpc.fail('the codex probe is over') }, async () => {
    await rpc.request('initialize', {
      clientInfo: { name: CLIENT_NAME, title: null, version: pkg.version },
      capabilities: null,
    });
    rpc.notify('initialized', {});

    return listModels(rpc, ctx.provider);
  });
}

/**
 * Codex answers a failed quota read with its own reason. Only a missing or
 * rejected login is the account's fault; a request that never reached OpenAI
 * says so, instead of sending the user to repair a login that works.
 */
export function codexQuotaError(reason: string): Error {
  if (/authentication required|not logged in|unauthorized|\b401\b|token.*(expired|invalid|revoked)/i.test(reason)) {
    return new Error('Codex is not signed in to a subscription. Check its login in Providers.');
  }
  if (/error sending request|timed? ?out|connect|dns|network/i.test(reason)) {
    return new Error('Codex could not reach OpenAI to read subscription quotas. Retrying in five minutes.');
  }
  return new Error(`Codex could not read subscription quotas: ${reason.slice(0, 200)}`);
}

/** A bounded account request, with its traced process closed on every path. */
async function accountRequest<T>(ctx: ProbeContext, action: (rpc: CodexRpc) => Promise<T>, reset = false): Promise<T> {
  const profile = profileFor(ctx.provider);
  const executable = profile ? resolveExecutable(profile) : null;
  if (!executable) throw new Error('Codex is not installed. Check Providers.');
  const child = ctx.spawnChild(executable, profileFor(ctx.provider)?.launch?.args ?? [], {
    cwd: ctx.cwd, env: { ...process.env, ...ctx.accountEnv },
  });
  child.stderr.resume();
  const rpc = new CodexRpc(child, {
    notification: () => undefined,
    request: () => Promise.reject(new Error('No turn is running during a quota read')),
    log: () => undefined,
  });
  let timer: Timer | undefined;
  try {
    const failure = new Promise<never>((_, reject) => {
      child.once('exit', () => reject(new Error(reset ? 'Codex closed before confirming the reset. Refresh the limits before trying again.' : 'Codex closed before reporting quotas. Check its login in Providers.')));
      child.once('error', () => reject(new Error('Codex could not start. Check Providers.')));
      timer = setTimeout(() => reject(new Error(reset ? 'Codex did not confirm the reset within 20 seconds. Refresh the limits before trying again.' : 'Codex did not report quotas within 20 seconds.')), PROBE_TIMEOUT_MS);
    });
    const read = (async () => {
      await rpc.request('initialize', { clientInfo: { name: CLIENT_NAME, title: null, version: pkg.version }, capabilities: reset ? { experimentalApi: true } : null });
      rpc.notify('initialized', {});
      return action(rpc);
    })();
    return await Promise.race([read, failure]);
  } finally {
    clearTimeout(timer);
    rpc.fail('the account request is over');
    child.stdin.end();
    ctx.killTree();
  }
}

/** Reads subscription limits without creating a thread or submitting a prompt. */
export function readCodexQuota(ctx: ProbeContext): Promise<unknown> {
  return accountRequest(ctx, async (rpc) => {
    try { return await rpc.request('account/rateLimits/read', {}); }
    catch (error) {
      ctx.log('warn', `account/rateLimits/read failed: ${messageOf(error)}`);
      throw codexQuotaError(messageOf(error));
    }
  });
}

/** Selects the earliest usable credit in this login; no turn is started. */
export function consumeCodexReset(ctx: ProbeContext, idempotencyKey: string, selection: QuotaResetSelection): Promise<QuotaResetOutcome> {
  return accountRequest(ctx, async (rpc) => {
    let creditId = selection.creditId;
    if (creditId === undefined) {
      const raw = await rpc.request('account/rateLimits/read', {});
      let credit;
      try { credit = codexNextResetCredit(raw); }
      catch (error) { throw new QuotaResetError(messageOf(error), true); }
      if (!credit) return 'noCredit';
      creditId = credit.id;
      selection.remember(creditId);
    }
    const result = await rpc.request<{ outcome?: unknown }>('account/rateLimitResetCredit/consume', { idempotencyKey, creditId });
    return quotaResetOutcome(result?.outcome);
  }, true).catch((error: unknown) => {
    if (error instanceof QuotaResetError) throw error;
    // Native errors can include the private credit or backend response.
    throw new QuotaResetError('Codex could not confirm the reset. Refresh the limits before trying again.');
  });
}
