<script lang="ts">
  import { Bot, FilePen, FileText, Globe, Search, ShieldCheck, ShieldX, SquareTerminal, Wrench } from '@lucide/svelte';
  import type { PermissionRequest } from '@boite/contracts';
  import { json } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { decisionTitle } from '../lib/decision-title';
  import { describeTool } from '../lib/tool-summary';
  import { watchDecision } from '../lib/decision-tail.svelte';
  import CodeText from './CodeText.svelte';
  import CommandWords from './CommandWords.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import InfoTip from './InfoTip.svelte';
  import DecisionActions from './DecisionActions.svelte';
  import { arrive } from '../lib/arrival';

  let {
    toolName,
    decision,
    request,
    answer,
    asker
  }: {
    toolName: string;
    decision: 'allow' | 'deny' | null;
    request: PermissionRequest | null;
    /** False, or a promise of false, gives the buttons back: the answer did not reach the core. */
    answer: (decision: 'allow' | 'deny') => unknown;
    /** A subagent's ask drawn over its parent's composer (`ComposerFoot`): who asks, and the way into its conversation. Such a card is no row of the timeline, so the way back to a row out of view never counts it. */
    asker?: { title: string; open: () => void };
  } = $props();

  /**
   * The decision out to the core: both buttons stay down until it lands, so a
   * second tap sends nothing and the row shows its answer was taken.
   */
  let sending = $state<'allow' | 'deny' | null>(null);

  async function choose(choice: 'allow' | 'deny'): Promise<void> {
    if (sending !== null || decision !== null || (choice === 'allow' && previewMissing)) return;
    sending = choice;
    if ((await answer(choice)) === false) sending = null;
  }

  const ICONS = { command: SquareTerminal, read: FileText, edit: FilePen, write: FilePen, search: Search, fetch: Globe, web: Globe, agent: Bot, other: Wrench };

  /**
   * While it waits, the ask is a card in the timeline where the call stands:
   * a head with the family's mark, what is asked in a few words and "Waiting
   * for approval" by the live dot; then the agent's stated purpose, the
   * command in a code block that scrolls past a few lines (or a change's
   * diff), and Deny then Allow once in the card's own foot. The raw input
   * stays behind an "i". Once answered, one quiet line: the verdict, then
   * what it was about.
   */
  let described = $derived(describeTool(toolName, request?.input ?? null));
  let sentence = $derived(decisionTitle(toolName, request?.input ?? null));
  let Family = $derived(ICONS[described.family]);
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

  /** With the row itself focused, Enter allows and Escape denies, as the buttons' titles say. */
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

{#if decision === null}
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="permission card" data-testid="permission-card" data-decision="pending" data-family={described.family} role="group" aria-label={sentence} tabindex="-1"
  {@attach keys} {@attach asker ? undefined : watchDecision} {@attach arrive}>
  <div class="head">
    <span class="glyph" aria-hidden="true"><Family size={15} strokeWidth={1.75} /></span>
    <span class="sentence" data-testid="permission-sentence" title={described.subject || toolName}>{sentence}</span>
    <span class="state" data-testid="permission-status">
      <span class="dot" aria-hidden="true"></span><span class="ui-label">{strings.chat.permissionWaiting}</span>
      {#if request}<InfoTip text={`${toolName}\n${json(request.input)}`} topic={sentence} testid="permission-input" />{/if}
    </span>
  </div>
  {#if asker}
    <p class="asker" data-testid="permission-asker">
      <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
      <span class="ui-label who" title={asker.title}>{fill(strings.activity.subagentAsks, { title: asker.title })}</span>
      <button type="button" class="ghost small" data-testid="permission-open-asker" title={fill(strings.activity.openSubagentHint, { title: asker.title })} onclick={asker.open}><span class="ui-label">{strings.activity.openSubagent}</span></button>
    </p>
  {/if}
  {#if why}<p class="why" data-testid="permission-why"><CodeText text={why} /></p>{/if}
  {#if subjectBlock}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre class="mono command" data-testid="permission-subject" tabindex="0"><CommandWords text={subjectBlock} /></pre>
  {/if}
  {#if described.change}
    {@const change = described.change}
    <div class="change"><Deferred part={parts.DiffView}>{#snippet children(DiffView)}<DiffView path={change.path} oldText={change.oldText} newText={change.newText} doc={change} />{/snippet}</Deferred></div>
  {/if}
  <div class="choices" aria-busy={sending !== null}>
    <DecisionActions>
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
{@const receipt = (decision === 'allow' ? strings.chat.allowedReceipt : strings.chat.deniedReceipt).split('{subject}')}
<div class="permission resolved" data-testid="permission-card" data-decision={decision} data-family={described.family}>
  <span class="glyph" class:denied={decision === 'deny'} class:allowed={decision === 'allow'}>
    {#if decision === 'allow'}<ShieldCheck size={15} strokeWidth={1.75} />{:else}<ShieldX size={15} strokeWidth={1.75} />{/if}
  </span>
  <!-- The receipt: the verdict, then what it was about, on one quiet line. -->
  <span class="sentence receipt ui-label" data-testid="permission-sentence" title={described.subject || sentence}><span class="verdict" data-testid="permission-verdict">{receipt[0]}</span>{described.subject || sentence}{receipt[1] ?? ''}</span>
</div>
{/if}

<style>
  /* Waiting: a card of its own in the run, the head, what is asked, then the pair in its foot. */
  .permission.card {
    display: flex;
    flex-direction: column;
    margin-block: 4px;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    background: var(--card-fill);
    box-shadow: var(--shadow-e1);
    outline: none;
    overflow: hidden;
  }
  .permission.card:focus-visible { border-color: var(--color-accent); box-shadow: var(--shadow-e1), 0 0 0 1px var(--color-accent); }
  .head { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 40px; padding: 4px 8px 4px 12px; }
  .glyph { display: inline-flex; flex: none; justify-content: center; align-items: center; color: var(--color-muted-foreground); }
  .card .glyph { width: 26px; height: 26px; border-radius: var(--radius-sm); background: var(--color-live-soft); color: var(--color-live); }
  .card > p { margin: 0; }
  /* In a capped stack (a subagent's asks over the composer) the card keeps its height and the stack scrolls. */
  .permission.card, .card > * { flex: none; }
  .sentence { flex: 1 1 auto; min-width: 0; color: var(--color-foreground); font-size: var(--instrument-size); font-weight: 600; line-height: 22px; overflow-wrap: anywhere; }
  /* Amber says "needs you", as on the pill over the composer. */
  .state { display: inline-flex; align-items: center; gap: 6px; flex: none; color: var(--color-muted-foreground); font-size: var(--text-sm); white-space: nowrap; }
  .dot { flex: none; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-live); }
  .state :global(.info-tip) { flex: none; }
  .state :global(.info-bubble) { font-family: var(--font-mono); font-size: var(--text-xs); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; }
  /* A subagent's ask over its parent's composer: who asks, and the way in. */
  .asker { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 0 8px 4px 14px; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .asker > :global(svg) { flex: none; }
  .who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .asker button { flex: none; margin-left: auto; }
  /* The agent's own words for the call, first: three lines at most, the rest in the raw input. */
  .why { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; padding: 0 14px 8px; color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 20px; overflow-wrap: anywhere; }
  /* The command whole in a code block: wrapped at its spaces (CommandWords), about seven lines, then it scrolls. */
  .command { margin: 0 12px 12px; padding: 8px 10px; max-height: 148px; overflow: auto; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-code-background); color: var(--color-foreground); font-size: var(--text-meta); line-height: 19px; white-space: pre-wrap; scrollbar-width: thin; }
  .command:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
  .change { margin: 0 12px 12px; min-width: 0; }
  /* The pair belongs to the card: its foot, under a hairline. */
  .choices { display: flex; justify-content: flex-end; min-width: 0; padding: 8px 12px; border-top: 1px solid var(--color-border); background: color-mix(in oklab, var(--card-fill), var(--color-foreground) 2%); }
  @media (max-width: 720px) {
    /* The state takes its own line under the title, and the pair the card's width, two halves. */
    .head { flex-wrap: wrap; row-gap: 0; padding-block: 8px; }
    .sentence { flex-basis: calc(100% - 40px); }
    .state { padding-left: 34px; min-height: 24px; }
    .choices :global(.decision-actions) { flex: 1 1 auto; flex-wrap: nowrap; }
    .choices :global(.decision-actions > button) { flex: 1 1 0; }
  }

  /* Answered: a tool row of the run again (ToolGroup's geometry). */
  .permission.resolved {
    display: grid;
    column-gap: var(--activity-gap);
    padding: var(--activity-padding);
    border-radius: var(--radius-sm);
  }
  /* Answered: one more line of the run, the shield in the verdict's colour. */
  .permission.resolved {
    grid-template-columns: var(--activity-glyph) minmax(0, 1fr);
    align-items: center;
    min-height: var(--control);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  .glyph.allowed { color: var(--color-success); }
  .glyph.denied { color: var(--color-danger); }
  .resolved .sentence { font-size: var(--text-sm); font-weight: 500; color: inherit; }
  /* One line however long the subject: its whole text is in the title. */
  .receipt { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .verdict { color: var(--color-foreground); }
</style>
