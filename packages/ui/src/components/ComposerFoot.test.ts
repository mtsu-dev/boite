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

test('a permission out of view is the foot\'s first row, named by its title, and Show leads back to it', async () => {
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
  expect(row.querySelector('[data-testid=decision-pill-show]')?.textContent).toBe('Show');

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

test('queued prompts are "Queued" rows: their text, Edit and Delete, and the text itself takes the prompt back', async () => {
  await open();
  const threadId = store.openThread!.id;
  store.composerStates[threadId] = { text: '', attachments: [], queued: [{ text: 'Add a test for a file with a BOM', attachments: [] }, { text: 'Then rerun the suite', attachments: [] }], sending: false, paused: false };
  const restore = vi.fn();
  foot({ onrestore: restore });
  await tick();
  const items = [...document.querySelectorAll<HTMLElement>('[data-testid=composer-queued-item]')];
  expect(items).toHaveLength(2);
  expect(items.map(item => item.querySelector('[data-testid=composer-queued-state]')?.textContent)).toEqual(['Queued', 'Queued']);
  expect(document.body.textContent).not.toContain('Then:');
  expect(items[0]!.querySelector('[data-testid=composer-queued-text]')?.textContent).toBe('Add a test for a file with a BOM');
  expect(items[0]!.querySelector('[data-testid=composer-queued-edit]')?.getAttribute('aria-label')).toBe('Edit');
  expect(items[0]!.querySelector('[data-testid=composer-queued-remove]')?.getAttribute('aria-label')).toBe('Delete');
  items[1]!.querySelector<HTMLButtonElement>('[data-testid=composer-queued-text]')!.click();
  expect(restore).toHaveBeenCalledWith(1);
  const remove = vi.spyOn(store, 'removeQueued');
  items[0]!.querySelector<HTMLButtonElement>('[data-testid=composer-queued-remove]')!.click();
  expect(remove).toHaveBeenCalledWith(threadId, 0);
});

test('on a phone a queued prompt shows two lines, its text edits it, and Edit sits beside Delete on 40 px targets', async () => {
  await open();
  const threadId = store.openThread!.id;
  store.composerStates[threadId] = { text: '', attachments: [], queued: [{ text: 'Rename the export button and move it beside the filters, then rerun the suite', attachments: [] }], sending: false, paused: false };
  const restore = vi.fn();
  foot({ onrestore: restore });
  await tick();
  const item = document.querySelector<HTMLElement>('[data-testid=composer-queued-item]')!;
  item.querySelector<HTMLButtonElement>('[data-testid=composer-queued-text]')!.click();
  expect(restore).toHaveBeenLastCalledWith(0);
  // The same two icons as a desktop, in that order at the row's end.
  expect([...item.querySelectorAll<HTMLElement>('.tools button')].map((button) => button.dataset.testid)).toEqual(['composer-queued-edit', 'composer-queued-remove']);
  item.querySelector<HTMLButtonElement>('[data-testid=composer-queued-edit]')!.click();
  expect(restore).toHaveBeenCalledTimes(2);
  // jsdom applies no component CSS: read the queue's phone rules as Svelte compiles them.
  const { compile } = await import('svelte/compiler');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(`${import.meta.dirname}/ComposerQueue.svelte`, 'utf8').replace(/<script lang="ts">[\s\S]*?<\/script>/, '<script></script>');
  const css = compile(source, { filename: 'ComposerQueue.svelte', cssHash: () => 'q' }).css?.code ?? '';
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'), css.indexOf('@media (max-width: 400px)'));
  expect(phone).toContain('-webkit-line-clamp: 2');
  expect(phone).toContain('--icon-button: 40px');
  // Nothing is hidden on a phone: Edit keeps its icon.
  expect(phone).not.toContain('display: none');
});
