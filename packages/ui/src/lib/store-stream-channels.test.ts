import { afterEach, expect, vi } from 'vitest';
import type { MessagePart } from '@boite/contracts';
import { test } from '../test/fake-client';
import type { Store } from './store.svelte';

afterEach(() => { vi.unstubAllGlobals(); });

/** The window draws the phone layout (`onPhone`) or the desktop one. */
function screen(phone: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: phone, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
}

function card(store: Store, at: { messageId: string; partIndex: number }): Extract<MessagePart, { type: 'tool' }> {
  const part = store.openThread!.messages.find(message => message.id === at.messageId)?.parts[at.partIndex];
  if (part?.type !== 'tool') throw new Error('no running card');
  return part;
}

/** The `channels` each subscribing call carried, in order. */
function asked(calls: unknown[][]): (string[] | undefined)[] {
  return calls
    .filter(([method, params]) => method === 'threads.subscribe' || (method === 'threads.get' && !!(params as { open?: unknown }).open))
    .map(([, params]) => (params as { channels?: string[] }).channels);
}

test('a phone leaves a running command\'s output on the core until a card watches it', async ({ ready }) => {
  screen(true);
  const { store, client } = await ready({ delayMs: 0 });
  const calls = vi.spyOn(client, 'call');
  await store.open('t-trace');
  expect(asked(calls.mock.calls)).toEqual([['text', 'tools']]);

  const at = client.redrawCommand('t-trace', 'compiling 1/40\n');
  await vi.waitFor(() => expect(card(store, at).outputDeferred).toBe(true));
  expect(card(store, at).output).toBe('');

  // An open card on the running call asks for its output: what it printed so far comes back at once.
  const release = store.watchLiveOutput('t-trace');
  await vi.waitFor(() => expect(card(store, at).output).toBe('compiling 1/40\n'));
  expect(asked(calls.mock.calls).at(-1)).toBeUndefined();
  client.redrawCommand('t-trace', 'compiling 2/40\n');
  await vi.waitFor(() => expect(card(store, at).output).toBe('compiling 2/40\n'));

  // The card folds: the next redraws stay on the core again.
  release();
  await vi.waitFor(() => expect(asked(calls.mock.calls).at(-1)).toEqual(['text', 'tools']));
  const before = calls.mock.calls.length;
  client.redrawCommand('t-trace', 'compiling 3/40\n');
  await vi.waitFor(() => expect(card(store, at).outputDeferred).toBe(true));
  expect(card(store, at).output).toBe('');
  expect(calls.mock.calls.length).toBe(before);
  calls.mockRestore();
});

test('a phone window widened past the phone layout gets the output of a card it opens', async ({ ready }) => {
  screen(true);
  const { store, client } = await ready({ delayMs: 0 });
  const calls = vi.spyOn(client, 'call');
  await store.open('t-trace');
  const at = client.redrawCommand('t-trace', 'compiling 1/40\n');
  await vi.waitFor(() => expect(card(store, at).outputDeferred).toBe(true));

  // The window grows past 720px: the core still holds the phone's narrow subscription.
  screen(false);
  const release = store.watchLiveOutput('t-trace');
  await vi.waitFor(() => expect(card(store, at).output).toBe('compiling 1/40\n'));
  expect(asked(calls.mock.calls).at(-1)).toBeUndefined();
  // Once wide, closing the card keeps every channel: a desktop window does not narrow.
  release();
  client.redrawCommand('t-trace', 'compiling 2/40\n');
  await vi.waitFor(() => expect(card(store, at).output).toBe('compiling 2/40\n'));
  expect(asked(calls.mock.calls)).toEqual([['text', 'tools'], undefined]);
  calls.mockRestore();
});

test('a desktop window asks for every channel and gets every redraw', async ({ ready }) => {
  screen(false);
  const { store, client } = await ready({ delayMs: 0 });
  const calls = vi.spyOn(client, 'call');
  await store.open('t-trace');
  expect(asked(calls.mock.calls)).toEqual([undefined]);
  const at = client.redrawCommand('t-trace', 'compiling 1/40\n');
  await vi.waitFor(() => expect(card(store, at).output).toBe('compiling 1/40\n'));
  // A card watching changes nothing on a desktop: no new subscribe.
  const release = store.watchLiveOutput('t-trace');
  release();
  expect(asked(calls.mock.calls)).toEqual([undefined]);
  calls.mockRestore();
});
