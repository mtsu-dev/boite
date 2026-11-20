import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import type { AutoCompactMoment, Turn, Usage } from '@boite/contracts';
import { COLD_WAKE } from '../src/threads/auto-compact.ts';
import { agentValue } from './agent-fixture.ts';
import { quietAgent, startTestCore, waitFor } from './harness.ts';

/**
 * Opt-in trial of one cold wake of a mochi (`docs/internals/context.md`, "A
 * mochi's cold wake"), with a real model behind a Douane gateway. It spends that gateway's
 * subscriptions and lasts as long as the prompt cache: more than an hour on
 * Claude's one-hour cache. `BOITE_E2E_COLD_WAKE_PROXY_URL` is the gateway's API
 * URL, `BOITE_E2E_COLD_WAKE_PROXY_KEY` its key. `BOITE_E2E_COLD_WAKE_VARIANT`
 * is `plain` (no compaction before the wake) or `compact` (the compaction the
 * core runs while the cache is still warm); run both at once, one per process.
 */
const GATEWAY = process.env['BOITE_E2E_COLD_WAKE_PROXY_URL'] ?? '';
const KEY = process.env['BOITE_E2E_COLD_WAKE_PROXY_KEY'] ?? '';
const VARIANT = process.env['BOITE_E2E_COLD_WAKE_VARIANT'] === 'compact' ? 'compact' : 'plain';
const MODEL = process.env['BOITE_E2E_COLD_WAKE_MODEL'] ?? 'claude-opus-5-5';
/**
 * Enough of the repository's own notes for a context near 100 000 tokens, the
 * median of the real cold wakes, below where a background copy starts (136 000
 * of the 160 000 limit), so the compaction is a turn whose usage is recorded.
 */
const PASTE_CHARS = 240_000;
const run = process.env['BOITE_E2E_COLD_WAKE'] === '1' && GATEWAY.length > 0 ? test : test.skip;
const RATES = { in: 4, out: 20, read: 0.2, write: 5, hour: 8 };

const usd = (u: Usage | null) => u === null ? 0 : (u.inputTokens * RATES.in + u.outputTokens * RATES.out + u.cacheReadTokens * RATES.read
  + (u.cacheWriteTokens - (u.cacheWriteHourTokens ?? 0)) * RATES.write + (u.cacheWriteHourTokens ?? 0) * RATES.hour) / 1e6;

function notes(): string {
  const dir = join(import.meta.dir, '../../../docs/internals');
  let text = '';
  for (const name of readdirSync(dir).filter(file => file.endsWith('.md')).sort()) {
    text += `\n\n=== ${name}\n\n${readFileSync(join(dir, name), 'utf8')}`;
    if (text.length >= PASTE_CHARS) break;
  }
  return text.slice(0, PASTE_CHARS);
}

run(`a mochi's cold wake, ${VARIANT}`, async () => {
  const origin = GATEWAY.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const h = await startTestCore({ settings: { subscriptionProxy: { enabled: true, kind: 'douane', baseUrl: GATEWAY, dashboardUrl: `${origin}/admin/#quotas` } } });
  let denying = true;
  const { minTokens } = COLD_WAKE;
  try {
    const owner = await h.connect();
    if (KEY.length > 0) await owner.call('subscriptionProxy.configure', { subscriptionProxy: (await owner.call('settings.get', {})).subscriptionProxy!, key: KEY });
    // The mochi gets no tool on the host: every request it makes is refused, the same way in both variants.
    void (async () => {
      while (denying) {
        for (const request of await owner.call('permissions.list', {}).catch(() => [])) {
          await owner.call('permissions.answer', { requestId: request.id, decision: 'deny' }).catch(() => undefined);
        }
        await Bun.sleep(2_000);
      }
    })();
    // The policy of the real mochis on 2026-11-15. `plain` turns the cold wake's compaction off, as before it existed.
    if (VARIANT === 'plain') COLD_WAKE.minTokens = Number.POSITIVE_INFINITY;
    const policy = { autoCompact: { tokens: 160_000, moments: [] as AutoCompactMoment[] }, backgroundCompaction: true };
    await owner.call('settings.set', { autoCompact: policy.autoCompact, backgroundCompaction: true, compactionByType: { bot: policy } });
    const account = (await owner.call('accounts.list', {})).find(entry => entry.providerId === 'claude');
    expect(account).toBeDefined();
    // Model and effort are checked against the list the agent gives.
    const { models } = await owner.call('providers.probe', { providerId: 'claude', accountId: account!.id });
    console.log(`${VARIANT}: models ${models.map(entry => entry.id).join(', ')}`);
    const paused = h.core.workforce.limits().paused;
    h.core.workforce.setLimits({ paused: true });
    let agent = await owner.call('agents.profile.save', { value: agentValue(account!.id, { name: 'Cold', selection: { providerId: 'claude', accountId: account!.id, model: MODEL, effort: 'high', permissionMode: 'default' } }) });
    agent = await quietAgent(owner, agent);
    const threadId = h.core.workforce.sessionOf(agent.id)!.threadId;
    h.core.workforce.setLimits({ paused });
    const ended = () => h.core.journal.listTurns(threadId).every(turn => turn.status !== 'queued' && turn.status !== 'running');
    await waitFor(() => h.core.journal.listTurns(threadId).length > 0 && ended(), 10 * 60_000);

    await owner.call('turns.start', { threadId, prompt: `Here are today's notes on Boite's internals, for later. Do not use any tool. Read them and answer with exactly [quiet].\n${notes()}` });
    await waitFor(() => h.core.journal.listTurns(threadId).length > 1 && ended(), 10 * 60_000);
    const built = h.core.journal.getThread(threadId)!;
    const cache = built.promptCache;
    expect(cache).toBeTruthy();
    const lapse = cache!.at + cache!.ttlSeconds * 1000;
    console.log(`${VARIANT}: context ${built.context?.tokens} tokens, cache ${cache!.ttlSeconds} s, lapses in ${Math.round((lapse - Date.now()) / 1000)} s`);

    // Past the lapse, with room for a compaction that started a minute before it.
    await Bun.sleep(Math.max(0, lapse + 120_000 - Date.now()));
    await waitFor(ended, 10 * 60_000);
    const before = h.core.journal.getThread(threadId)!.context?.tokens;
    // The mochi's introduction is an event turn too: the wake is the next one.
    const events = () => h.core.journal.listTurns(threadId).filter(turn => turn.execution?.operation === 'event');
    const introduced = events().length;
    await owner.call('agents.event', { agent: agent.id, text: 'The nightly build of Boite finished green. Nothing is asked of you.' });
    await waitFor(() => events().length > introduced && ended(), 10 * 60_000);

    const turns: Turn[] = h.core.journal.listTurns(threadId);
    let total = 0;
    for (const turn of turns) {
      const cost = usd(turn.usage);
      total += cost;
      console.log(`${VARIANT} ${turn.execution?.operation ?? 'user'} ${turn.status} ${JSON.stringify(turn.usage)} ${cost.toFixed(4)} $`);
    }
    const wake = events().at(-1)!;
    const compaction = turns.filter(turn => turn.execution?.operation === 'compact');
    console.log(`${VARIANT}: context before the wake ${before}, after ${h.core.journal.getThread(threadId)!.context?.tokens}`);
    console.log(`${VARIANT}: wake ${usd(wake.usage).toFixed(4)} $, compaction ${compaction.map(turn => usd(turn.usage)).reduce((a, b) => a + b, 0).toFixed(4)} $, all turns ${total.toFixed(4)} $`);
    expect(wake.status).toBe('done');
    if (VARIANT === 'compact') expect(compaction.length).toBe(1);
  } finally {
    denying = false;
    COLD_WAKE.minTokens = minTokens;
    await h.stop();
  }
}, 2 * 3_600_000);
