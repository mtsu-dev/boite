<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Check, ChevronRight, MessageCircleQuestionMark, Paperclip } from '@lucide/svelte';
  import type { QuestionAnswer, QuestionOption } from '@boite/contracts';
  import { keepFocus } from '../lib/focus';
  import { glides } from '../lib/motion';
  import { fill, strings } from '../lib/strings';
  import CodeText from './CodeText.svelte';
  import DecisionHead from './DecisionHead.svelte';

  let {
    text,
    options,
    allowText,
    multiple,
    async = false,
    docked = false,
    folded = false,
    head,
    foot,
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
     * Drawn at the top of the composer: the question once, in bold on a line
     * of its own, Skip and the fold a compact group at its end, the options as rows numbered for the keyboard
     * (the composer's 1 to 9), and no second send while the box answers it.
     */
    docked?: boolean;
    /** Docked and folded: the head alone, the question on one line. */
    folded?: boolean;
    /** What the dock adds to the head's end, after Skip: its fold. */
    head?: Snippet;
    /** The dock's secondary line under the choices: its pager. */
    foot?: Snippet;
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
  const verdict = $derived(strings.chat.questionAnswered.split('{answer}') as [string, string?]);
  let built = $state(false);
  $effect(() => { if (open) built = true; });

  const ready = $derived(picked.length > 0 || drafted);

  /**
   * The docked choices get a room from the dock's budget (a CSS max-height,
   * from the viewport, never from the card's animated height). Whole rows
   * only: when they do not all fit, the list stops under the last row that
   * does and a line counts the rest. Settled before the card arrives, so its
   * growth never reflows the count, and the end frame is the reduced-motion one.
   */
  let list = $state<HTMLDivElement | undefined>(undefined);
  let below = $state(0);
  /** Where each row ends, from the list's top with no scroll. */
  function ends(): number[] {
    if (!list) return [];
    const top = list.getBoundingClientRect().top - list.scrollTop;
    return Array.from(list.children).map((row) => row.getBoundingClientRect().bottom - top);
  }
  function fit(): void {
    if (!list || !docked) return;
    list.style.maxHeight = '';
    const room = parseFloat(getComputedStyle(list).maxHeight);
    const rows = ends();
    if (!Number.isFinite(room) || (rows.at(-1) ?? 0) <= room + 1) { below = 0; return; }
    const whole = rows.filter((end) => end <= room + 1);
    list.style.maxHeight = `${Math.ceil(whole.at(-1) ?? rows[0] ?? 0)}px`;
    measure();
  }
  /** The rows under the list's edge, counted from where it is scrolled. */
  function measure(): void {
    if (!list || !list.style.maxHeight) { below = 0; return; }
    const edge = list.scrollTop + list.clientHeight + 1;
    below = ends().filter((end) => end > edge).length;
  }
  $effect(() => {
    void options.length;
    if (!list || !docked || typeof ResizeObserver !== 'function') return;
    // A new width rewraps the rows; a new height changes the room.
    let width = list.clientWidth;
    const watch = new ResizeObserver(() => { if (list && list.clientWidth !== width) { width = list.clientWidth; fit(); } });
    watch.observe(list);
    fit();
    return () => watch.disconnect();
  });
  function more(): void {
    const next = Array.from(list?.children ?? []).find((option) => option.getBoundingClientRect().bottom > list!.getBoundingClientRect().bottom + 1);
    next?.scrollIntoView({ block: 'nearest', behavior: glides() ? 'smooth' : 'auto' });
  }

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

<svelte:window onresize={fit} />
<div
  class="question"
  class:resolved={answer !== null || (!docked && (!async || !pending))}
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
      <!-- One sentence from one template: the answer sits inline in it, so no flex gap doubles the space. -->
      <span class="given ui-label" data-testid="question-verdict" title={fill(strings.chat.questionAnswered, { answer: summary(answer) })}><span class="verdict">{verdict[0]}</span><span data-testid="question-answer">{summary(answer)}</span><span class="verdict">{verdict[1] ?? ''}</span></span>
      {#if answer.attachments?.length}
        <span class="given-files" data-testid="question-answer-files" title={fileNames(answer)}><Paperclip size={12} strokeWidth={2} />{answer.attachments.length}</span>
      {/if}
      <span class="fold-caret" class:open aria-hidden="true"><ChevronRight size={12} /></span>
    </button>
    <div class="disclosure-fold" class:open inert={!open}>
      <div>
        {#if built}
          <div class="answer-detail">
            <p class="prompt" data-testid="question-text"><CodeText {text} /></p>
            <p>{summary(answer)}</p>
            {#if answer.attachments?.length}
              <p class="muted">{fill(strings.media.answerFiles, { names: fileNames(answer) })}</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else if !pending && !docked}
    <!-- Skipped, or dropped with its turn: the receipt, one quiet line, never the card again. -->
    <div class="answered-row cancelled-row">
      <span class="glyph"><MessageCircleQuestionMark size={15} strokeWidth={1.75} /></span>
      <span class="given ui-label" data-testid="question-cancelled" title={text}>{fill(strings.chat.questionCancelled, { question: text })}</span>
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
    <DecisionHead>
      <span class="prompt" class:folded data-testid="question-text"><CodeText {text} /></span>
      {#snippet end()}
        {#if pending && skip}
          <button type="button" class="ghost skip" data-testid="question-skip" disabled={sent} onmousedown={keepFocus} onclick={pass}><span class="ui-label">{strings.chat.questionSkip}</span></button>
        {/if}
        {@render head?.()}
      {/snippet}
    </DecisionHead>
    {#if folded}{@render foot?.()}{/if}
  {:else}
    <div class="head">
      <span class="glyph"><MessageCircleQuestionMark size={15} strokeWidth={1.75} /></span>
      <span class="muted ui-label">{async ? strings.chat.questionAsyncHeading : strings.chat.questionHeading}</span>
    </div>
    <p class="prompt" data-testid="question-text"><CodeText {text} /></p>
  {/if}
  {#if !folded}
  {#if async && answer === null && pending && !docked}
    <p class="muted description" data-testid="question-async-hint">{strings.chat.questionAsyncHint}</p>
  {/if}

    {#if options.length > 0}
      {#if docked && pending && !sent}
        <!-- A pick only marks the row: the composer's Send answers, with whatever is typed. -->
        <p class="how" data-testid="question-how">{multiple ? strings.chat.questionPickMany : strings.chat.questionPickOne}</p>
      {/if}
      <div class="options" class:clipped={below > 0} role={multiple ? 'group' : 'radiogroup'} bind:this={list} onscroll={measure}>
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
              <kbd class="kbd" aria-hidden="true">{#if multiple && picked.includes(option.id)}<Check size={11} strokeWidth={2.5} />{:else}{index + 1}{/if}</kbd>
            {:else}
            <span class="box" class:round={!multiple} aria-hidden="true">
              {#if multiple && picked.includes(option.id)}
                <Check size={10} strokeWidth={3} />
              {/if}
            </span>
            {/if}
            <span class="labels">
              <span class="label"><CodeText text={option.label} /></span>
              {#if option.description}
                <span class="muted description"><CodeText text={option.description} /></span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
      {#if below > 0}
        <button type="button" class="ghost more" data-testid="question-more" onmousedown={keepFocus} onclick={more}><span class="ui-label">{fill(strings.chat.questionMore, { count: String(below) })}</span></button>
      {/if}
    {/if}
    {@render foot?.()}

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

  /* At the top of the composer, inside the dock's raised tile (Composer's `.decision-card`). */
  .question.docked {
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    /* The card's inset on the sides, so the question starts where the field's text does. */
    padding: 10px var(--dock-inset, 10px);
    gap: 8px;
  }
  /* Nothing in the card shrinks: the choices take the room the dock's budget
     gives them (`fit`), in whole rows, and the rest scroll in place. A cut
     row fades and a line counts the rest. */
  .question.docked > :global(*) { flex: none; }
  .question.docked > .options { overflow-y: auto; overscroll-behavior: contain; max-height: max(120px, calc(var(--dock-budget, 55dvh) - 230px - var(--deck-room, 0px))); }
  .docked .options.clipped { mask-image: linear-gradient(to bottom, var(--color-foreground) calc(100% - 24px), transparent); }

  /* The question's own column beside the compact controls; folded, it holds one line. */
  .docked .prompt { display: block; min-width: 0; padding-block: calc((var(--control) - 22px) / 2); font-weight: inherit; }
  .docked .prompt.folded { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  @media (max-width: 720px) {
    .docked .skip { min-height: var(--touch-target); padding: 0 8px; }
    /* A phone gives the choices what the card's budget leaves once the
       head, the field and the bar are counted (`--dock-cap`). */
    .question.docked { padding: 8px var(--dock-inset, 8px); gap: 4px; }
    .question.docked > .options { max-height: max(96px, calc(var(--dock-cap, 30dvh) - 96px)); }
  }
  .more { align-self: flex-start; height: 24px; padding: 0 8px; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .skip { height: var(--control); padding: 0 8px; border-radius: var(--radius-sm); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 550; }

  .how { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 16px; }
  /* Each choice a tappable row: its own fill and edge at rest, a lift under a mouse, the picked one ringed. */
  .docked .options { gap: 4px; }
  .docked .option { align-items: center; gap: 12px; padding: 7px 10px; border-color: var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-2); box-shadow: var(--shadow-e1); }
  @media (hover: hover) {
    .docked .option:hover:not(:disabled) { transform: translateY(-1px); background: var(--color-surface-3); border-color: var(--color-edge); }
  }
  .docked .option:focus-visible { transform: none; background: var(--color-surface-3); border-color: var(--color-edge); }
  .docked .option.picked { background: var(--color-surface-3); border-color: var(--color-foreground); }
  .docked .option.picked .kbd { border-color: transparent; background: var(--color-foreground); color: var(--color-background); }
  .docked .option:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -1px; }
  .docked .label { font-weight: 550; }
  /* The shared keycap, one square per option; muted until its option is picked. */
  .kbd { flex: none; width: 20px; height: 20px; padding: 0; color: var(--color-muted-foreground); }
  .option.picked .kbd { color: var(--color-foreground); }
  /* A card taller than its room scrolls; the answer stays at its foot, in sight. */
  .docked .actions { justify-content: flex-end; }
  /* After the rows' own padding, so the phone's tighter one wins. */
  @media (max-width: 720px) { .docked .option { min-height: var(--touch-target); padding: 4px 8px; } }

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
  .cancelled-row .given { color: var(--color-muted-foreground); }
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
