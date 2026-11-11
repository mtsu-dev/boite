import type { PermissionRequest } from '@boite/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import MobileThreadRow from './MobileThreadRow.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  document.body.innerHTML = '';
});

test('a phone row that needs you says it beside its dot, and an Activity row reads its command whole', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && row.projectId && row.id !== store.openThread?.id)!;
  thread.status = 'waiting';
  const command = 'bun run build\n&& bun run deploy --channel nightly';
  store.pendingPermissions = [{ id: 'perm', threadId: thread.id, toolName: 'Bash', input: { command }, description: null, createdAt: Date.now() } as unknown as PermissionRequest];
  const machine = { id: 'local', label: 'Local', store };
  const project = store.projects.find(row => row.id === thread.projectId);
  const props = { machine, thread, project, now: Date.now(), items: [], onopen: () => {}, onaction: () => {} };

  // A list row: the dot in the one slot with its word beside it, named once for a screen reader and the pointer.
  mounted = mount(MobileThreadRow, { target: document.body, props });
  flushSync();
  const mark = document.querySelector('[data-testid=thread-state]')!;
  expect([mark.getAttribute('data-state'), mark.getAttribute('aria-label'), mark.getAttribute('title')]).toEqual(['waiting', 'Needs you', 'Needs you']);
  expect(mark.querySelector('.word')?.textContent).toBe('Needs you');
  await unmount(mounted);

  // Activity: where it comes from, what it asks by what it does (the composer's title), then the command as it will
  // run, both lines of it.
  mounted = mount(MobileThreadRow, { target: document.body, props: { ...props, compact: true, reason: 'Wants to run:', at: Date.now(), verb: 'allow', kind: 'permission', where: { project: 'orbit', text: 'orbit' } } });
  flushSync();
  // Its kind first, over the title, as on the desktop.
  const kind = document.querySelector<HTMLElement>('[data-testid=activity-kind]')!;
  expect([kind.dataset['kind'], kind.textContent]).toEqual(['permission', 'Permission']);
  // Its glyph is the card's one mark: no state dot stacked under it beside the title.
  expect(document.querySelector('[data-testid=thread-state]')).toBeNull();
  const place = document.querySelector('[data-testid=mobile-row-where]')!;
  const ask = document.querySelector('[data-testid=mobile-row-reason]')!;
  expect(place.textContent).toBe('orbit');
  expect(ask.textContent?.trim()).toBe('Build the project');
  expect(place.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('[data-testid=thread-operation]')!.textContent).toBe(command);
  expect(document.querySelector<HTMLElement>('[data-testid=thread-verb]')!.dataset['verb']).toBe('allow');
  // The desktop's pair: Deny outlined, then Allow solid, right-aligned under the content.
  const deny = document.querySelector<HTMLElement>('[data-testid=thread-verb-secondary]')!;
  expect([deny.dataset['verb'], deny.classList.contains('secondary'), deny.parentElement!.classList.contains('decision-actions')]).toEqual(['deny', true, true]);
});

test('a phone list row says its state in a word after its mark, before its time: Needs you, Working, Failed', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && row.projectId && row.id !== store.openThread?.id)!;
  const project = store.projects.find(row => row.id === thread.projectId);
  const machine = { id: 'local', label: 'Local', store };
  for (const [status, state, word, mark] of [['waiting', 'waiting', 'Needs you', '.dot'], ['running', 'working', 'Working', '.work-ring'], ['error', 'error', 'Failed', '.fail']] as const) {
    thread.status = status;
    thread.runningSince = status === 'running' ? Date.now() - 60_000 : null;
    thread.archived = false;
    mounted = mount(MobileThreadRow, { target: document.body, props: { machine, thread, project, now: Date.now(), items: [], onopen: () => {}, onaction: () => {} } });
    flushSync();
    const shown = document.querySelector<HTMLElement>('[data-testid=thread-state]')!;
    expect(shown.dataset['state']).toBe(state);
    // The phone has the room: the word always shows, never the desktop's narrow rule.
    expect(shown.classList.contains('fit')).toBe(false);
    const parts = [...shown.parentElement!.children];
    const at = shown.parentElement!.querySelector('.at')!;
    expect(shown.querySelector(mark)).not.toBeNull();
    expect(shown.querySelector('.word')?.textContent).toBe(word);
    // Mark, word, then the time, on the title's line.
    expect(parts.indexOf(at)).toBe(parts.indexOf(shown) + 1);
    expect(shown.firstElementChild!.compareDocumentPosition(shown.querySelector('.word')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await unmount(mounted);
    mounted = undefined;
  }
});

test('an Activity row keeps the title on the row\'s width: the ask is whole under it, a sub-agent one line, the verb follows the content', () => {
  const css = readFileSync(resolve('src/components/MobileThreadRow.svelte'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const headline = readFileSync(resolve('src/components/ThreadHeadline.svelte'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // No room reserved beside the title for the verb: at 360 that squeezed a title into three lines next to an empty column.
  expect(css).not.toMatch(/\.reason \.thread :global\(\.headline\) \{[^}]*margin-right/);
  expect(css).not.toMatch(/\.verb \{[^}]*position: absolute/);
  // What is asked: whole up to four lines, then Show all (ClampText.svelte), never a cut line; a sub-agent's line
  // under it stays one line, cut with an ellipsis (the headline's lead is a column).
  expect(readFileSync(resolve('src/components/MobileThreadRow.svelte'), 'utf8')).toMatch(/<ClampText text=\{ask\} testid="mobile-row-reason" \/>/);
  expect(css).toMatch(/\.why \.text \{[^}]*white-space: nowrap[^}]*\}/);
  expect(css).toMatch(/\.why \.text \{[^}]*text-overflow: ellipsis/);
  expect(headline).toMatch(/\.lead \{[^}]*flex-direction: column/);
});
