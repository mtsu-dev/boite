import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { decisionTail } from '../lib/decision-tail.svelte';
import ComposerFoot from './ComposerFoot.svelte';

let component: ReturnType<typeof mount> | undefined;
let store: Store;
let client: FakeClient;
afterEach(async () => {
  if (component) await unmount(component, { outro: false });
  component = undefined;
  decisionTail.count = 0;
  decisionTail.away = true;
  store?.detach();
  client?.close();
  document.body.innerHTML = '';
});

async function open(threadId = 't-descriptors'): Promise<void> {
  client = new FakeClient({ delayMs: 0 });
  store = new Store();
  store.attach(client);
  await store.connect();
  await store.open(threadId);
}

function foot(props: { onrestore?: (at: number) => void } = {}): void {
  component = mount(ComposerFoot, { target: document.body, props: {
    store, key: store.openThread!.id, thread: store.openThread, composer: store.composerStates[store.openThread!.id],
    blocked: false, machine: 'studio', sendNow: null, onrestore: props.onrestore ?? (() => {}), onsendnow: () => {}
  } });
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid=composer-foot] .foot-row')];

test('a permission out of view is the foot\'s first row, named by its title, decided there, and its title leads back to it', async () => {
  await open();
  const threadId = store.openThread!.id;
  store.pendingPermissions = [{ id: 'perm', threadId, turnId: 'turn', toolName: 'Bash', input: { command: 'git push origin orbit/csv-import' }, description: 'Publish the branch', createdAt: 1 }];
  decisionTail.count = 1;
  decisionTail.away = true;
  foot();
  // The row loads with the first permission.
  await vi.waitFor(() => expect(document.querySelector('[data-testid=decision-pill]')).not.toBeNull());
  const row = document.querySelector<HTMLElement>('[data-testid=decision-pill]')!;
  expect(rows()[0]).toBe(row);
  expect(row.textContent).toContain('Waiting for approval:');
  expect(row.querySelector('[data-testid=decision-pill-title]')?.textContent).toBe('Push orbit/csv-import');
  // The title is the way back; no separate "Show" word. The pair is the transcript's, the affirmative last.
  expect(row.querySelector('[data-testid=decision-pill-show] [data-testid=decision-pill-title]')).not.toBeNull();
  expect(row.textContent).not.toContain('Show');
  expect([...row.querySelectorAll('.decision-actions > button')].map((button) => [button.textContent?.trim(), button.className.includes('primary')]))
    .toEqual([['Deny', false], ['Allow once', true]]);

  // Two waiting: the count, then the oldest's title.
  decisionTail.count = 2;
  flushSync();
  expect(row.textContent).toContain('2 decisions waiting:');
  expect(row.querySelector('[data-testid=decision-pill-title]')?.textContent).toBe('Push orbit/csv-import');

  // Back in view on its command row, the foot has nothing to say and takes no room.
  decisionTail.away = false;
  flushSync();
  expect(document.querySelector('[data-testid=decision-pill]')).toBeNull();
  expect(rows()).toHaveLength(0);
});

test('Allow once in the foot decides the permission without scrolling to its row', async () => {
  await open();
  const threadId = store.openThread!.id;
  store.pendingPermissions = [{ id: 'perm', threadId, turnId: 'turn', toolName: 'Bash', input: { command: 'git push origin orbit/csv-import' }, description: 'Publish the branch', createdAt: 1 }];
  decisionTail.count = 1;
  decisionTail.away = true;
  const answer = vi.spyOn(store, 'answer').mockResolvedValue(true);
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  foot();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=decision-pill-allow]')).not.toBeNull());
  const allow = document.querySelector<HTMLButtonElement>('[data-testid=decision-pill-allow]')!;
  allow.click();
  await tick();
  expect(answer).toHaveBeenCalledWith('perm', 'allow');
  expect(scroll).not.toHaveBeenCalled();
  // On its way, both buttons stay down: a second press sends nothing.
  expect(allow.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[data-testid=decision-pill-deny]')!.disabled).toBe(true);
  allow.click();
  expect(answer).toHaveBeenCalledTimes(1);
});

for (const phone of [false, true]) {
  test(`on a ${phone ? 'phone' : 'desktop'} the work under way and the queued prompts are one quiet line in the same words, Stop naming what it stops, and a press unfolds them`, async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
      media, matches: phone && media.includes('max-width: 720px'), onchange: null, addListener() {}, removeListener() {}
    }) as unknown as MediaQueryList);
    client = new FakeClient({ delayMs: 0, delegationDemo: true });
    store = new Store();
    store.attach(client);
    await store.connect();
    await store.open('t-native');
    const [run] = await client.call('workflows.list', { threadId: 't-trace' });
    await vi.waitFor(() => expect(store.openThread?.id).toBe('t-native'));
    store.composerStates['t-native'] = { text: '', attachments: [], queued: [{ text: 'Add a test for a file with a BOM', attachments: [] }], sending: false, paused: true };
    foot();
    await vi.waitFor(() => expect(store.workflowsThreadId).toBe('t-native'));
    store.workflows = [{ ...run!, rootThreadId: 't-native', status: 'running', createdAt: Date.now() - 62_000, nodes: [] }];
    await tick();
    flushSync();
    // Outside the card: the card holds only a decision.
    expect(document.querySelector('[data-testid=composer-foot] [data-testid=agent-dock]')).toBeNull();
    expect(document.querySelector('[data-testid=composer-strip-lines] [data-testid=agent-dock]')).not.toBeNull();
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid=composer-foot-fold]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector<HTMLElement>('[data-testid=agent-dock-label]')!.dataset.text).toBe('Waiting on 1 workflow');
    // The held prompt is no count on the line: it stands above it as its own dashed bubble, folded or not.
    expect(document.querySelector('[data-testid=agent-dock-queued]')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-testid=composer-held]')!.hidden).toBe(false);
    // The marks carry the names on both screens (their tooltip, their hidden words): no rule drops them on a phone.
    expect(document.querySelector('[data-testid=agent-dock-names]')?.textContent).toContain(run!.name);
    const { compile } = await import('svelte/compiler');
    const { readFileSync } = await import('node:fs');
    const dock = readFileSync(`${import.meta.dirname}/AgentDock.svelte`, 'utf8').replace(/<script lang="ts">[\s\S]*?<\/script>/, '<script></script>');
    expect(compile(dock, { filename: 'AgentDock.svelte', cssHash: () => 'd' }).css?.code).not.toMatch(/\.marks\.d \{[^}]*display: none/);
    const stop = document.querySelector<HTMLElement>('[data-testid=agent-dock-stop]')!;
    expect(stop.textContent?.trim()).toBe('Stop workflows');
    expect(stop.title).toContain('The agent itself is not stopped');
    toggle.click();
    flushSync();
    // Unfolded: the same words, then one row per run; the queued bubble keeps its place with its Delete.
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector<HTMLElement>('[data-testid=agent-dock-label]')!.dataset.text).toBe('Waiting on 1 workflow');
    expect([...document.querySelectorAll('[data-testid=agent-dock-row] .words')].map(row => row.textContent)).toEqual([run!.name]);
    expect(document.querySelector<HTMLElement>('[data-testid=composer-held]')!.hidden).toBe(false);
    expect(document.querySelector('[data-testid=composer-queued-item] [data-testid=composer-queued-remove]')).not.toBeNull();
    vi.restoreAllMocks();
  });
}

test('queued prompts are dashed bubbles under the strip line: a press takes one back, Delete removes it, Send now sits under them', async () => {
  await open();
  const threadId = store.openThread!.id;
  store.composerStates[threadId] = { text: '', attachments: [], queued: [{ text: 'Add a test for a file with a BOM', attachments: [] }, { text: 'Then rerun the suite', attachments: [] }], sending: false, paused: false };
  const restore = vi.fn();
  foot({ onrestore: restore });
  await tick();
  // Under the strip's line, in view without unfolding anything.
  const held = document.querySelector<HTMLElement>('[data-testid=composer-held]')!;
  expect(held.hidden).toBe(false);
  expect(held.compareDocumentPosition(document.querySelector('[data-testid=composer-strip-lines]')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  const items = [...document.querySelectorAll<HTMLElement>('[data-testid=composer-queued-item]')];
  expect(items).toHaveLength(2);
  expect(items.map(item => item.querySelector('.queued-bubble')?.textContent?.trim())).toEqual(['Add a test for a file with a BOM', 'Then rerun the suite']);
  expect(items[0]!.getAttribute('title')).toContain('Add a test for a file with a BOM');
  expect(document.querySelector('[data-testid=composer-queued] .queued-foot')?.textContent).toContain('Sent after the next tool, or when the turn ends');
  items[1]!.querySelector<HTMLButtonElement>('.queued-bubble')!.click();
  expect(restore).toHaveBeenCalledWith(1);
  const remove = vi.spyOn(store, 'removeQueued');
  items[0]!.querySelector<HTMLButtonElement>('[data-testid=composer-queued-remove]')!.click();
  expect(remove).toHaveBeenCalledWith(threadId, 0);
});

test('a subagent\'s command waiting for approval shows over its parent\'s composer, named by the subagent, and is answered there', async () => {
  await open();
  const parent = store.openThread!.id;
  const child = store.threads.find((row) => row.id !== parent && !row.archived)!;
  child.parentThreadId = parent;
  // The child's ask, as the machine holds it: the parent's row reads "Needs you" (`rowAsks`), its own timeline has no row for it.
  store.pendingPermissions = [{ id: 'child-perm', threadId: child.id, turnId: 'turn', toolName: 'Bash', input: { command: 'cargo test --workspace' }, description: 'Run the suite before the push', createdAt: 1 }];
  const call = vi.spyOn(client, 'call');
  foot();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=subagent-permissions] [data-testid=permission-card]')).not.toBeNull());
  const card = document.querySelector<HTMLElement>('[data-testid=subagent-permissions] [data-testid=permission-card]')!;
  expect(card.querySelector('[data-testid=permission-asker]')?.textContent).toContain(`Asked by ${child.title}`);
  expect(card.querySelector('[data-testid=permission-why]')?.textContent).toBe('Run the suite before the push');
  expect(card.querySelector('[data-testid=permission-subject]')?.textContent).toContain('cargo test --workspace');
  // It is no row of this timeline: the way back to a row out of view does not count it.
  expect(decisionTail.card).toBeNull();
  card.querySelector<HTMLButtonElement>('[data-testid=permission-allow]')!.click();
  await vi.waitFor(() => expect(call).toHaveBeenCalledWith('permissions.answer', { requestId: 'child-perm', decision: 'allow' }));
  // The subagent's own ask only: the parent's stays on its row in the timeline.
  store.pendingPermissions = [{ id: 'own', threadId: parent, turnId: 'turn', toolName: 'Bash', input: { command: 'ls' }, description: null, createdAt: 2 }];
  flushSync();
  expect(document.querySelector('[data-testid=subagent-permissions]')).toBeNull();
});
