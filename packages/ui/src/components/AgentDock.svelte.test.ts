import { afterEach, expect, test, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import AgentDock from './AgentDock.svelte';
import { AgentsView } from '../lib/agents.svelte';
import { FakeAgents } from '../lib/fake-agents';

let component: ReturnType<typeof mount> | undefined;
let store: Store;
let client: FakeClient;
afterEach(async () => {
  if (component) await unmount(component, { outro: false });
  store?.detach();
  client?.close();
  document.body.innerHTML = '';
});

test('a running workflow keeps its own entry by name, with a timer, and opens its panel', async () => {
  client = new FakeClient({ delayMs: 0, delegationDemo: true });
  store = new Store();
  store.attach(client);
  await store.connect();
  await store.open('t-native');
  const [run] = await client.call('workflows.list', { threadId: 't-trace' });
  component = mount(AgentDock, { target: document.body, props: { store, threadId: 't-native' } });
  await vi.waitFor(() => expect(store.workflowsThreadId).toBe('t-native'));
  await tick();
  expect(document.querySelector('[data-testid=agent-dock]')).toBeNull();

  store.workflows = [{ ...run!, rootThreadId: 't-native', status: 'running', createdAt: Date.now() - 62_000, nodes: [] }];
  await tick();
  const button = document.querySelector<HTMLButtonElement>('[data-testid=active-subagent][data-kind=workflow]');
  expect(button?.textContent).toContain(run!.name);
  expect(button?.querySelector('[data-testid=agent-elapsed]')?.textContent).toContain('1m');
  button!.click();
  await tick();
  expect(store.panel.isOpen).toBe(true);
  expect(store.panel.active?.runId).toBe(run!.id);

  // A running entry wears the tool rows' working mark.
  expect(button?.querySelector('.spinner')).not.toBeNull();

  // Finished, it shows its check a moment, its time frozen, then leaves.
  store.workflows[0]!.status = 'done';
  await tick();
  const done = document.querySelector<HTMLButtonElement>('[data-testid=active-subagent][data-done]');
  expect(done?.textContent).toContain(run!.name);
  expect(done?.querySelector('.spinner')).toBeNull();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=agent-dock]')).toBeNull(), { timeout: 3000 });

  // A failed run leaves at once: no check for what did not finish well.
  store.workflows = [{ ...run!, id: 'wf-failing', rootThreadId: 't-native', status: 'running', createdAt: Date.now(), nodes: [] }];
  await tick();
  expect(document.querySelector('[data-testid=active-subagent]')).not.toBeNull();
  store.workflows[0]!.status = 'failed';
  await tick();
  expect(document.querySelector('[data-testid=agent-dock]')).toBeNull();
});

test('a memory pass another machine names leaves this machine\'s subagent of the same id in the dock', async () => {
  client = new FakeClient({ delayMs: 0, delegationDemo: true });
  store = new Store();
  store.attach(client);
  await store.connect();
  const child = store.threads.find(thread => thread.id === 't-team-running')!;
  await store.open(child.parentThreadId!);
  component = mount(AgentDock, { target: document.body, props: { store, threadId: child.parentThreadId! } });
  const count = () => document.querySelector<HTMLElement>('[data-testid=active-subagents]')?.dataset.count;
  // The running child and the one waiting on its background run, each its own entry.
  await vi.waitFor(() => expect(count()).toBe('2'));
  // Another machine's snapshot: its agent's memory pass happens to carry the same thread id.
  const snapshot = new FakeAgents(() => {}).snapshot();
  const other = { client: { call: vi.fn().mockResolvedValue({ ...snapshot, status: [{ agentId: 'agt-elsewhere', threadId: 'elsewhere', state: 'idle', memory: { threadId: child.id, status: 'running', summary: null, at: 1 } }] }), on: () => () => {} } } as unknown as Store;
  const view = new AgentsView(other);
  try {
    await view.refresh();
    await tick();
    expect(count()).toBe('2');
    expect(document.querySelectorAll('[data-testid=active-subagent][data-kind=agent]')).toHaveLength(2);
  } finally { view.close(); }
});

test('more entries than a phone dock shows fold behind a "+N" entry that opens them, never a silent clip', async () => {
  const before = globalThis.matchMedia;
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: media === '(max-width: 720px)', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } }));
  try {
    client = new FakeClient({ delayMs: 0, delegationDemo: true });
    store = new Store();
    store.attach(client);
    await store.connect();
    await store.open('t-native');
    const [run] = await client.call('workflows.list', { threadId: 't-trace' });
    component = mount(AgentDock, { target: document.body, props: { store, threadId: 't-native' } });
    await vi.waitFor(() => expect(store.workflowsThreadId).toBe('t-native'));
    const running = (count: number) => Array.from({ length: count }, (_, at) => ({ ...run!, id: `wf-${at}`, name: `Run ${at + 1}`, rootThreadId: 't-native', status: 'running' as const, createdAt: Date.now(), nodes: [] }));
    const names = () => [...document.querySelectorAll('[data-testid=active-subagent]')].map((entry) => entry.textContent?.trim().split(/\s+/).slice(0, 2).join(' '));
    const more = () => document.querySelector<HTMLButtonElement>('[data-testid=agent-dock-more]');

    // Four fit: a "+1" would hide a name for the room of one.
    store.workflows = running(4);
    await tick();
    expect(names()).toEqual(['Run 1', 'Run 2', 'Run 3', 'Run 4']);
    expect(more()).toBeNull();

    // Five: three by name, then the count of the rest, which opens them all in place.
    store.workflows = running(5);
    await tick();
    expect(names()).toEqual(['Run 1', 'Run 2', 'Run 3']);
    expect(more()?.textContent?.trim()).toBe('Show 2 more');
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    more()!.click();
    await tick();
    expect(names()).toEqual(['Run 1', 'Run 2', 'Run 3', 'Run 4', 'Run 5']);
    expect(more()?.getAttribute('aria-expanded')).toBe('true');
    more()!.click();
    await tick();
    expect(names()).toHaveLength(3);
  } finally { vi.stubGlobal('matchMedia', before); }
});
