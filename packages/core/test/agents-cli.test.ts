import { expect, test } from 'bun:test';
import { COORDINATION_RECENT_COMPLETION_MS, type AgentContact } from '@boite/contracts';
import { askArgs, contactLine } from '../src/agents-cli.ts';
import { parse } from '../src/cli-args.ts';

const now = 1_800_000_000_000;
const contact: AgentContact = { coreId: 'here', threadId: 'thread', title: 'Worker', machine: 'Test machine', resources: '', status: 'idle', mode: 'brief', activeAt: now };

test('activity advice uses successful completion, warns on unknown history and allows a recent follow-up', () => {
  expect(contactLine(contact, 'here', now)).toContain('not working');
  expect(contactLine(contact, 'here', now)).toContain('discouraged');
  expect(contactLine({ ...contact, lastCompletedAt: null }, 'here', now)).toContain('no completed turn');
  expect(contactLine({ ...contact, lastCompletedAt: now - COORDINATION_RECENT_COMPLETION_MS }, 'here', now)).not.toContain('warning:');
  expect(contactLine({ ...contact, lastCompletedAt: now - COORDINATION_RECENT_COMPLETION_MS - 1 }, 'here', now)).toContain('discouraged');
  expect(contactLine({ ...contact, lastCompletedAt: now + 1 }, 'here', now)).toContain('discouraged');
  // A crashed thread is unfinished work, not a finished one to leave alone.
  expect(contactLine({ ...contact, lastCompletedAt: now - COORDINATION_RECENT_COMPLETION_MS - 1, status: 'error' }, 'here', now)).toContain('note: its last turn failed; a message wakes it to resume.');
  for (const status of ['running', 'queued', 'waiting'] as const) expect(contactLine({ ...contact, status }, 'here', now)).not.toContain('warning:');
});

test('contact output exposes project restoration and an automatic delivery pause', () => {
  const line = contactLine({ ...contact, projectArchived: true, paused: true }, 'here', now);
  expect(line).toContain('project archived; delivery will restore it');
  expect(line).toContain('coordination paused');
});

test('threads ask keeps its own flags out of the request text, and the CLI hands them over as typed', () => {
  const words = parse(['threads', 'ask', 'someone', 'on', 'the', 'docs', '--to', 'Studio-B/thr_abc', '--new', '--wait', '--timeout', '30', '--json']);
  expect(words.json).toBe(true);
  expect(words.positional.slice(0, 2)).toEqual(['threads', 'ask']);
  expect(askArgs(words.positional.slice(2))).toEqual({ text: 'someone on the docs', target: 'Studio-B/thr_abc', want: 'thread', wait: true, timeout: 30 });
  expect(parse(['agents', 'ask', 'x', '--share']).positional).toEqual(['threads', 'ask', 'x', '--share']);
  expect(askArgs(['--contact', 'Studio', 'a', 'reviewer'])).toEqual({ text: 'a reviewer', contact: 'Studio', wait: false });
  expect(() => askArgs(['--new', '--share', 'x'])).toThrow('exclude each other');
  expect(() => askArgs(['--to', 'thr_abc', 'x'])).toThrow('<contact>/<thread-id>');
  expect(() => askArgs(['--project', 'x', 'y'])).toThrow('unknown flag --project');
  expect(() => askArgs(['--wait'])).toThrow('needs the request text');
  // After `--`, a word like `--timeout` is the request's, and the CLI hands `--` over.
  const typed = parse(['threads', 'ask', '--wait', '--', 'how', 'to', 'pass', '--timeout', 'to', 'curl']);
  expect(askArgs(typed.positional.slice(2))).toEqual({ text: 'how to pass --timeout to curl', wait: true });
  // Other threads commands still refuse a flag they do not know.
  expect(() => parse(['threads', 'send', 'thr_a', 'hi', '--new'])).toThrow('unknown flag --new');
});
