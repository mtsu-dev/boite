<script lang="ts">
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import EmptyState from './EmptyState.svelte';

  /**
   * The first screen of a machine with no AI, desktop and phone alike: the
   * shared empty state with the house bot, one line, one action. The folder,
   * the drafts and the composer come once an AI answers; a paired device is
   * told where to connect one.
   */
  let { store }: { store: Store } = $props();
</script>

<EmptyState line={strings.firstRun.welcome} testid="first-run" markTestid="first-run-mark">
  {#snippet action()}
    {#if store.owner}
      <button type="button" class="primary start" data-testid="first-run-connect" onclick={() => store.openConnect()}>{strings.connect.button}</button>
    {:else}
      <p data-testid="first-run-device">{strings.connect.device}</p>
    {/if}
  {/snippet}
</EmptyState>

<style>
  .start { height: var(--control-lg); padding: 0 22px; border-radius: var(--radius-full); }
  @media (hover: hover) { .start:hover:not(:disabled) { background: color-mix(in srgb, var(--color-foreground) 86%, var(--color-background)); } }
  @media (max-width: 720px) { .start { min-width: 200px; } }
</style>
