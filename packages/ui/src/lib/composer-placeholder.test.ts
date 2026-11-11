import { expect, test } from 'vitest';
import { composerPlaceholder } from './composer-placeholder';
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

test('a waiting permission says a message declines it and redirects, in a short form on a phone, after offline and a removed account', () => {
  const t = strings.composer;
  expect(composerPlaceholder({ ...base, permission: true })).toBe('Send a message to decline and redirect');
  expect(composerPlaceholder({ ...base, permission: true, replying: true })).toBe(t.permissionPlaceholder);
  expect(composerPlaceholder({ ...base, permission: true, narrow: true })).toBe('Reply to decline and redirect');
  // Send does something else in those states: they keep their own words.
  expect(composerPlaceholder({ ...base, permission: true, offline: true })).toBe(fill(t.placeholderOffline, { machine: 'This PC' }));
  expect(composerPlaceholder({ ...base, permission: true, accountGone: true })).toBe(t.placeholderPickAccount);
});

test('a question at the top of the box says what Send does to it: answers beside the options, alone, or waits behind it', () => {
  const t = strings.composer;
  expect(composerPlaceholder({ ...base, replying: true, answer: 'options' })).toBe('Or type your own answer');
  expect(composerPlaceholder({ ...base, replying: true, answer: 'text' })).toBe(t.answerTextPlaceholder);
  expect(composerPlaceholder({ ...base, replying: true, answer: 'after' })).toBe(t.afterAnswerPlaceholder);
  // Offline still wins: the answer could not leave.
  expect(composerPlaceholder({ ...base, answer: 'options', offline: true })).toBe(fill(t.placeholderOffline, { machine: 'This PC' }));
});
