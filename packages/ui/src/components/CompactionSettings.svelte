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
    <h2 class="ui-label-box"><span class="ui-label" id="{uid}-scope">{strings.settings.compactionScope}</span></h2>
    <div class="scope" role="group" aria-labelledby="{uid}-scope">
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
  .scope { display: flex; flex-wrap: wrap; gap: 6px; padding: var(--space-3) 0; }
  .ui-chip { flex: 1; justify-content: center; min-width: max-content; }
  .ui-chip.picked { border-color: var(--color-muted-foreground); color: var(--color-foreground); background: var(--color-active); }
  .customize { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: var(--space-3) 0; }
  .words { display: flex; align-items: center; gap: 8px; }
  .hint { margin: 0 0 20px; }
  fieldset { border: 0; padding: var(--space-3) 0; margin: 0; min-width: 0; }
  fieldset:disabled { opacity: 0.6; }
  @media (max-width: 720px) {
    .scope { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ui-chip { min-width: 0; }
  }
</style>
