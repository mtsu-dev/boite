<script lang="ts">
  import { ShieldCheck, ShieldQuestion, ShieldX } from '@lucide/svelte';
  import type { PermissionRequest } from '@boite/contracts';
  import { json } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { describeTool, permissionSentence } from '../lib/tool-summary';
  import CodeText from './CodeText.svelte';
  import CommandWords from './CommandWords.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import InfoTip from './InfoTip.svelte';
  import DecisionHead from './DecisionHead.svelte';
  import DecisionActions from './DecisionActions.svelte';
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
     * Drawn at the top of the composer, where the field below stays free,
     * in reading order: the ask with its raw input behind an "i", the
     * thing itself in mono, the agent's own reason when it gave one, then
     * Deny (Esc) and Allow once (Enter), the keys in their titles. The ask
     * scrolls inside the dock's budget; the choices stay in sight.
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
  <!-- The body scrolls inside the dock's budget, its cut edge fading; the pair under it is always whole. -->
  <div class="ask scroll-edges">
    <DecisionHead>
      <span class="sentence ui-label" data-testid="permission-sentence" title={described.subject || toolName}>{sentence}</span>
      {#if request}<InfoTip text={`${toolName}\n${json(request.input)}`} topic={sentence} testid="permission-input" />{/if}
    </DecisionHead>
    {#if subjectBlock}
      <pre class="mono subject scroll-edges" data-testid="permission-subject">{subjectBlock}</pre>
    {/if}
    {#if why}<p class="why" data-testid="permission-why"><CodeText text={why} /></p>{/if}
    {#if described.change}
      {@const change = described.change}
      <Deferred part={parts.DiffView}>{#snippet children(DiffView)}<DiffView path={change.path} oldText={change.oldText} newText={change.newText} doc={change} />{/snippet}</Deferred>
    {/if}
  </div>
  <div class="choices" aria-busy={sending !== null}>
    <DecisionActions>
      {#if total > 1}<span class="count ui-label" data-testid="permission-count">{fill(strings.chat.permissionOf, { index: String(index), total: String(total) })}</span>{/if}
      <button type="button" class="secondary" data-testid="permission-deny" title={strings.chat.denyKey} disabled={sending !== null} onclick={() => void choose('deny')}>
        <span class="ui-label">{strings.chat.deny}</span>
      </button>
      <!-- An answer covers this one call: the button says so, the agent asks again next time. -->
      <button type="button" class="primary" data-testid="permission-allow" title={strings.chat.allowOnceKey} disabled={sending !== null || previewMissing} onclick={() => void choose('allow')}>
        <span class="ui-label">{strings.chat.allowOnce}</span>
      </button>
    </DecisionActions>
  </div>
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
      <pre class="mono subject" data-testid="permission-subject"><CommandWords text={subjectBlock} /></pre>
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
      <button type="button" class="primary" data-testid="permission-allow" title={strings.chat.allowOnceHint} disabled={sending !== null || previewMissing} onclick={() => void choose('allow')}>
        <span class="ui-label">{strings.chat.allowOnce}</span>
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

  /* At the top of the composer, the one raised tile in it: its fill, corners
     and height budget are the dock's (Composer's `.decision-card`). In reading
     order, the ask then the choices: on a desktop the choices close its last
     line at the end, on a phone they take a row under the command. The ask
     scrolls inside the budget, so Deny and Allow are always in sight. */
  .permission.docked.decision-card {
    /* The question's inset: the card's on the sides, so the ask starts where the field's text does. */
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: minmax(0, 1fr);
    align-items: end;
    gap: 8px 12px;
    padding: 10px var(--dock-inset, 10px);
    overflow: hidden;
    outline: none;
  }
  /* A short fade: in the least room the body has, the command over it stays readable. */
  .ask { --scroll-edge: 10px; --scroll-edge-ground: var(--decision-fill, var(--color-composer-surface)); display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; max-height: 100%; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .ask > :global(*) { flex: none; }
  /* The fades take no room: they cancel the column's gap as well as their own height. */
  .docked .ask::before { margin-bottom: calc(-1 * var(--scroll-edge) - 6px); }
  .docked .ask::after { margin-top: calc(-1 * var(--scroll-edge) - 6px); }
  /* The agent's own words for the call, under the command, past the dot like it. */
  .why { margin: -2px 0 0; padding-left: 14px; color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 20px; overflow-wrap: anywhere; }
  .docked:focus-visible { box-shadow: inset 0 0 0 2px var(--color-accent); }
  .docked .sentence { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .docked :global(.info-tip) { flex: none; }
  /* Under a pointer the raw input's "i" shows on the ask's hover or focus. */
  @media (hover: hover) {
    .docked :global(.info-tip) { opacity: 0; transition: opacity var(--motion-duration) var(--motion-curve); }
    .docked:is(:hover, :focus-within) :global(.info-tip), .docked :global(.info-tip[aria-expanded='true']) { opacity: 1; }
  }
  .docked :global(.info-bubble) { font-family: var(--font-mono); font-size: var(--text-xs); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; }
  .choices { min-width: 0; }
  .count { flex: none; color: var(--color-muted-foreground); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  /* Squeezed by the dock's budget, it scrolls; a line under its edge fades instead of being cut (app.css `.scroll-edges`). */
  /* The command belongs to the ask's line: right under its title, starting
     where the title's words do (past the dot), with no fill and no edge of
     its own. A long one scrolls sideways, its whole text behind the "i". */
  .docked pre { --scroll-edge-ground: var(--decision-fill, var(--color-composer-surface)); max-height: 120px; margin-top: -4px; padding: 0 0 0 14px; border: none; border-radius: 0; background: none; font-size: var(--text-meta); line-height: 20px; white-space: pre; word-break: normal; overflow: auto; scrollbar-width: none; }
  @media (max-width: 720px) {
    /* The sentence asks for its whole width: when it and the two choices do not fit one
       line, the choices wrap under it rather than cutting the ask. */
    .permission.docked.decision-card { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; padding: 8px var(--dock-inset, 8px); }
  }
</style>
