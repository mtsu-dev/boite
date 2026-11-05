import { Folder, List } from '@lucide/svelte';
import { workspace } from './workspace.svelte';
import { projectKey, projectView, type ProjectEntry } from './project-view.svelte';
import { projectName } from './format';
import { separator, type MenuItem } from './menu';
import { strings } from './strings';

/**
 * The thread list's view picker, on the desktop's sidebar and a phone's list
 * header alike: Projects or Recent, then, in Recent, the project it lists
 * (all of them or one). The display options panel keeps only how the rows
 * group. A project's id is its `projectKey`, as `projectView.pick` reads it.
 */
export function viewMenuItems(entries: ProjectEntry[], several: boolean): MenuItem[] {
  const recent = workspace.view === 'recent';
  const views: MenuItem[] = [
    { id: 'view:projects', label: strings.sidebar.projectsView, glyph: Folder, checked: !recent, radio: true },
    { id: 'view:recent', label: strings.sidebar.recentView, glyph: List, checked: recent, radio: true }
  ];
  if (!recent || entries.length === 0) return views;
  const selected = projectView.selected(entries);
  return [
    ...views,
    separator('scope-sep'),
    { id: 'all', label: strings.sidebar.allProjects, checked: !selected, radio: true },
    ...entries.map(entry => ({
      id: projectKey(entry), label: projectName(entry.project), hint: several ? entry.machine.label : entry.project.path,
      checked: projectKey(entry) === projectView.filter, radio: true, projectTile: { project: entry.project, store: entry.machine.store }
    }))
  ];
}

export function pickView(id: string): void {
  if (id === 'view:projects' || id === 'view:recent') workspace.setView(id === 'view:recent' ? 'recent' : 'projects');
  else projectView.pick(id);
}
