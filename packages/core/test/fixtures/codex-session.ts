/*
 * Codex rollouts the way the CLI writes them, with invented content: the
 * dialect of 0.165 and later (`item_completed` events), the one before it
 * (`user_message` and `agent_message` events, tools as `response_item`
 * records), and a subagent's. Each also carries the `response_item` copies
 * and the injected context the CLI writes beside the conversation, which an
 * import must not read as prompts.
 */

export const CODEX_FIXTURE_SESSION_ID = '01a2b3c4-1111-7aaa-8bbb-0123456789ab';

function lines(records: Record<string, unknown>[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

/** The file name the CLI gives a rollout, under `sessions/<year>/<month>/<day>`. */
export function codexRolloutPath(sessionId = CODEX_FIXTURE_SESSION_ID): string[] {
  return ['sessions', '2026', '09', '10', `rollout-2026-09-10T08-00-00-${sessionId}.jsonl`];
}

function meta(cwd: string, sessionId: string, source: unknown = 'cli'): Record<string, unknown> {
  return {
    timestamp: '2026-09-10T08:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: sessionId,
      session_id: sessionId,
      timestamp: '2026-09-10T08:00:00.000Z',
      cwd,
      originator: 'codex_cli_rs',
      cli_version: '0.167.2',
      source,
      model_provider: 'openai',
      base_instructions: { text: 'You are a coding agent.' },
    },
  };
}

function injected(at: string): Record<string, unknown> {
  return {
    timestamp: at,
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/somewhere</cwd>\n</environment_context>' }] },
  };
}

function item(at: string, body: Record<string, unknown>): Record<string, unknown> {
  return { timestamp: at, type: 'event_msg', payload: { type: 'item_completed', thread_id: 't', turn_id: 'turn', item: body } };
}

/** Two prompts: reasoning, a command, a patch, an MCP call and two messages, then a short answer. */
export function codexSessionFixture(cwd: string, options: { sessionId?: string; source?: unknown; prompt?: string } = {}): string {
  const sessionId = options.sessionId ?? CODEX_FIXTURE_SESSION_ID;
  const prompt = options.prompt ?? 'List the files of this folder, then say hello';
  return lines([
    meta(cwd, sessionId, options.source),
    injected('2026-09-10T08:00:00.500Z'),
    { timestamp: '2026-09-10T08:00:01.000Z', type: 'turn_context', payload: { cwd, model: 'gpt-5.5', effort: 'medium', turn_id: 'turn' } },
    { timestamp: '2026-09-10T08:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn' } },
    { timestamp: '2026-09-10T08:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } },
    item('2026-09-10T08:00:01.000Z', { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: prompt, text_elements: [] }] }),
    item('2026-09-10T08:00:03.000Z', { type: 'Reasoning', id: 'r1', summary_text: ['A directory listing first.'], raw_content: [] }),
    { timestamp: '2026-09-10T08:00:03.000Z', type: 'response_item', payload: { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque' } },
    { timestamp: '2026-09-10T08:00:04.000Z', type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'ls', status: 'completed' } },
    item('2026-09-10T08:00:05.000Z', {
      type: 'CommandExecution', id: 'c1', command: ['/bin/bash', '-lc', 'ls'], cwd, aggregated_output: 'README.md\npackage.json',
      exit_code: 0, status: 'completed', source: 'unified_exec_startup', duration: { secs: 0, nanos: 1000 }, parsed_cmd: [{ type: 'list_files', cmd: 'ls', path: null }],
    }),
    { timestamp: '2026-09-10T08:00:05.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'README.md\npackage.json' } },
    item('2026-09-10T08:00:06.000Z', { type: 'AgentMessage', id: 'm1', phase: 'commentary', content: [{ type: 'Text', text: 'Two files.' }] }),
    item('2026-09-10T08:00:07.000Z', {
      type: 'FileChange', id: 'p1', status: 'completed', stdout: '', stderr: '',
      changes: { 'notes.md': { type: 'add', content: 'hello\n' }, 'README.md': { type: 'update', unified_diff: '@@ -1 +1 @@\n-old\n+new\n', move_path: null } },
    }),
    item('2026-09-10T08:00:08.000Z', {
      type: 'McpToolCall', id: 'x1', server: 'docs', tool: 'search', status: 'failed', arguments: { query: 'hello' },
      result: { content: [{ type: 'text', text: 'no index' }], isError: true }, duration: { secs: 0, nanos: 5 },
    }),
    item('2026-09-10T08:00:09.000Z', { type: 'AgentMessage', id: 'm2', phase: 'final_answer', content: [{ type: 'Text', text: 'Hello.' }] }),
    { timestamp: '2026-09-10T08:00:09.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Hello.' }] } },
    { timestamp: '2026-09-10T08:00:09.500Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn', last_agent_message: 'Hello.' } },
    { timestamp: '2026-09-10T08:01:00.000Z', type: 'turn_context', payload: { cwd, model: 'gpt-5.5-codex', turn_id: 'turn2' } },
    item('2026-09-10T08:01:00.000Z', { type: 'UserMessage', id: 'u2', content: [{ type: 'text', text: 'Thanks, bye', text_elements: [] }] }),
    item('2026-09-10T08:01:02.000Z', { type: 'AgentMessage', id: 'm3', phase: 'final_answer', content: [{ type: 'Text', text: 'Bye.' }] }),
  ]);
}

/** The older dialect: one prompt, reasoning, a function call with its output, one the file never answers, an answer. */
export function codexLegacySessionFixture(cwd: string, sessionId: string): string {
  return lines([
    meta(cwd, sessionId),
    injected('2026-09-10T08:00:00.500Z'),
    { timestamp: '2026-09-10T08:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Count the files' }] } },
    { timestamp: '2026-09-10T08:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Count the files', kind: 'plain' } },
    { timestamp: '2026-09-10T08:00:01.500Z', type: 'turn_context', payload: { cwd, model: 'gpt-5-codex' } },
    { timestamp: '2026-09-10T08:00:02.000Z', type: 'event_msg', payload: { type: 'agent_reasoning', text: 'Counting first.' } },
    { timestamp: '2026-09-10T08:00:03.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","ls | wc -l"]}', call_id: 'call_1' } },
    { timestamp: '2026-09-10T08:00:04.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: '{"output":"2\\n","metadata":{"exit_code":0}}' } },
    { timestamp: '2026-09-10T08:00:05.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["sleep","60"]}', call_id: 'call_2' } },
    { timestamp: '2026-09-10T08:00:06.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Two files.' } },
    { timestamp: '2026-09-10T08:00:06.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Two files.' }] } },
  ]);
}
