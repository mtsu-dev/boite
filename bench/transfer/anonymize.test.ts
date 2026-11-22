import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { anonymize, FORBIDDEN } from './anonymize.ts';
import { FIXTURE_PROMPT, NOTES_TEXT, PROVIDERS, readFixture } from './fixture.ts';

const machine = { home: 'C:\\Users\\alice', temp: 'C:\\Users\\alice\\AppData\\Local\\Temp', user: 'alice', host: 'ALICE-PC' };

describe('anonymize', () => {
  test('takes the recording machine out of every spelling of its paths', () => {
    const project = 'C:\\Users\\alice\\AppData\\Local\\Temp\\boite-transfer-x1y2\\notes.md';
    const [, line] = anonymize({ provider: 'codex', agentVersion: '1', model: 'm', lines: [{
      cwd: project,
      json: JSON.stringify({ path: project }),
      forward: 'c:/Users/alice/AppData/Local/Temp/boite-core-abc/accounts/acc_abcdefgh/config.toml',
      home: 'see C:\\Users\\alice\\.codex\\auth.json on ALICE-PC, mail alice@corp.io',
      shell: '"C:\\Program Files\\WindowsApps\\PowerShell_7\\pwsh.exe" -Command ls',
    }] }, machine);
    expect(line).toEqual({
      cwd: '/workspace/notes.md',
      json: JSON.stringify({ path: '/workspace/notes.md' }),
      forward: expect.stringMatching(/^\/data\/accounts\/acc_[a-z0-9]{8}\/config\.toml$/),
      home: 'see /home/user/.codex/auth.json on host, mail user@example.com',
      shell: '"/usr/bin/pwsh" -Command ls',
    });
  });

  test('swaps each id for one of its length and alphabet, the same one each time, and reseeds signatures', () => {
    const uuid = '0f8e7c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
    const [, first, second] = anonymize({ provider: 'claude', agentVersion: '1', model: 'm', lines: [
      { session_id: uuid, id: 'toolu_01AbCdEfGhIjKlMn', signature: 'EqQBCkYIBhgCKkA+/=' },
      { session_id: uuid, text: `tool toolu_01AbCdEfGhIjKlMn` },
    ] }, machine) as Record<string, string>[];
    expect(first!['session_id']).not.toBe(uuid);
    expect(first!['session_id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(second!['session_id']).toBe(first!['session_id']!);
    expect(first!['id']).toMatch(/^toolu_[A-Za-z0-9]{16}$/);
    expect(second!['text']).toBe(`tool ${first!['id']}`);
    expect(first!['signature']).toHaveLength('EqQBCkYIBhgCKkA+/='.length);
    expect(first!['signature']).not.toBe('EqQBCkYIBhgCKkA+/=');
  });

  test('anonymizes a path streamed across pieces and keeps the number of pieces', () => {
    const pieces = ['{"file_', 'path": "C', ':\\\\Users\\\\ali', 'ce\\\\AppData\\\\Local\\\\Temp\\\\boite-transfer-q9\\\\notes.md"}'];
    const lines = pieces.map((partial_json) => ({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } } }));
    const out = anonymize({ provider: 'claude', agentVersion: '1', model: 'm', lines }, machine).slice(1) as typeof lines;
    expect(out).toHaveLength(pieces.length);
    expect(out.map((line) => line.event.delta.partial_json).join('')).toBe('{"file_path": "/workspace/notes.md"}');
  });

  test('writes the header first', () => {
    expect(anonymize({ provider: 'opencode', agentVersion: '1.2', model: 'x/y', lines: [] }, machine)).toEqual([
      { fixture: 1, provider: 'opencode', agentVersion: '1.2', model: 'x/y', prompt: FIXTURE_PROMPT },
    ]);
  });
});

/** What a fixture streams in pieces, joined, so a value cut in two is read whole. */
function streamedText(lines: unknown[]): string {
  return lines.map((line) => {
    const value = line as { event?: { delta?: Record<string, unknown> }; params?: { delta?: unknown; update?: { content?: { text?: unknown } } } };
    const delta = value.event?.delta;
    const piece = delta?.['text'] ?? delta?.['partial_json'] ?? delta?.['thinking'] ?? value.params?.delta ?? value.params?.update?.content?.text;
    return typeof piece === 'string' ? piece : '';
  }).join('');
}

/** The commands, skills and agents a fixture's agent says it has: built in, or the recording machine's own. */
function listed(lines: unknown[]): string[] {
  return lines.flatMap((line) => {
    const value = line as { type?: string; subtype?: string; skills?: string[]; slash_commands?: string[]; agents?: string[]; params?: { update?: { availableCommands?: { name: string }[] } } };
    if (value.type === 'system' && value.subtype === 'init') return [...value.skills ?? [], ...value.slash_commands ?? [], ...value.agents ?? []];
    return value.params?.update?.availableCommands?.map((command) => command.name) ?? [];
  });
}

/** Skills installed for this machine's user, which a recording must not list. */
function machineSkills(): Set<string> {
  const roots = [join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills'), join(homedir(), '.config', 'opencode', 'skills')];
  if (process.env.CLAUDE_CONFIG_DIR) roots.push(join(process.env.CLAUDE_CONFIG_DIR, 'skills'));
  return new Set(roots.filter((root) => existsSync(root)).flatMap((root) => readdirSync(root)));
}

describe('fixtures', () => {
  // A name the fixture's own text uses ("runner" on a CI runner) is not a leak,
  // nor one of the anonymizer's own placeholders (a container's user `user`).
  const ownWords = new Set(`${NOTES_TEXT} ${FIXTURE_PROMPT} user host example`.toLowerCase().split(/\W+/));
  const names = [userInfo().username, hostname()].filter((name) => name.length >= 3 && !ownWords.has(name.toLowerCase()));

  for (const provider of PROVIDERS) {
    test(`${provider} holds nothing of the machine that recorded it`, () => {
      const { header, lines } = readFixture(provider);
      expect(header.prompt).toBe(FIXTURE_PROMPT);
      const text = `${JSON.stringify(lines)}\n${streamedText(lines)}`;
      for (const [pattern, what] of FORBIDDEN) expect({ what, found: pattern.exec(text)?.[0] }).toEqual({ what, found: undefined });
      for (const name of names) expect(text.toLowerCase()).not.toContain(name.toLowerCase());
      const skills = machineSkills();
      expect(listed(lines).filter((name) => skills.has(name))).toEqual([]);
    });
  }
});
