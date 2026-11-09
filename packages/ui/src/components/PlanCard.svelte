<script lang="ts">
  import { errorText } from '../lib/errors';
  import { Check, Copy, Download, FolderDown } from '@lucide/svelte';
  import { planFileName } from '../lib/plan';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import Prose from './Prose.svelte';

  /**
   * The plan an agent proposes before it edits, read as a document rather than
   * a tool's JSON: copy it, download it as markdown, or write it into the
   * thread's folder. Writing is the editor's save, so only the owner gets it.
   */
  let { store, threadId, plan }: { store: Store; threadId: string; plan: string } = $props();

  /** Its ticked steps (`- [x]`) over all of them; a plan with no ticks counts none. */
  const tasks = $derived.by(() => {
    const marks = [...plan.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/gm)];
    return { done: marks.filter((mark) => mark[1] !== ' ').length, total: marks.length };
  });
  /** A plan headed "Plan" says it once, in the head. */
  const leadIsLabel = $derived(/^\s*#{1,6}\s+plan\s*\n/i.test(plan));
  let copied = $state(false);
  let saving = $state(false);
  let saved = $state<string | null>(null);
  let reset = 0;
  $effect(() => () => clearTimeout(reset));

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(plan);
    } catch {
      return;
    }
    copied = true;
    clearTimeout(reset);
    reset = window.setTimeout(() => { copied = false; }, 1500);
  }

  function download(): void {
    const url = URL.createObjectURL(new Blob([plan], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = planFileName(plan);
    link.click();
    // Firefox and Safari start the download after this task, so the URL lives a second.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function save(): Promise<void> {
    const client = store.client;
    if (!client || saving) return;
    saving = true;
    try {
      const names = (await client.call('files.list', { threadId })).map((entry) => entry.name);
      const name = planFileName(plan, names);
      await client.call('files.write', { threadId, path: name, text: plan });
      saved = name;
    } catch (error) {
      store.error = errorText(error);
    } finally {
      saving = false;
    }
  }
</script>

<section class="plan" class:lead={leadIsLabel} data-testid="plan-card">
  <div class="head">
    <span class="title">{strings.chat.plan}</span>
    {#if tasks.total > 0}<span class="count">{fill(strings.chat.planProgress, { done: String(tasks.done), total: String(tasks.total) })}</span>{/if}
    {#if saved}<span class="saved" title={fill(strings.chat.planSaved, { name: saved })}>{fill(strings.chat.planSaved, { name: saved })}</span>{/if}
    <span class="actions">
      <button type="button" class="ghost icon small" data-testid="plan-copy" title={copied ? strings.chat.copied : strings.common.copy} onclick={() => void copy()}>
        {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
      </button>
      <button type="button" class="ghost icon small" data-testid="plan-download" title={strings.chat.planDownload} onclick={download}><Download size={14} /></button>
      {#if store.owner}
        {@const label = saved ? fill(strings.chat.planSaved, { name: saved }) : strings.chat.planSave}
        <button type="button" class="ghost icon small" data-testid="plan-save" disabled={saving || saved !== null || store.connection !== 'ready'}
          title={saved ? label : strings.chat.planSaveHint} aria-label={label} onclick={() => void save()}>
          {#if saved}<Check size={14} />{:else}<FolderDown size={14} />{/if}
        </button>
      {/if}
    </span>
  </div>
  <div class="body"><Prose text={plan} {store} {threadId} /></div>
</section>

<style>
  /* In the text flow under one hairline, no box: the plan is read, not pressed; bordered cards are kept for what
     the user decides or operates (round 20). */
  .plan {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 4px 0 0;
    border-top: 1px solid var(--color-border);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: var(--control-sm);
    font-size: var(--instrument-meta-size);
    color: var(--instrument-meta);
  }

  .title { color: var(--instrument-ink); font-weight: 600; }
  .count { font-variant-numeric: tabular-nums; }
  .saved { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* The buttons stay quiet until the plan is pointed at; a finger always has them. */
  .actions { display: flex; gap: 2px; margin-left: auto; opacity: 0; transition: opacity var(--dur-2); }
  .plan:hover .actions, .plan:focus-within .actions { opacity: 1; }
  .actions button { color: var(--color-subtle); }
  .actions button:hover:not(:disabled) { color: var(--color-foreground); }
  @media (hover: none) { .actions { opacity: 1; } }

  .body { min-width: 0; padding-right: 4px; color: var(--instrument-ink); }
  /* The instrumental tier under the agent's words (app.css --instrument-*): the reply stays the one full-size layer. */
  .body :global(.prose) { font-size: var(--instrument-size); line-height: var(--instrument-leading); }
  /* Normal weight: the agent's bold lead words read as the step, not as a shout. */
  .body :global(strong) { font-weight: inherit; }
  .body :global(:is(h1, h2, h3, h4, h5, h6)) { font-size: var(--instrument-meta-size); font-weight: 600; margin: 10px 0 4px; }
  /* A plan headed "Plan" says it once, in the head above. */
  .lead .body :global(.paragraph:first-child > :is(h1, h2, h3, h4, h5, h6):first-child) { display: none; }
  .lead .body :global(.paragraph:first-child:has(> :is(h1, h2, h3, h4, h5, h6):only-child)) { display: none; }
  /* Steps the agent ticked are struck and grey; the next one is in full ink, the rest wait in grey. */
  .body :global(li.task) { color: var(--instrument-ink); }
  .body :global(li.task:has(> input:checked)) { color: var(--color-subtle); text-decoration: line-through; text-decoration-color: var(--color-edge); }
  .body :global(li.task:first-child:not(:has(> input:checked))),
  .body :global(li.task:has(> input:checked) + li.task:not(:has(> input:checked))) { color: var(--color-foreground); }

  @media (max-width: 720px) {
    .actions button { width: var(--touch-target); height: var(--touch-target); }
  }
</style>
