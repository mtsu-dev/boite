import { describe, expect, test } from 'vitest';
import { avatarLit, litReason, moodFacts } from './avatar-lit';

describe('a mochi picture lights only for the owner', () => {
  test('each reason lights it, the strongest named first', () => {
    expect(litReason({ open: true })).toBe('open');
    expect(litReason({ attention: true })).toBe('attention');
    expect(litReason({ failed: true })).toBe('failed');
    expect(litReason({ unread: 2 })).toBe('unread');
    expect(litReason({ unread: true })).toBe('unread');
    expect(litReason({ open: true, failed: true, unread: 1 })).toBe('open');
    expect(litReason({ attention: true, failed: true })).toBe('attention');
  });
  test('grey otherwise: at rest, at work, nothing unread', () => {
    expect(avatarLit({})).toBe(false);
    expect(avatarLit({ open: false, attention: false, failed: false, unread: 0 })).toBe(false);
    expect(avatarLit({ unread: false })).toBe(false);
    expect(avatarLit(moodFacts('working'))).toBe(false);
    expect(avatarLit(moodFacts('idle'))).toBe(false);
    expect(avatarLit(moodFacts(undefined))).toBe(false);
  });
  test('a mood that waits, failed or has news carries its reason', () => {
    expect(litReason(moodFacts('waiting'))).toBe('attention');
    expect(litReason(moodFacts('error'))).toBe('failed');
    expect(litReason(moodFacts('unread'))).toBe('unread');
  });
});
