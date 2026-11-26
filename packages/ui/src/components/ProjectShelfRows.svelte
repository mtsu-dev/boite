<script lang="ts">
  import { Archive, ArchiveRestore, CheckCheck, FolderX } from '@lucide/svelte';
  import type { Project, ThreadId } from '@boite/contracts';
  import { count as formatCount, projectName } from '../lib/format';
  import { archiveProjectWithUndo, projectMenu } from '../lib/project-menu';
  import { projectKey, type ProjectEntry } from '../lib/project-view.svelte';
  import type { Store } from '../lib/store.svelte';
  import { archiveCount, projectThreadView, type ProjectShelfKind } from '../lib/project-threads.svelte';
  import { fill, strings } from '../lib/strings';
  import { dropKey, takesDrop, threadDrag } from '../lib/thread-move.svelte';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import { longPress } from '../lib/long-press';
  import MachineIcon from './MachineIcon.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import RecentDone from './RecentDone.svelte';

  /**
   * The rows of a fold under the project list (ProjectShelf.svelte draws the
   * fold and loads this on its own, out of the entry chunk): the idle
   * projects, without a thread, or the archived ones, a step quieter. Each is
   * a card as the ones above draw it (Sidebar.svelte), its header alone, in
   * one list sorted by name whatever its machine; choosing it starts a conversation there,
   * restoring an archived project first. A row's one quick action shows under
   * the pointer (archive an idle project, restore an archived one) and its
   * full menu, removal included, opens with a right click or a long press.
   * Removal never sits on the row: a pointer reaching for the quick action
   * would land on it when the hover swaps the buttons in. An idle project that
   * still has done conversations shows their count, which unfolds that history
   * under its row. With several machines its header shows the machine's icon, as a card's does.
   * `onopen` runs once a draft or a conversation opens from the fold, so the
   * phone can show it. `onrows` receives the history conversations drawn, in
   * order, for Alt+digit, none while the fold is shut.
   */
  type Row = { store: Store; threadId: ThreadId };
  let { kind, projects, open, multi, now, scrollRoot, onopen, onrows }: {
    kind: ProjectShelfKind;
    projects: ProjectEntry[];
    open: boolean;
    multi: boolean;
    now: number;
    scrollRoot?: HTMLElement;
    onopen?: () => void;
    onrows?: (rows: Row[]) => void;
  } = $props();
  const history = ['done', 'archived'] as const;
  const uid = $props.id();
  /** The row whose action is in flight, so a second click cannot race it. */
  let busy = $state<string | null>(null);

  /** One list by name, a machine's label settling a tie: the header's icon says where each lives. */
  let rows = $derived(projects.slice().sort((a, b) => projectName(a.project).localeCompare(projectName(b.project)) || a.machine.label.localeCompare(b.machine.label)));

  const key = (machine: Machine, project: Project) => dropKey(machine.id, project.id);

  /** The rows each unfolded history last drew, by list and project; a closed one is skipped below rather than cleared. */
  let historyRows = $state.raw<Record<string, Row[]>>({});
  const observers = new Map<string, (rows: Row[]) => void>();
  const historyKey = (entry: ProjectEntry, list: (typeof history)[number]) => JSON.stringify([list, projectKey(entry)]);
  function observer(entry: ProjectEntry, list: (typeof history)[number]) {
    const at = historyKey(entry, list);
    if (!observers.has(at)) observers.set(at, rows => { historyRows = { ...historyRows, [at]: rows }; });
    return observers.get(at)!;
  }
  let reported: Row[] = [];
  $effect(() => {
    const visible = !open || kind !== 'idle' ? [] : rows.flatMap(entry => history.flatMap(list =>
      archiveCount(entry.project, list) > 0 && projectThreadView.isOpen(entry, list) ? historyRows[historyKey(entry, list)] ?? [] : []));
    if (visible.length === reported.length && visible.every((row, index) => row.store === reported[index]?.store && row.threadId === reported[index]?.threadId)) return;
    reported = visible;
    onrows?.(visible);
  });
  // Unmounted once the fold empties: the rows it reported leave Alt+digit too, as RecentDone's do.
  $effect(() => () => { if (reported.length) onrows?.([]); });

  async function run(machine: Machine, project: Project, action: () => Promise<unknown>) {
    if (busy !== null) return;
    busy = key(machine, project);
    try {
      await action();
    } finally {
      busy = null;
    }
  }

  function start(event: MouseEvent, machine: Machine, project: Project) {
    const owner = machine.store;
    // No conversation can start in a folder that is gone: the menu offers what can still be done with it.
    if (kind === 'idle' && project.missing === true) return projectMenu(event, owner, project);
    void run(machine, project, async () => {
      if (kind === 'archived' && !(await owner.archiveProject(project.id, false))) return;
      if (project.missing === true) return;
      await workspace.select(owner, undefined, project.id);
      onopen?.();
    });
  }

  /** What choosing the row does, above the folder it points at, and on which machine once several are listed. */
  function rowTitle(machine: Machine, project: Project): string {
    const action = rowAction(project);
    return multi ? `${action} · ${machine.label}` : action;
  }
  function rowAction(project: Project): string {
    if (project.missing === true) return kind === 'idle' ? strings.sidebar.projectMissing : `${strings.sidebar.restoreProject} ${projectName(project)}`;
    return fill(kind === 'idle' ? strings.sidebar.newThreadIn : strings.sidebar.restoreAndStart, { project: projectName(project) });
  }
</script>

<ul>
    {#each rows as entry (key(entry.machine, entry.project))}
      {@const { machine, project } = entry}
      {@const here = key(machine, project)}
      {@const kept = kind === 'idle' ? history.filter(list => archiveCount(project, list) > 0) : []}
      {@const controls = `${uid}-${encodeURIComponent(here)}`}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li
        class={kind}
        data-testid="{kind}-project"
        data-project-id={project.id}
        data-machine-id={machine.id}
        data-project-name={projectName(project)}
        data-thread-drop={kind === 'idle' ? '' : undefined}
        class:candidate={kind === 'idle' && takesDrop(threadDrag.current, machine.id, project.id)}
        class:drop={kind === 'idle' && threadDrag.over === here}
        aria-label={kind === 'idle' && threadDrag.over === here ? fill(strings.threadMove.dropHere, { project: projectName(project) }) : undefined}
        oncontextmenu={(event) => projectMenu(event, machine.store, project)}
        use:longPress
      >
        <div class="row">
          <button
            type="button"
            class="ghost main"
            data-testid="{kind}-project-open"
            title={`${rowTitle(machine, project)}\n${project.path}`}
            disabled={busy !== null}
            onclick={(event) => start(event, machine, project)}
          >
            <span class="tile" aria-hidden="true"><ProjectTile {project} store={machine.store} size={18} /></span>
            {#if multi}<span class="host" data-testid="project-host" class:away={machine.store.connection !== 'ready'} aria-label={machine.label}><MachineIcon icon={machine.icon} os={machine.store.core?.os} size={14} /></span>{/if}
            <span class="name ui-label" class:gone={project.missing === true}>{projectName(project)}</span>
            {#if project.missing === true}<span class="missing" title={strings.sidebar.projectMissing}><FolderX size={13} aria-label={strings.sidebar.projectMissing} /></span>{/if}
          </button>
          {#each kept as list (list)}
            {@const count = archiveCount(project, list)}
            {@const listLabel = fill(list === 'done' ? strings.sidebar.projectDoneThreads : strings.sidebar.projectArchivedThreads, { count: String(count), project: projectName(project) })}
            <button type="button" class="ghost counter {list}" class:active={projectThreadView.isOpen(entry, list)} data-testid="project-{list}-toggle" data-count={count}
              title={listLabel} aria-label={listLabel} aria-expanded={projectThreadView.isOpen(entry, list)} aria-controls="{controls}-{list}"
              onclick={() => projectThreadView.toggle(entry, list)}>
              {#if list === 'done'}<CheckCheck size={12} aria-hidden="true" />{:else}<Archive size={12} aria-hidden="true" />{/if}<span class="ui-label">{formatCount(count)}</span>
            </button>
          {/each}
          <span class="actions">
            {#if kind === 'idle'}
              {#if project.kind !== 'drafts'}
                <button
                  type="button"
                  class="ghost small icon"
                  data-testid="idle-project-archive"
                  title={strings.sidebar.archiveProject}
                  aria-label={`${strings.sidebar.archiveProject}: ${projectName(project)}`}
                  disabled={busy !== null}
                  onclick={() => void run(machine, project, () => archiveProjectWithUndo(machine.store, project))}><Archive size={13} /></button
                >
              {/if}
            {:else}
              <button
                type="button"
                class="ghost small icon"
                data-testid="archived-project-restore"
                title={strings.sidebar.restoreProject}
                aria-label={`${strings.sidebar.restoreProject} ${projectName(project)}`}
                disabled={busy !== null}
                onclick={() => void run(machine, project, () => machine.store.archiveProject(project.id, false))}><ArchiveRestore size={13} /></button
              >
            {/if}
          </span>
        </div>
        {#each kept as list (list)}
          {#if projectThreadView.isOpen(entry, list)}
            <div id="{controls}-{list}" class="history" data-testid="project-{list}">
              <RecentDone kind={list} entries={[entry]} {scrollRoot} {now} open header={false} cap={10} {onopen} onrows={observer(entry, list)} />
            </div>
          {/if}
        {/each}
      </li>
    {/each}
</ul>

<style>
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ul {
    margin: 0;
    padding: 2px 0 0;
    list-style: none;
  }
  /* A card as the open projects draw theirs (Sidebar.svelte .project): a quiet surface, its header alone. */
  li {
    margin-bottom: 8px;
    padding: 4px;
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    transition: background var(--dur-1) var(--ease-out-quint), box-shadow var(--dur-1) var(--ease-out-quint), opacity var(--dur-1) var(--ease-out-quint);
  }
  /* The card header's measures: 38 px, the 18 px tile, its 8 px gap, the name at the title size. */
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 38px;
    padding-right: 2px;
    border-radius: var(--radius-sm);
    color: var(--color-foreground);
  }
  .row:hover,
  .row:focus-within {
    background: var(--color-hover);
  }
  .main {
    flex: 1;
    min-width: 0;
    height: auto;
    min-height: 38px;
    justify-content: flex-start;
    gap: 8px;
    padding: 0 4px;
    border-color: transparent;
    color: inherit;
    font-size: inherit;
    text-align: left;
  }
  /* The row draws the hover, so the button inside it does not add a second shade. */
  .row .main:hover:not(:disabled),
  .row .main:focus-visible {
    background: transparent;
  }
  .tile {
    display: flex;
    flex: none;
  }
  .row:hover .tile,
  .row:focus-within .tile {
    opacity: 1;
  }
  .name {
    flex: 1;
    font-size: var(--text-title);
    font-weight: var(--weight-title);
    letter-spacing: -0.01em;
  }
  /* The machine, once two are listed: its icon before the name, as on a card. */
  .host { display: flex; flex: none; color: var(--color-muted-foreground); }
  .host.away { color: var(--color-danger); }
  .name.gone {
    text-decoration: line-through;
    color: var(--color-subtle);
  }
  .missing {
    display: flex;
    flex: none;
    color: var(--color-danger);
  }
  .actions {
    display: flex;
    flex: none;
    gap: 2px;
  }
  /* An archived project reads a step quieter than an idle one; under the pointer it wakes. */
  li.archived .row { color: var(--color-muted-foreground); }
  li.archived .tile { opacity: 0.55; filter: grayscale(0.6); }
  li.archived .row:hover, li.archived .row:focus-within { color: var(--color-foreground); }
  li.archived .row:hover .tile, li.archived .row:focus-within .tile { opacity: 1; filter: none; }
  li { -webkit-touch-callout: none; }
  .actions button {
    border-color: transparent;
  }
  /* A pointer sees a row's own buttons on the row it is over; a touch screen always does. Hidden, they keep their slot, so the counts beside them never move. */
  @media (hover: hover) {
    .actions {
      opacity: 0;
    }
    .row:hover .actions,
    .row:focus-within .actions {
      opacity: 1;
    }
  }
  /* Done and archived conversations an idle project still has: always shown, they are what it holds. */
  .counter {
    flex: none;
    height: 26px;
    min-width: 30px;
    padding: 0 6px;
    gap: 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  /* A project card's count (ProjectThreadCounters.svelte): the header's grey, Done's green on its mark alone, and
     open, the fill and the ink stay as long as its list does. */
  .counter.done :global(svg) {
    color: var(--color-success);
  }
  .counter.active,
  .counter.active:hover:not(:disabled) {
    background: var(--color-active);
    color: var(--color-foreground);
    background-clip: padding-box;
  }
  .history {
    padding: 0 0 2px;
  }
  @media (max-width: 720px) {
    .counter {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
      padding: 0 7px;
      gap: 5px;
    }
    /* The 44px target stays; the transparent border keeps the fill to the 32px count drawn inside it. */
    .counter { border-width: 6px 0; }
  }
  /* A dragged thread can land on an idle project: same edge and neutral fill as a project section. */
  :global(html.thread-dragging) li:not(.candidate) {
    opacity: 0.6;
  }
  li.candidate {
    box-shadow: inset 0 0 0 1px var(--color-edge);
  }
  li.drop {
    background: var(--color-accent-soft);
    box-shadow: inset 0 0 0 1px var(--color-muted-foreground);
  }
</style>
