<script lang="ts">
  import { ArchiveRestore, Ellipsis, Folder, GitMerge, GitPullRequest, GitPullRequestClosed, Puzzle, Trash2 } from '@lucide/svelte';
  import { DEFAULT_THREAD_DONE_RETENTION_DAYS, type Project, type ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { archivedTime } from '../lib/archive';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { separator, type MenuItem } from '../lib/menu';
  import { canDeleteThread } from '../lib/thread-removal';
  import { ThreadRestore } from '../lib/thread-restore.svelte';
  import { agentLabel, ago, exactTime, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import { longPress } from '../lib/long-press';
  import MachineIcon from './MachineIcon.svelte';
  import Menu from './Menu.svelte';

  /**
   * A done or archived conversation, drawn like a thread row and on its column: the title
   * (the agent only in its tooltip), when it was put away, and under it the pull request it ended
   * with, which opens on the forge. The row reads the conversation and its
   * actions keep restoration separate.
   */
  let { owner, thread, now, machine, project, archive, onopen }: {
    owner: Store;
    thread: ThreadSummary;
    now: number;
    machine?: Machine;
    /** In a list that spans several projects, where the header does not name it already. */
    project?: Project;
    archive?: { lock: ThreadRestore; restored: (summary: ThreadSummary) => void; removed: (thread: ThreadSummary) => void };
    onopen?: () => void;
  } = $props();
  const rowLock = new ThreadRestore();
  const lock = $derived(archive?.lock ?? rowLock);
  const deleting = $derived(lock.deleting === thread.id);
  const open = $derived(workspace.active === owner && owner.openThread?.id === thread.id);
  const agent = $derived(agentLabel(owner, thread));
  const reason = $derived(thread.archiveReason);
  const at = $derived(reason?.archivedAt ?? archivedTime(thread));
  /** The merge that archived it, else the pull request its branch last had. */
  const pr = $derived(reason?.type === 'pr-merged'
    ? { number: reason.number, url: reason.url, state: 'MERGED' as const }
    : thread.pullRequest ?? null);
  const prLabel = $derived(pr ? fill(archive && reason?.type === 'pr-merged' ? strings.settings.archived.mergedReason : pr.state === 'MERGED' ? strings.sidebar.prMerged : pr.state === 'CLOSED' ? strings.sidebar.prClosed : strings.sidebar.prOpen, { number: String(pr.number) }) : '');
  /** The plugin that marked it done (`threads.archive`), so a row that went by itself says why. */
  const plugin = $derived(reason?.type === 'plugin' ? reason : null);
  const byPlugin = $derived(plugin && fill(strings.sidebar.archivedByPlugin, { name: plugin.pluginName }));
  const retention = $derived(owner.settings?.threadDoneRetentionDays ?? DEFAULT_THREAD_DONE_RETENTION_DAYS);
  const expires = $derived(archive && thread.doneAt != null && retention > 0 ? thread.doneAt + retention * 86_400_000 : null);
  const meta = $derived(project || pr || plugin || expires !== null);
  const offline = $derived(owner.connection !== 'ready');
  const restoreLabel = $derived(archive ? strings.settings.archived.restore : strings.sidebar.reopenThread);
  const items = $derived<MenuItem[]>([
    { id: 'open', label: strings.common.open, disabled: deleting },
    ...(thread.archived ? [{ id: 'restore', label: restoreLabel, glyph: ArchiveRestore, disabled: lock.busy || offline, testid: 'archived-menu-restore' }] : []),
    ...(pr ? [{ id: 'pr', label: prLabel, title: pr.url }] : []),
    { id: 'copy', label: strings.sidebar.copyPath, title: thread.cwd },
    ...(canDeleteThread(thread) ? [separator(), { id: 'delete', label: strings.common.delete, glyph: Trash2, danger: true, disabled: lock.busy || offline, testid: 'archived-delete' }] : [])
  ]);

  async function restore(): Promise<void> {
    const summary = await lock.restore(owner, thread.id);
    if (summary) archive?.restored(summary);
  }
  /** The row stays until the list reloads, its lock with it. */
  async function remove(): Promise<void> {
    const removed = thread;
    if (await lock.remove(owner, removed, !archive)) archive?.removed(removed);
  }
  function select(): void {
    // Being deleted, or gone already: there is no thread left to open.
    if (deleting) return;
    onopen?.();
    void workspace.select(owner, thread.id);
  }
  function pick(action: string): void {
    if (action === 'open') select();
    if (action === 'restore') void restore();
    if (action === 'pr' && pr) window.open(pr.url, '_blank', 'noopener,noreferrer');
    if (action === 'copy') void owner.copy(thread.cwd);
    if (action === 'delete') void remove();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="done-thread" class:open class:archived-list-row={archive !== undefined} data-testid="done-thread" data-thread-id={thread.id} data-machine-id={machine?.id ?? workspace.machines.find(m => m.store === owner)?.id}
  oncontextmenu={(event) => contextMenu.open(event, items, pick)} use:longPress={(target) => !!target.closest('.row')}>
  <button type="button" class="ghost row" data-testid={archive ? 'archived-open' : 'done-thread-open'} title="{thread.title} · {agent}" disabled={deleting} onclick={select}>
    <span class="headline">
      {#if machine}
        <span class="machine" title={machine.label} aria-label={machine.label}><MachineIcon icon={machine.icon} os={owner.core?.os} /></span>
      {/if}
      <span class="title ui-label">{thread.title}</span>
      <!-- The project shows below, outside the button: named here too, so two same-titled threads read apart. -->
      {#if project}<span class="visually-hidden">{projectName(project)}</span>{/if}
      <!-- Put away, it carries no live state, a turn still running included: when it was put away. -->
      {#if thread.archived}<time datetime={new Date(at).toISOString()} title={exactTime(at)}>{ago(at, now)}</time>{/if}
    </span>
  </button>
  {#if meta}
    <div class="metadata">
      {#if project}<span class="project-name" title={project.path}><Folder size={12} /><span class="ui-label">{projectName(project)}</span></span>{/if}
      <!-- The puzzle and the plugin's name; the sentence is for the tooltip and screen readers. -->
      {#if plugin}<span class="by-plugin" data-testid={archive ? 'archive-plugin-reason' : 'done-thread-plugin'} title={archive ? plugin.pluginId : byPlugin}><Puzzle size={12} /><span class="ui-label" aria-hidden="true">{plugin.pluginName}</span><span class="visually-hidden">{byPlugin}</span></span>{/if}
      {#if pr}
        <span data-testid={archive && reason?.type === 'pr-merged' ? 'archive-merged-reason' : undefined}><a class="pr {pr.state.toLowerCase()}" data-testid="done-thread-pr" data-state={pr.state} href={pr.url} target="_blank" rel="noopener noreferrer" title={pr.url}>
          {#if pr.state === 'MERGED'}<GitMerge size={12} />{:else if pr.state === 'CLOSED'}<GitPullRequestClosed size={12} />{:else}<GitPullRequest size={12} />{/if}<span class="ui-label">{prLabel}</span>
        </a></span>
      {/if}
      {#if expires !== null}<span data-testid="done-expires">{fill(strings.settings.archived.deletesAt, { date: exactTime(expires) })}</span>{/if}
    </div>
  {/if}
  <div class="actions">
    {#if thread.archived}<button type="button" class="ghost small icon restore" data-testid={archive ? 'archived-restore' : 'done-thread-restore'} title={restoreLabel}
      aria-label={fill(strings.sidebar.reopenNamedThread, { title: thread.title })} disabled={lock.busy || offline} onclick={() => void restore()}><ArchiveRestore size={14} /></button>{/if}
    <Menu {items} onpick={pick} label={strings.sidebar.threadMenu} placement="bottom" align="end" variant="ghost" testid={archive ? `archived-menu-${thread.id}` : 'done-thread-menu'}><Ellipsis size={15} /></Menu>
  </div>
</div>

<style>
  .done-thread {
    /* The thread row's own measures (ThreadCard.svelte), so both lists share one column and one height. */
    --pad-x: 8px;
    position: relative;
    font-size: 13.5px;
    border-radius: var(--radius-md);
    transition: background var(--dur-2) var(--ease-out-quint);
    -webkit-touch-callout: none;
  }
  .done-thread:hover, .done-thread:focus-within { background: var(--color-hover); }
  .done-thread.open { background: var(--color-active); }
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: auto;
    min-height: 32px;
    padding: 6px calc(2 * max(var(--control-sm), var(--icon-button-target)) + var(--pad-x)) 6px var(--pad-x);
    gap: 4px;
    background: transparent;
  }
  .row::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
  .row:hover:not(:disabled) { background: transparent; }
  .row:active:not(:disabled) { transform: none; }
  .headline { display: flex; align-items: center; min-width: 0; min-height: 20px; gap: 8px; }
  .machine { display: inline-flex; align-items: center; flex: none; color: var(--color-muted-foreground); }
  /* Done or archived, put away: a step quieter than the live rows above it (lighter ink, regular weight), and it
     wakes under the pointer. */
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-subtle);
    font-weight: 400;
    transition: color var(--dur-2) var(--ease-out-quint);
  }
  .done-thread:hover .title, .done-thread:focus-within .title, .done-thread.open .title { color: var(--color-foreground); }
  time { flex: none; color: var(--color-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .metadata {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    padding: 0 var(--pad-x) 8px;
    gap: 9px;
    min-width: 0;
    pointer-events: none;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .project-name { display: flex; flex: 1; align-items: center; gap: 4px; min-width: 0; }
  .project-name span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .metadata :global(svg) { flex: none; }
  .by-plugin { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 4px; min-width: 0; }
  .by-plugin .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pr {
    position: relative;
    z-index: 1;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    pointer-events: auto;
    color: var(--color-success);
    text-decoration: none;
    border-radius: var(--radius-sm);
  }
  /* The badge's softened red (PullRequestBadge.svelte): a closed pull request is read, never shouted. */
  .pr.closed { color: color-mix(in oklch, var(--color-danger) 60%, var(--color-muted-foreground)); }
  .pr:hover span, .pr:focus-visible span { text-decoration: underline; text-underline-offset: 3px; }
  .actions { position: absolute; display: flex; align-items: center; top: 0; right: 0; opacity: 0; }
  .done-thread:is(:hover, :focus-within) .actions { opacity: 1; }
  .archived-list-row .title { white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  @media (hover: none), (pointer: coarse) {
    .actions { opacity: 1; }
  }
  @media (max-width: 720px) {
    .row { min-height: var(--touch-target); }
    .actions :is(.restore, :global(.trigger)) { min-height: var(--touch-target); min-width: var(--touch-target); }
    .title { font-size: var(--text-base); }
  }
</style>
