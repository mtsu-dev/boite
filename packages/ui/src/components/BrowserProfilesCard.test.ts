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

function showDeletableProfile(settings: Partial<Settings> = { browserProfiles: [{ id: 'p-one', name: 'One' }] }) {
  store.settings = settings as Settings;
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
  const save = showDeletableProfile({ browserProfiles: [{ id: 'p-one', name: 'One', engine: 'chrome' }] });
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
  await vi.waitFor(() => expect(store.settings?.browserProfiles).toEqual([{ id: 'p-one', name: 'One', engine: 'chrome', userAgent: { mode: 'replace', value: 'Mozilla/5.0 Chrome/158.0.0.0' } }]));
});

test('overlapping User-Agent saves and a rename preserve every profile change', async () => {
  store.settings = { browserProfiles: [{ id: 'p-one', name: 'One', engine: 'chrome' }, { id: 'p-two', name: 'Two', engine: 'chrome' }] } as Settings;
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
    { id: 'p-one', name: 'Renamed', engine: 'chrome', userAgent: { mode: 'suffix', value: 'Bounty/1' } },
    { id: 'p-two', name: 'Two', engine: 'chrome', userAgent: { mode: 'suffix', value: 'Bounty/2' } },
  ]));
});

function pickEngine(row: string, name: string) {
  query<HTMLButtonElement>(`[data-profile=${row}] [data-testid=browser-profile-engine]`).click();
  flushSync();
  query<HTMLElement>(`[data-testid=browser-profile-engine-menu]`);
  [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(item => item.textContent?.includes(name))!.click();
  flushSync();
}

test('each profile, Default included, shows its engine with the choice checked, and only a Chrome profile has a User-Agent', async () => {
  const save = showDeletableProfile({ browserProfiles: [{ id: 'p-one', name: 'One' }, { id: 'p-old', name: 'Old', userAgent: { mode: 'suffix', value: 'Tool/1' } }] });
  const engine = (row: string) => query(`[data-profile=${row}] [data-testid=browser-profile-engine]`).textContent?.trim();
  expect(engine('default')).toBe('Engine: App window');
  expect(engine('p-one')).toBe('Engine: App window');
  // A profile saved with a User-Agent before engines existed runs in Chrome, as it did.
  expect(engine('p-old')).toBe('Engine: Chrome');
  expect(document.querySelector('[data-profile=default] [data-testid=browser-user-agent-edit]')).toBeNull();
  expect(document.querySelector('[data-profile=p-one] [data-testid=browser-user-agent-edit]')).toBeNull();
  query('[data-profile=p-old] [data-testid=browser-user-agent-edit]');

  query<HTMLButtonElement>('[data-profile=p-one] [data-testid=browser-profile-engine]').click();
  flushSync();
  const checked = [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].map(item => [item.textContent?.trim(), item.getAttribute('aria-checked')]);
  expect(checked).toEqual([['App window', 'true'], ['Chrome', 'false']]);
  [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(item => item.textContent?.includes('Chrome'))!.click();
  await vi.waitFor(() => expect(store.settings?.browserProfiles?.[0]).toEqual({ id: 'p-one', name: 'One', engine: 'chrome' }));
  flushSync();
  expect(engine('p-one')).toBe('Engine: Chrome');

  // While a User-Agent is edited the engine under it cannot change.
  query<HTMLButtonElement>('[data-profile=p-one] [data-testid=browser-user-agent-edit]').click();
  flushSync();
  expect(query<HTMLButtonElement>('[data-profile=p-one] [data-testid=browser-profile-engine]').disabled).toBe(true);
  expect(query<HTMLButtonElement>('[data-profile=p-old] [data-testid=browser-profile-engine]').disabled).toBe(false);
  [...document.querySelectorAll<HTMLButtonElement>('[data-profile=p-one] form.user-agent button')].find(button => button.textContent === 'Cancel')!.click();
  flushSync();
  expect(query<HTMLButtonElement>('[data-profile=p-one] [data-testid=browser-profile-engine]').disabled).toBe(false);

  // The built-in profile keeps its engine beside the list, which stays as it was.
  save.mockClear();
  pickEngine('default', 'Chrome');
  await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ browserBuiltinProfiles: { default: { engine: 'chrome' } } }));
  flushSync();
  expect(engine('default')).toBe('Engine: Chrome');
  expect(store.settings?.browserProfiles).toHaveLength(2);
  expect(document.querySelector('[data-profile=default] [data-testid=browser-user-agent-edit]')).toBeNull();
});