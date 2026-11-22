import { afterEach, expect, vi } from 'vitest';
import { test } from '../test/fake-client';
import { Store } from './store.svelte';
import { RpcFailure } from './client';
import { RpcErrorCode, type Project } from '@boite/contracts';

afterEach(() => {
  vi.restoreAllMocks();
});

test('the landing uses the boot list and simultaneous draft opens refresh their selected project once', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0 });
  const asked = vi.spyOn(client, 'call');
  store.attach(client);
  await store.connect();
  const lists = () => asked.mock.calls.filter(([method]) => method === 'projects.list').length;
  const gitReads = () => asked.mock.calls.filter(([method]) => method === 'projects.git');
  expect(lists()).toBe(1);

  await store.openLanding();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.draft).not.toBeNull();
  expect(lists()).toBe(1);
  expect(gitReads()).toHaveLength(0);

  // New thread pressed right away still asks, so a `git init` done meanwhile shows.
  store.startDraft('p-boite');
  store.startDraft('p-boite');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(lists()).toBe(1);
  expect(gitReads()).toEqual([['projects.git', { projectId: 'p-boite' }]]);
});

test('older cores still refresh projects when a draft is opened', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0 });
  store.attach(client);
  await store.connect();
  const call = client.call.bind(client);
  const asked = vi.spyOn(client, 'call').mockImplementation((method, params, options) =>
    method === 'projects.git' ? Promise.reject(new RpcFailure({ code: RpcErrorCode.MethodNotFound, message: 'Unknown method' })) : call(method, params, options));
  store.startDraft('p-boite');
  await vi.waitFor(() => expect(asked.mock.calls.filter(([method]) => method === 'projects.list')).toHaveLength(1));
  store.startDraft('p-notes');
  await vi.waitFor(() => expect(asked.mock.calls.filter(([method]) => method === 'projects.list')).toHaveLength(2));
  expect(asked.mock.calls.filter(([method]) => method === 'projects.git')).toHaveLength(1);
});

test('an earlier project list preserves the Git state already refreshed for a draft', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0 });
  store.attach(client);
  await store.connect();
  let resolveList!: (rows: Project[]) => void;
  const list = new Promise<Project[]>(resolve => { resolveList = resolve; });
  const rows = store.projects.map(project => project.id === 'p-boite'
    ? { ...project, name: 'Renamed on disk', repository: true } : project);
  const call = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation(async (method, params, options) => {
    if (method === 'projects.list') return list;
    if (method === 'projects.git') return { repository: false };
    return call(method, params, options);
  });
  const refresh = store.refreshProjects();
  store.startDraft('p-boite');
  await vi.waitFor(() => expect(store.projects.find(project => project.id === 'p-boite')?.repository).toBe(false));
  resolveList(rows);
  await refresh;
  expect(store.projects.find(project => project.id === 'p-boite')).toMatchObject({ name: 'Renamed on disk', repository: false });
});

test('archiving the open project lands elsewhere, and another client hears the flag', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0 });
  const other = new Store();
  store.attach(client);
  other.attach(client);
  try {
    await store.connect();
    await other.connect();
    await store.open('t-trace');
    expect(store.openThread?.projectId).toBe('p-boite');

    expect(await store.archiveProject('p-boite', true)).toBe(true);
    expect(store.projects.find((p) => p.id === 'p-boite')?.archived).toBe(true);
    // The screen leaves the archived project for a thread of one still listed.
    expect(store.openThread?.projectId).not.toBe('p-boite');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.projects.find((p) => p.id === 'p-boite')?.archived).toBe(true);

    expect(await store.archiveProject('p-boite', false)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.projects.find((p) => p.id === 'p-boite')?.archived).toBeUndefined();
  } finally {
    other.detach();
  }
});

test('a project archived while its machine is away stays archived and reaches the machine on reconnect', async ({ createStore }) => {
  window.localStorage.clear();
  const { store, client } = createStore({ delayMs: 0 });
  store.attach(client);
  await store.connect();
  const archives = vi.spyOn(client, 'call');
  client.drop();
  expect(store.connection).not.toBe('ready');

  expect(await store.archiveProject('p-notes', true)).toBe(true);
  expect(store.projects.find((p) => p.id === 'p-notes')?.archived).toBe(true);
  expect(archives.mock.calls.some(([method]) => method === 'projects.archive')).toBe(false);

  await client.restore();
  await store.reload();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(archives.mock.calls.filter(([method]) => method === 'projects.archive')).toEqual([['projects.archive', { projectId: 'p-notes', archived: true }]]);
  expect(store.projects.find((p) => p.id === 'p-notes')?.archived).toBe(true);
  const listed = await client.call('projects.list', {});
  expect(listed.find((p) => p.id === 'p-notes')?.archived).toBe(true);

  // Sent once: the next reconnect asks nothing again.
  archives.mockClear();
  client.drop();
  await client.restore();
  await store.reload();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(archives.mock.calls.some(([method]) => method === 'projects.archive')).toBe(false);
});

test('worktree defaults follow the project on both clients and saved or explicit draft choices survive', async ({ createStore }) => {
  window.localStorage.clear();
  const { store, client } = createStore({ delayMs: 0 });
  const other = new Store();
  store.attach(client);
  other.attach(client);
  try {
    await store.connect();
    await other.connect();
    await store.setProjectWorktreeDefault('p-boite', true);
    await new Promise(resolve => setTimeout(resolve, 0));
    other.startDraft('p-boite');
    expect(other.draft?.worktree).toBe(true);
    store.startDraft('p-notes');
    expect(store.draft?.worktree).toBe(false);
    store.setDraftProject('p-boite');
    expect(store.draft?.worktree).toBe(true);
    store.setDraftWorktree(false);
    store.setDraftProject('p-notes');
    expect(store.draft?.worktree).toBe(false);
    store.setDraftProject('p-boite');
    expect(store.draft?.worktree).toBe(false);
    store.composerStates.draft!.text = 'Keep this draft';
    store.startDraft('p-notes');
    store.startDraft('p-boite');
    expect(store.draft?.worktree).toBe(false);
    await store.setProjectWorktreeDefault('p-boite', false);
    await new Promise(resolve => setTimeout(resolve, 0));
    // The other client's already open draft keeps its choice.
    expect(other.draft?.worktree).toBe(true);
    other.startDraft('p-notes');
    other.startDraft('p-boite');
    expect(other.draft?.worktree).toBe(false);
  } finally {
    other.detach();
  }
});
