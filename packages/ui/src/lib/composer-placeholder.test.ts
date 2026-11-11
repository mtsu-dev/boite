import { expect, test } from 'vitest';
import { composerPlaceholder } from './composer-placeholder';
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

test('a waiting permission says a message declines it, named by its title cut at a word, and redirects, shorter on a phone, after offline and a removed account', async () => {
  const t = strings.composer;
  const push = { toolName: 'Bash', input: { command: 'git push origin orbit/csv-import' } };
  // The titles load apart from the first page: until they do, the request is named generically.
  expect(composerPlaceholder({ ...base, permission: push })).toBe('Send a message to decline this request and redirect');
  await import('./decision-title');
  await new Promise((resolve) => setTimeout(resolve));
  expect(composerPlaceholder({ ...base, permission: push })).toBe('Send a message to decline "Push orbit/csv-import" and redirect');
  expect(composerPlaceholder({ ...base, permission: push, replying: true })).toBe(fill(t.permissionPlaceholder, { subject: '"Push orbit/csv-import"' }));
  // A phone's field holds fewer words: a title whose first two words do not fit is named generically, never cut inside a word.
  expect(composerPlaceholder({ ...base, permission: push, narrow: true })).toBe('Reply to decline this request');
  expect(composerPlaceholder({ ...base, permission: { toolName: 'Bash', input: { command: 'npm test' } }, narrow: true })).toBe('Reply to decline "Run the tests"');
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
