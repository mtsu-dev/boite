<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Check, ChevronRight, MessageCircleQuestionMark, Paperclip } from '@lucide/svelte';
  import type { QuestionAnswer, QuestionOption } from '@boite/contracts';
  import { keepFocus } from '../lib/focus';
  import { fill, strings } from '../lib/strings';

  let {
    text,
    options,
    allowText,
    multiple,
    async = false,
    docked = false,
    folded = false,
    head,
    answer,
    pending,
    picked = $bindable([]),
    drafted = false,
    replying = false,
    submit,
    skip,
    onwrite,
    page,
    onopen
  }: {
    text: string;
    options: QuestionOption[];
    allowText: boolean;
    multiple: boolean;
    /** Asked with `boite ask`: the agent did not stop for it and the answer reaches it later. */
    async?: boolean;
    /**
     * Drawn at the top of the composer: the question once, in bold beside its
     * tag, Skip at the right, the options as rows numbered for the keyboard
     * (the composer's 1 to 9), and no second send while the box answers it.
     */
    docked?: boolean;
    /** Docked and folded: the head alone, the question on one line. */
    folded?: boolean;
    /** What the dock adds to the head, before Skip: its pager and fold. */
    head?: Snippet;
    answer: QuestionAnswer | null;
    /** False on a card whose turn ended before anyone answered: nothing to press. */
    pending: boolean;
    /** The options picked, held outside so the composer's Send can take them (`lib/question-reply.svelte.ts`). */
    picked?: string[];
    /** The composer holds text or files for this answer: Answer needs no option then. */
    drafted?: boolean;
    /** The composer is this question's free field: the card says so instead of offering it. */
    replying?: boolean;
    /** False when the answer did not reach the core: the card is given back to answer again. */
    submit: (optionIds: string[]) => unknown;
    /** Resolve without sending an answer. A failure leaves the card usable. */
    skip?: () => unknown;
    /** Hands the composer to this question, when another one or an ordinary message has it. */
    onwrite?: () => void;
    /** The page asked with `boite ask --open`, and what its Open button does. */
    page?: string;
    onopen?: () => unknown;
  } = $props();

  let sent = $state(false);
  let open = $state(false);
  let built = $state(false);
  $effect(() => { if (open) built = true; });

  const ready = $derived(picked.length > 0 || drafted);

  function toggle(id: string): void {
    if (multiple) {
      picked = picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id];
      return;
    }
    picked = picked[0] === id ? [] : [id];
  }

  async function send(): Promise<void> {
    if (!pending || !ready || sent) return;
    sent = true;
    if ((await submit(picked)) === false) sent = false;
  }

  async function pass(): Promise<void> {
    if (!pending || sent || !skip) return;
    sent = true;
    if ((await skip()) === false) sent = false;
  }
  /** What the folded card says: the labels picked, then whatever was typed, else how many files went. */
  function summary(given: QuestionAnswer): string {
    const labels = given.optionIds.map((id) => options.find((one) => one.id === id)?.label ?? id);
    const written = given.text ?? '';
    if (labels.length > 0 && written.length > 0) return `${labels.join(', ')}: ${written}`;
    const said = labels.length > 0 ? labels.join(', ') : written;
    const count = given.attachments?.length ?? 0;
    return said.length > 0 || count === 0 ? said : fill(strings.media.answerFileCount, { count: String(count) });
  }

  function fileNames(given: QuestionAnswer): string {
    return (given.attachments ?? []).map((file) => file.name ?? strings.composer.attachUnnamed).join(', ');
  }
</script>

<div
  class="question"
  class:resolved={answer !== null || (!docked && !async && pending)}
  class:async
  class:docked
  data-testid="question-card"
  data-async={async ? 'true' : undefined}
  data-state={answer !== null ? 'answered' : pending ? 'pending' : 'cancelled'}
  role="group"
>
  {#if answer !== null}
    <button type="button" class="ghost answered-row" data-testid="question-toggle" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="glyph"><MessageCircleQuestionMark size={15} strokeWidth={1.75} /></span>
      <span class="verdict ui-label" data-testid="question-verdict">{strings.chat.questionAnswered}</span>
      <span class="given ui-label" data-testid="question-answer" title={summary(answer)}>{summary(answer)}</span>
      {#if answer.attachments?.length}
        <span class="given-files" data-testid="question-answer-files" title={fileNames(answer)}><Paperclip size={12} strokeWidth={2} />{answer.attachments.length}</span>
      {/if}
      <span class="fold-caret" class:open aria-hidden="true"><ChevronRight size={12} /></span>
    </button>
    <div class="disclosure-fold" class:open inert={!open}>
      <div>
        {#if built}
          <div class="answer-detail">
            <p class="prompt" data-testid="question-text">{text}</p>
            <p>{summary(answer)}</p>
            {#if answer.attachments?.length}
              <p class="muted">{fill(strings.media.answerFiles, { names: fileNames(answer) })}</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else if !docked && !async && pending}
    <!-- The agent stopped for it: the question is written once, in the composer's dock; here a plain line and a quiet mark. -->
    <button type="button" class="ghost answered-row waiting-row" data-testid="question-waiting" title={strings.chat.questionDocked} disabled={!onwrite} onclick={() => onwrite?.()}>
      <span class="glyph"><MessageCircleQuestionMark size={15} strokeWidth={1.75} /></span>
      <span class="given ui-label">{strings.chat.questionHeading}</span>
      <span class="waiting-mark" role="img" aria-label={strings.chat.questionDocked}></span>
    </button>
  {:else}
  {#if docked}
    <div class="dock-head">
      <span class="tag"><span class="ui-label">{strings.chat.questionAsyncHeading}</span></span>
      <p class="prompt" class:folded data-testid="question-text">{text}</p>
      {@render head?.()}
      {#if pending && skip}
        <button type="button" class="ghost skip" data-testid="question-skip" disabled={sent} onmousedown={keepFocus} onclick={pass}><span class="ui-label">{strings.chat.questionSkip}</span></button>
      {/if}
    </div>
  {:else}
    <div class="head">
      <span class="glyph"><MessageCircleQuestionMark size={15} strokeWidth={1.75} /></span>
      <span class="muted ui-label">{async ? strings.chat.questionAsyncHeading : strings.chat.questionHeading}</span>
    </div>
    <p class="prompt" data-testid="question-text">{text}</p>
  {/if}
  {#if !folded}
  {#if async && answer === null && pending && !docked}
    <p class="muted description" data-testid="question-async-hint">{strings.chat.questionAsyncHint}</p>
  {/if}

    {#if options.length > 0}
      <div class="options" role={multiple ? 'group' : 'radiogroup'}>
        {#each options as option, index (option.id)}
          <button
            type="button"
            class="option"
            class:picked={picked.includes(option.id)}
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={picked.includes(option.id)}
            data-testid="question-option"
            data-option={option.id}
            disabled={!pending || sent}
            onmousedown={keepFocus}
            onclick={() => toggle(option.id)}
          >
            {#if docked && index < 9}
              <kbd aria-hidden="true">{#if multiple && picked.includes(option.id)}<Check size={11} strokeWidth={2.5} />{:else}{index + 1}{/if}</kbd>
            {:else}
            <span class="box" class:round={!multiple} aria-hidden="true">
              {#if multiple && picked.includes(option.id)}
                <Check size={10} strokeWidth={3} />
              {/if}
            </span>
            {/if}
            <span class="labels">
              <span class="label">{option.label}</span>
              {#if option.description}
                <span class="muted description">{option.description}</span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}

    {#if pending && !(docked && replying && !page)}
      <div class="actions">
        {#if page && onopen}
          <button type="button" class="ghost" data-testid="question-open" title={page} onmousedown={keepFocus} onclick={onopen}><span class="ui-label">{strings.chat.questionOpenPage}</span></button>
        {/if}
        {#if skip && !docked}
          <button type="button" class="ghost" data-testid="question-skip" disabled={sent} onmousedown={keepFocus} onclick={pass}><span class="ui-label">{strings.chat.questionSkip}</span></button>
        {/if}
        {#if allowText && !replying && onwrite}
          <button type="button" class="ghost" data-testid="question-write" disabled={sent} onclick={onwrite}><span class="ui-label">{strings.chat.questionWrite}</span></button>
        {/if}
        {#if !docked || !replying}
        <button
          type="button"
          class="primary"
          data-testid="question-submit"
          disabled={!ready || sent}
          onmousedown={keepFocus}
          onclick={send}
        >
          <span class="ui-label">{strings.chat.questionAnswer}</span>
        </button>
        {/if}
      </div>
    {:else if !pending}
      <p class="muted description" data-testid="question-cancelled">{strings.chat.questionCancelled}</p>
    {/if}
  {/if}
  {/if}
</div>

<style>
  .question {
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-e1);
    padding: 8px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Nobody waits on it: a dashed edge instead of the live one that says the agent is stopped. */
  .question.async {
    border-left-style: dashed;
  }

  /* At the top of the composer the composer is the frame; a hairline parts it from the field. */
  .question.docked {
    border: none;
    border-bottom: 1px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    padding: 10px 12px;
    gap: 8px;
  }

  .dock-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .dock-head :global(button) { flex: none; }
  .dock-head .prompt { flex: 1; min-width: 0; font-size: var(--text-base); font-weight: 600; line-height: 22px; }
  .dock-head .prompt.folded { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  /* What waits on the owner, quietly: a small live dot and a muted word, no fill. */
  .tag { flex: none; height: 22px; gap: 6px; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; display: inline-flex; align-items: center; }
  .tag::before { content: ''; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-live); }
  /* A phone puts the question under its tag and controls, full width; the controls keep
     their touch height on narrower sides, so a pager and Skip still fit one row at 360 px. */
  @media (max-width: 720px) {
    .dock-head { flex-wrap: wrap; align-items: center; gap: 0; }
    .dock-head .tag { margin-right: auto; }
    .dock-head .prompt { order: 1; flex: 1 0 100%; }
    .dock-head :global(button.icon) { min-width: 36px; }
    .dock-head .skip { min-height: var(--touch-target); padding: 0 6px; }
  }
  .skip { height: 24px; padding: 0 8px; border-radius: var(--radius-sm); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 550; }

  .docked .options { gap: 2px; }
  .docked .option { align-items: center; gap: 12px; padding: 8px 10px; border-color: transparent; border-radius: var(--radius-lg); background: transparent; }
  .docked .option:hover:not(:disabled), .docked .option:focus-visible { transform: none; background: var(--color-hover); border-color: var(--color-border); }
  .docked .option.picked { background: var(--color-hover); border-color: var(--color-edge); }
  .docked .option:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -1px; }
  .docked .label { font-weight: 550; }
  kbd { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 20px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-3); color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: 11px; }
  .option.picked kbd { color: var(--color-foreground); border-color: var(--color-edge); }
  .docked .actions { justify-content: flex-end; }

  .waiting-row:disabled { opacity: 1; cursor: default; }
  /* Waiting on the owner: a small live dot, where to answer is in its tooltip. */
  .waiting-mark { flex: none; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-live); }

  /* Resolved questions use the same inset and touch target as tool disclosures. */
  .question.resolved {
    border: none;
    background: transparent;
    box-shadow: none;
    padding: 0;
    gap: 0;
    color: var(--color-muted-foreground);
    min-width: 0;
  }

  .question.resolved .prompt {
    font-weight: 500;
    font-size: var(--text-sm);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .glyph {
    display: inline-flex;
    color: var(--color-live);
  }

  .resolved .glyph {
    color: var(--color-subtle);
  }

  .verdict {
    flex: none;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }

  .prompt {
    margin: 0;
    font-weight: 500;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .given {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-foreground);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .answered-row { display: flex; align-items: center; justify-content: flex-start; gap: var(--activity-gap); width: 100%; height: auto; min-height: var(--control); padding: var(--activity-padding); border-radius: var(--radius-sm); font-weight: 400; text-align: left; }
  .answered-row:hover:not(:disabled) { background: var(--color-surface-2); }
  .answered-row:active:not(:disabled) { transform: none; }
  .answered-row .glyph { flex: none; width: var(--activity-glyph); justify-content: center; }
  .answer-detail { margin: 4px 0 8px calc(var(--activity-padding) + var(--activity-glyph) / 2); padding: 4px var(--activity-padding) 4px calc(var(--activity-glyph) / 2 + var(--activity-gap)); border-left: 1px solid var(--color-border); font-size: var(--text-sm); }
  .answer-detail p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .answer-detail p + p { margin-top: 8px; color: var(--color-foreground); }

  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* The global button is one centred 28 px line; a row here is two lines tall. */
  .option {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    height: auto;
    white-space: normal;
    text-align: left;
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition:
      background var(--dur-2) var(--ease-out-quint),
      border-color var(--dur-2) var(--ease-out-quint),
      transform var(--dur-1) var(--ease-out-quint);
  }

  /* The option lifts a pixel under the pointer and fills under the keyboard;
     neither one commits the pick, which is what the click is for. */
  .option:hover:not(:disabled) {
    border-color: var(--color-edge);
    transform: translateY(-1px);
  }

  .option:focus-visible {
    outline: none;
    border-color: var(--color-edge);
    background: var(--color-surface-2);
  }

  .option:active:not(:disabled) {
    transform: none;
    background: var(--color-surface-3);
  }

  .option.picked {
    border-color: var(--color-live);
  }

  .option:disabled {
    cursor: default;
  }

  .box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    margin-top: 3px;
    flex: none;
    border: 1px solid var(--color-edge);
    border-radius: calc(var(--radius-sm) / 3);
    color: var(--color-accent-ink);
  }

  .box.round {
    border-radius: 50%;
  }

  .option.picked .box {
    border-color: var(--color-live);
    background: var(--color-live);
  }

  .labels {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    min-width: 0;
  }

  .description {
    font-size: var(--text-sm);
  }

  .given-files { display: inline-flex; align-items: center; gap: 2px; flex: none; font-size: var(--text-xs); color: var(--color-muted-foreground); }

  .actions {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }
</style>
