<script lang="ts">
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * The first screen of a machine with no AI, desktop and phone alike: the
   * mark, one line, one action. The folder, the drafts and the composer come
   * once an AI answers; a paired device is told where to connect one.
   */
  let { store }: { store: Store } = $props();
</script>

<div class="first-run" data-testid="first-run">
  <img src="./icons/icon.svg" alt="" width="56" height="56" />
  <h1>{strings.firstRun.welcome}</h1>
  {#if store.owner}
    <button type="button" class="primary start" data-testid="first-run-connect" onclick={() => store.openConnect()}>{strings.connect.button}</button>
  {:else}
    <p data-testid="first-run-device">{strings.connect.device}</p>
  {/if}
</div>

<style>
  .first-run { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; min-height: 0; padding: 40px 24px; text-align: center; animation: rise var(--dur-3) var(--ease-out-quint); }
  img { border-radius: var(--radius-lg); }
  h1 { max-width: 22ch; margin: 0; font-size: var(--text-lg); font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
  p { max-width: 36ch; margin: 0; font-size: var(--text-base); line-height: 1.5; color: var(--color-muted-foreground); }
  .start { height: var(--control-lg); padding: 0 22px; border-radius: var(--radius-full); font-weight: 600; }
  .start:hover:not(:disabled) { background: color-mix(in srgb, var(--color-foreground) 86%, var(--color-background)); }
  @media (max-width: 720px) { .start { min-width: 200px; } }
</style>
