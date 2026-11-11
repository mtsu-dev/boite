import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ConversationSwitches from './ConversationSwitches.svelte';
import { chatPrefs, CHAT_PREFS_STORAGE_KEY, readChatPrefs } from '../lib/chat-prefs.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  localStorage.clear();
  Object.assign(chatPrefs, readChatPrefs());
});

test('file grouping and automatic previews default to compact and persist independently', () => {
  running = mount(ConversationSwitches, { target: document.body, props: { part: 'conversation' } });
  flushSync();
  const group = document.querySelector<HTMLInputElement>('[data-testid=chat-group-changes]')!;
  const preview = document.querySelector<HTMLInputElement>('[data-testid=chat-expand-diffs]')!;
  expect(group.checked).toBe(true);
  expect(preview.checked).toBe(false);
  group.click(); preview.click(); flushSync();
  expect(readChatPrefs()).toEqual({ groupChanges: false, expandDiffs: true });
  localStorage.setItem(CHAT_PREFS_STORAGE_KEY, JSON.stringify({ groupChanges: true, expandDiffs: false }));
  window.dispatchEvent(new StorageEvent('storage', { key: CHAT_PREFS_STORAGE_KEY })); flushSync();
  expect(group.checked).toBe(true);
  expect(preview.checked).toBe(false);
});

test('the list part holds the grouping alone, and a phone, whose list display options hold it, has none', () => {
  running = mount(ConversationSwitches, { target: document.body, props: { part: 'list' } });
  flushSync();
  expect(document.querySelector('[data-testid=setting-group-working-threads]')).not.toBeNull();
  expect(document.querySelector('[data-testid=setting-chat-artifacts]')).toBeNull();
  unmount(running, { outro: false });
  running = mount(ConversationSwitches, { target: document.body, props: { part: 'list', phone: true } });
  flushSync();
  expect(document.querySelector('[data-testid=setting-group-working-threads]')).toBeNull();
  unmount(running, { outro: false });
  running = mount(ConversationSwitches, { target: document.body, props: { part: 'conversation', phone: true } });
  flushSync();
  expect(document.querySelector('[data-testid=setting-chat-artifacts]')).not.toBeNull();
  expect(document.querySelector('[data-testid=chat-group-changes]')).not.toBeNull();
});
