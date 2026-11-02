<script lang="ts">
  import { SquareDashedMousePointer } from '@lucide/svelte';
  import type { MessagePart, WindowGuideAnswer } from '@boite/contracts';
  import { errorText } from '../lib/errors';
  import { keepFocus } from '../lib/focus';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * A box an agent shows on the screen with `boite window point`
   * (docs/windows.md). The box is click-through, so the person answers it
   * here, from any of the owner's devices: Done takes it away, I can't find it
   * takes it away and tells the agent so. Once the box ends, or its time
   * passed, the card shrinks to one quiet row saying how it ended. A box
   * that is one step of a tour carries its `2 / 5` badge in both, as the box
   * on the screen does.
   */
  let { store, threadId, part }: {
    store: Store;
    threadId: string;
    part: Extract<MessagePart, { type: 'window_guide' }>;
  } = $props();
  const s = strings.windows.guide;

  let busy = $state(false), error = $state(''), now = $state(Date.now());
  const outcome = $derived(part.end ?? (now >= part.expiresAt ? 'timeout' : null));
  const app = $derived(part.process.replace(/\.exe$/i, ''));
  const what = $derived(part.label || part.control?.name || '');
  const step = $derived(part.step ? { index: String(part.step.index), total: String(part.step.total) } : null);

  // The card turns itself over when the box's time ends, without waiting for the core's word.
  $effect(() => {
    if (part.end !== null) return;
    const left = part.expiresAt - Date.now();
    if (left <= 0) { now = Date.now(); return; }
    const timer = setTimeout(() => { now = Date.now(); }, left + 50);
    return () => clearTimeout(timer);
  });

  async function answer(given: WindowGuideAnswer): Promise<void> {
    const client = store.client;
    if (busy || !client) return;
    busy = true; error = '';
    try { await client.call('windows.dismiss', { threadId, boxId: part.boxId, answer: given }); }
    catch (cause) { error = errorText(cause); busy = false; }
  }
</script>

{#if outcome !== null}
  {@const verdict = fill(s.ends[outcome], { app })}
  <div class="guide resolved" data-testid="window-guide" data-state="ended" data-end={outcome}>
    <span class="glyph"><SquareDashedMousePointer size={15} strokeWidth={1.75} /></span>
    {#if step}<span class="step" data-testid="window-guide-step" title={fill(strings.windows.pointer.stepLabel, step)}>{fill(strings.windows.pointer.step, step)}</span>{/if}
    <span class="verdict ui-label" data-testid="window-guide-verdict">{what ? fill(s.ended, { verdict, what }) : verdict}</span>
  </div>
{:else}
  <div class="guide" data-testid="window-guide" data-state="shown" role="group" aria-label={what || fill(s.boxIn, { app })}>
    <span class="glyph live"><SquareDashedMousePointer size={15} strokeWidth={1.75} /></span>
    <div class="body">
      <span class="title">
        {#if step}<span class="step" data-testid="window-guide-step" title={fill(strings.windows.pointer.stepLabel, step)}>{fill(strings.windows.pointer.step, step)}</span>{/if}
        <span class="what" data-testid="window-guide-what">{what || fill(s.boxIn, { app })}</span>
      </span>
      <span class="hint">{fill(s.hint, { app })}</span>
      {#if error}<span class="error" role="status" data-testid="window-guide-error">{error}</span>{/if}
    </div>
    <div class="actions">
      <button type="button" class="primary" data-testid="window-guide-done" title={s.doneTitle} disabled={busy} onmousedown={keepFocus} onclick={() => answer('dismissed')}><span class="ui-label">{s.done}</span></button>
      <button type="button" class="ghost" data-testid="window-guide-missing" title={s.missingTitle} disabled={busy} onmousedown={keepFocus} onclick={() => answer('missing')}><span class="ui-label">{s.missing}</span></button>
    </div>
  </div>
{/if}

<style>
  /* One row, as small as a box on the screen is: what it shows on the left, the two answers on the right. */
  .guide {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    border: 1px solid var(--color-edge);
    border-left-style: dashed;
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-e1);
    padding: 8px 10px 8px 12px;
  }
  .glyph { display: inline-flex; flex: none; color: var(--color-accent); }
  .body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .what { min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
  /* The tour's step, as on the box's label: a small pill of the accent's soft tint. */
  .step {
    flex: none;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: var(--color-accent-soft);
    color: var(--color-accent);
    font-size: var(--text-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .resolved .step { background: var(--color-surface-2); color: var(--color-muted-foreground); font-weight: 500; }
  .hint { font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .error { font-size: var(--text-sm); color: var(--color-danger); overflow-wrap: anywhere; }
  .actions { display: flex; flex: none; gap: 6px; }

  /* A phone's column has no room beside the text: the answers go under it, full width. */
  @media (max-width: 720px) {
    .guide:not(.resolved) { flex-wrap: wrap; align-items: flex-start; }
    .actions { flex-basis: 100%; }
    .actions button { flex: 1; }
  }

  /* Ended: one quiet row in the timeline, like an answered question. */
  .guide.resolved {
    gap: var(--activity-gap);
    border: none;
    background: transparent;
    box-shadow: none;
    min-height: var(--control);
    padding: var(--activity-padding);
    color: var(--color-muted-foreground);
  }
  .resolved .glyph { width: var(--activity-glyph); justify-content: center; color: var(--color-subtle); }
  .verdict { min-width: 0; font-size: var(--text-sm); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
