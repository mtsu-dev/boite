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

  // A failed run shows the red mark a moment, never the check, then leaves.
  store.workflows = [{ ...run!, id: 'wf-failing', rootThreadId: 't-native', status: 'running', createdAt: Date.now(), nodes: [] }];
  await tick();
  expect(document.querySelector('[data-testid=active-subagent]')).not.toBeNull();
  store.workflows[0]!.status = 'failed';
  await tick();
  const failed = document.querySelector<HTMLElement>('[data-testid=active-subagent][data-state=failed]');
  expect(failed?.querySelector('.fail')).not.toBeNull();
  expect(failed?.textContent).toContain('Failed');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=agent-dock]')).toBeNull(), { timeout: 3000 });
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

/** The demo's parent with its children and a provider's own agent at work, its dock mounted. */
async function twoAtWork() {
  client = new FakeClient({ delayMs: 0, delegationDemo: true });
  store = new Store();
  store.attach(client);
  await store.connect();
  const parent = store.threads.find(thread => thread.id === 't-team-running')!.parentThreadId!;
  await store.open(parent);
  const props = $state({ store, threadId: parent });
  component = mount(AgentDock, { target: document.body, props });
  await vi.waitFor(() => expect(document.querySelectorAll('[data-testid=active-subagent][data-kind=agent]')).toHaveLength(2));
  const toggle = () => document.querySelector<HTMLButtonElement>('[data-testid=agent-dock-toggle]')!;
  return { parent, props, toggle, count: document.querySelectorAll('[data-testid=active-subagent]').length };
}

test('several at work fold into one row that counts them, folded by default', async () => {
  const { toggle, count } = await twoAtWork();
  expect(count).toBeGreaterThan(1);
  expect(toggle().textContent).toContain(`${count} active`);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  // The rows wait in the closed fold, out of reach until it opens.
  expect(document.querySelector('[data-testid=agent-dock-list]')?.closest('.disclosure-fold:not(.open)')).not.toBeNull();
  expect(document.querySelector('[data-testid=agent-dock-asking]')).toBeNull();
});

test('the fold opens on a click and from the keyboard, and another thread starts folded', async () => {
  const { parent, props, toggle } = await twoAtWork();
  const opened = () => toggle().getAttribute('aria-expanded') === 'true' && !!document.querySelector('[data-testid=agent-dock-list]')?.closest('.disclosure-fold.open');
  toggle().click();
  await tick();
  expect(opened()).toBe(true);
  toggle().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  expect(opened()).toBe(false);
  for (const key of ['Enter', ' ']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    toggle().dispatchEvent(event);
    await tick();
    expect(opened()).toBe(true);
    // Handled once: the browser's own click on that key cannot fold it again.
    expect(event.defaultPrevented).toBe(true);
    toggle().click();
    await tick();
    expect(opened()).toBe(false);
  }
  toggle().click();
  await tick();
  props.threadId = 't-native';
  await tick();
  props.threadId = parent;
  await vi.waitFor(() => expect(toggle()).not.toBeNull());
  expect(opened()).toBe(false);
});

test('an entry opens that subagent\'s own conversation', async () => {
  const { parent, props, toggle } = await twoAtWork();
  toggle().click();
  await tick();
  const entry = document.querySelector<HTMLButtonElement>('[data-testid=active-subagent][data-kind=agent]')!;
  const childId = store.delegation!.agents.find(agent => agent.thread.title === entry.title)!.thread.id;
  entry.click();
  await vi.waitFor(() => expect(store.openThread?.id).toBe(childId));
  // Its transcript, not a status: the task it was given reads as its first message.
  await vi.waitFor(() => expect(store.openThread?.messages.length).toBeGreaterThan(0));
  // The child's own dock lists what it sent, never itself or its siblings.
  props.threadId = childId;
  await vi.waitFor(() => expect(store.delegation?.rootThreadId).toBe(parent));
  await tick();
  expect(document.querySelector('[data-testid=active-subagent]:is([data-kind=agent], [data-kind=workflow])')).toBeNull();
});

test('a subagent that asks the user puts the amber dot and its count on the folded row', async () => {
  const { parent, toggle } = await twoAtWork();
  const child = store.delegation!.agents.find(agent => agent.thread.id === 't-team-running')!;
  store.threads.find(thread => thread.id === parent)!.subagentQuestions = [{ threadId: child.thread.id, title: child.thread.title }];
  await tick();
  const flag = toggle().querySelector<HTMLElement>('[data-testid=agent-dock-asking]');
  expect(flag?.querySelector('.dot')).not.toBeNull();
  expect(flag?.textContent?.trim()).toBe('1');
  expect(flag?.getAttribute('aria-label')).toBe('1 needs you');
  const asking = document.querySelector<HTMLElement>('[data-testid=active-subagent][data-state=asking]');
  expect(asking?.title).toBe(child.thread.title);
  expect(asking?.textContent).toContain('Needs you');
});
