<script lang="ts">
  import { untrack } from 'svelte';
  import { Autosave } from '../lib/autosave.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import InfoTip from './InfoTip.svelte';
  import SaveStatus from './SaveStatus.svelte';
  import SyncMark from './SyncMark.svelte';

  /**
   * A number of days a machine keeps something, as one settings row: the
   * label, then the field and its unit. It saves when the field is left or on
   * Enter, with no Save button, and says so beside the field (`SaveStatus`).
   * A value out of range stays in the field with its error under the row.
   */
  let { store, key, label, hint, fallback, testid, onsaved }: {
    store: Store;
    key: 'threadDoneRetentionDays' | 'threadDeletionRetentionDays';
    label: string;
    hint: string;
    fallback: number;
    testid: string;
    onsaved?: () => Promise<void> | void;
  } = $props();
  const uid = $props.id();

  let saved = $derived(store.settings?.[key] ?? fallback);
  let days = $state<number | null | undefined>(untrack(() => saved));
  let dirty = false;
  $effect(() => {
    const next = saved;
    untrack(() => { if (!dirty) days = next; });
  });
  const valid = $derived(typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 3650);

  const save = new Autosave(async () => {
    const value = days as number;
    // The store has already said why in its own error line.
    if (!(await store.saveSettings({ [key]: value }))) throw new Error('');
    if (days === value) dirty = false;
    await onsaved?.();
  });

  /** Left or confirmed: a valid change saves now, an unchanged field lets go. */
  function commit() {
    if (!dirty || !valid) return;
    if (days === saved) { dirty = false; return; }
    save.change(key);
  }
</script>

<div class="switch-row days">
  <!-- The label element holds only the words: a label's span child would take the muted caption style (app.css). -->
  <span class="text ui-label-box">
    <label class="ui-label" for="{uid}-days">{label}</label><InfoTip topic={label} text={hint} /><SyncMark {store} {key} />
  </span>
  <span class="field">
    <SaveStatus {save} />
    <input id="{uid}-days" type="number" inputmode="numeric" min="0" max="3650" step="1" bind:value={days}
      disabled={!store.settings || store.connection !== 'ready'}
      oninput={() => { dirty = true; }} onchange={commit} onkeydown={(event) => { if (event.key === 'Enter') commit(); }}
      aria-invalid={!valid} aria-describedby={valid ? undefined : `${uid}-error`} data-testid={testid} />
    <span class="unit ui-label">{strings.units.days}</span>
  </span>
  {#if !valid}<p id="{uid}-error" class="field-error" role="alert">{strings.settings.deleted.retentionError}</p>{/if}
</div>

<style>
  .field { display: inline-flex; flex: none; align-items: center; gap: var(--space-2); }
  input { width: 72px; text-align: right; }
  input[aria-invalid='true'] { border-color: var(--color-danger); }
  .unit { color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .field-error { flex-basis: 100%; margin: 0; color: var(--color-danger); font-size: var(--text-sm); }
  .days { flex-wrap: wrap; }
</style>
