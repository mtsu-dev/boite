import { afterEach, expect, test } from 'bun:test';
import { CAPACITY_RETRY } from '../src/threads/turn-attempts.ts';
import { waitFor } from './harness.ts';
import { assistant, claudeThread, harness, init, runTurn, scripted, sdk, success, useClaudeHarness } from './fixtures/claude-query.ts';

useClaudeHarness();

const delays = CAPACITY_RETRY.delaysMs;
afterEach(() => { CAPACITY_RETRY.delaysMs = delays; });

/** What the CLI writes when an API error ends the turn: the coded assistant message, then an error result. */
function apiError(sessionId: string, error: string, text: string) {
  return [
    sdk({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, error, message: { id: 'msg_err', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }] } }),
    sdk({ ...(success(sessionId) as object), is_error: true, result: text }),
  ];
}

test('an overloaded_error ends the try and the same turn answers on the next one', async () => {
  CAPACITY_RETRY.delaysMs = [20, 20, 20];
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  let prompts = 0;
  scripted(() => {}, (fake) => {
    prompts += 1;
    fake.emit(init('sess-529'));
    if (prompts === 1) for (const message of apiError('sess-529', 'overloaded', 'API Error: 529 Overloaded')) fake.emit(message);
    else {
      fake.emit(assistant('sess-529', [{ type: 'text', text: 'answered' }]));
      fake.emit(success('sess-529'));
    }
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('done');
  expect(prompts).toBe(2);
  const thread = await client.call('threads.get', { threadId });
  expect(thread.turns).toHaveLength(1);
  expect(JSON.stringify(thread.messages)).toContain('answered');
});

test('a rejected window before a rate_limit error plans the resume at that window reset', async () => {
  harness.core.settings.set({ autoResumeLimitedThreads: true });
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600;
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-limit'));
    fake.emit(sdk({ type: 'rate_limit_event', session_id: 'sess-limit', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt } }));
    for (const message of apiError('sess-limit', 'rate_limit', "You've hit your limit")) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === resetsAt * 1000);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
});

test('an expired rejected window does not hide a future reset in the Claude error text', async () => {
  harness.core.settings.set({ autoResumeLimitedThreads: true });
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  const expired = Math.floor(Date.now() / 1000) - 60;
  const future = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const expected = Date.parse(future);
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-limit-expired'));
    fake.emit(sdk({ type: 'rate_limit_event', session_id: 'sess-limit-expired', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: expired } }));
    for (const message of apiError('sess-limit-expired', 'rate_limit', `You've hit your limit · resets ${future}`)) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  const { recovery } = await client.call('threads.get', { threadId });
  expect(recovery?.resetsAt).toBe(expected);
  await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === expected);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
});

test('an expired rejected window does not turn an unrelated Claude failure into a usage limit', async () => {
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  const expired = Math.floor(Date.now() / 1000) - 60;
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-stale-refusal'));
    fake.emit(sdk({ type: 'rate_limit_event', session_id: 'sess-stale-refusal', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: expired } }));
    for (const message of apiError('sess-stale-refusal', 'unknown', 'API Error: connection closed')) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  const { recovery } = await client.call('threads.get', { threadId });
  expect(recovery?.kind).toBe('interrupted');
});

test('a rate limit on a gateway route names the provider of its model, not a Claude account', async () => {
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  // The model a subscription proxy route stores, which the scripted account cannot list.
  harness.core.journal.putThread({ ...harness.core.threads.require(threadId), model: 'antigravity/gemini-4-hydrogen-xhigh' });
  const text = 'API Error: Request rejected (429) · all accounts for this provider are unavailable; last upstream refusal: RESOURCE_EXHAUSTED';
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-gateway'));
    for (const message of apiError('sess-gateway', 'rate_limit', text)) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  const turn = (await client.call('threads.get', { threadId })).turns.at(-1);
  expect(turn?.error).toBe(`This antigravity account has hit its rate limit. ${text}`);
});

test.each([
  ['rate_limit', "API Error: Request rejected (429) · this client's share is used up until 2030-02-03T04:05:06Z; its share cap is reached", 'usage-limit', Date.parse('2030-02-03T04:05:06Z')],
  ['rate_limit', "You've hit your limit · resets Nov 23, 2030, 5pm UTC (daily)", 'usage-limit', Date.parse('2030-11-23T17:00:00Z')],
  ['server_error', 'API Error: 503 no available subscription for this model; connect an account or wait for its quota reset.', 'usage-limit', null],
  ['server_error', 'API Error: 503 upstream unavailable', 'interrupted', undefined],
] as const)('a Claude %s with %s offers the matching recovery', async (code, text, kind, resetsAt) => {
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  scripted(() => {}, fake => {
    fake.emit(init('sess-recovery'));
    for (const message of apiError('sess-recovery', code, text)) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'keep my request')).toBe('error');
  const { recovery } = await client.call('threads.get', { threadId });
  expect(recovery?.kind).toBe(kind);
  expect(recovery?.resetsAt).toBe(resetsAt);
});

test('a Claude rate_limit without a rate_limit_event parses the reset time from CLI text (timezone and local clock)', async () => {
  harness.core.settings.set({ autoResumeLimitedThreads: true });
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-text-tz'));
    for (const message of apiError('sess-text-tz', 'rate_limit', "You've hit your limit · resets Nov 23, 2030, 5pm (Europe/Paris)")) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  const expected = Date.parse('2030-11-23T16:00:00.000Z');
  await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === expected, 2000);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });

  // Local clock without a date (e.g. "resets 11:59pm") must resolve to a future timestamp within 24h.
  const before = Date.now();
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-text-local'));
    for (const message of apiError('sess-text-local', 'rate_limit', "You've hit your limit · resets 11:59pm")) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'again')).toBe('error');
  await waitFor(() => {
    const at = harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt;
    return typeof at === 'number' && at > before && at <= before + 24 * 3600 * 1000 + 60_000;
  }, 2000);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
});

test('an allowed seven_day rate_limit_event does not clear a rejected five_hour reset', async () => {
  harness.core.settings.set({ autoResumeLimitedThreads: true });
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600;
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-windows'));
    fake.emit(sdk({ type: 'rate_limit_event', session_id: 'sess-windows', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt } }));
    fake.emit(sdk({ type: 'rate_limit_event', session_id: 'sess-windows', rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day' } }));
    for (const message of apiError('sess-windows', 'rate_limit', "You've hit your limit")) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === resetsAt * 1000, 2000);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
});

test('a late ISO rate_limit_event after the assistant error frame still provides the reset time', async () => {
  harness.core.settings.set({ autoResumeLimitedThreads: true });
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  const iso = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-late-iso'));
    const [assistantErr, resultErr] = apiError('sess-late-iso', 'rate_limit', "You've hit your limit");
    fake.emit(assistantErr!);
    fake.emit(sdk({ type: 'rate_limit_event', session_id: 'sess-late-iso', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: iso } }));
    fake.emit(resultErr!);
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === Date.parse(iso), 2000);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
});

test('a result-only or unknown-coded Claude usage limit is classified and plans a resume', async () => {
  harness.core.settings.set({ autoResumeLimitedThreads: true });
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  const expectedIso = Date.parse('2030-11-24T17:00:00.000Z');
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-result-only'));
    fake.emit(sdk({ ...(success('sess-result-only') as object), is_error: true, result: "You've hit your limit · resets 2030-11-24T17:00:00Z" }));
  });
  expect(await runTurn(client, threadId, 'hello')).toBe('error');
  await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === expectedIso, 2000);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });

  const pipeEpoch = Math.floor(Date.now() / 1000) + 4 * 3600;
  scripted(() => {}, (fake) => {
    fake.emit(init('sess-unknown-pipe'));
    for (const message of apiError('sess-unknown-pipe', 'unknown', `Claude AI usage limit reached|${pipeEpoch}`)) fake.emit(message);
  });
  expect(await runTurn(client, threadId, 'again')).toBe('error');
  await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === pipeEpoch * 1000, 2000);
  expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
});

test('a Douane pool exhaustion response on Claude plans a resume at gatewayPoolReset', async () => {
  const client = await harness.connect();
  const threadId = await claudeThread(client);
  const earliestReset = Date.now() + 2 * 3600 * 1000;
  const laterReset = Date.now() + 5 * 3600 * 1000;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/v1/quotas') {
        return Response.json({
          updated_at: new Date().toISOString(),
          providers: [{
            provider: 'claude', name: 'Claude', display: 'accounts',
            entries: [
              { id: 'acct-a', label: 'Account A', status: 'cooldown', windows: [{ id: 'five-hour', label: '5 hours', remaining_percent: 0, reset_at: new Date(laterReset).toISOString() }], credits: [] },
              { id: 'acct-b', label: 'Account B', status: 'ready', windows: [{ id: 'five-hour', label: '5 hours', remaining_percent: 0, reset_at: new Date(earliestReset).toISOString() }], credits: [] },
            ],
          }],
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    await client.call('subscriptionProxy.configure', {
      subscriptionProxy: { enabled: true, kind: 'douane', baseUrl: `http://127.0.0.1:${server.port}/v1`, dashboardUrl: `http://127.0.0.1:${server.port}/admin/#quotas` },
      key: 'douane-claude-test-key',
    });

    // Exact Douane state.rs:309 + relay.rs:281 HTTP 503 JSON body surfaced as server_error.
    const body503 = 'API Error: 503 {"error":{"type":"proxy_error","message":"no available subscription for this model; connect an account or wait for its quota reset"}}';
    scripted(() => {}, (fake) => {
      fake.emit(init('sess-douane-503-json'));
      for (const message of apiError('sess-douane-503-json', 'server_error', body503)) fake.emit(message);
    });
    expect(await runTurn(client, threadId, 'hit 503 json')).toBe('error');
    await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === earliestReset, 2000);
    expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });

    // Result-only 503 frame without an assistant error frame.
    scripted(() => {}, (fake) => {
      fake.emit(init('sess-douane-503-result'));
      fake.emit(sdk({ ...(success('sess-douane-503-result') as object), is_error: true, result: 'API Error: 503 no available subscription for this model; connect an account or wait for its quota reset' }));
    });
    expect(await runTurn(client, threadId, 'hit 503 result')).toBe('error');
    await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === earliestReset, 2000);
    expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });

    // Exact Douane relay.rs:471-474 HTTP 429 JSON body surfaced with an unknown code.
    const body429 = 'API Error: 429 {"error":{"type":"proxy_error","message":"all accounts for this provider are unavailable; check their quotas and connection status"}}';
    scripted(() => {}, (fake) => {
      fake.emit(init('sess-douane-429-json'));
      for (const message of apiError('sess-douane-429-json', 'unknown', body429)) fake.emit(message);
    });
    expect(await runTurn(client, threadId, 'hit 429 json')).toBe('error');
    await waitFor(() => harness.core.threads.list({}).find(thread => thread.id === threadId)?.retry?.resetsAt === earliestReset, 2000);
    expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });

    // Negative: HTTP 503 with relay.rs:473 (upstream 503 outage, not 429) stays interrupted.
    const body503Outage = 'API Error: 503 {"error":{"type":"proxy_error","message":"all accounts for this provider are unavailable; check their quotas and connection status"}}';
    scripted(() => {}, (fake) => {
      fake.emit(init('sess-douane-503-outage'));
      for (const message of apiError('sess-douane-503-outage', 'server_error', body503Outage)) fake.emit(message);
    });
    expect(await runTurn(client, threadId, 'hit 503 outage')).toBe('error');
    const { recovery } = await client.call('threads.get', { threadId });
    expect(recovery?.kind).toBe('interrupted');
  } finally {
    server.stop(true);
  }
});


