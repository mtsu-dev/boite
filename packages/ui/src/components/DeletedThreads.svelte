<script lang="ts">
  import { errorText } from '../lib/errors';
  import { DEFAULT_THREAD_DELETION_RETENTION_DAYS, DEFAULT_THREAD_DONE_RETENTION_DAYS, type DeletedThreadSummary, type ThreadId, type ThreadSummary } from '@boite/contracts';
  import { exactTime, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import SettingDays from './SettingDays.svelte';

  let { store, eager = false }: { store: Store; eager?: boolean } = $props();
  let threads = $state<DeletedThreadSummary[] | null>(null);
  let loading = $state(false);
  let restoring = $state<ThreadId | null>(null);
  let asked = false;
  let generation = 0;
  let retention = $derived(store.settings?.threadDeletionRetentionDays ?? DEFAULT_THREAD_DELETION_RETENTION_DAYS);

  $effect(() => {
    if (store.owner && store.connection === 'ready' && (eager || asked)) void load();
  });
  $effect(() => store.client?.on('thread.deletionsUpdated', () => { if (asked) void load(); }));

  async function load(): Promise<void> {
    const client = store.client;
    if (!client || !store.owner) return;
    asked = true;
    const current = ++generation;
    loading = true;
    try {
      const rows = await client.call('threads.deleted', {});
      if (current === generation && client === store.client) threads = rows;
    } catch (error) {
      if (current === generation) store.error = errorText(error);
    } finally { if (current === generation) loading = false; }
  }

  async function restore(threadId: ThreadId): Promise<void> {
    restoring = threadId;
    try { if (await store.restoreDeletedThread(threadId)) await load(); }
    finally { restoring = null; }
  }

  function projectOf(thread: ThreadSummary): string {
    const project = store.projects.find(p => p.id === thread.projectId);
    return project ? projectName(project) : '';
  }
</script>

{#if store.owner}
  <section class="card" data-testid="deleted-threads">
    <h2>{strings.settings.deleted.heading}</h2>
    <!-- How long a thread stays, done then deleted: two rows that save when left, out of the archive's list. -->
    <SettingDays {store} key="threadDoneRetentionDays" label={strings.settings.archived.doneRetentionLabel} hint={strings.settings.archived.doneRetentionHint}
      fallback={DEFAULT_THREAD_DONE_RETENTION_DAYS} testid="done-retention-days" />
    <SettingDays {store} key="threadDeletionRetentionDays" label={strings.settings.deleted.retentionLabel} hint={strings.settings.deleted.retentionHint}
      fallback={DEFAULT_THREAD_DELETION_RETENTION_DAYS} testid="deleted-retention-days" onsaved={() => { if (asked) return load(); }} />
    {#if threads === null}
      <button type="button" data-testid="deleted-show" disabled={loading || store.connection !== 'ready'} onclick={() => void load()}>
        <span class="ui-label">{strings.settings.deleted.show}</span>
      </button>
    {:else if threads.length === 0}
      <p class="muted" data-testid="deleted-empty">{strings.settings.deleted.empty}</p>
    {:else}
      <ul data-testid="deleted-list">
        {#each threads as thread (thread.id)}
          <li data-thread-id={thread.id}>
            <div class="conversation">
              <span class="title" title={thread.title}>{thread.title}</span>
              {#if retention > 0 && thread.deletedAt}
                <span class="subtle expiry">{fill(strings.settings.deleted.purgesAt, { date: exactTime(thread.deletedAt + retention * 86_400_000) })}</span>
              {/if}
            </div>
            <span class="subtle meta">{projectOf(thread)}</span>
            <button type="button" class="small" data-testid="deleted-restore" disabled={restoring !== null || store.connection !== 'ready'} onclick={() => void restore(thread.id)}>
              <span class="ui-label">{strings.sidebar.undo}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  section > :is(button, p, ul) { margin-top: var(--space-3); }
  li { display: flex; align-items: center; gap: 10px; min-height: var(--row); padding: 4px 4px 4px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
  .conversation { flex: 1; min-width: 0; }
  .title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .expiry { display: block; font-size: var(--text-sm); }
  .meta { flex: none; font-size: var(--text-sm); }
  button { flex: none; }
  @media (max-width: 720px) {
    li { flex-wrap: wrap; }
    .conversation { flex-basis: 100%; }
    .meta { flex: 1; }
  }
</style>
