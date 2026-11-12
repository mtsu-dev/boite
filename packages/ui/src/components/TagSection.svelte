<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Tag } from '@lucide/svelte';
  import { projectView } from '../lib/project-view.svelte';
  import { UNTAGGED } from '../lib/project-tags';
  import { strings } from '../lib/strings';
  import FoldHeader from './FoldHeader.svelte';

  /**
   * The projects carrying one tag, in the Projects view grouped by tag, on
   * desktop and phone. Its header folds it, and the fold is kept on this
   * device by tag (`projectView.folded`); the cards stay mounted under it.
   */
  let { tag, label, count, children }: { tag: string; label: string; count: number; children: Snippet } = $props();
  const uid = $props.id();
  const open = $derived(projectView.tagOpen(tag));
  const untagged = $derived(tag === UNTAGGED);
</script>

<section class="tag-section" class:untagged data-testid="tag-section" data-tag={tag}>
  <FoldHeader label={untagged ? strings.sidebar.tags.untagged : label} {count} {open} controls={uid} testid="tag-section-toggle" onclick={() => projectView.toggleTag(tag)}>
    {#snippet icon()}<span class="glyph" aria-hidden="true"><Tag size={14} /></span>{/snippet}
  </FoldHeader>
  <div id={uid} class="disclosure-fold" class:open inert={!open}><div class="cards">{@render children()}</div></div>
</section>

<style>
  /* A rule above each tag after the first: the sections read as shelves, the tag's glyph in the accent. */
  :global(.tag-section + .tag-section) { border-top: 1px solid var(--color-border); }
  .tag-section :global(.fold-header .label) { color: var(--color-foreground); font-weight: 500; }
  .untagged :global(.fold-header .label) { color: var(--color-muted-foreground); font-weight: inherit; }
  .glyph { display: inline-flex; flex: none; color: var(--color-accent); }
  .untagged .glyph { color: var(--color-subtle); }
  .cards { padding-top: 2px; padding-bottom: 4px; }
</style>
