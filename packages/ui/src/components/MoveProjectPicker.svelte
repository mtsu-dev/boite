<script lang="ts">
  import type { ProjectGroup } from '../lib/project-rows';
  import { strings } from '../lib/strings';
  import { movePicker, moveTargets } from '../lib/thread-move.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import ProjectSearch from './ProjectSearch.svelte';

  /**
   * "Move to project" from a thread's menus: the project search of the draft's
   * "Change project" over the thread's machine, its own project checked. A
   * move keeps its machine, so no machine heads the rows, and nothing opens a
   * folder from here.
   */
  let rows = $derived.by(() => {
    const request = movePicker.request;
    if (!request) return [];
    const owner = request.store;
    const machine = workspace.machinesOr(owner).find((m) => m.store === owner) ?? { id: 'local', label: strings.machines.local, store: owner };
    return moveTargets(owner, request, machine);
  });
  let groups = $derived<ProjectGroup[]>(rows.length ? [{ id: 'projects', machine: null, rows }] : []);

  function pick(id: string) {
    const projectId = rows.find((row) => row.id === id)?.tile?.project.id;
    if (projectId) movePicker.pick(projectId);
    else movePicker.close();
  }
</script>

<ProjectSearch
  popover={movePicker.popover}
  testid="move-project"
  label={strings.threadMove.moveTo}
  {groups}
  several={false}
  empty={strings.threadMove.noOtherProject}
  onpick={pick}
  onclose={() => movePicker.close()}
/>
