import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Message } from '@boite/contracts';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import UserMessage from './UserMessage.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (mounted) await unmount(mounted); mounted = undefined; document.body.innerHTML = ''; });

test('a prompt a plugin sent in the owner\'s name says which plugin, and the owner\'s own says nothing', async () => {
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store(); store.attach(client);
  try {
    await store.connect(); await store.open('t-trace');
    const message: Message = {
      id: 'm-plugin', threadId: 't-trace', turnId: null, role: 'user', state: 'complete', createdAt: Date.now(),
      parts: [{ type: 'text', text: 'Write the standup', byPlugin: { pluginId: 'standup', pluginName: 'Standup' } }],
    };
    mounted = mount(UserMessage, { target: document.body, props: { store, message, turn: undefined, accepted: true, responded: true } });
    flushSync();
    const marker = document.querySelector<HTMLElement>('[data-testid=by-plugin]');
    expect(marker?.textContent).toBe('By plugin Standup');
    expect(marker?.title).toBe('standup');
    expect(document.querySelector('[data-testid=text-part]')?.textContent).toBe('Write the standup');

    await unmount(mounted);
    mounted = mount(UserMessage, { target: document.body, props: { store, message: { ...message, parts: [{ type: 'text', text: 'Mine' }] }, turn: undefined, accepted: true, responded: true } });
    flushSync();
    expect(document.querySelector('[data-testid=by-plugin]')).toBeNull();
  } finally {
    client.close();
  }
});
