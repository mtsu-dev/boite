import { expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { AgentProfile, Message, NewConversationNotice } from '@boite/contracts';
import { test } from '../test/fake-client';
import { startNewConversation } from '../lib/agent-new-session';
import { AgentsView } from '../lib/agents.svelte';
import { confirm } from '../lib/confirm.svelte';
import { count } from '../lib/format';
import { fill, strings } from '../lib/strings';
import ConfirmDialog from './ConfirmDialog.svelte';
import NewConversationMarker from './NewConversationMarker.svelte';

const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
const find = <T extends HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const markers = (messages: Message[]) => messages.flatMap(m => m.parts.flatMap(p => p.type === 'text' && p.newConversation ? [p.newConversation] : []));

// The confirm's note had its count glued to the help ("message.64 / 4 000") and the thread showed the core's plain line.
test('a new conversation asks with an optional note counted apart from its help, then the thread marks who asked and folds the note', async ({ ready }) => {
  const labels = strings.agents.newConversation;
  const mounted: ReturnType<typeof mount>[] = [];
  try {
    const { store, client } = await ready({ delayMs: 0 });
    const selection = { providerId: 'echo', accountId: 'echo', model: 'echo', effort: null, permissionMode: 'default' } as AgentProfile['selection'];
    const agent = await client.call('agents.profile.save', { value: { name: 'Ada', domain: '', instructions: '', avatar: '', selection, status: 'active' } });
    const { threadId } = await client.call('agents.open', { agentId: agent.id });
    await vi.waitFor(async () => expect((await client.call('threads.get', { threadId })).status).toBe('idle'));
    const view = AgentsView.of(store);
    await view.refresh();
    mounted.push(mount(ConfirmDialog, { target: document.body }));

    const asked = startNewConversation(view, agent, store);
    await settle();
    expect(find('confirm-dialog')?.querySelector('h2')?.textContent).toBe(fill(labels.title, { name: 'Ada' }));
    const note = find<HTMLTextAreaElement>('confirm-note')!;
    expect(document.activeElement).toBe(note);
    expect(note.maxLength).toBe(4000);
    expect(find('confirm-ok')?.textContent?.trim()).toBe(labels.confirm);
    const counter = find('confirm-note-count')!;
    expect(counter.textContent).toBe(fill(labels.count, { count: count(0), max: count(4000) }));
    // The help is its own element beside the count, not one run of text with it.
    expect(document.getElementById('confirm-note-hint')?.textContent).toBe(labels.noteHint);
    expect(counter.previousElementSibling?.id).toBe('confirm-note-hint');

    note.value = '  Next: the changelog.  ';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(counter.textContent).toBe(fill(labels.count, { count: count(24), max: count(4000) }));
    find<HTMLButtonElement>('confirm-ok')!.click();
    expect(await asked).toBe(true);
    const thread = await client.call('threads.get', { threadId });
    expect(markers(thread.messages)).toEqual([{ by: 'user', note: 'Next: the changelog.' }]);

    // The owner's marker says "by you"; the note stays folded until asked for.
    const mark = (notice: NewConversationNotice) => {
      const target = document.body.appendChild(document.createElement('div'));
      mounted.push(mount(NewConversationMarker, { target, props: { store, threadId, notice } }));
      flushSync();
      return target;
    };
    const mine = mark(markers(thread.messages)[0]!);
    expect(mine.querySelector('[data-testid=new-conversation-by]')?.textContent).toBe(labels.byYou);
    expect(mine.querySelector('[data-testid=new-conversation-note]')).toBeNull();
    mine.querySelector<HTMLButtonElement>('[data-testid=new-conversation-toggle]')!.click();
    flushSync();
    expect(mine.querySelector('[data-testid=new-conversation-note]')?.textContent).toBe('Next: the changelog.');
    // One the mochi asked for names it; without a note there is nothing to unfold.
    const its = mark({ by: 'mochi' });
    expect(its.querySelector('[data-testid=new-conversation-by]')?.textContent).toBe(fill(labels.byMochi, { name: 'Ada' }));
    expect(its.querySelector('[data-testid=new-conversation-toggle]')).toBeNull();
  } finally {
    confirm.answer(false);
    for (const component of mounted) await unmount(component);
    document.body.innerHTML = '';
  }
});
