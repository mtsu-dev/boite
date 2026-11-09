<script lang="ts">
  import type { MemoryEvent } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { notifyCorner } from '../lib/notify-corner';
  import { sameNotice } from '../lib/memory-timeline';
  import MemoryRow from './MemoryRow.svelte';

  /**
   * A memory stop is news about the machine, not part of the conversation: a
   * stop that lands while its thread is open arrives in the notification
   * corner, once, with the way to the memory settings. The stops a thread
   * already had when it was first opened are history and stay out of the way.
   */
  let { store }: { store: Store } = $props();

  /** Per thread, the time of its last stop when this view first saw it; plain, since only first sight writes it. */
  const history = new Map<string, number>();
  let dismissed = $state<string[]>([]);
  const thread = $derived(store.openThread);
  /** The latest stop and the ones just before it that read the same, as the timeline merges them. */
  const group = $derived.by(() => {
    // A thread from the list carries no stops yet: its history is only known once its snapshot lands.
    const events = thread?.memoryEvents;
    if (!thread || !events) return [];
    const last = events.at(-1);
    if (!history.has(thread.id)) history.set(thread.id, last?.at ?? -Infinity);
    const since = history.get(thread.id)!;
    if (!last || last.at <= since) return [];
    const run: MemoryEvent[] = [last];
    for (let at = events.length - 2; at >= 0 && events[at]!.at > since && sameNotice(events[at], run[0]!); at -= 1) run.unshift(events[at]!);
    return run;
  });
  const key = $derived(thread && group.length ? `${thread.id}:${group.at(-1)!.at}` : null);

  const dismiss = (): void => { if (key !== null) dismissed = [...dismissed, key]; };
</script>

{#if key !== null && !dismissed.includes(key)}
  <div class="notify-corner memory-corner" use:notifyCorner data-testid="memory-corner">
    <MemoryRow event={group[0]!} events={group} ondismiss={dismiss}
      onconfigure={store.owner ? () => { dismiss(); store.showSettings('resources', 'limits'); } : undefined} />
  </div>
{/if}

