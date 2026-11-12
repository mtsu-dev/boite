import { expect, test, vi } from 'vitest';
import type { WorkflowRun, WorkflowTemplate } from '@boite/contracts';
import type { Client } from '../client';
import type { StoreContext } from './context';
import { Workflows } from './workflows.svelte';
import { test as storeTest } from '../../test/fake-client';
import { fakeCore } from '../fake-client/coordination';

const template = (projectId: string | null, name = 'Review'): WorkflowTemplate => ({
  id: name, projectId, name, plan: { name, steps: [{ id: 'review', task: 'x'.repeat(5000) }] }, createdAt: 1, updatedAt: 1,
});

function fixture(projectId: string | null = 'project', libraryProjectId = projectId) {
  let templates = [template(libraryProjectId)];
  const reads = { runs: 0, templates: 0, jsonChars: 0, jsonBytes: 0 };
  const call = vi.fn(async (method: string) => {
    let value: unknown;
    if (method === 'workflows.list') { reads.runs++; value = []; }
    else if (method === 'workflows.templates.list') { reads.templates++; value = structuredClone(templates); }
    else if (method === 'workflows.templates.save') { templates = [template(libraryProjectId, 'Saved')]; value = templates[0]; }
    else if (method === 'workflows.templates.remove') { templates = []; value = { removed: true }; }
    else throw new Error(method);
    if (method.endsWith('.list')) {
      const json = JSON.stringify(value);
      reads.jsonChars += json.length;
      reads.jsonBytes += new TextEncoder().encode(json).byteLength;
    }
    return value;
  });
  const client = { call } as unknown as Client;
  const store = { openThread: { id: 'root', parentThreadId: null as string | null, projectId }, connection: 'ready', owner: true, navigationGeneration: 1 };
  const ctx = { client, store, clientGeneration: 1, reason: String } as unknown as StoreContext;
  const workflows = new Workflows(ctx);
  Object.assign(store, { loadWorkflows: (...args: Parameters<Workflows['loadWorkflows']>) => workflows.loadWorkflows(...args) });
  return { ctx, store, workflows, call, client, reads, setTemplates: (value: WorkflowTemplate[]) => { templates = value; } };
}

const nextRead = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('100 spaced run refreshes read the run list 101 times and the unchanged templates once', async () => {
  const f = fixture();
  f.setTemplates(Array.from({ length: 20 }, (_, i) => template('project', `Review ${i}`)));
  await f.workflows.loadWorkflows();
  for (let i = 0; i < 100; i++) await f.workflows.loadWorkflows();
  console.info(`workflow refresh measurement: ${JSON.stringify(f.reads)}`);
  expect(f.reads.runs).toBe(101);
  expect(f.reads.templates).toBe(1);
});

test('template invalidations from another root of the project refresh only the templates', async () => {
  const f = fixture();
  await f.workflows.loadWorkflows();
  f.setTemplates([template('project', 'Changed elsewhere')]);
  f.workflows.changed({ threadId: 'other-root', runId: '', templatesProjectId: 'project' });
  await vi.waitFor(() => expect(f.workflows.workflowTemplates[0]?.name).toBe('Changed elsewhere'));
  expect(f.reads).toMatchObject({ runs: 1, templates: 2 });
  f.workflows.changed({ threadId: 'other-root', runId: '', templatesProjectId: 'other-project' });
  await nextRead();
  expect(f.reads.templates).toBe(2);
});

test.each([false, true])('a bot child in an entrusted project refreshes its parent library (initially empty: %s)', async empty => {
  const f = fixture('entrusted', null);
  f.store.openThread.id = 'child';
  f.store.openThread.parentThreadId = 'bot';
  if (empty) f.setTemplates([]);
  await f.workflows.loadWorkflows();
  f.setTemplates([template(null, 'Changed on another bot')]);
  f.workflows.changed({ threadId: 'other-bot', runId: '', templatesProjectId: null });
  await vi.waitFor(() => expect(f.workflows.workflowTemplates[0]?.name).toBe('Changed on another bot'));
  expect(f.reads).toMatchObject({ runs: 1, templates: 2 });
  // Once a response identifies the parent library, the child's checkout project is unrelated.
  f.workflows.changed({ threadId: 'entrusted-root', runId: '', templatesProjectId: 'entrusted' });
  f.workflows.changed({ threadId: 'bot', runId: 'progress' });
  await vi.waitFor(() => expect(f.reads.runs).toBe(2));
  expect(f.reads.templates).toBe(2);
  await f.workflows.saveWorkflowTemplate({ rootThreadId: 'bot', plan: template(null).plan } as WorkflowRun, 'Saved');
  expect(f.workflows.workflowTemplates.map(t => t.name)).toEqual(['Saved']);
  await f.workflows.removeWorkflowTemplate(f.workflows.workflowTemplates[0]!);
  expect(f.workflows.workflowTemplates).toEqual([]);
  expect(f.reads.templates).toBe(4);
});

test('a burst of run events still coalesces to one follow-up run read and shares the template read', async () => {
  const f = fixture();
  let release!: (value: unknown) => void;
  f.call.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const reading = f.workflows.loadWorkflows();
  for (let i = 0; i < 100; i++) f.workflows.changed({ threadId: 'root', runId: 'run' });
  release([]);
  await reading;
  expect(f.call.mock.calls.filter(([method]) => method === 'workflows.list')).toHaveLength(2);
  expect(f.reads.templates).toBe(1);
});

test('legacy empty run ids invalidate only the open tree, including projectless roots and child views', async () => {
  const f = fixture(null);
  f.store.openThread.parentThreadId = 'parent';
  await f.workflows.loadWorkflows();
  f.setTemplates([template(null, 'Legacy')]);
  f.workflows.changed({ threadId: 'parent', runId: '' });
  await vi.waitFor(() => expect(f.workflows.workflowTemplates[0]?.name).toBe('Legacy'));
  f.workflows.changed({ threadId: 'unrelated', runId: '' });
  await nextRead();
  expect(f.reads.templates).toBe(2);
});

test('a template invalidation during its read performs another read before publishing', async () => {
  const f = fixture();
  const real = f.call.getMockImplementation()!;
  let release!: (value: unknown) => void;
  f.call.mockImplementationOnce(async method => real(method)); // runs
  f.call.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const reading = f.workflows.loadWorkflows();
  await nextRead();
  f.setTemplates([template('project', 'New')]);
  f.workflows.changed({ threadId: 'elsewhere', runId: '', templatesProjectId: 'project' });
  release([template('project', 'Old')]);
  await reading;
  expect(f.workflows.workflowTemplates[0]?.name).toBe('New');
  expect(f.call.mock.calls.filter(([method]) => method === 'workflows.templates.list')).toHaveLength(2);
});

test('a template event queued just after the response resolves still triggers a second read', async () => {
  const f = fixture();
  const reading = f.workflows.loadWorkflows();
  queueMicrotask(() => queueMicrotask(() => {
    f.setTemplates([template('project', 'Newer than the response')]);
    f.workflows.changed({ threadId: 'other-root', runId: '', templatesProjectId: 'project' });
  }));
  await reading;
  expect(f.workflows.workflowTemplates[0]?.name).toBe('Newer than the response');
  expect(f.reads.templates).toBe(2);
});

test('navigation and reconnect retire pending reads and revalidate a project visit', async () => {
  const f = fixture();
  const real = f.call.getMockImplementation()!;
  let release!: (value: unknown) => void;
  f.call.mockImplementationOnce(async method => real(method));
  f.call.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = f.workflows.loadWorkflows();
  await nextRead();
  f.store.navigationGeneration++;
  f.setTemplates([template('project', 'New visit')]);
  await f.workflows.loadWorkflows();
  release([template('project', 'Old visit')]);
  await old;
  expect(f.workflows.workflowTemplates[0]?.name).toBe('New visit');
  f.workflows.disconnected();
  f.setTemplates([template('project', 'Reconnected')]);
  await f.workflows.loadWorkflows();
  expect(f.workflows.workflowTemplates[0]?.name).toBe('Reconnected');
});

test('leaving a project and coming back revalidates its templates without publishing another project library', async () => {
  const f = fixture();
  await f.workflows.loadWorkflows();
  f.store.openThread = { id: 'other-root', parentThreadId: null, projectId: 'other-project' };
  f.store.navigationGeneration++;
  f.setTemplates([template('other-project', 'Elsewhere')]);
  await f.workflows.loadWorkflows();
  expect(f.workflows.workflowTemplates[0]?.projectId).toBe('other-project');
  f.store.openThread = { id: 'root', parentThreadId: null, projectId: 'project' };
  f.store.navigationGeneration++;
  f.setTemplates([template('project', 'Changed while away')]);
  await f.workflows.loadWorkflows();
  expect(f.workflows.workflowTemplates[0]?.name).toBe('Changed while away');
  expect(f.reads.templates).toBe(3);
});

test('stores and clients with colliding project ids never reuse another machine library', async () => {
  const first = fixture(), second = fixture();
  second.setTemplates([template('project', 'Other machine')]);
  await Promise.all([first.workflows.loadWorkflows(), second.workflows.loadWorkflows()]);
  expect(first.workflows.workflowTemplates[0]?.name).toBe('Review');
  expect(second.workflows.workflowTemplates[0]?.name).toBe('Other machine');
  first.ctx.client = second.client;
  await first.workflows.loadWorkflows();
  expect(first.workflows.workflowTemplates[0]?.name).toBe('Other machine');
});

test('local save and remove invalidate the project library even without an event', async () => {
  const f = fixture();
  await f.workflows.loadWorkflows();
  await f.workflows.saveWorkflowTemplate({ rootThreadId: 'root', plan: template('project').plan } as WorkflowRun, 'Saved');
  expect(f.workflows.workflowTemplates.map(t => t.name)).toEqual(['Saved']);
  await f.workflows.removeWorkflowTemplate(f.workflows.workflowTemplates[0]!);
  expect(f.workflows.workflowTemplates).toEqual([]);
});

test('a failed library read remains retryable on the next refresh', async () => {
  const f = fixture();
  const real = f.call.getMockImplementation()!;
  f.call.mockImplementationOnce(async method => real(method));
  f.call.mockRejectedValueOnce(new Error('Disconnected'));
  await f.workflows.loadWorkflows();
  expect(f.workflows.workflowsError).toContain('Disconnected');
  await f.workflows.loadWorkflows();
  expect(f.workflows.workflowTemplates.map(t => t.name)).toEqual(['Review']);
});

storeTest('the Store event listener keeps 100 spaced run events off the template RPC and revalidates on reconnect', async ({ ready }) => {
  const { store, client } = await ready({ delayMs: 0, coreId: 'workflow-cache-events' });
  await store.open('t-trace');
  const real = client.call.bind(client);
  const reads = { runs: 0, templates: 0 };
  vi.spyOn(client, 'call').mockImplementation(((method, params, options) => {
    if (method === 'workflows.list') reads.runs++;
    if (method === 'workflows.templates.list') reads.templates++;
    return real(method, params, options);
  }) as typeof client.call);
  await store.loadWorkflows();
  const ctx = fakeCore('workflow-cache-events')!;
  for (let i = 0; i < 100; i++) {
    ctx.emitToThread('t-trace', 'workflows.changed', { threadId: 't-trace', runId: 'progress' });
    await nextRead();
  }
  expect(reads).toEqual({ runs: 101, templates: 1 });
  client.drop();
  await client.elsewhere('workflows.templates.save', { threadId: 't-trace', name: 'Saved while away', plan: template('project').plan });
  await client.restore();
  await vi.waitFor(() => expect(store.workflowTemplates.map(t => t.name)).toEqual(['Saved while away']));
  expect(reads.templates).toBe(2);
});

storeTest('a template changed on an unsubscribed root refreshes the open root of the same project', async ({ ready }) => {
  const { store, client } = await ready({ delayMs: 0, coreId: 'workflow-template-routing' });
  await store.open('t-trace');
  await store.loadWorkflows();
  const source = store.openThread!;
  const other = await client.elsewhere('threads.create', { projectId: source.projectId!, providerId: source.providerId, accountId: source.accountId });
  expect(client.coreSubscribers).not.toContain(other.id);
  const saved = await client.elsewhere('workflows.templates.save', { threadId: other.id, name: 'Saved from another root', plan: template(source.projectId).plan });
  await vi.waitFor(() => expect(store.workflowTemplates.map(t => t.name)).toEqual(['Saved from another root']));
  await client.elsewhere('workflows.templates.remove', { threadId: other.id, templateId: saved.id });
  await vi.waitFor(() => expect(store.workflowTemplates).toEqual([]));
});
