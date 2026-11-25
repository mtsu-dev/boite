<script lang="ts">
  /*
   * What the machine keeps of a conversation as it ages: four modes in a row,
   * the life of a conversation under the one picked, and what applying it
   * would free, measured before anything is touched. Nothing is saved until
   * Apply; with no mode saved, nothing is compacted.
   */
  import { Archive, ArrowRight, Check, ChevronDown, HardDrive, Lock, SlidersHorizontal, Trash2 } from '@lucide/svelte';
  import {
    DEFAULT_THREAD_DELETION_RETENTION_DAYS, TRANSCRIPT_DAYS_MAX, TRANSCRIPT_MODES, TRANSCRIPT_POLICY_FIELDS, TRANSCRIPT_PRESETS, transcriptPolicy,
    type TranscriptMode, type TranscriptPolicy, type TranscriptPreview, type TranscriptProgress,
  } from '@boite/contracts';
  import { errorText } from '../lib/errors';
  import { bytes } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import InfoTip from './InfoTip.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let { store }: { store: Store } = $props();
  const words = $derived(strings.settings.transcripts);
  const ICONS = { delete: Trash2, classic: Archive, storage: HardDrive, custom: SlidersHorizontal };

  const saved = $derived(store.settings?.transcriptStorage);
  const applied = $derived<TranscriptMode | null>(saved?.mode ?? null);
  /** The mode looked at; null follows the saved one. */
  let chosen = $state<TranscriptMode | null>(null);
  const picked = $derived(chosen ?? applied);
  let open = $state(false);
  /** Custom as edited here; until then the saved one, or what the machine does today. */
  let edited = $state<TranscriptPolicy | null>(null);
  const custom = $derived(edited ?? saved?.custom ?? transcriptPolicy(undefined, store.settings?.threadDeletionRetentionDays ?? DEFAULT_THREAD_DELETION_RETENTION_DAYS));
  const policyOf = (mode: TranscriptMode): TranscriptPolicy => mode === 'custom' ? custom : TRANSCRIPT_PRESETS[mode];
  const policy = $derived(picked === null ? null : policyOf(picked));
  const dirty = $derived(picked !== null && (picked !== applied || (picked === 'custom' && JSON.stringify(custom) !== JSON.stringify(saved?.custom))));

  let preview = $state<TranscriptPreview | null>(null);
  let measuring = $state(false);
  let progress = $state<TranscriptProgress | null>(null);
  let saving = $state(false);
  let generation = 0;
  /** Bumped when a pass ends: what is left to free has changed. */
  let passes = $state(0);

  $effect(() => {
    const client = store.client;
    const asked = policy === null ? null : JSON.stringify(policy);
    void passes;
    if (!client || !store.owner || store.connection !== 'ready' || asked === null) { preview = null; return; }
    const current = ++generation;
    measuring = true;
    // A custom delay is typed digit by digit: measure once it settles.
    const timer = setTimeout(() => {
      client.call('transcripts.preview', { policy: JSON.parse(asked) as TranscriptPolicy })
        .then(result => { if (current === generation) preview = result; })
        .catch(error => { if (current === generation) { preview = null; store.error = errorText(error); } })
        .finally(() => { if (current === generation) measuring = false; });
    }, picked === 'custom' ? 400 : 0);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    const client = store.client;
    if (!client || !store.owner || store.connection !== 'ready') return;
    client.call('transcripts.progress', {}).then(result => { progress = result; }).catch(() => {});
    return client.on('transcripts.progress', result => {
      if (progress?.running === true && !result.running) passes += 1;
      progress = result;
    });
  });

  function pick(mode: TranscriptMode): void {
    chosen = mode;
    if (mode === 'custom') open = true;
  }

  function setDays(field: keyof TranscriptPolicy, text: string): void {
    const value = text.trim() === '' ? null : Math.min(TRANSCRIPT_DAYS_MAX, Math.max(0, Math.floor(Number(text))));
    edited = { ...custom, [field]: value !== null && Number.isFinite(value) ? value : null };
  }

  async function apply(): Promise<void> {
    if (picked === null) return;
    saving = true;
    try {
      // A preset keeps the custom delays saved before: picking Custom again finds them.
      const kept = saved?.custom === undefined ? {} : { custom: saved.custom };
      if (await store.saveSettings({ transcriptStorage: picked === 'custom' ? { mode: 'custom', custom } : { mode: picked, ...kept } })) { chosen = null; edited = null; }
    } finally { saving = false; }
  }

  async function compactUnlinked(): Promise<void> {
    try { progress = await store.client!.call('transcripts.compactUnlinked', { days: 7 }); }
    catch (error) { store.error = errorText(error); }
  }

  const days = (count: number): string => fill(count === 1 ? words.day : words.days, { count: String(count) });
  const cell = (value: number | null): string => value === null ? words.never : value === 0 ? words.atOnce : days(value);

  /** The life of a conversation under a policy, in the order things happen to it. */
  function life(p: TranscriptPolicy): { when: string; what: string }[] {
    const steps: { at: number; what: string }[] = [];
    const erase = p.deletedEraseDays;
    if (p.deletedCompactDays !== null && (erase === null || p.deletedCompactDays < erase)) steps.push({ at: p.deletedCompactDays, what: words.steps.compacted });
    if (p.imagesEraseDays !== null && (erase === null || p.imagesEraseDays < erase)) steps.push({ at: p.imagesEraseDays, what: words.steps.images });
    if (erase !== null) steps.push({ at: erase, what: words.steps.erased });
    steps.sort((a, b) => a.at - b.at);
    const out = steps.map(step => ({ when: step.at === 0 ? words.steps.deletedNow : fill(words.steps.deletedFor, { days: days(step.at) }), what: step.what }));
    if (erase === null) out.push({ when: words.steps.after, what: steps.length === 0 ? words.steps.keptWhole : words.steps.kept });
    if (p.idleCompactDays !== null) out.unshift({ when: fill(words.steps.idleFor, { days: days(p.idleCompactDays) }), what: words.steps.compactedOpen });
    return out;
  }
</script>

{#if store.owner}
  <SettingsSection id="settings-transcripts" testid="transcript-storage" title={words.heading} info={words.info}>
    {#snippet actions()}{#if preview}<span class="used" data-testid="transcript-total">{bytes(preview.totalBytes)}</span>{/if}{/snippet}

    <!-- One child for the card: its own spacing, no rule between the parts. -->
    <div class="body">
    <div class="modes" role="radiogroup" aria-label={words.heading}>
      {#each TRANSCRIPT_MODES as mode (mode)}
        {@const Icon = ICONS[mode]}
        <button type="button" role="radio" class="mode" class:on={picked === mode} aria-checked={picked === mode} data-testid="transcript-mode-{mode}" onclick={() => pick(mode)}>
          <span class="head">
            <Icon size={16} strokeWidth={2} />
            <span class="name">{words.modes[mode].name}</span>
            {#if applied === mode}<span class="current" data-testid="transcript-current"><Check size={12} strokeWidth={3} />{words.current}</span>{/if}
          </span>
          <span class="line">{words.modes[mode].line}</span>
        </button>
      {/each}
    </div>

    {#if policy === null}
      <p class="muted none" data-testid="transcript-none">{words.none}</p>
    {:else}
      <ol class="life" data-testid="transcript-life">
        {#each life(policy) as step, index (index)}
          {#if index > 0}<li class="then" aria-hidden="true"><ArrowRight size={14} strokeWidth={2} /></li>{/if}
          <li class="step"><span class="when">{step.when}</span><span class="what">{step.what}</span></li>
        {/each}
      </ol>

      <div class="gain" data-testid="transcript-preview">
        <div class="said">
          {#if preview}
            <strong>{preview.freedBytes > 0 ? fill(words.frees, { size: bytes(preview.freedBytes) }) : words.freesNothing}</strong>
            <span class="subtle">{fill(words.counts, { compact: String(preview.compact.threads), erase: String(preview.erase.threads) })}</span>
          {:else if measuring}
            <span class="subtle">{words.measuring}</span>
          {/if}
          {#if progress?.running}
            <span class="subtle" data-testid="transcript-progress">{fill(words.running, { left: String(progress.remaining), size: bytes(progress.freedBytes) })}</span>
          {:else if progress?.lastError}
            <span class="subtle" data-testid="transcript-error">{fill(words.failed, { error: progress.lastError })}</span>
          {:else if progress?.finishedAt && progress.freedBytes > 0}
            <span class="subtle" data-testid="transcript-progress">{fill(words.finished, { size: bytes(progress.freedBytes) })}</span>
          {/if}
        </div>
        <button type="button" class="primary" data-testid="transcript-apply" disabled={!dirty || saving || measuring || store.connection !== 'ready'} onclick={() => void apply()}>
          <span class="ui-label">{preview && preview.erase.threads > 0 && dirty ? fill(words.applyErases, { count: String(preview.erase.threads) }) : words.apply}</span>
        </button>
      </div>
    {/if}

    <button type="button" class="more" aria-expanded={open} onclick={() => { open = !open; }} data-testid="transcript-compare">
      <ChevronDown size={14} strokeWidth={2} /><span class="ui-label">{words.compare}</span>
    </button>

    {#if open}
      <div class="table" role="table" data-testid="transcript-table">
        <div class="tr th" role="row">
          <span role="columnheader"></span>
          {#each TRANSCRIPT_MODES as mode (mode)}<span role="columnheader" class:on={picked === mode}>{words.modes[mode].name}</span>{/each}
        </div>
        {#each TRANSCRIPT_POLICY_FIELDS as field (field)}
          <div class="tr" role="row">
            <span role="rowheader" class="ui-label-box"><span class="ui-label">{words.fields[field].label}</span><InfoTip topic={words.fields[field].label} text={words.fields[field].tip} /></span>
            {#each TRANSCRIPT_MODES as mode (mode)}
              {@const value = policyOf(mode)[field]}
              <span role="cell" class:on={picked === mode} class:never={value === null}>
                {#if mode === 'custom' && picked === 'custom'}
                  <label class="days"><input type="number" inputmode="numeric" min="0" max={TRANSCRIPT_DAYS_MAX} step="1" placeholder={words.never} aria-label={words.fields[field].label}
                    data-testid="transcript-custom-{field}" value={value ?? ''} oninput={event => setDays(field, event.currentTarget.value)} /><span>{words.dayUnit}</span></label>
                {:else}{cell(value)}{/if}
              </span>
            {/each}
          </div>
        {/each}
        <div class="tr always" role="row">
          <span role="rowheader"><Lock size={12} strokeWidth={2} /> {words.usage}</span>
          <span role="cell" class="span">{words.usageKept}</span>
        </div>
      </div>
    {/if}

    {#if applied !== null && preview && preview.unlinked.sessions > 0}
      <div class="unlinked" data-testid="transcript-unlinked">
        <span class="ui-label-box"><span class="ui-label">{fill(words.unlinked, { size: bytes(preview.unlinked.bytes), count: String(preview.unlinked.sessions) })}</span><InfoTip topic={words.unlinkedTopic} text={words.unlinkedTip} /></span>
        <button type="button" class="small" data-testid="transcript-unlinked-compact" disabled={progress?.running === true || store.connection !== 'ready'} onclick={() => void compactUnlinked()}>
          <span class="ui-label">{words.unlinkedCompact}</span>
        </button>
      </div>
    {/if}
    </div>
  </SettingsSection>
{/if}

<style>
  .used { margin-left: auto; color: var(--color-subtle); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }

  .body { display: flex; flex-direction: column; padding-top: var(--space-2); }
  .modes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
  .mode { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: var(--space-1); height: auto; padding: var(--space-3); text-align: left; white-space: normal;
    background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: none; color: var(--color-foreground);
    transition: background var(--dur-2) var(--ease-out-quint), border-color var(--dur-2) var(--ease-out-quint); }
  .mode:hover { background: var(--color-surface-3); }
  .mode.on { background: var(--color-accent-soft); border-color: var(--color-accent); }
  .head { display: flex; align-items: center; gap: var(--space-2); min-height: 18px; }
  .name { font-weight: 600; }
  .current { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; color: var(--color-subtle); font-size: var(--text-sm); }
  .line { color: var(--color-subtle); font-size: var(--text-sm); line-height: 1.35; }
  .none { margin: var(--space-3) 0 0; }

  /* One conversation's life, left to right. */
  .life { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-4) 0 0; padding: 0; list-style: none; }
  .step { display: grid; gap: 2px; padding: var(--space-2) var(--space-3); background: var(--color-surface-2); border-radius: var(--radius-md); }
  .when { color: var(--color-subtle); font-size: var(--text-sm); }
  .what { font-weight: 600; }
  .then { display: flex; color: var(--color-faint); }

  .gain { display: flex; align-items: center; gap: var(--space-4); margin-top: var(--space-4); }
  .said { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .said strong { font-size: var(--text-lg); font-variant-numeric: tabular-nums; }
  .said .subtle { font-size: var(--text-sm); }
  .gain button { flex: none; }

  .more { align-self: flex-start; margin-top: var(--space-2); padding-inline: var(--space-2); background: none; border: none; box-shadow: none; color: var(--color-subtle); gap: var(--space-1); }
  .more :global(svg) { transition: rotate var(--dur-2) var(--ease-out-quint); }
  .more[aria-expanded='true'] :global(svg) { rotate: 180deg; }

  .table { margin-top: var(--space-1); font-variant-numeric: tabular-nums; }
  .tr { display: grid; grid-template-columns: minmax(180px, 1.5fr) repeat(4, minmax(0, 1fr)); align-items: stretch; }
  .tr > span { display: flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 var(--space-2); border-top: 1px solid var(--color-border); }
  .tr > span:first-child { justify-content: flex-start; padding-left: 0; }
  .th > span { min-height: 32px; border-top: none; color: var(--color-subtle); font-size: var(--text-sm); }
  .tr > .on { background: var(--color-accent-soft); color: var(--color-foreground); }
  .th > .on { border-radius: var(--radius-md) var(--radius-md) 0 0; font-weight: 600; }
  .never { color: var(--color-subtle); }
  .always > span { color: var(--color-subtle); font-size: var(--text-sm); gap: var(--space-1); }
  .always .span { grid-column: 2 / -1; }
  .days { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--color-subtle); font-size: var(--text-sm); }
  .days input { width: 84px; height: 28px; text-align: right; }

  .unlinked { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); padding-block: var(--space-3); border-top: 1px solid var(--color-border); }
  .unlinked > span { flex: 1; min-width: 0; }
  .unlinked button { flex: none; }

  @media (max-width: 720px) {
    .modes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gain, .unlinked, .life { flex-direction: column; align-items: stretch; }
    .then { display: none; }
    .table { overflow-x: auto; }
    .tr { grid-template-columns: 150px repeat(4, 84px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .mode, .more :global(svg) { transition: none; }
  }
</style>
