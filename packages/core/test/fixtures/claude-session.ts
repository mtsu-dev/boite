/*
 * A Claude Code transcript the way the CLI writes one: two prompts, a tool
 * call answered by a `tool_result`, a thinking block, a sidechain the import
 * leaves out, an `ai-title` record when asked for one. Shared by the core
 * test and the browser e2e.
 */

export const FIXTURE_SESSION_ID = '0f3a9c2e-1111-4bbb-8ccc-0123456789ab';

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

export function claudeSessionFixture(cwd: string, options: { aiTitle?: string; sessionId?: string } = {}): string {
  const sessionId = options.sessionId ?? FIXTURE_SESSION_ID;
  const base = { isSidechain: false, cwd, sessionId, version: '2.1.266', gitBranch: 'main', userType: 'external' };
  const records: Record<string, unknown>[] = [
    { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-09-10T08:00:00.000Z', sessionId },
    {
      ...base,
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      timestamp: '2026-09-10T08:00:01.000Z',
      message: { role: 'user', content: 'List the files of this folder, then say hello' },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      timestamp: '2026-09-10T08:00:03.000Z',
      message: {
        id: 'msg_1',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'thinking', thinking: 'A directory listing first.', signature: 'sig' }],
      },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'a2',
      parentUuid: 'a1',
      timestamp: '2026-09-10T08:00:04.000Z',
      message: {
        id: 'msg_1',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
      },
    },
    {
      ...base,
      type: 'user',
      uuid: 'u2',
      parentUuid: 'a2',
      timestamp: '2026-09-10T08:00:05.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'README.md\npackage.json' }] },
      toolUseResult: { stdout: 'README.md\npackage.json' },
    },
    // A subagent's records: the same file, another conversation, not the user's.
    {
      ...base,
      isSidechain: true,
      type: 'user',
      uuid: 's1',
      parentUuid: null,
      timestamp: '2026-09-10T08:00:05.500Z',
      message: { role: 'user', content: 'Explore the repository' },
    },
    {
      ...base,
      isSidechain: true,
      type: 'assistant',
      uuid: 's2',
      parentUuid: 's1',
      timestamp: '2026-09-10T08:00:05.600Z',
      message: { id: 'msg_s', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'Explored.' }] },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'a3',
      parentUuid: 'u2',
      timestamp: '2026-09-10T08:00:06.000Z',
      message: { id: 'msg_2', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Two files. ' }] },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'a4',
      parentUuid: 'a3',
      timestamp: '2026-09-10T08:00:06.500Z',
      message: { id: 'msg_2', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Hello.' }] },
    },
    {
      ...base,
      type: 'user',
      uuid: 'u3',
      parentUuid: 'a4',
      timestamp: '2026-09-10T08:01:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Thanks, bye' }] },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'a5',
      parentUuid: 'u3',
      timestamp: '2026-09-10T08:01:02.000Z',
      message: { id: 'msg_3', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Bye.' }] },
    },
    { type: 'last-prompt', lastPrompt: 'Thanks, bye', sessionId },
  ];
  if (options.aiTitle !== undefined) records.push({ type: 'ai-title', aiTitle: options.aiTitle, sessionId });
  return `${records.map(line).join('\n')}\n`;
}

/**
 * Records the CLI files as the user's beside what the user typed: a caveat, a
 * slash command and its output, a shell command and its output, a skill's
 * body, a background task's notice, an interrupt and its filler reply, a
 * compaction summary and an error the CLI wrote in the agent's place.
 */
export function claudeCliRecordsFixture(cwd: string, sessionId: string): string {
  const base = { isSidechain: false, cwd, sessionId, version: '2.1.266', gitBranch: 'main', userType: 'external' };
  let clock = 0;
  const at = (): string => new Date(Date.parse('2026-09-11T09:00:00.000Z') + 1000 * clock++).toISOString();
  const user = (content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...base,
    type: 'user',
    timestamp: at(),
    message: { role: 'user', content },
    ...extra,
  });
  const assistant = (id: string, ...texts: string[]): Record<string, unknown> => ({
    ...base,
    type: 'assistant',
    timestamp: at(),
    message: { id, role: 'assistant', model: 'claude-sonnet-5', content: texts.map((text) => ({ type: 'text', text })) },
  });
  const synthetic = (text: string, error: boolean): Record<string, unknown> => ({
    ...assistant(`syn_${clock}`, text),
    message: { id: `syn_${clock}`, role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] },
    isApiErrorMessage: error,
  });
  const records = [
    user('<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>', { isMeta: true }),
    user('<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>'),
    user('<local-command-stdout>Set model to Sonnet 5</local-command-stdout>'),
    user('<bash-input>git status</bash-input>'),
    user('<bash-stdout>On branch main</bash-stdout><bash-stderr></bash-stderr>'),
    user('<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>the </command-args> tag</command-args>'),
    user([{ type: 'text', text: 'Review the last commit for bugs and report them.' }], { isMeta: true }),
    assistant('msg_r', 'The commit ', 'looks fine.'),
    user('Now fix the typo in README.md'),
    assistant('msg_f', 'Started the build in the background.'),
    user('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'),
    assistant('msg_t', 'The build passed.'),
    user([{ type: 'text', text: '[Request interrupted by user]' }]),
    synthetic('No response requested.', false),
    user([{ type: 'text', text: '[Request interrupted by user for tool use]\n' }]),
    user('This session is being continued from a previous conversation that ran out of context.', { isCompactSummary: true }),
    user('<local-command-stderr>Error: compaction failed</local-command-stderr>'),
    user([{ type: 'text', text: 'Thanks' }]),
    synthetic('API Error: 529 overloaded', true),
  ];
  return `${records.map(line).join('\n')}\n`;
}

/** A session of bare commands: the CLI's records around them, no reply from the agent. */
export function claudeCommandsOnlyFixture(cwd: string, sessionId: string, answer: 'none' | 'error' | 'reply'): string {
  const base = { isSidechain: false, cwd, sessionId, version: '2.1.266', userType: 'external' };
  const records: Record<string, unknown>[] = [
    { ...base, type: 'user', isMeta: true, timestamp: '2026-09-12T10:00:00.000Z', message: { role: 'user', content: '<local-command-caveat>Caveat</local-command-caveat>' } },
    {
      ...base,
      type: 'user',
      timestamp: '2026-09-12T10:00:01.000Z',
      message: { role: 'user', content: '<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args>keep the plan</command-args>' },
    },
    { ...base, type: 'user', timestamp: '2026-09-12T10:00:02.000Z', message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } },
  ];
  if (answer !== 'none') {
    records.push({
      ...base,
      type: 'assistant',
      timestamp: '2026-09-12T10:00:03.000Z',
      ...(answer === 'error' ? { isApiErrorMessage: true } : {}),
      message: {
        id: 'msg_c',
        role: 'assistant',
        model: answer === 'error' ? '<synthetic>' : 'claude-sonnet-5',
        content: [{ type: 'text', text: answer === 'error' ? 'API Error: 500' : 'Compacted, the plan is kept.' }],
      },
    });
  }
  return `${records.map(line).join('\n')}\n`;
}
