import { expect, test, vi } from 'vitest';
import { DisplayImages, KEPT_CHARS, KEPT_GLOBAL_CHARS } from './store/display-images';
import type { StoreContext } from './store/context';
import { FakeClient } from './fake-client';
import { Store } from './store.svelte';

test('originals of a few MB each stay within the character bound, the newest kept', async () => {
  const call = vi.fn(async () => ({ data: 'A'.repeat(1024 * 1024), mimeType: 'image/gif' }));
  const images = new DisplayImages({ client: { call } } as unknown as StoreContext);
  try {
    for (let index = 0; index < 30; index++) await images.load('t-1', `m-${index}`, 0, 'image/gif');
    expect(images.chars).toBeLessThanOrEqual(KEPT_CHARS);
    expect(images.chars).toBeGreaterThan(KEPT_CHARS - 2 * 1024 * 1024);
    await images.load('t-1', 'm-29', 0, 'image/gif');
    expect(call).toHaveBeenCalledTimes(30);
    await images.load('t-1', 'm-0', 0, 'image/gif');
    expect(call).toHaveBeenCalledTimes(31);
  } finally {
    images.clear();
  }
});

test('connected machines share one renderer-wide image budget and evict hidden machines first', async () => {
  const chunk = 'B'.repeat(4 * 1024 * 1024);
  const hiddenCall = vi.fn(async () => ({ data: chunk, mimeType: 'image/gif' }));
  const visibleCall = vi.fn(async () => ({ data: chunk, mimeType: 'image/gif' }));
  const hidden = new DisplayImages({ client: { call: hiddenCall }, store: { visible: false } } as unknown as StoreContext);
  const visible = new DisplayImages({ client: { call: visibleCall }, store: { visible: true } } as unknown as StoreContext);
  try {
    for (let index = 0; index < 4; index++) await hidden.load('t-h', `m-${index}`, 0, 'image/gif');
    for (let index = 0; index < 4; index++) await visible.load('t-v', `m-${index}`, 0, 'image/gif');
    expect(hidden.chars + visible.chars).toBeLessThanOrEqual(KEPT_GLOBAL_CHARS);
    // Visible store kept all 4 of its entries (~16M chars) while hidden store gave up space first.
    expect(visible.chars).toBeGreaterThan(16 * 1024 * 1024);
    expect(hidden.chars).toBeLessThan(12 * 1024 * 1024);
  } finally {
    hidden.clear();
    visible.clear();
  }
});

test('detaching a store releases its display images from the renderer cache', async () => {
  const chunk = 'C'.repeat(4 * 1024 * 1024);
  const removed = new Store();
  const client = new FakeClient({ delayMs: 0 });
  const visibleCall = vi.fn(async () => ({ data: chunk, mimeType: 'image/gif' }));
  const visible = new DisplayImages({ client: { call: visibleCall }, store: { visible: true } } as unknown as StoreContext);
  try {
    vi.spyOn(client, 'call').mockImplementation(async () => ({ data: chunk, mimeType: 'image/gif' }) as never);
    // Load the surviving store first so it would be evicted first if detach left the removed store behind.
    await visible.load('t-v', 'm-0', 0, 'image/gif');
    removed.attach(client);
    for (let index = 0; index < 4; index++) await removed.loadDisplayImage('t-r', `m-${index}`, 0, 'image/gif');
    removed.detach();
    await visible.load('t-v', 'm-1', 0, 'image/gif');
    await visible.load('t-v', 'm-2', 0, 'image/gif');
    // Surviving store's oldest entry stays cached because detach freed the removed store's budget.
    await visible.load('t-v', 'm-0', 0, 'image/gif');
    expect(visibleCall).toHaveBeenCalledTimes(3);
  } finally {
    removed.detach();
    client.close();
    visible.clear();
  }
});

test('another machine never answers with a picture the previous one sent', async () => {
  const store = new Store();
  const clients = [new FakeClient({ delayMs: 0 }), new FakeClient({ delayMs: 0 })];
  try {
    for (const [index, client] of clients.entries()) {
      vi.spyOn(client, 'call').mockImplementation(async () => ({ data: `machine-${index}`, mimeType: 'image/webp' }) as never);
    }
    store.attach(clients[0]!);
    expect(await store.loadDisplayImage('t-1', 'm-1', 0, 'image/png')).toBe('data:image/webp;base64,machine-0');
    store.attach(clients[1]!);
    expect(await store.loadDisplayImage('t-1', 'm-1', 0, 'image/png')).toBe('data:image/webp;base64,machine-1');
  } finally {
    store.detach();
    for (const client of clients) client.close();
  }
});

test('a copy comes as a file route address at the machine it was asked of, by size, and as base64 through a relay in the shell', async () => {
  const call = vi.fn(async (_method: string, params: { thumb?: boolean; ticket?: boolean }) => params.ticket ? { data: '', url: `/file/${params.thumb ? 'small' : 'large'}`, mimeType: 'image/webp', bytes: 9 } : { data: 'UklG', mimeType: 'image/webp' });
  const store = { endpointUrl: 'http://192.168.1.5:7777' };
  const images = new DisplayImages({ client: { call }, store } as unknown as StoreContext);
  try {
    expect(await images.load('t-1', 'm-1', 0, 'image/png', true)).toBe('http://192.168.1.5:7777/file/small');
    expect(call).toHaveBeenLastCalledWith('messages.attachment', { threadId: 't-1', messageId: 'm-1', partIndex: 0, display: true, thumb: true, ticket: true });
    expect(await images.load('t-1', 'm-1', 0, 'image/png')).toBe('http://192.168.1.5:7777/file/large');
    expect(await images.load('t-1', 'm-1', 0, 'image/png', true)).toBe('http://192.168.1.5:7777/file/small');
    expect(call).toHaveBeenCalledTimes(2);
    // An address that stopped loading is asked again.
    images.forget('t-1', 'm-1', 0, true);
    await images.load('t-1', 'm-1', 0, 'image/png', true);
    expect(call).toHaveBeenCalledTimes(3);

    // Players use the same owning endpoint, but ask for the original instead of a display copy.
    expect(await images.original('t-1', 'm-video', 2, 'video/mp4')).toBe('http://192.168.1.5:7777/file/large');
    expect(call).toHaveBeenLastCalledWith('messages.attachment', { threadId: 't-1', messageId: 'm-video', partIndex: 2, ticket: true });

    // The shell admits `/file/` only at a machine's own address: through a relay it asks for base64.
    store.endpointUrl = `http://192.168.1.5:7777/group/relay/${'a'.repeat(64)}`;
    window.__TAURI_INTERNALS__ = {} as never;
    try {
      images.clear();
      expect(await images.load('t-1', 'm-1', 0, 'image/png', true)).toBe('data:image/webp;base64,UklG');
      expect(call).toHaveBeenLastCalledWith('messages.attachment', { threadId: 't-1', messageId: 'm-1', partIndex: 0, display: true, thumb: true });
      expect(await images.original('t-1', 'm-video', 2, 'video/mp4')).toBe('data:image/webp;base64,UklG');
      expect(call).toHaveBeenLastCalledWith('messages.attachment', { threadId: 't-1', messageId: 'm-video', partIndex: 2 });
    } finally {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  } finally {
    images.clear();
  }
});
