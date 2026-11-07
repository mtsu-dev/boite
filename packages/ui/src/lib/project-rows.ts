import type { Project } from '@boite/contracts';
import { projectName, shortPath } from './format';
import type { SearchField } from './palette';
import type { Store } from './store.svelte';
import type { Machine } from './workspace.svelte';

/** One line of the project search (`ProjectSearch.svelte`): a tile, a name, a short folder, the mark. */
export interface ProjectRow {
  /** The machine and the project: project ids can collide between machines. */
  id: string;
  label: string;
  /** The folder on one line: what tells two projects of one name apart (`shortPath`). */
  hint: string;
  /** The full folder or the drafts' explanation, under the pointer. */
  title: string;
  /** Checked: the draft's project, or the thread's own in the move picker. */
  active: boolean;
  tile: { project: Project; store: Store } | null;
  machine: Machine;
  /** What a query word may land on: the name, the machine, the full folder. */
  fields: SearchField[];
}

export interface ProjectGroup {
  /** The machine's id: two machines can carry the same label. */
  id: string;
  /** Null on one machine, or on a ranked list where every row names its own. */
  machine: Machine | null;
  rows: ProjectRow[];
}

/** What a query word may land on: the name first, the machine when there are several, then the full folder. */
export function searchFields(name: string, machine: Machine, path: string, several: boolean): SearchField[] {
  return [
    { text: name },
    ...(several ? [{ text: machine.label, penalty: 5 }] : []),
    ...(path ? [{ text: path, penalty: 15 }] : [])
  ];
}

/** A project's row: its name unless `label` says otherwise, its folder shortened, the full one under the pointer. */
export function projectRow(project: Project, machine: Machine, options: { several: boolean; active: boolean; label?: string }): ProjectRow {
  const name = projectName(project);
  return {
    id: JSON.stringify([machine.id, project.id]),
    label: options.label ?? name,
    hint: shortPath(project.path),
    title: project.path,
    active: options.active,
    tile: { project, store: machine.store },
    machine,
    fields: searchFields(name, machine, project.path, options.several)
  };
}
