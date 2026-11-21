import { expect } from 'vitest';
import { RpcErrorCode, USAGE_THREAD_TURNS_MAX } from '@boite/contracts';
import { test } from '../../test/fake-client';
import { dayEdges } from '../usage';

test('usage.history filters one project, lists every project with removed ones, and names its rates', async ({ ready }) => {
  const { client } = await ready({ delayMs: 0 });
  const edges = dayEdges(90);
  const all = await client.call('usage.history', { edges });
  const projects = new Map((all.projects ?? []).map((project) => [project.projectId, project]));
  expect([...projects.keys()].sort()).toEqual(['p-boite', 'p-notes', 'p-prototype', null].sort());
  expect(projects.get('p-prototype')).toMatchObject({ name: 'prototype', removed: true });
  expect(projects.get(null)).toMatchObject({ name: null, removed: false });
  expect(all.pricing).toMatchObject({ origin: 'bundled' });
  const total = (history: typeof all) => history.rows.reduce((sum, row) => sum + row.turns, 0);
  expect([...projects.values()].reduce((sum, project) => sum + project.turns, 0)).toBe(total(all));

  const notes = await client.call('usage.history', { edges, projectId: 'p-notes' });
  expect(total(notes)).toBe(projects.get('p-notes')!.turns);
  expect(notes.threads.every((thread) => thread.projectId === 'p-notes')).toBe(true);
  expect(notes.projects).toEqual(all.projects);
  const none = await client.call('usage.history', { edges, projectId: null });
  expect(total(none)).toBe(projects.get(null)!.turns);
  await expect(client.call('usage.history', { edges, projectId: ' ' })).rejects.toMatchObject({ code: RpcErrorCode.InvalidParams });
});

test('usage.thread gives a thread\'s turns oldest first, capped to the newest, and its subagents', async ({ ready }) => {
  const { client } = await ready({ delayMs: 0 });
  const edges = dayEdges(90);
  const detail = await client.call('usage.thread', { threadId: 't-trace', edges });
  expect(detail.turns.length).toBeGreaterThan(0);
  expect(detail.turns.length).toBeLessThanOrEqual(USAGE_THREAD_TURNS_MAX);
  expect(detail.turns.every((turn, index) => index === 0 || turn.finishedAt >= detail.turns[index - 1]!.finishedAt)).toBe(true);
  expect(detail.truncated).toBe(detail.thread.turns > USAGE_THREAD_TURNS_MAX);
  expect(detail.turns.some((turn) => turn.usage === null && turn.price === null)).toBe(true);
  expect(detail.children.map((child) => child.threadId)).toEqual(['u-claude-cli']);
  await expect(client.call('usage.thread', { threadId: 'thr_missing', edges })).rejects.toMatchObject({ code: RpcErrorCode.NotFound });
  await expect(client.call('usage.thread', { threadId: 't-trace', edges: [1] })).rejects.toMatchObject({ code: RpcErrorCode.InvalidParams });
});
