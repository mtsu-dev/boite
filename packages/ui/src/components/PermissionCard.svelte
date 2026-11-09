<script lang="ts">
  import { Bot, FilePen, FileText, Globe, Search, ShieldCheck, ShieldX, SquareTerminal, Wrench } from '@lucide/svelte';
  import type { PermissionRequest } from '@boite/contracts';
  import { json } from '../lib/format';
  import { strings } from '../lib/strings';
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
    answer
  }: {
    toolName: string;
    decision: 'allow' | 'deny' | null;
    request: PermissionRequest | null;
    /** False, or a promise of false, gives the buttons back: the answer did not reach the core. */
    answer: (decision: 'allow' | 'deny') => unknown;
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
   * While it waits, the ask is the command row of the call that asked, in
   * the timeline where the call stands: the command itself in mono (or the
   * sentence for a change, its diff under it), the agent's reason in one
   * muted line, "Waiting for approval" by the live dot, and Deny then Allow
   * once at the row's end (under it on a phone). The raw input stays behind
   * an "i". Once answered, one quiet line: the verdict, then what it was about.
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
<div class="permission" data-testid="permission-card" data-decision="pending" data-family={described.family} role="group" aria-label={sentence} tabindex="-1"
  {@attach keys} {@attach watchDecision} {@attach arrive}>
  <span class="glyph" aria-hidden="true"><Family size={15} strokeWidth={1.75} /></span>
  <div class="body">
    {#if subjectBlock}
      <p class="mono command" data-testid="permission-subject" title={subjectBlock}><CommandWords text={subjectBlock} /></p>
    {:else}
      <p class="sentence" data-testid="permission-sentence" title={described.subject || toolName}>{sentence}</p>
    {/if}
    {#if why}<p class="why ui-label" data-testid="permission-why" title={why}><CodeText text={why} /></p>{/if}
    {#if described.change}
      {@const change = described.change}
      <div class="change"><Deferred part={parts.DiffView}>{#snippet children(DiffView)}<DiffView path={change.path} oldText={change.oldText} newText={change.newText} doc={change} />{/snippet}</Deferred></div>
    {/if}
    <p class="state" data-testid="permission-status">
      <span class="dot" aria-hidden="true"></span><span class="ui-label">{strings.chat.permissionWaiting}</span>
      {#if request}<InfoTip text={`${toolName}\n${json(request.input)}`} topic={sentence} testid="permission-input" />{/if}
    </p>
  </div>
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
  /* A tool row of the run (ToolGroup's geometry): the family's mark, then
     the ask's lines, then the pair at the row's end. */
  .permission {
    display: grid;
    grid-template-columns: var(--activity-glyph) minmax(0, 1fr) auto;
    align-items: start;
    column-gap: var(--activity-gap);
    padding: var(--activity-padding);
    border-radius: var(--radius-sm);
    outline: none;
  }
  .permission:focus-visible { box-shadow: inset 0 0 0 2px var(--color-accent); }
  .glyph { display: inline-flex; justify-content: center; align-items: center; height: 22px; color: var(--instrument-ink); }
  .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .body > p { margin: 0; }
  /* The command whole, one line until it is long, then wrapped at its spaces (CommandWords); a word wider than the row scrolls. */
  .command { color: var(--color-foreground); font-size: var(--text-meta); line-height: 22px; white-space: pre-wrap; overflow-x: auto; scrollbar-width: none; }
  .sentence { color: var(--color-foreground); font-size: var(--instrument-size); line-height: 22px; overflow-wrap: anywhere; }
  /* The agent's own words for the call: one muted line, the rest in its title. */
  .why { color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 20px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .change { margin-block: 4px; min-width: 0; }
  .state { display: flex; align-items: center; gap: 6px; min-height: 20px; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  /* Amber says "needs you", as on the pill over the composer. */
  .dot { flex: none; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-live); }
  .state :global(.info-tip) { flex: none; }
  .state :global(.info-bubble) { font-family: var(--font-mono); font-size: var(--text-xs); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; }
  .choices { align-self: center; min-width: 0; }
  @media (max-width: 720px) {
    /* The pair takes a row under the ask, at its end, so the command keeps the width. */
    .permission { grid-template-columns: var(--activity-glyph) minmax(0, 1fr); row-gap: 6px; }
    .choices { grid-column: 2; }
  }

  /* Answered: one more line of the run, the shield in the verdict's colour. */
  .permission.resolved {
    grid-template-columns: var(--activity-glyph) minmax(0, 1fr);
    align-items: center;
    min-height: var(--control);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  .resolved .glyph { height: auto; }
  .glyph.allowed { color: var(--color-success); }
  .glyph.denied { color: var(--color-danger); }
  .resolved .sentence { font-size: var(--text-sm); font-weight: 500; color: inherit; }
  /* One line however long the subject: its whole text is in the title. */
  .receipt { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .verdict { color: var(--color-foreground); }
</style>
