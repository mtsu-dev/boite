<script lang="ts">
  import { ChevronRight, Globe } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  let { onclick }: { onclick?: () => void } = $props();
</script>

<button type="button" data-testid="agent-browser-background" {onclick}>
  <Globe size={16} strokeWidth={1.75} />
  <span class="ui-label">{strings.agentBrowser.background}</span>
  <ChevronRight size={14} />
</button>

<style>
  button { display: flex; align-items: center; gap: 8px; width: calc(100% - 12px); min-height: var(--row); margin: 4px 6px; padding: 4px 8px; border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-foreground); text-align: left; }
  button:hover { background: var(--color-active); }
  span { flex: 1; min-width: 0; font-size: var(--text-sm); }
</style>
