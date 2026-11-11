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

const line = () => document.querySelector<HTMLElement>('[data-testid=agent-dock]');
const label = () => document.querySelector('[data-testid=agent-dock-label]')?.textContent;
/** The names the line lists, in muted ink after the counts (whole here: tests have no ResizeObserver, so word-fit never cuts). */
const names = () => (document.querySelector('[data-testid=agent-dock-names]')?.textContent ?? '').split(', ').filter(Boolean);
const stop = () => document.querySelector<HTMLButtonElement>('[data-testid=agent-dock-stop]');

test('a running workflow puts the waiting line up by name, and Stop stops it', async () => {
  client = new FakeClient({ delayMs: 0, delegationDemo: true });
  store = new Store();
  store.attach(client);
  await store.connect();
  await store.open('t-native');
  const [run] = await client.call('workflows.list', { threadId: 't-trace' });
  component = mount(AgentDock, { target: document.body, props: { store, threadId: 't-native' } });
  await vi.waitFor(() => expect(store.workflowsThreadId).toBe('t-native'));
  await tick();
  expect(line()).toBeNull();

  store.workflows = [{ ...run!, rootThreadId: 't-native', status: 'running', createdAt: Date.now() - 62_000, nodes: [] }];
  await tick();
  expect(line()?.dataset.runs).toBe('1');
  expect(label()).toBe('Waiting on 1 workflow');
  expect(names()).toEqual([run!.name]);
  const control = vi.spyOn(store, 'controlWorkflow').mockResolvedValue(true);
  stop()!.click();
  await tick();
  expect(control).toHaveBeenCalledWith(expect.objectContaining({ id: run!.id }), 'stop');

  // Finished, it no longer holds the conversation: the line leaves at once.
  store.workflows[0]!.status = 'done';
  await tick();
  expect(line()).toBeNull();
});

test('a memory pass another machine names leaves this machine\'s subagent of the same id on the line', async () => {
  client = new FakeClient({ delayMs: 0, delegationDemo: true });
  store = new Store();
  store.attach(client);
  await store.connect();
  const child = store.threads.find(thread => thread.id === 't-team-running')!;
  await store.open(child.parentThreadId!);
  component = mount(AgentDock, { target: document.body, props: { store, threadId: child.parentThreadId! } });
  const count = () => line()?.dataset.count;
  // The running child and the one waiting on its background run, each counted.
  await vi.waitFor(() => expect(count()).toBe('2'));
  // Another machine's snapshot: its agent's memory pass happens to carry the same thread id.
  const snapshot = new FakeAgents(() => {}).snapshot();
  const other = { client: { call: vi.fn().mockResolvedValue({ ...snapshot, status: [{ agentId: 'agt-elsewhere', threadId: 'elsewhere', state: 'idle', memory: { threadId: child.id, status: 'running', summary: null, at: 1 } }] }), on: () => () => {} } } as unknown as Store;
  const view = new AgentsView(other);
  try {
    await view.refresh();
    await tick();
    expect(count()).toBe('2');
    // Its two subagents, then its running workflow.
    expect(names()).toHaveLength(3);
  } finally { view.close(); }
});

test('the work a thread waits on reads "Waiting on N" with its names, and Stop stops the subagents and the workflow', async () => {
  client = new FakeClient({ delayMs: 0, delegationDemo: true });
  store = new Store();
  store.attach(client);
  await store.connect();
  const parent = store.threads.find(thread => thread.id === 't-team-running')!.parentThreadId!;
  await store.open(parent);
  const props = $state({ store, threadId: parent });
  component = mount(AgentDock, { target: document.body, props });
  await vi.waitFor(() => expect(line()?.dataset.count).toBe('2'));
  // Two subagents and the workflow it started.
  expect(line()?.dataset.runs).toBe('1');
  expect(label()).toBe('Waiting on 3 subagents and workflows');
  // Stop names its reach, and its tooltip that the agent itself goes on.
  expect(stop()?.textContent?.trim()).toBe('Stop all');
  expect(stop()?.title).toBe('Stops the subagents and workflows this conversation waits on. The agent itself is not stopped.');
  const titles = [...store.delegation!.agents.map(agent => agent.thread.title), ...store.workflowsOf(parent).map(run => run.name)];
  // Every one of them by name, never a count alone; its tooltip holds them whole.
  expect(names()).toHaveLength(3);
  for (const name of names()) expect(titles).toContain(name);
  expect(document.querySelector<HTMLElement>('[data-testid=agent-dock-names]')?.title).toBe(names().join(', '));
  // Without a strip to fold into, the line is the counts, the names and Stop.
  expect(document.querySelector('[data-testid=agent-dock] [aria-expanded]')).toBeNull();
  expect(document.querySelectorAll('[data-testid=agent-dock] button')).toHaveLength(1);

  // At the root, one call stops every subagent of the team.
  const stopAll = vi.spyOn(store, 'stopDelegatedAgent').mockResolvedValue();
  const control = vi.spyOn(store, 'controlWorkflow').mockResolvedValue(true);
  stop()!.click();
  await tick();
  expect(stopAll).toHaveBeenCalledTimes(1);
  expect(stopAll).toHaveBeenCalledWith();
  expect(control).toHaveBeenCalledWith(expect.objectContaining({ rootThreadId: parent }), 'stop');
  await vi.waitFor(() => expect(stop()?.disabled).toBe(false));

  // A subagent's own line counts what it sent, never itself or its siblings.
  props.threadId = 't-team-running';
  await vi.waitFor(() => expect(store.delegation?.rootThreadId).toBe(parent));
  await tick();
  expect(line()).toBeNull();
});

test('a command\'s own agent keeps the line up without a Stop that could never reach it', async () => {
  client = new FakeClient({ delayMs: 0, delegationDemo: true });
  store = new Store();
  store.attach(client);
  await store.connect();
  await store.open('t-native');
  component = mount(AgentDock, { target: document.body, props: { store, threadId: 't-native' } });
  await vi.waitFor(() => expect(store.delegation?.nativeAgents.length).toBeGreaterThan(0));
  store.delegation!.nativeAgents = [{ id: 'cli-1', toolId: 'cli-1', name: 'Count the parser lines', status: 'running', startedAt: Date.now(), source: 'process' }];
  await tick();
  expect(label()).toBe('Waiting on 1 subagent');
  expect(names()).toEqual(['Count the parser lines']);
  expect(stop()).toBeNull();
  // A provider's own subagent runs inside the turn: Stop ends that turn.
  store.delegation!.nativeAgents = [{ id: 'native-1', toolId: 'native-1', name: 'Review parser boundaries', status: 'running', startedAt: Date.now() }];
  await tick();
  // It stops the turn and what runs in it: Stop says all.
  expect(stop()?.textContent?.trim()).toBe('Stop all');
  const turn = vi.spyOn(store, 'stop').mockResolvedValue();
  stop()!.click();
  await tick();
  expect(turn).toHaveBeenCalledTimes(1);
});
