<script lang="ts">
  import { errorText } from '../lib/errors';
  import { Ellipsis, RotateCcw, Trash2 } from '@lucide/svelte';
  import { DEFAULT_THREAD_DONE_RETENTION_DAYS, type ThreadId, type ThreadSummary } from '@boite/contracts';
  import InfoTip from './InfoTip.svelte';
  import Menu from './Menu.svelte';
  import DeletedThreads from './DeletedThreads.svelte';
  import { archivedThreads, archivedTime } from '../lib/archive';
  import { projectThread } from '../lib/thread-rows';
  import { SnapshotReads } from '../lib/store/snapshot-reads';
  import { canDeleteThread } from '../lib/thread-removal';
  import { ThreadRestore } from '../lib/thread-restore.svelte';
  import { ago, exactTime, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';

  /** `eager` reads the list at once: the phone's page of its own, where the archive is all there is to see. */
  let { store, eager = false }: { store: Store; eager?: boolean } = $props();

  /**
   * Null until asked for: the General page opens without reading the archive.
   * Asked for is the button, the phone's page, or a jump to this card (the
   * palette, the project menu, the settings search), which is the same ask.
   */
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
    if (asked || (!eager && store.settingsSection?.id !== 'archived') || store.connection !== 'ready') return;
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

  async function restore(thread: ThreadSummary) {
    const summary = await lock.restore(store, thread.id);
    if (!summary) return;
    threads = threads?.map(row => row.id === summary.id ? summary : row) ?? null;
    restored = [...restored, thread.id];
  }

  function projectOf(thread: ThreadSummary): string {
    const project = store.projects.find((p) => p.id === thread.projectId);
    return project ? projectName(project) : '';
  }

  async function remove(thread: ThreadSummary) {
    if (await lock.remove(store, thread)) threads = threads?.filter(t => t.id !== thread.id) ?? null;
  }
</script>

<section class="card" id="settings-archived" data-testid="archived-threads">
  <h2 class="ui-label-box"><span class="ui-label">{strings.settings.archived.heading}</span><InfoTip topic={strings.settings.archived.heading} text={strings.settings.archived.intro} /></h2>
  {#if threads === null}
    <button type="button" data-testid="archived-show" disabled={loading || store.connection !== 'ready'} onclick={() => void load()}>
      <span class="ui-label">{strings.settings.archived.show}</span>
    </button>
  {:else if threads.length === 0}
    <p class="muted" data-testid="archived-empty">{strings.settings.archived.empty}</p>
  {:else}
    <!-- One group of rows, as the lists draw them: the title, then where it was and why it left, then since when (a merge's
         own time when one put it away). The row itself restores (its one action, named under the pointer or the
         keyboard), then opens; Delete waits in its menu. -->
    <ul class="archived" data-testid="archived-list">
      {#each threads as thread (thread.id)}
        {@const retention = store.settings?.threadDoneRetentionDays ?? DEFAULT_THREAD_DONE_RETENTION_DAYS}
        {@const at = thread.archiveReason?.type === 'pr-merged' ? thread.archiveReason.archivedAt : archivedTime(thread)}
        {@const back = restored.includes(thread.id)}
        <!-- The menu names the row's action too, so a phone, with no pointer to show it, finds it there. -->
        {@const items = [
          ...(back ? [] : [{ id: 'restore', label: strings.settings.archived.restore, glyph: RotateCcw, disabled: lock.busy, testid: 'archived-menu-restore' }]),
          ...(canDeleteThread(thread) ? [{ id: 'delete', label: strings.common.delete, glyph: Trash2, danger: true, disabled: lock.busy, testid: 'archived-delete' }] : [])
        ]}
        <li data-thread-id={thread.id} class:back>
          <span class="title" title={thread.title}>{thread.title}</span>
          <span class="context">
            {#if projectOf(thread)}<span class="part">{projectOf(thread)}</span><span class="sep" aria-hidden="true">·</span>{/if}
            {#if thread.archiveReason?.type === 'pr-merged'}
              <span class="part archive-reason" data-testid="archive-merged-reason"><a href={thread.archiveReason.url} target="_blank" rel="noopener noreferrer">{fill(strings.settings.archived.mergedReason, { number: String(thread.archiveReason.number) })}</a></span><span class="sep" aria-hidden="true">·</span>
            {/if}
            {#if thread.doneAt != null && retention > 0}
              <span class="part" data-testid="done-expires">{fill(strings.settings.archived.deletesAt, { date: exactTime(thread.doneAt + retention * 86_400_000) })}</span><span class="sep" aria-hidden="true">·</span>
            {/if}
            <time class="part" datetime={new Date(at).toISOString()} title={exactTime(at)}>{ago(at)}</time>
          </span>
          <span class="actions">
            <!-- The row's one action: its button covers the row, its word shows under the pointer or the keyboard. -->
            {#if back}
              <button type="button" class="ghost small main" data-testid="archived-open" title={thread.title} onclick={() => void workspace.select(store, thread.id)}>
                <span class="ui-label">{strings.common.open}</span>
              </button>
            {:else}
              <button type="button" class="ghost small main" data-testid="archived-restore" title={thread.title} disabled={lock.busy} onclick={() => void restore(thread)}>
                <RotateCcw size={14} /><span class="ui-label">{strings.settings.archived.restore}</span>
              </button>
            {/if}
            {#if items.length}
              <Menu {items} onpick={id => void (id === 'delete' ? remove(thread) : restore(thread))}
                label={strings.sidebar.threadMenu} placement="bottom" align="end" variant="ghost" testid="archived-menu-{thread.id}"><Ellipsis size={15} /></Menu>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<DeletedThreads {store} {eager} />

<style>
  /* One bordered group, rows parted by hairlines, as Recent's and Activity's rows are one list. */
  .archived {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  /* The row is its own button: the main action's box covers it; the merge link and the menu stand above. */
  .archived li {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 2px 10px;
    min-height: var(--row);
    padding: 8px 10px;
    transition: background var(--dur-2) var(--ease-out-quint);
  }
  .archived li + li { border-top: 1px solid var(--color-border); }
  .archived li:hover { background: var(--color-hover); }

  .title {
    grid-column: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    line-height: 1.5;
  }

  .context {
    grid-column: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 6px;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }
  .part { min-width: 0; overflow-wrap: anywhere; }
  .sep { color: var(--color-subtle); }
  .context time { color: var(--color-subtle); }
  .archive-reason a { position: relative; z-index: 1; color: inherit; text-underline-offset: 2px; }

  /* The action and the menu beside both lines, at the row's right. */
  .actions {
    grid-column: 2;
    grid-row: 1 / span 2;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .archived button { gap: 4px; }
  .main { position: static; }
  .main::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
  .main:focus-visible { outline: none; }
  .archived li:has(.main:focus-visible) { outline: var(--focus-ring); outline-offset: -2px; }
  .actions :global(.menu), .actions :global(.trigger) { position: relative; z-index: 1; }
  /* At rest the row reads its words alone: its action names itself under the pointer or the keyboard, a restored
     row's Open stays. */
  .archived li:not(.back):not(:hover, :focus-within) .main,
  .archived li:not(:hover, :focus-within) .actions :global(.trigger) { opacity: 0; }
  /* A phone has no pointer to wait for: a tap on the row restores, its menu (Restore, Delete) always shows. The
     settings card already frames the list there, so the rows lose their own border and line up with its edge. */
  @media (max-width: 720px) {
    .archived li:not(:hover, :focus-within) .actions :global(.trigger) { opacity: 1; }
    .archived { border: none; border-radius: 0; }
    .archived li { padding-inline: 0; }
    /* Brought into view (Settings opened at the archive), the phone page's machine bar above stays whole rather than
       cut. An id: the settings cards' own margin (app.css) is more specific than a class. */
    #settings-archived { scroll-margin-top: 96px; }
  }
</style>
