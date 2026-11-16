import { describe, expect, test } from 'bun:test';
import type { RpcEvents } from '@boite/contracts';
import { assistant, calls, claudeThread, harness, init, runTurn, scripted, sdk, success, useClaudeHarness } from './fixtures/claude-query.ts';
import { waitFor } from './harness.ts';

useClaudeHarness();

const SESSION = 'sess-suggest';

/** Each prompt is answered, then the CLI's `prompt_suggestion` follows the result, as `promptSuggestions` makes it. */
function answerAndSuggest(fake: Parameters<Parameters<typeof scripted>[0]>[0], _prompt: string, index: number): void {
  fake.emit(init(SESSION));
  fake.emit(assistant(SESSION, [{ type: 'text', text: `answer ${index}` }]));
  fake.emit(success(SESSION));
  fake.emit(sdk({ type: 'prompt_suggestion', suggestion: `  try step ${index + 1}  `, uuid: `ps-${index}`, session_id: SESSION }));
}

describe('claude prompt suggestions', () => {
  test('the option goes to the CLI and its suggestion after the result is the thread\'s, until the next message clears it', async () => {
    harness.core.settings.set({ warmProcessMinutes: 5 });
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    const events: RpcEvents['thread.suggestion'][] = [];
    harness.core.bus.onCommitted((name, payload) => { if (name === 'thread.suggestion') events.push(payload as RpcEvents['thread.suggestion']); });
    scripted(() => undefined, answerAndSuggest);

    expect(await runTurn(client, threadId, 'first')).toBe('done');
    expect(calls[0]?.options.promptSuggestions).toBe(true);
    await waitFor(() => events.length === 1);
    const turn = harness.core.journal.lastTurn(threadId)!;
    expect(events[0]).toEqual({ threadId, suggestion: { turnId: turn.id, text: 'try step 1', at: expect.any(Number) } });
    // A client that subscribes later, or reconnects, reads it with the thread.
    expect((await client.call('threads.get', { threadId })).suggestion).toMatchObject({ turnId: turn.id, text: 'try step 1' });
    // The timeline holds nothing of it.
    expect(JSON.stringify(harness.core.journal.listMessages(threadId))).not.toContain('try step');

    expect(await runTurn(client, threadId, 'second')).toBe('done');
    expect(events[1]).toEqual({ threadId, suggestion: null });
    await waitFor(() => events.length === 3);
    expect(events[2]?.suggestion).toMatchObject({ text: 'try step 2' });

    await client.call('threads.archive', { threadId });
    await waitFor(() => events.length === 4);
    expect(events[3]).toEqual({ threadId, suggestion: null });
    expect(harness.core.threads.agentState.suggestions.has(threadId)).toBe(false);
  });

  test('turned off, the CLI starts without the option and a stray suggestion is dropped', async () => {
    harness.core.settings.set({ warmProcessMinutes: 5, promptSuggestions: false });
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    scripted(() => undefined, answerAndSuggest);

    expect(await runTurn(client, threadId, 'first')).toBe('done');
    expect(calls[0]?.options.promptSuggestions).toBeUndefined();
    await Bun.sleep(50);
    expect((await client.call('threads.get', { threadId })).suggestion).toBeNull();
  });

  test('a delegated child gets no suggestion', async () => {
    harness.core.settings.set({ warmProcessMinutes: 5 });
    const client = await harness.connect();
    const parent = await claudeThread(client);
    const threadId = (await client.call('threads.create', { projectId: harness.core.journal.getThread(parent)!.projectId!, providerId: 'claude', accountId: harness.core.journal.getThread(parent)!.accountId, title: 'child' })).id;
    harness.core.journal.putThread({ ...harness.core.journal.getThread(threadId)!, parentThreadId: parent });
    scripted(() => undefined, answerAndSuggest);

    expect(await runTurn(client, threadId, 'first')).toBe('done');
    expect(calls[0]?.options.promptSuggestions).toBeUndefined();
    await Bun.sleep(50);
    expect(harness.core.threads.agentState.suggestions.has(threadId)).toBe(false);
  });
});
