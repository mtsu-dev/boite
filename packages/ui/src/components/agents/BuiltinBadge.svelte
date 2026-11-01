<script lang="ts">
  import { Box } from '@lucide/svelte';
  import { strings } from '../../lib/strings';

  /**
   * Says a bot is Boite's own: a small box beside its name, the word too
   * where there is room. It sits inside the row's button, so its tooltip is
   * the native title rather than an "i" of its own.
   */
  let { word = false }: { word?: boolean } = $props();
  const labels = $derived(strings.agents.builtin);
</script>

<span class="builtin-badge" class:word title={labels.badgeTip} aria-label={`${labels.badge}. ${labels.badgeTip}`} role="img" data-testid="agent-builtin-badge">
  <Box size={word ? 12 : 11} strokeWidth={2} aria-hidden="true" />{#if word}<span>{labels.badge}</span>{/if}
</span>

<style>
  .builtin-badge { display: inline-flex; flex: none; align-items: center; gap: 4px; height: 18px; padding: 0 5px; border-radius: var(--radius-full); background: var(--color-accent-soft); color: var(--color-accent); font-size: var(--text-xs); font-weight: 600; line-height: 1; }
  .builtin-badge.word { padding: 0 7px 0 6px; }
</style>
