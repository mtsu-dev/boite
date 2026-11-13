import { markFeature } from '@boite/contracts';
import type { ContactRequest, Project } from '@boite/contracts';
import { projectName } from './format';
import type { MenuItem } from './menu';
import type { Store } from './store.svelte';

/** The projects a request can open: never the drafts folder or an archived one. */
export function openable(store: Store): Project[] {
  return store.projects.filter(project => project.kind !== 'drafts' && !project.archived);
}

/** `https://host/owner/website.git` and `git@host:owner/website` both name `website`. */
function repository(remote: string | undefined): string | null {
  const name = remote?.trim().replace(/\/+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/i, '').toLowerCase();
  return name || null;
}

/**
 * Where a plain Accept shares a request: the project of the thread it named,
 * then the project named like its git remote's repository or the asker's
 * project, then the one the owner worked in last. The row's menu offers the
 * others.
 */
export function acceptProject(store: Store, request: ContactRequest): Project | null {
  const projects = openable(store);
  const byId = (id: string | null | undefined) => projects.find(project => project.id === id);
  const target = request.target ? byId(store.threads.find(thread => thread.id === request.target!.threadId)?.projectId) : undefined;
  if (target) return target;
  const names = [repository(request.gitRemote), request.from.project?.trim().toLowerCase()].filter((name): name is string => !!name);
  const folder = (project: Project) => project.path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)?.toLowerCase();
  const named = names.map(name => projects.find(project => project.name.toLowerCase() === name || folder(project) === name)).find(Boolean);
  if (named) return named;
  const recent = store.threads.filter(thread => !thread.archived && byId(thread.projectId))
    .reduce<typeof store.threads[number] | undefined>((last, thread) => !last || thread.updatedAt > last.updatedAt ? thread : last, undefined);
  return byId(recent?.projectId) ?? projects[0] ?? null;
}

/** The row's menu: every project it can open, the plain Accept's one checked. */
export function acceptItems(store: Store, chosen: Project | null): MenuItem[] {
  return openable(store).map(project => ({ id: project.id, label: projectName(project), projectTile: { project, store }, checked: project.id === chosen?.id, radio: true }));
}

// Marks this module in a bundle: a call no bundler drops (scripts/ci/feature-cut.ts).
markFeature('boite-feature:contacts');
