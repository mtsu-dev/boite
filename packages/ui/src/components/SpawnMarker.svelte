<script lang="ts">
  import { MessagesSquare } from '@lucide/svelte';
  import type { ThreadLink } from '@boite/contracts';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * One end of `boite thread new` in a timeline: above the first prompt of the
   * thread an agent started (`from`), or where the starting agent did it (`to`).
   * The linked thread opens on a click while this machine still has it.
   */
  let { store, link, direction }: { store: Store; link: ThreadLink; direction: 'from' | 'to' } = $props();
  // A thread on another machine of the group says which.
  let label = $derived(fill(direction === 'from' ? strings.chat.startedByAgent : strings.chat.agentStartedThread, { title: link.title, project: link.machine ? `${link.project} · ${link.machine}` : link.project }));
  let present = $derived(store.threads.some((thread) => thread.id === link.threadId && !thread.archived));
</script>

<div class="spawn" data-testid="spawn-marker" data-direction={direction}>
  <span class="rule"></span>
  {#if present}
    <button type="button" class="ghost small label" data-testid="spawn-marker-open" data-preload-thread={link.threadId} title={strings.chat.openLinkedThread} onclick={() => void store.open(link.threadId)}><MessagesSquare size={13} /><span class="ui-label">{label}</span></button>
  {:else}
    <span class="label"><MessagesSquare size={13} /><span class="ui-label">{label}</span></span>
  {/if}
  <span class="rule"></span>
</div>

<style>
  /* Drawn like a wake divider: a quiet line, the icon alone in the accent. */
  .spawn {
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .rule { flex: 1; min-width: 12px; height: 1px; background: var(--color-border); }
  .label {
    flex: 0 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    overflow-wrap: anywhere;
    white-space: normal;
    text-align: center;
    height: auto;
  }
  button.label:hover, button.label:focus-visible { color: var(--color-foreground); }
  .label :global(svg) { flex: none; color: var(--color-accent); }
</style>
