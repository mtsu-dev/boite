import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Settings } from '@boite/contracts';
import BrowserProfilesCard from './BrowserProfilesCard.svelte';
import { browserProfiles } from '../lib/browser-profiles.svelte';
import { store } from '../lib/store.svelte';
import { browserBridge } from '../lib/browser-bridge';
import { confirm } from '../lib/confirm.svelte';

const originalDelete = browserBridge.deleteProfile;

let app: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  confirm.answer(false);
  browserBridge.deleteProfile = originalDelete;
  browserProfiles.source = null;
  store.settings = null;
  document.body.innerHTML = '';
});

function showDeletableProfile() {
  store.settings = { browserProfiles: [{ id: 'p-one', name: 'One' }] } as Settings;
  const save = vi.fn(async (patch: Partial<Settings>) => {
    store.settings = { ...store.settings!, ...patch };
    return true;
  });
  browserProfiles.source = { get settings() { return store.settings; }, saveSettings: save };
  app = mount(BrowserProfilesCard, { target: document.body });
  flushSync();
  return save;
}

function deleteProfile() {
  query<HTMLButtonElement>('[data-testid=browser-profile-delete]').click();
  flushSync();
  if (confirm.current) confirm.answer(true);
}

test('a client without profile erasure retains the profile and explains how to delete it', async () => {
  browserBridge.deleteProfile = undefined;
  const save = showDeletableProfile();
  deleteProfile();
  await vi.waitFor(() => {
    flushSync();
    expect(query('[data-testid=browser-profile-error]').textContent).toContain('desktop app');
  });
  expect(save).not.toHaveBeenCalled();
  expect(store.settings?.browserProfiles).toEqual([{ id: 'p-one', name: 'One' }]);
});

test('a failed profile erase retains the entry and a retry removes it only after erasure', async () => {
  browserBridge.deleteProfile = async () => { throw new Error('data locked'); };
  const save = showDeletableProfile();
  deleteProfile();
  await vi.waitFor(() => {
    flushSync();
    expect(query('[data-testid=browser-profile-error]').textContent).toContain('data locked');
  });
  expect(save).not.toHaveBeenCalled();
  expect(store.settings?.browserProfiles).toEqual([{ id: 'p-one', name: 'One' }]);
  let erased!: () => void;
  browserBridge.deleteProfile = () => new Promise<void>(resolve => { erased = resolve; });
  deleteProfile();
  await vi.waitFor(() => expect(erased).toBeTypeOf('function'));
  expect(save).not.toHaveBeenCalled();
  erased();
  await vi.waitFor(() => expect(store.settings?.browserProfiles).toEqual([]));
  expect(save).toHaveBeenCalledTimes(1);
});

function query<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
}

test('a whole User-Agent typed as a suffix is flagged as typed and never saved, and the example follows the mode', async () => {
  const save = showDeletableProfile();
  query<HTMLButtonElement>('[data-testid=browser-user-agent-edit]').click();
  flushSync();
  const input = query<HTMLInputElement>('[data-testid=browser-user-agent-value]');
  expect(input.placeholder).toBe('Program marker, e.g. MyTool/1.0');
  input.value = 'Mozilla/5.0 Chrome/158.0.0.0';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(query('[data-testid=browser-user-agent-whole]').textContent).toContain('Replace entire value');
  expect(query<HTMLButtonElement>('[data-testid=browser-user-agent-save]').disabled).toBe(true);
  query<HTMLFormElement>('form.user-agent').requestSubmit();
  flushSync();
  expect(save).not.toHaveBeenCalled();
  query<HTMLButtonElement>('[data-testid=browser-user-agent-mode]').click();
  flushSync();
  [...document.querySelectorAll<HTMLElement>('[role=menuitem], [role=menuitemradio]')].find(item => item.textContent?.includes('Replace entire value'))!.click();
  flushSync();
  expect(document.querySelector('[data-testid=browser-user-agent-whole]')).toBeNull();
  expect(input.placeholder).toBe('Full User-Agent');
  query<HTMLFormElement>('form.user-agent').requestSubmit();
  await vi.waitFor(() => expect(store.settings?.browserProfiles).toEqual([{ id: 'p-one', name: 'One', userAgent: { mode: 'replace', value: 'Mozilla/5.0 Chrome/158.0.0.0' } }]));
});

test('overlapping User-Agent saves and a rename preserve every profile change', async () => {
  store.settings = { browserProfiles: [{ id: 'p-one', name: 'One' }, { id: 'p-two', name: 'Two' }] } as Settings;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const patches: Partial<Settings>[] = [];
  browserProfiles.source = {
    get settings() { return store.settings; },
    async saveSettings(patch) {
      patches.push(patch);
      await pending;
      store.settings = { ...store.settings!, ...patch };
      return true;
    },
  };
  app = mount(BrowserProfilesCard, { target: document.body });
  flushSync();
  try {
    for (const [id, marker] of [['p-one', 'Bounty/1'], ['p-two', 'Bounty/2']] as const) {
      const row = `[data-profile=${id}]`;
      query<HTMLButtonElement>(`${row} [data-testid=browser-user-agent-edit]`).click();
      flushSync();
      const input = query<HTMLInputElement>(`${row} [data-testid=browser-user-agent-value]`);
      input.value = marker;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      query<HTMLFormElement>(`${row} form.user-agent`).requestSubmit();
      flushSync();
    }
    query<HTMLButtonElement>('[data-profile=p-one] [data-testid=browser-profile-rename]').click();
    flushSync();
    const name = query<HTMLInputElement>('[data-testid=browser-profile-rename-input]');
    name.value = 'Renamed';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    query<HTMLFormElement>('form.rename').requestSubmit();
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0));
    expect(patches).toHaveLength(1);
  } finally {
    finish();
    await vi.waitFor(() => expect(patches).toHaveLength(3));
  }
  await vi.waitFor(() => expect(store.settings?.browserProfiles).toEqual([
    { id: 'p-one', name: 'Renamed', userAgent: { mode: 'suffix', value: 'Bounty/1' } },
    { id: 'p-two', name: 'Two', userAgent: { mode: 'suffix', value: 'Bounty/2' } },
  ]));
});
