import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import ThreadHeader from './ThreadHeader.svelte';
import headerSource from './ThreadHeader.svelte?raw';
import { store as primary } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import { phoneWidth } from '../test/phone-width';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

async function renameOpen(text: string): Promise<HTMLInputElement> {
  document.querySelector<HTMLButtonElement>('[data-testid=thread-title]')!.click();
  flushSync();
  const input = document.querySelector<HTMLInputElement>('[data-testid=thread-rename-input]')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return input;
}

async function start(): Promise<ReturnType<typeof vi.spyOn>> {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  mounted = mount(ThreadHeader, { target: document.body, props: { store } });
  await settle();
  return vi.spyOn(store, 'rename').mockResolvedValue();
}

test('a rename begun on one thread writes to that thread after another surface opens a different one', async () => {
  const rename = await start();
  const input = await renameOpen('Title for the trace thread');
  const other = store.threads.find(thread => thread.id !== 't-trace' && !thread.archived)!;
  await store.open(other.id);
  await settle();
  expect(store.openThread?.id).toBe(other.id);
  input.dispatchEvent(new FocusEvent('blur'));
  await settle();
  expect(rename.mock.calls).toEqual([['t-trace', 'Title for the trace thread']]);
  expect(document.querySelector('[data-testid=thread-rename-input]')).toBeNull();
});

test('Enter commits once and Escape commits nothing, whatever blur follows', async () => {
  const rename = await start();
  let input = await renameOpen('Kept');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur'));
  await settle();
  expect(rename.mock.calls).toEqual([['t-trace', 'Kept']]);

  input = await renameOpen('Dropped');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur'));
  await settle();
  expect(rename).toHaveBeenCalledTimes(1);
});

test('a header unmounted with its rename open, as a machine switch does, still writes the title typed so far', async () => {
  const rename = await start();
  await renameOpen('Typed before the switch');
  await unmount(mounted!);
  mounted = undefined;
  await settle();
  expect(rename.mock.calls).toEqual([['t-trace', 'Typed before the switch']]);
});

test('on a phone the title has its own 17 px line and the place sits under it, never beside it', () => {
  const phone = headerSource.slice(headerSource.indexOf('@media (max-width: 720px)'));
  expect(phone).toMatch(/\.title-menu \{[^}]*flex: 1 1 auto/);
  expect(phone).toMatch(/\.title-text \{[^}]*font-size: 17px;[^}]*font-weight: 600/);
  expect(phone).toMatch(/\.title-lines \{[^}]*flex-direction: column/);
});

// Round 3's phone subtitle read "orbit · This PC · or... · #128": the connected machine took the branch's room.
test('a phone subtitle reads project · branch, naming the machine only when it is not the connected one', async () => {
  const restore = phoneWidth();
  const other = new FakeClient({ delayMs: 0 });
  client = new FakeClient({ delayMs: 0 });
  const remote = new Store();
  try {
    primary.attach(client); await primary.connect();
    remote.attach(other); await remote.connect();
    workspace.machines = [{ id: 'local', label: 'This PC', store: primary }, { id: 'home', label: 'Workstation', store: remote }];
    const place = () => document.querySelector('[data-testid=thread-place]')!.textContent;
    for (const [owner, machine] of [[primary, null], [remote, 'Workstation']] as const) {
      await owner.open('t-trace');
      owner.openThread!.branch = 'feature/import';
      mounted = mount(ThreadHeader, { target: document.body, props: { store: owner } });
      await settle();
      const project = document.querySelector('[data-testid=thread-place] .place-project')!.textContent!;
      expect(project).toBe(machine ? `${project.split(' · ')[0]} · ${machine}` : project.split(' · ')[0]);
      expect(place()).not.toContain('This PC');
      expect(document.querySelector('[data-testid=thread-place] .place-branch')!.textContent).toBe(' · feature/import');
      await unmount(mounted); mounted = undefined;
    }
  } finally {
    restore(); workspace.machines = []; primary.detach(); remote.detach(); other.close();
  }
});

test('a phone title menu reads the project, machine and full branch, and copies each in one tap', async () => {
  const restore = phoneWidth();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  client = new FakeClient({ delayMs: 0 });
  try {
    primary.attach(client); await primary.connect();
    workspace.machines = [{ id: 'local', label: 'This PC', store: primary }];
    await primary.open('t-trace');
    const branch = 'atlas/a-branch-name-far-too-long-for-the-subtitle-of-a-phone';
    primary.openThread!.branch = branch;
    mounted = mount(ThreadHeader, { target: document.body, props: { store: primary } });
    await settle();
    document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click();
    await settle();
    const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid=thread-menu-trigger-menu] [data-value=${id}]`);
    expect(row('copy-project')).not.toBeNull();
    // The connected machine, which the subtitle leaves out, reads here.
    expect(row('copy-machine')!.querySelector('.label')!.textContent!.trim()).toBe('This PC');
    expect(row('copy-branch')!.querySelector('.label')!.textContent!.trim()).toBe(branch);
    expect(row('copy-branch')!.querySelector('.hint')!.textContent).toBe('Branch');
    row('copy-branch')!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(branch);
    // The menu stays open to say so.
    expect(row('copy-branch')!.querySelector('.hint')!.textContent).toBe('Copied');
  } finally {
    restore(); workspace.machines = []; primary.detach();
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
});

test('on a phone the branch gives way before the project, and the header row holds no bot avatar', () => {
  const phone = headerSource.slice(headerSource.indexOf('@media (max-width: 720px)'));
  expect(phone).toMatch(/\.place-project \{ flex: 0 1 auto; \}/);
  expect(phone).toMatch(/\.place-branch \{ flex: 0 1000 auto; \}/);
  expect(phone).toMatch(/\.context-pill \{ display: none; \}/);
});
