<script lang="ts">
  import { ArchiveRestore, Folder, RotateCcw, Trash2 } from '@lucide/svelte';
  import { DEFAULT_THREAD_DONE_RETENTION_DAYS, type ThreadSummary } from '@boite/contracts';
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { archivedTime } from '../lib/archive';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { separator } from '../lib/menu';
  import { canDeleteThread } from '../lib/thread-removal';
  import { ThreadRestore } from '../lib/thread-restore.svelte';
  import { agentLabel, ago, exactTime, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { workspace } from '../lib/workspace.svelte';
  import { longPress } from '../lib/long-press';
  import { archiveKindOf } from '../lib/project-threads.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import StateRing from './StateRing.svelte';
  import ThreadPicture from './ThreadPicture.svelte';
  import ThreadState from './ThreadState.svelte';
  import { threadState } from '../lib/thread-state';

  /**
   * A done or archived conversation, drawn in the thread row's grammar on one
   * line: the ring around its picture, the title, when it was put away. The
   * branch, the pull request it ended with and the day it is deleted are the
   * row's tooltip; the pull request opens from the row's menu and from the
   * conversation's header. A list across projects adds the project under it.
   * Reopen (done) or Restore (archived) and Delete stay one hover away, in
   * plain words in their labels, as the Settings archived list offers them;
   * Delete keeps its undo toast. A right click, or a long press on a phone,
   * opens the same actions in the row's menu.
   */
  let { entry, now, showMachine = false, showProject = false, onopen }: {
    entry: ProjectEntry & { thread: ThreadSummary };
    now: number;
    showMachine?: boolean;
    /** Only in a list that spans several projects: under a project's header it would repeat it. */
    showProject?: boolean;
    onopen?: () => void;
  } = $props();
  const lock = new ThreadRestore();
  const deleting = $derived(lock.deleting !== null);
  const owner = $derived(entry.machine.store);
  const thread = $derived(entry.thread);
  const open = $derived(workspace.active === owner && owner.openThread?.id === thread.id);
  const agent = $derived(agentLabel(owner, thread));
  /** The merge that archived it, else the pull request its branch last had. */
  const pr = $derived(thread.archiveReason?.type === 'pr-merged'
    ? { number: thread.archiveReason.number, url: thread.archiveReason.url, state: 'MERGED' as const }
    : thread.pullRequest ?? null);
  const prLabel = $derived(pr ? fill(pr.state === 'MERGED' ? strings.sidebar.prMerged : pr.state === 'CLOSED' ? strings.sidebar.prClosed : strings.sidebar.prOpen, { number: String(pr.number) }) : '');
  /** A done thread is deleted after the retention: when, on its meta line, as the Settings list said it. */
  const expiry = $derived.by(() => {
    const days = owner.settings?.threadDoneRetentionDays ?? DEFAULT_THREAD_DONE_RETENTION_DAYS;
    return thread.doneAt != null && days > 0 ? thread.doneAt + days * 86_400_000 : null;
  });
  const meta = $derived(showProject);
  /** The row's tooltip: its lines, the way a live row's tooltip holds what its one line leaves out. */
  const tooltip = $derived([thread.title, thread.branch, prLabel, expiry !== null ? fill(strings.settings.archived.deletesAt, { date: exactTime(expiry) }) : null].filter(Boolean).join('\n'));
  /** Archived by hand, not finished: work left to pick up reads as plainly as an open row. */
  const pending = $derived(archiveKindOf(thread) === 'archived');
  /** Done comes back with Reopen, archived with Restore: one verb per list. */
  const back = $derived(pending ? { label: strings.sidebar.restoreThread, named: strings.sidebar.restoreNamedThread } : { label: strings.sidebar.reopenThread, named: strings.sidebar.reopenNamedThread });
  const offline = $derived(owner.connection !== 'ready');
  const deletable = $derived(canDeleteThread(thread));

  function restore(): void {
    void lock.restore(owner, thread.id);
  }
  /** The row stays until the list reloads, its lock with it. */
  function remove(): void {
    void lock.remove(owner, thread, true);
  }
  function select(): void {
    // Being deleted, or gone already: there is no thread left to open.
    if (deleting) return;
    onopen?.();
    void workspace.select(owner, thread.id);
  }
  /** The row's own menu: Open, Restore or Reopen, the pull request, the path, Delete. */
  function menu(event: MouseEvent): void {
    const offline = owner.connection !== 'ready';
    contextMenu.open(
      event,
      [
        { id: 'open', label: strings.common.open, disabled: deleting },
        { id: 'restore', label: back.label, disabled: lock.busy || offline },
        ...(pr ? [{ id: 'pr', label: prLabel, title: pr.url }] : []),
        // On hover: a worktree path printed beside the label squeezes it into a column of letters.
        { id: 'copy', label: strings.sidebar.copyPath, title: thread.cwd },
        ...(deletable ? [separator(), { id: 'delete', label: strings.common.delete, danger: true, disabled: lock.busy || offline }] : [])
      ],
      (action) => {
        if (action === 'open') select();
        if (action === 'restore') restore();
        if (action === 'pr' && pr) window.open(pr.url, '_blank', 'noopener,noreferrer');
        if (action === 'copy') void owner.copy(thread.cwd);
        if (action === 'delete') remove();
      }
    );
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="done-thread" class:open class:meta class:pending data-testid="done-thread" data-thread-id={thread.id} data-machine-id={entry.machine.id} oncontextmenu={menu} use:longPress>
  {#snippet when()}
    {#if thread.status !== 'idle'}<ThreadState {thread} {now} away={owner.connection !== 'ready'} />{:else}<time datetime={new Date(archivedTime(thread)).toISOString()} title={exactTime(archivedTime(thread))}>{ago(archivedTime(thread), now)}</time>{/if}
  {/snippet}
  {#snippet machineMark()}
    <span class="machine" data-testid="done-thread-machine" title={entry.machine.label} aria-label={entry.machine.label}><MachineIcon icon={entry.machine.icon} os={owner.core?.os} size={meta ? 12 : 13} /></span>
  {/snippet}
  <button type="button" class="ghost row" data-testid="done-thread-open" title={tooltip} disabled={deleting} onclick={select}>
    <span class="headline">
      {#if showMachine && !meta}{@render machineMark()}{/if}
      <span class="provider" title={agent} aria-label={agent}><StateRing kind={threadState(thread)} stale={offline} ground="var(--ring-ground, var(--color-frame))"><ThreadPicture {owner} {thread} size={16} logo={13} /></StateRing></span>
      <span class="title ui-label">{thread.title}</span>
      {#if !meta}{@render when()}{/if}
    </span>
    <!-- Across projects, as the live rows above it: the title alone on its line, then the project, the machine and the time. -->
    {#if meta}
      <span class="facts">
        <span class="known">
          <span class="project-name" data-testid="done-thread-project" title={entry.project.path}><Folder size={12} /><span class="ui-label">{projectName(entry.project)}</span></span>
          {#if showMachine}{@render machineMark()}{/if}
        </span>
        <span class="trail" data-testid="done-thread-trail">{@render when()}</span>
      </span>
    {/if}
  </button>
  <span class="actions">
    <button type="button" class="ghost small icon restore" data-testid="done-thread-restore" title={back.label}
      aria-label={fill(back.named, { title: thread.title })}
      disabled={lock.busy || offline} onclick={restore}>{#if pending}<ArchiveRestore size={14} />{:else}<RotateCcw size={14} />{/if}</button>
    {#if deletable}<button type="button" class="ghost small icon remove" data-testid="done-thread-delete" title={strings.common.delete}
      aria-label={fill(strings.sidebar.deleteNamedThread, { title: thread.title })}
      disabled={lock.busy || offline} onclick={remove}><Trash2 size={14} /></button>{/if}
  </span>
</div>

<style>
  .done-thread {
    position: relative;
    border-radius: var(--radius-md);
    transition: background var(--dur-2) var(--ease-out-quint);
    -webkit-touch-callout: none;
  }
  .done-thread:hover, .done-thread:focus-within { background: var(--color-hover); }
  .done-thread.open { background: var(--color-active); }
  /* The thread row's measures: 30 px a line, 44 px with the project under it. */
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: auto;
    min-height: 30px;
    padding: 3.5px 6px 3.5px 4px;
    gap: 0;
    background: transparent;
  }
  .meta .row { min-height: 44px; justify-content: center; gap: 2px; padding: 3px 8px 3px 4px; }
  /* A 20 px ring and a 14 px title, as the live rows across projects. */
  .meta .provider :global([data-testid='state-ring']) { --ring-air: 0.5px; }
  .meta .title { font-size: var(--text-base); }
  .row:hover:not(:disabled) { background: transparent; }
  .row:active:not(:disabled) { transform: none; }
  .headline { display: flex; align-items: center; min-width: 0; min-height: 1lh; gap: 6px; font-size: var(--text-sm); }
  .provider, .machine { display: inline-flex; align-items: center; flex: none; color: var(--color-muted-foreground); }
  /* Finished work reads a step quieter than the live rows above it, and wakes under the pointer. */
  .provider { opacity: .7; }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted-foreground);
    font-weight: 400;
    transition: color var(--dur-2) var(--ease-out-quint);
  }
  .done-thread:hover .title, .done-thread:focus-within .title, .done-thread.open .title { color: var(--color-foreground); }
  .done-thread:hover .provider, .done-thread:focus-within .provider, .pending .provider { opacity: 1; }
  .pending .title { color: var(--color-foreground); }
  time { flex: none; color: var(--color-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  /* The second line starts under the title, past the 20 px ring and its 6 px gap; the time ends it on the right. */
  .facts {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 16px;
    padding-left: 26px;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .known { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; }
  .trail { display: flex; flex: none; align-items: center; }
  .trail :global(.when) { min-width: 3.2ch; justify-content: flex-end; text-align: right; }
  .project-name { display: flex; flex: 0 1 auto; align-items: center; gap: 4px; min-width: 0; }
  .project-name span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .facts :global(svg) { flex: none; }
  /* Restoring takes the time's place under the pointer, the way a thread row shows its menu. */
  .actions { position: absolute; top: 2px; right: 3px; display: flex; gap: 1px; opacity: 0; }
  .actions button { background: var(--color-surface-2); color: var(--color-muted-foreground); }
  .actions .remove:hover:not(:disabled) { color: var(--color-danger); }
  .done-thread:hover .actions, .done-thread:focus-within .actions { opacity: 1; }
  .done-thread:not(.meta):hover time, .done-thread:not(.meta):focus-within time,
  .done-thread:not(.meta):hover :global(.when), .done-thread:not(.meta):focus-within :global(.when) { opacity: 0; }
  /* Across projects the time sits on the second line, clear of the buttons: the hover keeps the title clear of them instead. */
  .meta:hover .headline, .meta:focus-within .headline { padding-right: 52px; }
  /* No hover on a touch screen: the time stays, restoring is in the long-press menu. */
  @media (hover: none), (pointer: coarse) {
    .actions { display: none; }
    .done-thread:hover time, .done-thread:focus-within time,
    .done-thread:hover :global(.when), .done-thread:focus-within :global(.when) { opacity: 1; }
  }
  @media (max-width: 720px) {
    .row { min-height: var(--touch-target); }
    .title { font-size: var(--text-base); }
    /* A phone's rows keep the time at the title's end, the project under it, as its live rows do. */
    .meta .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 6px; align-content: center; }
    .meta .headline { grid-area: 1 / 1; }
    .meta .facts { display: contents; }
    .meta .known { grid-area: 2 / 1 / 3 / 3; padding-left: 26px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
    .meta .trail { grid-area: 1 / 2; }
  }
</style>
