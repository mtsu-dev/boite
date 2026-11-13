<script lang="ts">
  // An ask's sentence is plain text except for `code` spans: agents name
  // files and commands that way, and a raw backtick reads as noise. No
  // markdown pass, so nothing else in the sentence changes.
  let { text }: { text: string } = $props();
  // The capture group keeps the spans: every odd piece is one.
  let pieces = $derived(text.split(/(`[^`\n]+`)/));
</script>

{#each pieces as piece, index (index)}{#if index % 2 === 1}<code>{piece.slice(1, -1)}</code>{:else}{piece}{/if}{/each}

<style>
  code {
    font-family: var(--font-mono);
    font-size: 0.875em;
    padding: 0 4px;
    border-radius: var(--radius-sm);
    background: var(--color-code-background);
    color: var(--color-code-foreground);
    border: 1px solid var(--color-border);
    overflow-wrap: anywhere;
  }
</style>
