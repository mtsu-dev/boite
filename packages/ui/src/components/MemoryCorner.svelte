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
   * A stop anywhere else, in a thread not on screen, on another page (`chat`
   * false) or in the open thread before its history landed, comes the same
   * way; either card stays until it is put away.
   */
  let { store, chat = true }: { store: Store; chat?: boolean } = $props();

  /** Per thread, the time of its last stop when this view first saw it; plain, since only first sight writes it. */
  const history = new Map<string, number>();
  let dismissed = $state<string[]>([]);
  const thread = $derived(chat ? store.openThread : null);
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

  /** The machine's last stop, kept until it is put away: on another page, or before the thread's history lands, only this card can say it. */
  const stop = $derived(store.memoryStop);
  /** Whether the open thread's own card carries that stop, so it is not said twice. */
  const told = $derived(stop !== null && thread !== null && stop.threadId === thread.id && group.some(event => event.at === stop.at && event.kind === stop.kind));
  // Putting the thread's card away puts away the stop it carries, so it does not come back once that thread is left.
  const dismiss = (): void => { if (key !== null) dismissed = [...dismissed, key]; if (told) store.dismissMemoryStop(); };
  /** Putting the machine's card away answers the thread's card for the same stop too, once its thread is back on screen. */
  const dismissStop = (): void => { if (stop !== null) dismissed = [...dismissed, `${stop.threadId}:${stop.at}`]; store.dismissMemoryStop(); };
  /** The way to the memory settings, for the owner: the card goes away on the way. */
  const configure = (put: () => void): (() => void) | undefined => store.owner ? () => { put(); store.showSettings('resources', 'limits'); } : undefined;
</script>

{#if key !== null && !dismissed.includes(key)}
  <div class="notify-corner memory-corner" use:notifyCorner data-testid="memory-corner">
    <MemoryRow event={group[0]!} events={group} ondismiss={dismiss} onconfigure={configure(dismiss)} />
  </div>
{:else if stop !== null}
  <div class="notify-corner memory-corner" use:notifyCorner data-testid="memory-corner">
    <MemoryRow event={stop} ondismiss={dismissStop} onconfigure={configure(dismissStop)} />
  </div>
{/if}

