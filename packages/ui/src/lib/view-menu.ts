import { Folder, Layers, List } from '@lucide/svelte';
import { workspace } from './workspace.svelte';
import { projectKey, projectView, type ProjectEntry } from './project-view.svelte';
import { projectName } from './format';
import { heading, separator, type MenuItem } from './menu';
import { strings } from './strings';
import { namesMachine } from './row-machine';

/**
 * The thread list's view picker, on the desktop's sidebar and a phone's list
 * header alike: Projects or Recent, then, in Recent, the project it lists
 * (all of them or one). The display options panel keeps only how the rows
 * group. Each choice sits under its own small label (View, Show), so its
 * check reads as one answer of two. A project's id is its `projectKey`, as `projectView.pick` reads it.
 * Every row leads with a mark, All projects its layers, so the labels start
 * on one column; a project names its machine only when the rows would, never
 * This PC.
 */
export function viewMenuItems(entries: ProjectEntry[], several: boolean): MenuItem[] {
  const recent = workspace.view === 'recent';
  const views: MenuItem[] = [
    heading('view-heading', strings.sidebar.viewHeading),
    { id: 'view:projects', label: strings.sidebar.projectsView, glyph: Folder, checked: !recent, radio: true },
    { id: 'view:recent', label: strings.sidebar.recentView, glyph: List, checked: recent, radio: true }
  ];
  if (!recent || entries.length === 0) return views;
  const selected = projectView.selected(entries);
  return [
    ...views,
    separator('scope-sep'),
    heading('scope-heading', strings.sidebar.scopeHeading),
    { id: 'all', label: strings.sidebar.allProjects, glyph: Layers, checked: !selected, radio: true },
    ...entries.map(entry => ({
      id: projectKey(entry), label: projectName(entry.project),
      hint: !several ? entry.project.path : namesMachine(entry.machine, entry.machine.store.connection !== 'ready') ? entry.machine.label : undefined,
      checked: projectKey(entry) === projectView.filter, radio: true, projectTile: { project: entry.project, store: entry.machine.store }
    }))
  ];
}

export function pickView(id: string): void {
  if (id === 'view:projects' || id === 'view:recent') workspace.setView(id === 'view:recent' ? 'recent' : 'projects');
  else projectView.pick(id);
}
