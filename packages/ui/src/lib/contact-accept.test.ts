import { expect, test } from 'vitest';
import type { ContactRequest, Project, ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { acceptItems, acceptProject } from './contact-accept';

const project = (id: string, name: string, extra: Partial<Project> = {}) => ({ id, name, path: `/src/${name}`, createdAt: 0, ...extra }) as Project;
const thread = (id: string, projectId: string, updatedAt: number) => ({ id, projectId, updatedAt, archived: false }) as unknown as ThreadSummary;
const store = (projects: Project[], threads: ThreadSummary[]) => ({ projects, threads }) as unknown as Store;
const request = (extra: Partial<ContactRequest> = {}) => ({ id: 'r', from: { project: 'website' }, ...extra }) as ContactRequest;

const projects = [project('p-drafts', 'Drafts', { kind: 'drafts' }), project('p-old', 'old', { archived: true } as Partial<Project>), project('p-notes', 'notes'), project('p-site', 'Website'), project('p-boite', 'boite')];
const threads = [thread('t-boite', 'p-boite', 20), thread('t-notes', 'p-notes', 10)];

test('a plain Accept shares the named thread\'s project, then the one named like the remote or the asker\'s project, then the last worked in', () => {
  const here = store(projects, threads);
  expect(acceptProject(here, request({ target: { threadId: 't-notes' } as ContactRequest['target'] }))?.id).toBe('p-notes');
  expect(acceptProject(here, request({ gitRemote: 'git@github.com:chris/boite.git' }))?.id).toBe('p-boite');
  expect(acceptProject(here, request())?.id).toBe('p-site');
  expect(acceptProject(here, request({ from: { project: 'elsewhere' } } as Partial<ContactRequest>))?.id).toBe('p-boite');
  // Never the drafts folder or an archived project.
  expect(acceptProject(store([projects[0]!, projects[1]!], []), request())).toBeNull();
});

test('the row menu lists every project it can open, the plain Accept\'s one checked', () => {
  const items = acceptItems(store(projects, threads), projects[4]!);
  expect(items.map(item => [item.id, item.checked])).toEqual([['p-notes', false], ['p-site', false], ['p-boite', true]]);
});
