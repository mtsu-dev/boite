<script lang="ts">
  import { ChevronRight, MessageSquarePlus } from '@lucide/svelte';
  import type { NewConversationNotice } from '@boite/contracts';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * Where a mochi's new conversation began (`agents.session.new`): the turns
   * above it are no longer in its session, those below start fresh. It says
   * who asked, the owner or the mochi itself, and folds the handoff note its
   * first turn was given.
   */
  let { store, threadId, notice }: { store: Store; threadId: string; notice: NewConversationNotice } = $props();
  const labels = $derived(strings.agents.newConversation);
  let open = $state(false);
  const name = $derived(agentDirectory(store).agentOfThread(threadId)?.name ?? null);
  const by = $derived(notice.by === 'user' ? labels.byYou : name ? fill(labels.byMochi, { name }) : labels.byTheMochi);
  const note = $derived(notice.note?.trim() ?? '');
</script>

<div class="fresh" data-testid="new-conversation-marker" data-by={notice.by}>
  <div class="line" role="separator" aria-label={`${labels.marker}, ${by}`}>
    <span class="rule"></span>
    <span class="label"><MessageSquarePlus size={13} /><span class="ui-label">{labels.marker}</span></span>
    <span class="rule"></span>
  </div>
  <div class="by">
    <span data-testid="new-conversation-by">{by}</span>
    {#if note}
      <span aria-hidden="true">·</span>
      <button type="button" class="ghost small toggle" data-testid="new-conversation-toggle" aria-expanded={open} onclick={() => (open = !open)}>
        <span class="ui-label">{labels.note}</span><span class="fold-caret" class:open aria-hidden="true"><ChevronRight size={12} /></span>
      </button>
    {/if}
  </div>
  {#if open && note}
    <p class="note" data-testid="new-conversation-note">{note}</p>
  {/if}
</div>

<style>
  .fresh {
    align-self: stretch;
    display: grid;
    gap: 2px;
    margin: 10px 0 6px;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .rule {
    flex: 1;
    height: 1px;
    background: var(--color-edge);
  }
  .label {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-accent);
    font-weight: 600;
  }
  .by {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 2px 6px;
    min-height: 24px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding-inline: 4px;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .note {
    margin: 4px 0 0;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
