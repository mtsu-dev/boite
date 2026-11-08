import type { Project, ThreadSummary } from '@boite/contracts';
import { projectName } from './format';

type Placed = { machine: { id: string; label: string }; project: Project | undefined; thread: Pick<ThreadSummary, 'id' | 'title'> };

/**
 * Where a flat list's row lives, for its secondary line, once the tile alone may not tell two rows apart: the list
 * spans several projects or machines, or two rows share a title. The project's name, then the machine's when the
 * list holds several and it is not `home`, this app's own machine, which every row would repeat; nothing when every
 * row shares one project and one machine and no title repeats.
 */
export function rowPlaces<T extends Placed>(rows: readonly T[], home?: string): (row: T) => string | undefined {
  const machines = new Set(rows.map(row => row.machine.id));
  const projects = new Set(rows.map(row => `${row.machine.id}\n${row.project?.id ?? ''}`));
  const titles = new Map<string, number>();
  for (const row of rows) titles.set(row.thread.title, (titles.get(row.thread.title) ?? 0) + 1);
  const mixed = machines.size > 1 || projects.size > 1;
  return row => {
    if (!mixed && (titles.get(row.thread.title) ?? 0) < 2) return undefined;
    const place = row.project ? projectName(row.project) : undefined;
    const parts = [place, machines.size > 1 && row.machine.id !== home ? row.machine.label : undefined].filter((part): part is string => !!part);
    return parts.length ? parts.join(' · ') : undefined;
  };
}
