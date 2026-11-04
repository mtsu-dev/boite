import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { setExperiment } from '../lib/experiments';
import MobileTabs from './MobileTabs.svelte';

let app: ReturnType<typeof mount> | undefined, client: FakeClient, store: Store;
const settle = async () => { for (let i = 0; i < 15; i++) { await Promise.resolve(); flushSync(); } };
beforeEach(async () => {
  client = new FakeClient({ delayMs: 0, principal: 'session' }); store = new Store(); store.attach(client); await store.connect();
});
afterEach(async () => { setExperiment('contacts', false); if (app) await unmount(app); app = undefined; store.detach(); client.close(); vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear(); });
const tab = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

test('the bar names its places in full and keeps New thread a round button over the lists, never a tab', async () => {
  const navigate = vi.fn(), onnew = vi.fn();
  app = mount(MobileTabs, { target: document.body, props: { store, screen: 'threads', waiting: 0, navigate, onnew } }); await settle();
  const names = () => Array.from(document.querySelectorAll('[data-testid=mobile-tabs] .tab')).map(button => button.textContent?.trim());
  // Bots off: three places, Contacts and New thread no longer among them.
  expect(names()).toEqual(['Threads', 'Inbox', 'Settings']);
  expect(tab('mobile-conversations')!.getAttribute('aria-current')).toBe('page');
  for (const [id, destination] of [['mobile-conversations', 'threads'], ['mobile-activity', 'activity']]) {
    tab(id!)!.click(); await settle();
    expect(navigate).toHaveBeenLastCalledWith(destination);
  }
  const fab = tab('mobile-new')!;
  expect(fab.classList.contains('tab')).toBe(false);
  expect(fab.getAttribute('aria-label')).toBe('New thread');
  fab.click();
  expect(onnew).toHaveBeenCalledOnce();
  tab('mobile-settings')!.click(); await settle();
  expect(store.page).toBe('settings');
  expect(tab('mobile-settings')!.getAttribute('aria-current')).toBe('page');
  expect(tab('mobile-conversations')!.hasAttribute('aria-current')).toBe(false);
  // A page is no list to start a conversation from.
  expect(tab('mobile-new')).toBeNull();

  setExperiment('resident-agents', true);
  onTestFinished(() => setExperiment('resident-agents', false));
  await settle();
  expect(names()).toEqual(['Threads', 'Inbox', 'Bots', 'Settings']);
});

test('the French bar keeps full names', async () => {
  const { setLocaleSetting } = await import('../lib/i18n.svelte');
  await setLocaleSetting('fr');
  onTestFinished(() => setLocaleSetting('en'));
  app = mount(MobileTabs, { target: document.body, props: { store, screen: 'activity', waiting: 0, navigate: () => {}, onnew: () => {} } }); await settle();
  expect(Array.from(document.querySelectorAll('[data-testid=mobile-tabs] .tab')).map(button => button.textContent?.trim())).toEqual(['Conversations', 'Réception', 'Réglages']);
  expect(tab('mobile-activity')!.getAttribute('aria-current')).toBe('page');
  expect(tab('mobile-new')).not.toBeNull();
});

test('Activity carries the count of conversations waiting on the user, capped so the badge stays round', async () => {
  app = mount(MobileTabs, { target: document.body, props: { store, screen: 'threads', waiting: 0, navigate: () => {}, onnew: () => {} } }); await settle();
  expect(tab('mobile-activity-waiting')).toBeNull();
  await unmount(app);
  app = mount(MobileTabs, { target: document.body, props: { store, screen: 'threads', waiting: 140, navigate: () => {}, onnew: () => {} } }); await settle();
  expect(tab('mobile-activity-waiting')!.textContent).toBe('99+');
  expect(tab('mobile-activity')!.getAttribute('aria-label')).toContain('140');
});

test('Bots carries the count of bots at work, in the waiting colour once one asks the user', async () => {
  setExperiment('resident-agents', true);
  onTestFinished(() => setExperiment('resident-agents', false));
  const { agentDirectory } = await import('../lib/agent-directory.svelte');
  app = mount(MobileTabs, { target: document.body, props: { store, screen: 'threads', waiting: 0, navigate: () => {}, onnew: () => {} } }); await settle();
  const rest = { status: 'idle', openQuestions: 0, backgroundWork: null, unread: false } as const;
  store.threads = store.threads.map(thread => ({ ...thread, ...rest, ...(thread.id === 't-trace' ? { agentSessionId: 'session-1' } : {}) }));
  agentDirectory(store).snapshot = { profiles: [{ id: 'agent-1', name: 'Mira', status: 'active' }], sessions: [{ id: 'session-1', agentId: 'agent-1' }], work: [], runs: [], entrusted: [] } as never;
  await settle();
  expect(tab('mobile-agents-at-work')).toBeNull();
  store.threads = store.threads.map(thread => thread.id === 't-trace' ? { ...thread, status: 'running' } : thread); await settle();
  expect(tab('mobile-agents-at-work')!.textContent).toBe('1');
  expect(tab('mobile-agents-at-work')!.dataset.waiting).toBe('false');
  store.threads = store.threads.map(thread => thread.id === 't-trace' ? { ...thread, status: 'idle', openQuestions: 1 } : thread); await settle();
  expect(tab('mobile-agents-at-work')!.dataset.waiting).toBe('true');
  expect(tab('mobile-agents')!.getAttribute('aria-label')).toBe('Bots, 1 at work, something needs you');
});
