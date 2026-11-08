<script lang="ts">
  import { CornerDownLeft, ShieldCheck, ShieldQuestion, ShieldX } from '@lucide/svelte';
  import type { PermissionRequest } from '@boite/contracts';
  import { json } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { describeTool, permissionSentence } from '../lib/tool-summary';
  import CodeText from './CodeText.svelte';
  import Deferred, { parts } from './Deferred.svelte';
  import InfoTip from './InfoTip.svelte';
  import DecisionHead from './DecisionHead.svelte';
  import { arrive } from '../lib/arrival';

  let {
    toolName,
    decision,
    request,
    answer,
    docked = false,
    index = 1,
    total = 1
  }: {
    toolName: string;
    decision: 'allow' | 'deny' | null;
    request: PermissionRequest | null;
    /** False, or a promise of false, gives the buttons back: the answer did not reach the core. */
    answer: (decision: 'allow' | 'deny') => unknown;
    /**
     * Drawn at the top of the composer, where the field below stays free:
     * the ask on one line with its raw input behind an "i", the thing itself
     * in mono, the reason, then Deny (Esc) and Allow (Enter).
     */
    docked?: boolean;
    /** Its place among the thread's pending asks, said only when there are several. */
    index?: number;
    total?: number;
  } = $props();

  /**
   * The decision out to the core: both buttons stay down until it lands, so a
   * second tap sends nothing and the card shows its answer was taken.
   */
  let sending = $state<'allow' | 'deny' | null>(null);

  async function choose(choice: 'allow' | 'deny'): Promise<void> {
    if (sending !== null || decision !== null || (choice === 'allow' && previewMissing)) return;
    sending = choice;
    if ((await answer(choice)) === false) sending = null;
  }

  /**
   * One sentence says what the agent wants to do; under it, the thing itself
   * (the command, the change as a diff, the address) and the agent's reason.
   * The raw input stays one click away for whoever wants it. The state reads
   * from the shield: a question while it waits, a check or a cross once answered.
   */
  let described = $derived(describeTool(toolName, request?.input ?? null));
  let sentence = $derived(permissionSentence(toolName, request?.input ?? null));
  let subjectBlock = $derived(
    described.change === null && (described.family === 'command' || described.family === 'fetch' || described.family === 'search' || described.family === 'web')
      ? described.subject
      : ''
  );
  /** The agent's reason, when it says more than the subject shown. */
  let why = $derived(request?.description && request.description !== subjectBlock ? request.description : '');
  // A change is approved on what it shows: Allow waits for the diff's chunk, which says
  // it is loading or offers a retry meanwhile (Deferred.svelte). Deny never waits.
  let previewMissing = $derived(described.change !== null && parts.DiffView.current === undefined);

  /** With the card itself focused, Enter allows and Escape denies, as the key hints say. */
  function keys(node: HTMLElement): () => void {
    const onkey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void choose('deny'); }
      else if (event.key === 'Enter' && event.target === node) { event.preventDefault(); void choose('allow'); }
    };
    node.addEventListener('keydown', onkey);
    return () => node.removeEventListener('keydown', onkey);
  }
</script>

{#if docked}
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="permission docked decision-card" data-testid="permission-card" data-decision="pending" data-family={described.family} role="group" aria-label={sentence} tabindex="-1" {@attach keys} {@attach arrive}>
  <DecisionHead>
    <span class="sentence ui-label" data-testid="permission-sentence" title={described.subject || toolName}>{sentence}</span>
    {#if request}<InfoTip text={`${why ? `${why}\n\n` : ''}${toolName}\n${json(request.input)}`} topic={sentence} testid="permission-input" />{/if}
    {#snippet end()}
      <span class="choices" aria-busy={sending !== null}>
        {#if total > 1}<span class="count ui-label" data-testid="permission-count">{fill(strings.chat.permissionOf, { index: String(index), total: String(total) })}</span>{/if}
        <button type="button" class="ghost choice" data-testid="permission-deny" disabled={sending !== null} onclick={() => void choose('deny')}>
          <span class="ui-label">{strings.chat.deny}</span><kbd class="kbd" aria-hidden="true">{strings.chat.keyEscape}</kbd>
        </button>
        <button type="button" class="choice allow" data-testid="permission-allow" disabled={sending !== null || previewMissing} onclick={() => void choose('allow')}>
          <span class="ui-label">{strings.chat.allow}</span><kbd class="kbd" aria-hidden="true"><CornerDownLeft size={11} strokeWidth={2} /></kbd>
        </button>
      </span>
    {/snippet}
  </DecisionHead>
  {#if subjectBlock}
    <pre class="mono subject scroll-edges" data-testid="permission-subject">{subjectBlock}</pre>
  {/if}
  {#if described.change}
    {@const change = described.change}
    <Deferred part={parts.DiffView}>{#snippet children(DiffView)}<DiffView path={change.path} oldText={change.oldText} newText={change.newText} doc={change} />{/snippet}</Deferred>
  {/if}
</div>
{:else}
<div
  class="permission"
  class:resolved={decision !== null}
  data-testid="permission-card"
  data-decision={decision ?? 'pending'}
  data-family={described.family}
>
  <div class="head">
    <span class="glyph" class:denied={decision === 'deny'} class:allowed={decision === 'allow'}>
      {#if decision === 'allow'}<ShieldCheck size={15} strokeWidth={1.75} />{:else if decision === 'deny'}<ShieldX size={15} strokeWidth={1.75} />{:else}<ShieldQuestion size={15} strokeWidth={1.75} />{/if}
    </span>
    {#if decision !== null}
      <!-- The receipt: the verdict, then what it was about, on one quiet line. -->
      {@const receipt = (decision === 'allow' ? strings.chat.allowedReceipt : strings.chat.deniedReceipt).split('{subject}')}
      <span class="sentence receipt ui-label" data-testid="permission-sentence" title={described.subject || sentence}><span class="verdict" data-testid="permission-verdict">{receipt[0]}</span>{described.subject || sentence}{receipt[1] ?? ''}</span>
    {:else}
      <span class="sentence ui-label" data-testid="permission-sentence" title={described.subject || toolName}>{sentence}</span>
    {/if}
  </div>

  {#if decision === null}
    {#if subjectBlock}
      <pre class="mono subject" data-testid="permission-subject">{subjectBlock}</pre>
    {/if}
    {#if described.change}
      {@const change = described.change}
      <Deferred part={parts.DiffView}>{#snippet children(DiffView)}<DiffView path={change.path} oldText={change.oldText} newText={change.newText} doc={change} />{/snippet}</Deferred>
    {/if}
    {#if request?.description && request.description !== subjectBlock}
      <p class="muted description"><CodeText text={request.description} /></p>
    {/if}
  {/if}
  {#if request}
    <details class="technical disclosure">
      <summary><span class="ui-label">{strings.chat.permissionTechnical}</span></summary>
      <p class="tool mono">{toolName}</p>
      <pre class="mono" data-testid="permission-input">{json(request.input)}</pre>
    </details>
  {/if}

  {#if decision === null}
    <div class="actions" aria-busy={sending !== null}>
      <button type="button" class="primary" data-testid="permission-allow" disabled={sending !== null || previewMissing} onclick={() => void choose('allow')}>
        <span class="ui-label">{strings.chat.allow}</span>
      </button>
      <button type="button" class="danger" data-testid="permission-deny" disabled={sending !== null} onclick={() => void choose('deny')}>
        <span class="ui-label">{strings.chat.deny}</span>
      </button>
    </div>
  {/if}
</div>
{/if}

<style>
  .permission {
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-e1);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Answered with no call to carry it, it reads as one more line of the run:
     a call's geometry, no frame. A call that has one carries the shield instead. */
  .permission.resolved {
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    padding: var(--activity-padding);
    min-height: var(--control);
    justify-content: center;
    gap: 2px;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }

  .resolved .head { gap: var(--activity-gap); }
  .resolved .glyph { width: var(--activity-glyph); justify-content: center; }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .glyph {
    display: inline-flex;
    flex: none;
    color: var(--color-live);
  }

  .glyph.allowed { color: var(--color-success); }
  .glyph.denied { color: var(--color-danger); }

  .sentence {
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .resolved .sentence { font-weight: 500; }

  /* One line however long the subject: its whole text is in the title. */
  .receipt { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .verdict { color: var(--color-foreground); }

  .description { font-size: var(--text-sm); }

  pre {
    margin: 0;
    padding: 8px 10px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .subject { color: var(--color-foreground); }

  /* The shared disclosure, at the size of the card's small print. */
  .technical summary { gap: 4px; min-height: 0; font-size: var(--text-xs); font-weight: 400; color: var(--color-subtle); }
  .technical summary::before { width: 12px; height: 12px; }
  .technical .tool { margin: 6px 0 4px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .resolved .technical { display: none; }
  @media (max-width: 720px) {
    .technical summary { min-height: var(--touch-target); }
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  /* At the top of the composer, the one raised card in it: its edge, surface
     and height budget are the dock's (Composer's `.decision-card`). Its head
     stays put and the subject under it scrolls, so Deny and Allow are always
     in sight however long the command. */
  .permission.docked {
    /* The question's inset: the card's on the sides, so the ask starts where the field's text does. */
    padding: 10px var(--dock-inset, 10px);
    gap: 8px;
    outline: none;
  }
  .permission.docked > :global(*) { flex: none; }
  .permission.docked > :global(:not(.decision-head)) { flex: 0 1 auto; min-height: 0; overflow: auto; }
  .docked:focus-visible { box-shadow: inset 0 0 0 2px var(--color-accent); }
  .docked .sentence { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .docked :global(.info-tip) { flex: none; }
  /* Under a pointer the raw input's "i" shows on the ask's hover or focus. */
  @media (hover: hover) {
    .docked :global(.info-tip) { opacity: 0; transition: opacity var(--motion-duration) var(--motion-curve); }
    .docked:is(:hover, :focus-within) :global(.info-tip), .docked :global(.info-tip[aria-expanded='true']) { opacity: 1; }
  }
  .docked :global(.info-bubble) { font-family: var(--font-mono); font-size: var(--text-xs); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; }
  .choices { display: flex; align-items: center; gap: 6px; }
  .count { flex: none; color: var(--color-muted-foreground); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  /* Squeezed by the dock's budget, it scrolls; a line under its edge fades instead of being cut (app.css `.scroll-edges`). */
  /* The command belongs to the ask's line: right under its title, starting
     where the title's words do (past the dot), with no fill and no edge of
     its own. A long one scrolls sideways, its whole text behind the "i". */
  .docked pre { --scroll-edge-ground: var(--color-composer-surface); max-height: 120px; margin-top: -6px; padding: 0 0 0 14px; border: none; border-radius: 0; background: none; font-size: var(--text-meta); line-height: 20px; white-space: pre; word-break: normal; overflow: auto; scrollbar-width: none; }
  .choice { flex: none; height: 30px; gap: 8px; padding: 0 12px; border-radius: var(--radius-md); font-size: var(--text-sm); font-weight: 600; }
  /* Neutral ink, never the accent: the accent stays for send. */
  .choice.allow { background: var(--color-foreground); color: var(--color-background); }
  .choice.allow:hover:not(:disabled) { background: var(--color-foreground); opacity: .9; }
  /* The shared keycap; on the filled Allow it takes the button's ink. */
  .choice .kbd { padding: 0 4px; line-height: 16px; }
  .choice.allow .kbd { border-color: color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit; }
  @media (max-width: 720px) {
    /* The ask is one short sentence: it keeps Deny and Allow on its line at 360. */
    .permission.docked { --decision-title: 6rem; padding: 8px var(--dock-inset, 8px); }
    .choice .kbd { display: none; }
    .choice { height: var(--touch-target); padding: 0 12px; }
  }
</style>
