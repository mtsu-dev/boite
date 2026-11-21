<script lang="ts">
  import { Search } from '@lucide/svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let { value = $bindable(''), input = $bindable(), placeholder, compact = false, ...attributes }: Omit<HTMLInputAttributes, 'value'> & {
    value?: string;
    input?: HTMLInputElement;
    placeholder: string;
    compact?: boolean;
  } = $props();
</script>

<label class:compact>
  <Search size={compact ? 13 : 14} strokeWidth={1.75} aria-hidden="true" />
  <input {...attributes} bind:this={input} bind:value type="search" autocomplete="off" autocapitalize="off" spellcheck="false"
    {placeholder} aria-label={placeholder} />
</label>

<style>
  label { display: flex; align-items: center; gap: 8px; height: var(--control); padding: 0 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-subtle); transition: border-color var(--dur-2) var(--ease-out-quint); }
  label:focus-within { border-color: var(--color-edge); color: var(--color-muted-foreground); }
  label.compact { gap: 6px; padding: 0 8px; height: var(--control-sm); }
  input { flex: 1; min-width: 0; height: 100%; padding: 0; border: none; background: transparent; color: var(--color-foreground); font-size: var(--text-sm); }
  input:focus { outline: none; }
  @media (max-width: 720px) {
    label { height: var(--control-touch); }
    .compact { height: var(--touch-target); border: 0; box-shadow: inset 0 0 0 1px var(--color-border); }
    .compact:focus-within { box-shadow: inset 0 0 0 1px var(--color-edge); }
  }
</style>
