<script lang="ts">
  import { ArrowRight, CircleAlert } from '@lucide/svelte';
  import Notice from './Notice.svelte';

  /** The error toast's notice: what failed, the way to its thread, a dismiss. */
  let { title, message, dismiss, action }: {
    title: string;
    message: string;
    dismiss: () => void;
    action?: { label: string; run: () => void };
  } = $props();
</script>

{#snippet open()}
  {#if action}
    <button type="button" class="small open-thread" onclick={action.run}>
      <span class="ui-label">{action.label}</span><ArrowRight size={14} />
    </button>
  {/if}
{/snippet}

<Notice icon={CircleAlert} tone="danger" floating role="alert" {title} ondismiss={dismiss} actions={action ? open : undefined}>
  <span class="message" class:thread-title={!!action} title={action ? message : undefined}>{message}</span>
</Notice>

<style>
  .message {
    display: block;
    white-space: pre-wrap;
    max-height: min(40vh, 320px);
    overflow-y: auto;
    user-select: text;
    overflow-wrap: anywhere;
  }
  .thread-title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
