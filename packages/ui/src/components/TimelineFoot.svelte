<script lang="ts">
  import { untrack } from 'svelte';
  import type { Store } from '../lib/store.svelte';
  import { pendingMoveOf } from '../lib/message-display';
  import { pendingSwitch } from '../lib/switch-notice';
  import MoveMarker from './MoveMarker.svelte';
  import SwitchMarker from './SwitchMarker.svelte';
  import ThreadClosing from './ThreadClosing.svelte';

  /**
   * What stands under a thread's last message. While `pending`, what the next
   * prompt will carry: a move the user made, said until the prompt that tells
   * the agent goes, and the model, effort or account picked since the
   * transcript last stated one, dashed until a turn runs on it
   * (`lib/switch-notice.ts`), under `closing`, a finished thread's last word,
   * since it was picked after it.
   * `pending` is false while a prompt is on its way or the window stops short
   * of the thread's end. `onlanded` runs when a line appears here or changes
   * its words, so a list at its end keeps it in view.
   */
  let { store, threadId, pending, closing, onlanded }: { store: Store; threadId: string; pending: boolean; closing: string | null; onlanded(): void } = $props();
  const move = $derived(pending ? pendingMoveOf(store.openThread, threadId) : null);
  const picked = $derived(pending ? pendingSwitch(store.openThread, threadId) : null);
  const lines = $derived(JSON.stringify([move?.note, picked?.to, closing]));
  $effect(() => {
    void lines;
    if (move || picked || closing !== null) untrack(onlanded);
  });
</script>

{#if move}<MoveMarker notice={move} pending />{/if}
{#if closing}<ThreadClosing text={closing} />{/if}
{#if picked}<SwitchMarker names={store} shown={picked} pending />{/if}
