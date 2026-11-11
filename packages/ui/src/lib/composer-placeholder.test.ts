import { expect, test } from 'vitest';
import { composerPlaceholder, declineHint } from './composer-placeholder';
import { cutAtWord } from './decision-subject.svelte';
import { fill, strings } from './strings';

const base = { target: null, replying: false, bot: null, offline: false, onThread: true, machine: 'This PC', provider: 'Claude' };

test('the box says two things at most: who reads it at rest, and reply while the agent works or asks', () => {
  const t = strings.composer;
  expect(composerPlaceholder(base)).toBe(fill(t.placeholder, { name: 'Claude' }));
  expect(composerPlaceholder({ ...base, onThread: false })).toBe(fill(t.placeholder, { name: 'Claude' }));
  expect(composerPlaceholder({ ...base, replying: true })).toBe(fill(t.replyPlaceholder, { name: 'Claude' }));
  expect(composerPlaceholder({ ...base, bot: 'Atlas', replying: true })).toBe(fill(t.replyPlaceholder, { name: 'Atlas' }));
  expect(composerPlaceholder({ ...base, provider: null })).toBe(fill(t.placeholder, { name: t.placeholderAgent }));
  // A state that changes what Send does says why instead.
  expect(composerPlaceholder({ ...base, offline: true })).toBe(fill(t.placeholderOffline, { machine: 'This PC' }));
  expect(composerPlaceholder({ ...base, offline: true, target: { placeholder: 'Side box' } })).toBe('Side box');
  // Under the notice that names the machine offline, the field does not say it again.
  expect(composerPlaceholder({ ...base, offline: true, away: true })).toBe('Sends when This PC is back');
  // A removed account locks the box: the field says what unlocks it, whatever else is going on.
  expect(composerPlaceholder({ ...base, accountGone: true, replying: true })).toBe(t.placeholderPickAccount);
  expect(t.placeholderPickAccount).toBe('Pick another account to send');
});

test('a waiting permission: the field says a message is the other way out, Send names the decision it declines, offline and a removed account keep their words', async () => {
  const t = strings.composer;
  const push = { toolName: 'Bash', input: { command: 'git push origin orbit/csv-import' } };
  expect(composerPlaceholder({ ...base, permission: push })).toBe('Or tell Claude what to do instead');
  expect(composerPlaceholder({ ...base, permission: push, bot: 'Atlas', replying: true })).toBe('Or tell Atlas what to do instead');
  // The titles load apart from the first page: until they do, the tooltip names the request generically.
  expect(declineHint(push)).toBe('Declines this request, then sends your message');
  await import('./decision-title');
  await new Promise((resolve) => setTimeout(resolve));
  expect(declineHint(push)).toBe('Declines Push orbit/csv-import, then sends your message');
  // Send does something else in those states: they keep their own words.
  expect(composerPlaceholder({ ...base, permission: push, offline: true })).toBe(fill(t.placeholderOffline, { machine: 'This PC' }));
  expect(composerPlaceholder({ ...base, permission: push, accountGone: true })).toBe(t.placeholderPickAccount);
});

test('a title longer than the room ends on its last whole word', () => {
  expect(cutAtWord('Run the release build for every target', 20)).toBe('Run the release\u2026');
  expect(cutAtWord('Edit src/lib/upload.ts', 12)).toBeNull();
  expect(cutAtWord('Push main', 20)).toBe('Push main');
});

test('a question at the top of the box says what Send does to it: answers beside the options, alone, or waits behind it', () => {
  const t = strings.composer;
  expect(composerPlaceholder({ ...base, replying: true, answer: 'options' })).toBe('Or type your own answer');
  expect(composerPlaceholder({ ...base, replying: true, answer: 'text' })).toBe(t.answerTextPlaceholder);
  expect(composerPlaceholder({ ...base, replying: true, answer: 'after' })).toBe(t.afterAnswerPlaceholder);
  // Offline still wins: the answer could not leave.
  expect(composerPlaceholder({ ...base, answer: 'options', offline: true })).toBe(fill(t.placeholderOffline, { machine: 'This PC' }));
});
