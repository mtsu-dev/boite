<script lang="ts">
  import { Check, ChevronRight, FolderOpen, Plug } from '@lucide/svelte';
  import { firstRunSteps, skipFolderStep } from '../../lib/first-run.svelte';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';

  /**
   * The empty app's welcome: connect an AI, then pick a folder, each step a
   * button into the flow that does it (the connect dialog, the folder
   * picker). It stands where the composer would, which could send nothing
   * yet. `prefix` tells the phone's list copy from the home card's in tests.
   */
  let { store, prefix = '' }: { store: Store; prefix?: string } = $props();
  const labels = $derived(strings.firstRun);
  const steps = $derived(firstRunSteps(store));
</script>

<section class="first-run" data-testid="{prefix}first-run" aria-labelledby="{prefix}first-run-title">
  <img class="mark" src="./icons/icon.svg" alt="" width="44" height="44" />
  <h1 id="{prefix}first-run-title">{labels.welcome}</h1>
  <p class="lead">{labels.welcomeBody}</p>
  <ol class="steps" aria-label={labels.steps}>
    {@render step(1, steps.connected, labels.connect, labels.connectHint, labels.connected, 'connect', !steps.connected, () => store.openConnect())}
    {@render step(2, steps.folder, labels.folder, labels.folderHint, labels.folderReady, 'folder', steps.connected && !steps.folder, () => { store.projectPickerOpen = true; })}
  </ol>
  {#if steps.connected && !steps.folder}
    <button type="button" class="ghost small skip" data-testid="{prefix}first-run-skip" onclick={skipFolderStep}><span class="ui-label">{labels.skipFolder}</span></button>
  {/if}
</section>

{#snippet step(index: number, done: boolean, title: string, hint: string, doneLabel: string, id: string, next: boolean, run: () => void)}
  <li>
    <button type="button" class="step" class:done class:next data-testid="{prefix}first-run-{id}" data-done={done} aria-label={done ? `${fill(labels.stepNumber, { index: String(index) })}: ${doneLabel}` : undefined} onclick={run}>
      <span class="number" aria-hidden="true">{#if done}<Check size={16} strokeWidth={2.5} />{:else if id === 'connect'}<Plug size={16} />{:else}<FolderOpen size={16} />{/if}</span>
      <span class="text">
        <span class="eyebrow ui-label">{done ? labels.doneStep : fill(labels.stepNumber, { index: String(index) })}</span>
        <strong>{done ? doneLabel : title}</strong>
        {#if !done}<small>{hint}</small>{/if}
      </span>
      {#if !done}<ChevronRight size={18} />{/if}
    </button>
  </li>
{/snippet}

<style>
  .first-run {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    width: min(calc(100% - 40px), 520px); margin: 0 auto; text-align: center;
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  .mark { border-radius: var(--radius-lg); box-shadow: var(--shadow-e1); }
  h1 { margin: 6px 0 0; font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.3px; }
  .lead { margin: 0 0 12px; color: var(--color-muted-foreground); font-size: var(--text-base); line-height: 1.5; }
  .steps { display: flex; flex-direction: column; gap: 10px; width: 100%; margin: 0; padding: 0; list-style: none; }
  .step {
    display: flex; align-items: center; gap: 14px; width: 100%; height: auto; min-height: 72px; padding: 14px 16px;
    border: 1px solid var(--color-edge); border-radius: var(--radius-lg); background: var(--color-surface-2);
    color: var(--color-foreground); text-align: left; white-space: normal; font-weight: 400;
    transition: border-color var(--dur-1) var(--ease-out-quint), background var(--dur-1) var(--ease-out-quint);
  }
  .step:hover { border-color: color-mix(in oklch, var(--color-accent) 60%, var(--color-edge)); background: var(--color-surface-3); }
  /* The step to take now: the accent edge and a filled mark, as a primary button would be. */
  .step.next { border-color: var(--color-accent); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-accent) 16%, transparent); }
  .number {
    display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: var(--radius-full);
    background: var(--color-surface-3); color: var(--color-muted-foreground);
  }
  .next .number { background: var(--color-accent); color: var(--color-accent-ink); }
  .done .number { background: color-mix(in oklch, var(--color-success) 18%, transparent); color: var(--color-success); }
  .done { background: transparent; border-style: dashed; }
  .done strong { color: var(--color-muted-foreground); }
  .text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .eyebrow { font-size: var(--text-xs); font-weight: 500; color: var(--color-muted-foreground); }
  .next .eyebrow { color: var(--color-accent); }
  strong { font-size: var(--text-md); font-weight: 600; }
  small { font-size: var(--text-sm); color: var(--color-muted-foreground); line-height: 1.45; }
  .step > :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .skip { margin-top: 2px; color: var(--color-muted-foreground); }
  @media (prefers-reduced-motion: reduce) { .first-run { animation: none; } }
  :global(html[data-motion='reduced']) .first-run { animation: none; }
  @media (max-width: 720px) {
    /* The draft's column has no side padding on a phone: the steps keep off the screen's edges. */
    .first-run { width: calc(100% - 32px); padding-bottom: 16px; }
    .step { min-height: 76px; }
    .skip { min-height: var(--touch-target); }
  }
</style>
