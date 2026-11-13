<script lang="ts" generics="M extends { store: Store }">
  import { CheckCheck } from '@lucide/svelte';
  import type { FeedRow } from '../lib/activity-feed';
  import { readableThreads } from '../lib/activity-feed';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';

  /**
   * Activity's "Mark all as read", on its first line: every failure, stop and
   * finish leaves the feed, each machine's on its own core; the questions and
   * permissions stay, since only an answer settles them. Nothing to clear, no
   * button.
   */
  let { rows }: { rows: readonly Pick<FeedRow<M>, 'machine' | 'thread' | 'kind'>[] } = $props();
  const readable = $derived(readableThreads(rows));

  function markAll() {
    for (const [machine, ids] of readable) void machine.store.markRead(ids);
  }
</script>

{#if readable.size > 0}
  <button type="button" class="ghost small mark-all" data-testid="activity-mark-all-read"
    title={strings.mobile.feed.markAllReadHint} onclick={markAll}>
    <CheckCheck size={14} strokeWidth={1.75} aria-hidden="true" /><span class="ui-label">{strings.mobile.feed.markAllRead}</span>
  </button>
{/if}

<style>
  .mark-all { flex: none; gap: 6px; height: var(--control-sm); padding: 0 8px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .mark-all:hover:not(:disabled) { color: var(--color-foreground); }
</style>
