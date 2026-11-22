<script lang="ts">
  import { onDestroy } from 'svelte';
  import { errorText } from '../lib/errors';
  import { type ThreadId, type ThreadSummary } from '@boite/contracts';
  import DoneThread from './DoneThread.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { archivedThreads, archivedTime } from '../lib/archive';
  import { projectThread } from '../lib/thread-rows';
  import { SnapshotReads } from '../lib/store/snapshot-reads';
  import { ThreadRestore } from '../lib/thread-restore.svelte';
  import { projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { archivedFocus, clearArchivedFocus } from '../lib/archived-focus.svelte';

  let { store, place = 'list', onopen }: { store: Store; place?: 'phone' | 'list'; onopen?: () => void } = $props();

  let threads = $state<ThreadSummary[] | null>(null);
  let loading = $state(false);
  const lock = new ThreadRestore();
  /** One automatic ask per connection: a failed read leaves the button for another user ask. */
  let asked = false;
  const removed = new Set<ThreadId>();
  const rows = new Set<ThreadId>();
  const reads = new SnapshotReads<ThreadSummary>(thread => thread.projectId ?? '');
  $effect(() => {
    void store.connection;
    const client = store.client;
    const generation = store.clientGeneration;
    const current = () => store.client === client && store.clientGeneration === generation;
    threads = null;
    loading = false;
    restored = [];
    lock.reset();
    asked = false;
    removed.clear();
    rows.clear();
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

  $effect(() => {
    if (asked || store.connection !== 'ready') return;
    asked = true;
    void load();
  });

  async function load() {
    const client = store.client;
    const generation = store.clientGeneration;
    const read = reads.begin();
    loading = true;
    try {
      const answer = await archivedThreads(store);
      if (store.client === client && store.clientGeneration === generation && read.active) {
        threads = read.apply(answer, threads ?? []).filter(t => !removed.has(t.id)).sort((a, b) => archivedTime(b) - archivedTime(a));
        rows.clear();
        for (const thread of threads) rows.add(thread.id);
      }
    } catch (error) {
      if (store.client === client && store.clientGeneration === generation) store.error = errorText(error);
    } finally {
      read.cancel();
      if (store.client === client && store.clientGeneration === generation) loading = false;
    }
  }

  /** Restored rows stay, their button now Open: a restore is usually followed by reading it. */
  let restored = $state<ThreadId[]>([]);

  function onRestored(summary: ThreadSummary) {
    threads = threads?.map(row => row.id === summary.id ? summary : row) ?? null;
    restored = [...restored, summary.id];
  }

  function onRemoved(removed: ThreadSummary) {
    threads = threads?.filter(row => row.id !== removed.id) ?? null;
  }

  const archive = { lock, restored: onRestored, removed: onRemoved };

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
  onDestroy(() => { if (archivedFocus.store === store && place === 'phone') clearArchivedFocus(); });

</script>

<section class={place === 'list' ? 'in-list' : 'card'} data-testid="archived-threads">
  {#if focusId && focusName}
    <p class="focus" data-testid="archived-focus">
      <span class="ui-label">{fill(strings.settings.archived.inProject, { project: focusName })}</span>
      <button type="button" class="ghost small" data-testid="archived-all" onclick={clearArchivedFocus}><span class="ui-label">{strings.settings.archived.allProjects}</span></button>
    </p>
  {/if}
  {#if shown === null}
    <button type="button" data-testid="archived-retry" disabled={loading || store.connection !== 'ready'} onclick={() => void load()}>
      <span class="ui-label">{loading ? strings.app.loading : strings.common.retry}</span>
    </button>
  {:else if shown.length === 0}
    <p class="muted" data-testid="archived-empty">{focusName ? fill(strings.settings.archived.emptyProject, { project: focusName }) : strings.settings.archived.empty}</p>
  {:else}
    <ul class="archived" data-testid="archived-list">
      {#each shown as thread (thread.id)}
        <li data-thread-id={thread.id}>
          <DoneThread owner={store} {thread} now={minuteClock.now} project={focusId ? undefined : store.projects.find(p => p.id === thread.projectId)} {archive} {onopen} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .focus {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 6px;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  .archived { display: flex; flex-direction: column; gap: 2px; list-style: none; margin: 0; padding: 0; }
  .in-list .focus { padding: 0 2px 0 8px; }
  .in-list .muted { margin: 0; padding: 12px 8px; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .in-list > button { margin: 4px 8px; }
</style>
