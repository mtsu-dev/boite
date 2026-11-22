import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ContactRequest } from '@boite/contracts';
import { ContactsView } from '../../lib/contacts.svelte';
import { Store } from '../../lib/store.svelte';
import RequestCard from './RequestCard.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

test('a plan to start a thread shows its whole brief before Accept, not its first line', () => {
  const brief = `Check the release script\nRead only.\n${'Then more. '.repeat(400)}The last line.`;
  const request = {
    id: 'creq-1', direction: 'in', coreId: 'core-chris', contact: 'Chris', status: 'pending', stage: 'owner', approved: false, want: 'thread', createdAt: Date.now(),
    text: 'Someone to check the release script', from: { coreId: 'core-chris', threadId: 't-1', title: 'Release' },
    plan: { kind: 'start', project: { id: 'p-1', name: 'Docs' }, brief },
  } as unknown as ContactRequest;
  mounted = mount(RequestCard, { target: document.body, props: { view: new ContactsView(new Store()), request, now: Date.now() } });
  flushSync();
  expect(document.querySelector('[data-testid="contact-request-brief"]')?.textContent).toBe(brief);
});
