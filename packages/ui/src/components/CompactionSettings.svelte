<script lang="ts">
  import { experimentsRun, type CompactionTarget } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';
  import { compactionPolicy } from '../lib/compaction-settings';
  import AutoCompactSettings from './AutoCompactSettings.svelte';
  import BackgroundCompactionSettings from './BackgroundCompactionSettings.svelte';
  import InfoTip from './InfoTip.svelte';

  let { store, backgroundOnly = false }: { store: Store; backgroundOnly?: boolean } = $props();
  let target = $state<CompactionTarget | undefined>();
  let saving = $state(false);
  let editor = $state<{ flush: () => Promise<void> }>();
  const uid = $props.id();
  const targets = $derived([
    { id: undefined, label: strings.settings.compactionCommon },
    { id: 'agent' as const, label: strings.settings.compactionAgent },
    { id: 'subagent' as const, label: strings.settings.compactionSubagent },
    { id: 'bot' as const, label: strings.settings.compactionBot },
  ]);
  const customized = $derived(target !== undefined && store.settings?.compactionByType?.[target] !== undefined);
  async function pick(next: CompactionTarget | undefined) {
    if (saving || next === target) return;
    saving = true;
    try {
      await editor?.flush();
      target = next;
    } finally { saving = false; }
  }
  async function customize(input: HTMLInputElement) {
    if (!target) return;
    saving = true;
    try {
      await editor?.flush();
      const next = { ...store.settings?.compactionByType };
      if (input.checked) next[target] = structuredClone($state.snapshot(compactionPolicy(store.settings, target)));
      else delete next[target];
      if (!await store.saveSettings({ compactionByType: next })) input.checked = !input.checked;
    } finally { saving = false; }
  }
</script>

{#if store.owner}
  <section class="card" data-testid="compaction-settings">
    <div class="scope" role="group" aria-label={strings.settings.compactionScope}>
      {#each targets as item (item.id)}
        <button type="button" class="ui-chip" class:picked={target === item.id} aria-pressed={target === item.id}
          data-testid="compaction-target-{item.id ?? 'common'}" disabled={saving} onclick={() => void pick(item.id)}><span class="ui-label">{item.label}</span></button>
      {/each}
    </div>
    {#if target}
      <div class="customize">
        <span class="words"><label for="{uid}-custom" class="ui-label">{strings.settings.compactionCustomize}</label><InfoTip topic={strings.settings.compactionCustomize} text={experimentsRun(store.core?.version) ? strings.settings.compactionInheritanceHint : strings.settings.compactionInheritanceHintRelease} /></span>
        <input id="{uid}-custom" type="checkbox" role="switch" data-testid="compaction-customize" checked={customized}
          disabled={!store.settings || saving} onchange={(event) => void customize(event.currentTarget)} />
      </div>
      {#if !customized}<p class="hint" data-testid="compaction-inherited">{strings.settings.compactionInherited}</p>{/if}
    {/if}
    {#key `${target ?? 'common'}:${customized}`}
      <fieldset disabled={saving || (target !== undefined && !customized)}>
        {#if backgroundOnly}<BackgroundCompactionSettings bind:this={editor} {store} {target} embedded />
        {:else}<AutoCompactSettings bind:this={editor} {store} {target} embedded />{/if}
      </fieldset>
    {/key}
  </section>
{/if}

<style>
  /* Rows of one card: each pads itself like a settings row, and the one line
     between two sits on the lower row's top edge, where a settings page's
     card draws its own (styles/settings.css): one line, on any page. */
  .card > .scope { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: var(--space-3) 0; }
  .ui-chip { flex: 1; justify-content: center; min-width: max-content; }
  .ui-chip.picked { border-color: var(--color-muted-foreground); color: var(--color-foreground); background: var(--color-active); }
  .customize { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: var(--space-3) 0; border-top: 1px solid var(--color-border); }
  .words { display: flex; align-items: center; gap: 8px; }
  .hint { margin: 0 0 var(--space-3); }
  fieldset { border: 0; border-top: 1px solid var(--color-border); padding: var(--space-3) 0; margin: 0; min-width: 0; }
  fieldset:disabled { opacity: 0.6; }
  @media (max-width: 720px) {
    .card > .scope { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ui-chip { min-width: 0; }
  }
</style>
