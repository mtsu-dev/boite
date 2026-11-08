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
});
