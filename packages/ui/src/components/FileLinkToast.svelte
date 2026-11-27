<script lang="ts">
  import { FileX } from '@lucide/svelte';
  import Notice from './Notice.svelte';
  import { Closing } from '../lib/closing.svelte';
  import { fileNotice } from '../lib/file-open.svelte';
  import { writeClipboardLater } from '../lib/live-input';
  import { toastSlot } from '../lib/notify-corner';
  import { strings } from '../lib/strings';

  /**
   * Says why a chat file link opened nothing: where it was looked for, the
   * path in full, and a way to copy it (`fileNotice`). It goes on its own
   * after a while, like a minor error; a new one replaces it.
   */
  const LINGER_MS = 8000;
  const toast = new Closing();
  let shown = $state<{ title: string; path: string } | null>(null);
  let copied = $state(false);

  $effect(() => {
    const current = fileNotice.current;
    if (!current) { toast.hide(); return; }
    shown = current;
    copied = false;
    toast.show();
    const timer = setTimeout(() => { if (fileNotice.current?.key === current.key) fileNotice.dismiss(); }, LINGER_MS);
    return () => clearTimeout(timer);
  });

  async function copy(): Promise<void> {
    if (!shown) return;
    try { await writeClipboardLater(Promise.resolve(shown.path)); copied = true; } catch { copied = false; }
  }
</script>

{#if toast.shown && shown}
  <div class="toast-slot" use:toastSlot>
    <div class="toast" class:closing={toast.closing} use:toast.attach onanimationend={toast.end}>
      <Notice icon={FileX} floating tone="caution" testid="file-link-toast" title={shown.title} detail={shown.path} ids={{ title: 'file-link-toast-title', detail: 'file-link-toast-path' }} ondismiss={() => fileNotice.dismiss()}>
        {#snippet actions()}
          <button type="button" class="small" data-testid="file-link-copy" onclick={() => void copy()}><span class="ui-label">{copied ? strings.chat.copied : strings.chat.copyPath}</span></button>
        {/snippet}
      </Notice>
    </div>
  </div>
{/if}

<style>
  .toast { animation: rise var(--motion-duration) var(--motion-curve); }
  .toast.closing {
    animation: fade-out var(--motion-duration) var(--motion-curve);
    pointer-events: none;
  }
</style>
