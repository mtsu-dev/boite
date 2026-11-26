<script lang="ts">
  import { untrack } from 'svelte';
  import { ArchiveRestore, Folder, GitMerge, GitPullRequest, GitPullRequestClosed, Puzzle, Trash2 } from '@lucide/svelte';
  import { errorText } from '../lib/errors';
  import { DEFAULT_THREAD_DONE_RETENTION_DAYS, type ThreadId, type ThreadSummary } from '@boite/contracts';
  import SettingsSection from './SettingsSection.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { archivedThreads, archivedTime } from '../lib/archive';
  import { projectThread } from '../lib/thread-rows';
  import { SnapshotReads } from '../lib/store/snapshot-reads';
  import { canDeleteThread } from '../lib/thread-removal';
  import { ThreadRestore } from '../lib/thread-restore.svelte';
  import { ago, exactTime, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { archivedFocus, clearArchivedFocus, holdArchivedFocus } from '../lib/archived-focus.svelte';

  /**
   * The archive's card in Settings, General on a desktop and a page of its own on a phone: every archived thread
   * of one machine, with where it was, why it left and when it goes, Restore and Delete in sight on each row.
   * `eager` reads the list at once (the phone's page, a jump to this card); otherwise it waits for Show.
   */
  let { store, eager = true, showTitle = true, onopen }: { store: Store; eager?: boolean; showTitle?: boolean; onopen?: () => void } = $props();

  let threads = $state<ThreadSummary[] | null>(null);
  let loading = $state(false);
  const lock = new ThreadRestore();
  let listOwner: Store | undefined;
  let listIdentity: string | undefined;
  const removed = new Set<ThreadId>();
  const rows = new Set<ThreadId>();
  const reads = new SnapshotReads<ThreadSummary>(thread => thread.projectId ?? '');
  $effect(() => {
    const owner = store;
    const online = owner.connection === 'ready';
    const client = owner.client;
    const generation = store.clientGeneration;
    const current = () => store === owner && owner.client === client && owner.clientGeneration === generation;
    const identity = store.core ? JSON.stringify([store.core.coreId, store.principal]) : undefined;
    untrack(() => {
      if (listOwner !== store || (identity !== undefined && listIdentity !== identity)) {
        threads = null;
        restored = [];
        rows.clear();
      }
      if (listOwner !== store || identity !== undefined) listIdentity = identity;
      listOwner = store;
    });
    loading = false;
    lock.reset();
    removed.clear();
    reads.clear();
    const offRemove = client?.on('thread.removed', ({ threadId }) => {
      if (!current()) return;
      removed.add(threadId);
      reads.change(threadId, null);
      if (rows.delete(threadId)) threads = threads?.filter(t => t.id !== threadId) ?? null;
      restored = restored.filter(id => id !== threadId);
    });
    const offRestore = client?.on('thread.created', summary => {
      if (!current() || !removed.delete(summary.id)) return;
      reconcile(summary);
    });
    const offUpdate = client?.on('thread.updated', summary => { if (current()) reconcile(summary); });
    if (online && (eager || untrack(() => threads) !== null)) untrack(() => void load());
    return () => { offRemove?.(); offRestore?.(); offUpdate?.(); reads.clear(); };
  });

  function reconcile(summary: ThreadSummary) {
    const held = rows.has(summary.id);
    const keep = !removed.has(summary.id) && (!summary.parentThreadId || projectThread(summary, store.threads.find(t => t.id === summary.parentThreadId))) &&
      (summary.archived || (held && (lock.restoring === summary.id || lock.deleting === summary.id || restored.includes(summary.id))));
    reads.change(summary.id, keep ? summary : null);
    if (threads === null) return;
    // Load samples from unrelated active threads must not rebuild the archive.
    if (!keep) {
      if (!rows.delete(summary.id)) return;
      threads = threads.filter(row => row.id !== summary.id);
      restored = restored.filter(id => id !== summary.id);
      return;
    }
    if (summary.archived) restored = restored.filter(id => id !== summary.id);
    rows.add(summary.id);
    const prior = threads.find(row => row.id === summary.id);
    // A row keeps its place while its archive time stands: a load sample or a restore moves nothing.
    if (prior && (!summary.archived || archivedTime(prior) === archivedTime(summary))) {
      threads = threads.map(row => row.id === summary.id ? summary : row);
      return;
    }
    // A newcomer, or a row archived again, takes its place by archive time: one put away earlier elsewhere does not jump to the top.
    const rest = threads.filter(row => row.id !== summary.id);
    const at = rest.findIndex(row => archivedTime(row) < archivedTime(summary));
    threads = at < 0 ? [...rest, summary] : [...rest.slice(0, at), summary, ...rest.slice(at)];
  }

  async function load() {
    const owner = store;
    const client = owner.client;
    const generation = owner.clientGeneration;
    const current = () => store === owner && owner.client === client && owner.clientGeneration === generation;
    const read = reads.begin();
    loading = true;
    try {
      const answer = await archivedThreads(owner);
      if (current() && read.active) {
        const prior = threads ?? [];
        const next = read.apply(answer, prior).filter(t => !removed.has(t.id));
        const seen = new Set(next.map(thread => thread.id));
        const rearchived = new Set(next.filter(thread => thread.archived).map(thread => thread.id));
        if (rearchived.size) restored = restored.filter(id => !rearchived.has(id));
        const kept = new Set([...restored, lock.restoring].filter(id => id !== null));
        threads = [...next, ...prior.filter(t => kept.has(t.id) && !removed.has(t.id) && !seen.has(t.id))]
          .sort((a, b) => archivedTime(b) - archivedTime(a));
        rows.clear();
        for (const thread of threads) rows.add(thread.id);
      }
    } catch (error) {
      if (current()) store.error = errorText(error);
    } finally {
      read.cancel();
      if (current()) loading = false;
    }
  }

  /** Restored rows stay, their button now Open: a restore is usually followed by reading it. */
  let restored = $state<ThreadId[]>([]);

  async function restore(thread: ThreadSummary) {
    const owner = store;
    const generation = store.clientGeneration;
    const summary = await lock.restore(owner, thread.id);
    if (!summary || store !== owner || store.clientGeneration !== generation || removed.has(thread.id)) return;
    threads = threads?.map(row => row.id === summary.id ? summary : row) ?? null;
    restored = [...restored, thread.id];
  }

  async function remove(thread: ThreadSummary) {
    if (await lock.remove(store, thread)) threads = threads?.filter(row => row.id !== thread.id) ?? null;
  }

  /** Archived, it opens read-only, its notice offering Restore; restored, it opens as any thread. */
  function open(thread: ThreadSummary) {
    if (lock.deleting === thread.id) return;
    onopen?.();
    void workspace.select(store, thread.id);
  }

  function projectOf(thread: ThreadSummary) {
    return store.projects.find(p => p.id === thread.projectId);
  }

  /** Opened from a project card's menu: that project's threads, until All projects or the archive closes. */
  const focusId = $derived.by(() => {
    const id = archivedFocus.store === store ? archivedFocus.projectId : null;
    // A project removed while the archive is open lets go of the focus: every project shows, not an empty list.
    return id && store.projects.some(p => p.id === id) ? id : null;
  });
  const focusName = $derived.by(() => {
    const project = focusId ? store.projects.find(p => p.id === focusId) : undefined;
    return project ? projectName(project) : '';
  });
  const shown = $derived(threads && focusId ? threads.filter(t => t.projectId === focusId) : threads);
  // Settings left, or the card moved to another machine: the next opening shows every project again.
  $effect(() => holdArchivedFocus(store));

</script>

<SettingsSection id="settings-archived" testid="archived-threads" title={showTitle ? strings.settings.archived.heading : undefined} info={strings.settings.archived.intro}>
  {#if focusId && focusName}
    <p class="focus" data-testid="archived-focus">
      <span class="ui-label">{fill(strings.settings.archived.inProject, { project: focusName })}</span>
      <button type="button" class="ghost small" data-testid="archived-all" onclick={clearArchivedFocus}><span class="ui-label">{strings.settings.archived.allProjects}</span></button>
    </p>
  {/if}
  {#if shown === null}
    <button type="button" data-testid="archived-show" disabled={loading || store.connection !== 'ready'} onclick={() => void load()}>
      <span class="ui-label">{loading ? strings.app.loading : strings.settings.archived.show}</span>
    </button>
  {:else if shown.length === 0}
    <p class="muted" data-testid="archived-empty">{focusName ? fill(strings.settings.archived.emptyProject, { project: focusName }) : strings.settings.archived.empty}</p>
  {:else}
    {@const retention = store.settings?.threadDoneRetentionDays ?? DEFAULT_THREAD_DONE_RETENTION_DAYS}
    {@const offline = store.connection !== 'ready'}
    <!-- One row per thread: its title (which opens it) and since when, then where it was, why it left and
         when it goes, Restore and Delete in sight at the end. -->
    <ul class="archived" data-testid="archived-list">
      {#each shown as thread (thread.id)}
        {@const reason = thread.archiveReason}
        {@const at = reason?.archivedAt ?? archivedTime(thread)}
        {@const project = focusId ? undefined : projectOf(thread)}
        {@const back = restored.includes(thread.id)}
        <li data-thread-id={thread.id} class:back aria-busy={lock.restoring === thread.id}>
          <span class="headline">
            <button type="button" class="text title" data-testid="archived-title" title={thread.title} disabled={lock.deleting === thread.id} onclick={() => open(thread)}>{thread.title}</button>
            <time datetime={new Date(at).toISOString()} title={exactTime(at)}>{ago(at, minuteClock.now)}</time>
          </span>
          <span class="context">
            {#if project}<span class="part" title={project.path}><Folder size={12} /><span class="ui-label">{projectName(project)}</span></span>{/if}
            {#if reason?.type === 'pr-merged'}
              <span class="part archive-reason" data-testid="archive-merged-reason"><GitMerge size={12} /><a href={reason.url} target="_blank" rel="noopener noreferrer">{fill(strings.settings.archived.mergedReason, { number: String(reason.number) })}</a></span>
            {:else}
              {#if reason?.type === 'plugin'}
                <span class="part archive-reason" data-testid="archive-plugin-reason" title={reason.pluginId}><Puzzle size={12} /><span class="ui-label">{fill(strings.sidebar.archivedByPlugin, { name: reason.pluginName })}</span></span>
              {/if}
              <!-- The pull request its branch last had, open, merged or closed. -->
              {#if thread.pullRequest}
                {@const pr = thread.pullRequest}
                <a class="part pr {pr.state.toLowerCase()}" data-testid="archived-pr" href={pr.url} target="_blank" rel="noopener noreferrer" title={pr.url}>
                  {#if pr.state === 'MERGED'}<GitMerge size={12} />{:else if pr.state === 'CLOSED'}<GitPullRequestClosed size={12} />{:else}<GitPullRequest size={12} />{/if}
                  <span class="ui-label">{fill(pr.state === 'MERGED' ? strings.sidebar.prMerged : pr.state === 'CLOSED' ? strings.sidebar.prClosed : strings.sidebar.prOpen, { number: String(pr.number) })}</span>
                </a>
              {/if}
            {/if}
            {#if thread.doneAt != null && retention > 0}
              <span class="part" data-testid="done-expires">{fill(strings.settings.archived.deletesAt, { date: exactTime(thread.doneAt + retention * 86_400_000) })}</span>
            {/if}
          </span>
          <span class="actions">
            {#if back}
              <button type="button" class="small" data-testid="archived-open" onclick={() => open(thread)}><span class="ui-label">{strings.common.open}</span></button>
            {:else}
              <button type="button" class="small" data-testid="archived-restore" disabled={lock.busy || offline} onclick={() => void restore(thread)}><ArchiveRestore size={14} /><span class="ui-label">{lock.restoring === thread.id ? strings.app.loading : strings.settings.archived.restore}</span></button>
            {/if}
            {#if canDeleteThread(thread)}
              <button type="button" class="ghost small danger" data-testid="archived-delete" disabled={lock.busy || offline} onclick={() => void remove(thread)}><Trash2 size={14} /><span class="ui-label">{strings.common.delete}</span></button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</SettingsSection>

<style>
  .focus {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
    padding: var(--space-3) 0;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  .muted { margin: 0; padding: var(--space-3) 0; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  [data-testid=archived-show] { margin: var(--space-3) 0; }
  .archived { display: flex; flex-direction: column; list-style: none; margin: 0; padding: 0; }
  /* The card's own rows: a line between every two, as between its settings (styles/settings.css). */
  .archived li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px 12px;
    padding: var(--space-3) 0;
  }
  .archived li + li { border-top: 1px solid var(--color-border); }
  .headline { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .title {
    flex: 1;
    min-width: 0;
    padding: 0;
    justify-content: flex-start;
    text-align: left;
    overflow-wrap: anywhere;
    white-space: normal;
    line-height: 1.45;
    color: var(--color-foreground);
  }
  @media (hover: hover) {
    .title:hover:not(:disabled) { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
  }
  time { flex: none; color: var(--color-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .context {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    min-width: 0;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
  }
  .part { display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
  .part :global(svg) { flex: none; }
  .archive-reason a { color: inherit; text-underline-offset: 3px; }
  /* The thread rows' colours (DoneThread.svelte): merged and open in the success ink, a closed one softened. */
  .pr { color: var(--color-success); text-decoration: none; }
  .pr.closed { color: color-mix(in oklch, var(--color-danger) 60%, var(--color-muted-foreground)); }
  .pr:hover span, .pr:focus-visible span { text-decoration: underline; text-underline-offset: 3px; }
  .actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
  @media (max-width: 720px) {
    .archived li { grid-template-columns: minmax(0, 1fr); }
    .actions { justify-content: flex-start; }
    .actions button { min-height: var(--touch-target); }
    .title { font-size: var(--text-base); }
  }
</style>
