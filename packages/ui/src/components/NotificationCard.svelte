<script lang="ts">
  import { ArrowRight, CircleAlert, X } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import '../lib/notify-corner.css';

  /** The card of the notification corner, here the error toast's: what failed, the way to its thread, a dismiss. */
  let { title, message, dismiss, action }: {
    title: string;
    message: string;
    dismiss: () => void;
    action?: { label: string; run: () => void };
  } = $props();
</script>

<div class="notify-card notification-card" data-tone="danger">
  <span class="notify-mark" aria-hidden="true"><CircleAlert size={16} strokeWidth={1.75} /></span>
  <div class="notify-lines">
    <span class="notify-title">{title}</span>
    <p class="notify-text" class:thread-title={!!action} title={action ? message : undefined}>{message}</p>
    {#if action}
      <div class="notify-actions">
        <button type="button" class="small open-thread" onclick={action.run}>
          <span class="ui-label">{action.label}</span><ArrowRight size={14} />
        </button>
      </div>
    {/if}
  </div>
  <button type="button" class="ghost icon notify-dismiss" onclick={dismiss} aria-label={strings.common.dismiss} title={strings.common.dismiss}>
    <X size={14} />
  </button>
</div>

<style>
  p {
    white-space: pre-wrap;
    max-height: min(40vh, 320px);
    overflow-y: auto;
    user-select: text;
  }
  .thread-title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
