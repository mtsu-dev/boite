<script lang="ts">
  import type { Snippet } from 'svelte';
  import { LoaderCircle, Pause } from '@lucide/svelte';
  import { projectThreadView } from '../lib/project-threads.svelte';
  import { strings } from '../lib/strings';
  import FoldHeader from './FoldHeader.svelte';

  /**
   * A section of project cards in the Projects view, on desktop and phone:
   * the projects at work on top, or the paused ones under the open cards. Its
   * header folds it for the session (PROJECT_FOLDS_OPEN says how it starts);
   * the cards stay mounted under the fold.
   */
  let { kind, count, children }: { kind: 'working' | 'paused'; count: number; children: Snippet } = $props();
  const uid = $props.id();
  const open = $derived(projectThreadView.foldOpen(kind));
  const label = $derived(kind === 'working' ? strings.sidebar.workingProjects : strings.sidebar.pausedProjects);
  const hint = $derived(kind === 'working' ? strings.sidebar.workingProjectsHint : strings.sidebar.pausedProjectsHint);
</script>

<section class="section {kind}" data-testid="{kind}-projects">
  <FoldHeader {label} {count} {open} controls={uid} testid="{kind}-projects-toggle" {hint} onclick={() => projectThreadView.toggleFold(kind)}>
    {#snippet icon()}<span class="glyph">{#if kind === 'working'}<LoaderCircle size={14} aria-hidden="true" />{:else}<Pause size={14} aria-hidden="true" />{/if}</span>{/snippet}
  </FoldHeader>
  <div id={uid} class="disclosure-fold" class:open inert={!open}><div class="cards">{@render children()}</div></div>
</section>

<style>
  /* At work on top, under a line that sets it apart from the open projects; paused under them, above the folds below. */
  .working { margin-bottom: 10px; border-bottom: 1px solid var(--color-border); }
  .paused { border-top: 1px solid var(--color-border); }
  /* Clipped for the fold without being a scroll box: a card's head inside sticks to the list's scroll, not to this. */
  .cards { padding-top: 2px; overflow: clip; }
  .glyph { display: inline-flex; flex: none; color: var(--color-muted-foreground); }
  @media (max-width: 720px) { .working { margin-bottom: 12px; } }
</style>
