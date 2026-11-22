<script lang="ts">
  import { untrack } from 'svelte';
  import { Autosave } from '../lib/autosave.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import SettingField from './SettingField.svelte';
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

<SettingField title={label} help={hint} error={valid ? undefined : strings.settings.deleted.retentionError}>
  {#snippet actions()}<SyncMark {store} {key} />{/snippet}
  {#snippet control(attributes)}
    <span class="field">
      <SaveStatus {save} />
      <input {...attributes} type="number" inputmode="numeric" min="0" max="3650" step="1" bind:value={days}
        disabled={!store.settings || store.connection !== 'ready'}
        oninput={() => { dirty = true; }} onchange={commit} onkeydown={(event) => { if (event.key === 'Enter') commit(); }}
        data-testid={testid} />
      <span class="unit ui-label">{strings.units.days}</span>
    </span>
  {/snippet}
</SettingField>

<style>
  .field { display: inline-flex; flex: none; align-items: center; gap: var(--space-2); }
  input { width: 72px; text-align: right; }
  input[aria-invalid='true'] { border-color: var(--color-danger); }
  .unit { color: var(--color-muted-foreground); font-size: var(--text-sm); }
</style>
