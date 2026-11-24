import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readDetachedWork, readPendingReply } from '../src/drivers/acp/detached.ts';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'boite-detached-'));
  homes.push(path);
  return path;
}

function write(root: string, conversation: string, path: string[], body: unknown): string {
  const file = join(root, 'antigravity-acp', 'brain', conversation, '.system_generated', ...path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

/** A child `session` launched with `call`, its record dated `at` seconds. */
function child(root: string, session: string, name: string, call: string, at: number): void {
  const record = write(root, session, ['subagents', `${name}.json`], { state: 'SUBAGENT_STATE_RUNNING' });
  utimesSync(record, at, at);
  write(root, name, ['messages', 'launch.json'], {
    sender: session,
    sourceMetadata: { tool: { toolCall: { id: call, name: 'invoke_subagent', argumentsJson: '{}' } } },
  });
}

describe('detached children', () => {
  test("a session's past children do not hide the one this turn launched", async () => {
    const root = home();
    for (let index = 0; index < 64; index += 1) child(root, 'session', `old-${index}`, `old-call-${index}`, 1_000 + index);
    child(root, 'session', 'new', 'call', 2_000);
    expect(await readDetachedWork(root, 'session', new Set(['call']))).toEqual({ launched: 1, atWork: 1 });
  });

  test("a session inbox full of past reports does not hide a child at work", async () => {
    const root = home();
    for (let index = 0; index < 257; index += 1) {
      const file = write(root, 'session', ['messages', `old-${index}.json`], { sender: `old-${index}`, priority: 'MESSAGE_PRIORITY_LOW' });
      utimesSync(file, 1_000 + index, 1_000 + index);
    }
    child(root, 'session', 'new', 'call', 2_000);
    expect(await readDetachedWork(root, 'session', new Set(['call']))).toEqual({ launched: 1, atWork: 1 });
  });

  test('an unreadable read receipt proves no report is unread', async () => {
    const root = home();
    write(root, 'session', ['messages', 'report.json'], { id: 'report', sender: 'worker', priority: 'MESSAGE_PRIORITY_HIGH' });
    expect(await readPendingReply(root, 'session')).toBe(true);
    write(root, 'session', ['messages', 'read.json'], '{"report": tr');
    expect(await readPendingReply(root, 'session')).toBe(false);
    write(root, 'session', ['messages', 'read.json'], { report: true });
    expect(await readPendingReply(root, 'session')).toBe(false);
  });
});
