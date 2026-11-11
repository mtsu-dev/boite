<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronDown, ChevronUp } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * What a decision decides on, read before it is taken (Activity's rows): whole up to four lines, and beyond that
   * its first four with "Show all", which unfolds it in place and folds it back. Whether it runs past is measured,
   * so a short text never wears the button.
   */
  let { text, testid, mono = false, children }: {
    text: string;
    testid?: string;
    /** A command: the code block's face, wrapped at spaces only by `children`. */
    mono?: boolean;
    /** The words drawn in place of `text` (a command's unbreakable words); `text` stays the measure and the tooltip. */
    children?: Snippet;
  } = $props();
  let open = $state(false);
  let over = $state(false);
  let box = $state<HTMLElement>();

  $effect(() => {
    if (!box) return;
    void text;
    const element = box;
    const measure = () => { if (!open) over = element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1; };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  });
</script>

<div class="clamp-text" class:mono>
  <div class="frame"><p class="body" class:open data-testid={testid} bind:this={box}>{#if children}{@render children()}{:else}{text}{/if}</p></div>
  {#if over}
    <button type="button" class="text small fold" data-testid="clamp-text-toggle" aria-expanded={open} onclick={() => { open = !open; }}>
      <span class="ui-label">{open ? strings.activity.textLess : strings.activity.textAll}</span>{#if open}<ChevronUp size={14} aria-hidden="true" />{:else}<ChevronDown size={14} aria-hidden="true" />{/if}
    </button>
  {/if}
</div>

<style>
  .clamp-text { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; contain: inline-size; }
  .frame { align-self: stretch; min-width: 0; }
  /* Prose a decision rests on: the body's size at the conversation's reading leading, so it reads as text, not meta. */
  .body { margin: 0; min-width: 0; font-size: var(--text-body); line-height: var(--leading-reading); color: var(--color-muted-foreground); text-align: start; white-space: pre-wrap; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; }
  .body.open { display: block; -webkit-line-clamp: none; line-clamp: none; overflow-x: auto; scrollbar-width: thin; }
  /* The command as it will run, the code block's face; the frame holds the padding, so a fifth line never peeks under the fourth. */
  .mono .frame { padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-code-background); }
  .mono .body { color: var(--color-code-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.5; overflow-wrap: normal; }
  /* The family's text button on the text's edge: words then the chevron, no underline. */
  .fold { margin: 2px 0 0 -6px; color: var(--color-foreground); font-size: var(--text-sm); font-weight: 500; }
  .fold:hover:not(:disabled) { background: var(--color-hover); }
  .fold :global(svg) { flex: none; color: var(--color-muted-foreground); }
</style>
