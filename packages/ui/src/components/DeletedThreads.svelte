<script lang="ts">
  import SettingsSection from './SettingsSection.svelte';
  import { errorText } from '../lib/errors';
  import { DEFAULT_THREAD_DELETION_RETENTION_DAYS, DEFAULT_THREAD_DONE_RETENTION_DAYS, transcriptPolicy, type DeletedThreadSummary, type ThreadId, type ThreadSummary } from '@boite/contracts';
  import { exactTime, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import SettingDays from './SettingDays.svelte';

  let { store }: { store: Store } = $props();
  let threads = $state<DeletedThreadSummary[] | null>(null);
  let loading = $state(false);
  let restoring = $state<ThreadId | null>(null);
  let asked = false;
  let generation = 0;
  let retention = $derived(store.settings?.threadDeletionRetentionDays ?? DEFAULT_THREAD_DELETION_RETENTION_DAYS);
  /** Once a storage mode is picked, it decides when a deleted conversation leaves this list. */
  let mode = $derived(store.settings?.transcriptStorage);
  let leaves = $derived.by(() => {
    if (mode === undefined) return retention > 0 ? retention : null;
    const policy = transcriptPolicy(mode, retention);
    const days = [policy.deletedCompactDays, policy.deletedEraseDays].filter(value => value !== null);
    return days.length === 0 ? null : Math.min(...days);
  });

  $effect(() => {
    if (store.owner && store.connection === 'ready' && asked) void load();
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
  <SettingsSection id="settings-thread-retention" testid="deleted-threads" title={strings.settings.deleted.heading}>
    <!-- How long a thread stays, done then deleted: two rows that save when left, out of the archive's list. -->
    <SettingDays {store} key="threadDoneRetentionDays" label={strings.settings.archived.doneRetentionLabel} hint={strings.settings.archived.doneRetentionHint}
      fallback={DEFAULT_THREAD_DONE_RETENTION_DAYS} testid="done-retention-days" />
    {#if mode === undefined}
      <SettingDays {store} key="threadDeletionRetentionDays" label={strings.settings.deleted.retentionLabel} hint={strings.settings.deleted.retentionHint}
        fallback={DEFAULT_THREAD_DELETION_RETENTION_DAYS} testid="deleted-retention-days" onsaved={() => { if (asked) return load(); }} />
    {/if}
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
              {#if leaves !== null && thread.deletedAt}
                <span class="subtle expiry">{fill(mode === undefined ? strings.settings.deleted.purgesAt : strings.settings.deleted.compactsAt, { date: exactTime(thread.deletedAt + leaves * 86_400_000) })}</span>
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
  </SettingsSection>
{/if}

<style>
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  :global(#settings-thread-retention) > :is(button, p, ul) { margin-top: var(--space-3); }
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
