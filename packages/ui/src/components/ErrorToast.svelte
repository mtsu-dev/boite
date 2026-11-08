<script lang="ts">
  import NotificationCard from './NotificationCard.svelte';
  import { Closing } from '../lib/closing.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { toastSlot } from '../lib/notify-corner';

  /**
   * The active machine's error as a card in the toasts' home (`toastSlot`), with Open thread
   * when a thread failed. A minor error with no thread clears itself after
   * five seconds.
   */
  let { store, pairingScreen, blocked, onopen }: {
    store: Store;
    /** The phone's pairing screen is up: it reports a missing or revoked pairing itself. */
    pairingScreen: boolean;
    /** The recovery screen already says the browser blocks the local network. */
    blocked: boolean;
    /** Open thread was pressed: the phone shows the chat. */
    onopen: () => void;
  } = $props();

  const toast = new Closing();
  /** The error is cleared the moment Dismiss is pressed, so the exit plays on a copy. */
  let text = $state('');
  let threadId = $state<string | null>(null);
  let owner = $state<Store | null>(null);

  function dismiss(): void {
    if (owner) owner.error = null;
  }

  function openThread(): void {
    const from = owner, id = threadId;
    if (!from || !id) return;
    from.error = null;
    void workspace.select(from, id);
    onopen();
  }

  $effect(() => {
    const current = store;
    const error = current.error;
    const pairingNotice = pairingScreen && (error === strings.errors.unpaired || error === strings.errors.revoked);
    // A machine that may still give way to one that answers has nothing to report yet.
    const held = workspace.waiting && current === workspace.primary;
    if (!error || current.errorOffline || pairingNotice || held || blocked) {
      toast.hide();
      return;
    }
    text = error;
    threadId = current.errorThreadId;
    owner = current;
    toast.show();
  });

  $effect(() => {
    const current = store;
    const error = current.error;
    if (!error || current.errorSeverity !== 'minor' || current.errorThreadId) return;
    const timer = setTimeout(() => {
      if (current.error === error && current.errorSeverity === 'minor') current.error = null;
    }, 5_000);
    return () => clearTimeout(timer);
  });
</script>

{#if toast.shown}
  <div
    class="toast toast-slot"
    class:closing={toast.closing}
    role="alert"
    use:toast.attach
    use:toastSlot
    onanimationend={toast.end}
    data-testid="error-toast"
  >
    <NotificationCard
      title={threadId ? strings.notify.failed : strings.errors.prefix}
      message={text}
      {dismiss}
      action={threadId ? { label: strings.notify.openThread, run: openThread } : undefined}
    />
  </div>
{/if}

<style>
  .toast { width: min(340px, calc(100vw - 24px)); animation: rise var(--dur-3) var(--ease-out-quint); }

  .toast.closing {
    animation: fade-out var(--dur-2) var(--ease-out-quint);
    pointer-events: none;
  }
</style>
