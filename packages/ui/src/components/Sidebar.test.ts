import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { threadsNeedingYou } from '../lib/app-rail';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import { closeArchived, openArchived } from '../lib/archived-view.svelte';
import Sidebar from './Sidebar.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const previousActive = workspace.active;
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined; store?.detach(); client?.close();
  workspace.machines = []; workspace.active = previousActive;
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

test('a machine out of reach keeps its project card\'s count of what needs the user, the rail badge\'s count', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threadsOf('p-boite').find(t => !t.parentThreadId)!;
  store.threads = store.threads.map(t => t.id === thread.id ? { ...t, status: 'error', unread: true } : t);
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  workspace.setView('projects');
  mounted = mount(Sidebar, { target: document.body, props: { store } });
  await settle();
  const card = () => Number(document.querySelector<HTMLElement>('[data-testid=project][data-project-id=p-boite] [data-testid=project-waiting-count]')?.dataset.count ?? 0);
  const reached = card();
  expect(reached).toBeGreaterThan(0);
  store.connection = 'closed';
  await settle();
  expect(document.querySelector('[data-testid=project][data-project-id=p-boite]')).not.toBeNull();
  // The rail sums every machine's (AppRail.svelte): the card says the same while its machine is away.
  expect(card()).toBe(reached);
  expect(threadsNeedingYou([store])).toBeGreaterThanOrEqual(card());
});

// One project's archive mounted every machine's list: the others had no such project to narrow to and showed all theirs.
test('the archive of one project lists that project\'s machine only, every machine once widened to all projects', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const otherClient = new FakeClient({ delayMs: 0, coreId: 'far', coreName: 'far', publicUrl: 'https://far.test', hostname: 'far' });
  const other = new Store(); other.attach(otherClient); await other.connect();
  try {
    await store.archive('t-trace');
    await other.archive('t-bench');
    workspace.machines = [{ id: 'local', label: 'Local', store }, { id: 'far', label: 'Far', store: other }]; workspace.active = store;
    workspace.setView('projects');
    mounted = mount(Sidebar, { target: document.body, props: { store } });
    await settle();
    openArchived(store, 'p-boite');
    const lists = () => Array.from(document.querySelectorAll('[data-testid=sidebar-archived] [data-testid=archived-list]')).map(list => list.textContent ?? '');
    await vi.waitFor(async () => { await settle(); expect(lists().length).toBe(1); });
    expect(lists()[0]).toContain('Finish the trace tab');
    expect(lists()[0]).not.toContain('Bench against legacy');
    document.querySelector<HTMLButtonElement>('[data-testid=archived-all]')!.click();
    await vi.waitFor(async () => { await settle(); expect(lists().length).toBe(2); });
    expect(lists().join(' ')).toContain('Bench against legacy');
  } finally {
    closeArchived();
    if (mounted) await unmount(mounted);
    mounted = undefined; other.detach(); otherClient.close();
  }
});
