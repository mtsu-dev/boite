<script lang="ts">
  import { untrack } from 'svelte';
  import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, KeyRound, MessageCircleQuestionMark, Settings2, ShieldQuestion, Users } from '@lucide/svelte';
  import type { MessagePart, PermissionRequest, QuestionRequest, SecretRequest, ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { decisionTitle } from '../lib/decision-title';
  import { describeTool } from '../lib/tool-summary';
  import { decisionTail, decisionsWaiting, lendAnswer } from '../lib/decision-tail.svelte';
  import { ignoreQuestions, pickOption, releaseWaiting, replyOf, repliesOf, sendAnswer, writeAnswer } from '../lib/question-reply.svelte';
  import { openQuestionPage } from '../lib/question-page';
  import { settingHeading } from '../lib/setting-requests';
  import { teamHeading } from '../lib/team-requests';
  import { glides } from '../lib/motion';
  import { touchScreen } from '../lib/device';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import InfoTip from './InfoTip.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import SettingRequestCard from './SettingRequestCardLoader.svelte';
  import AgentSettingCard from './AgentSettingCardLoader.svelte';
  import SubagentQuestions from './SubagentQuestions.svelte';

  /*
   * What the thread waits on, at the end of its timeline, under the turn that
   * asked: the permission the agent stopped for, its questions (the ones it
   * stopped for first, then the ones it asked without stopping, which a
   * running turn would push out of sight), its secrets, and what its
   * subagents ask, each the way into their own conversation. Several
   * questions stack behind a pager; each keeps what was picked while another
   * is on screen. The composer under it stays the user's: its field, its
   * chips and the subagents' entries. Once answered while the agent works,
   * the card folds in place to one line that says what was given.
   */
  let { store, threadId }: { store: Store; threadId: string } = $props();

  let children = $derived(new Map(store.threads.filter((row) => row.parentThreadId === threadId && !row.archived).map((row) => [row.id, row] as const)));
  let childQuestions = $derived(store.subagentQuestions(threadId));
  type Asked = QuestionRequest & { secret?: SecretRequest };
  let asked: Asked[] = $derived.by(() => {
    // A setting, an agent's setting or a team request the agent stopped for keeps its card in the timeline.
    const questions: Asked[] = store.pendingQuestions.filter((question) => question.threadId === threadId
      && (question.async === true || !(question.setting || question.agentSetting || question.team)));
    const secrets: Asked[] = store.pendingSecrets
      .filter((request) => request.threadId === threadId || children.has(request.threadId))
      .map((secret) => ({ id: secret.id, threadId: secret.threadId, turnId: secret.turnId, text: secret.reason, options: [], allowText: false, multiple: false, createdAt: secret.createdAt, secret }));
    return [...questions, ...secrets].sort((a, b) => Number(a.async === true || !!a.secret) - Number(b.async === true || !!b.secret) || a.createdAt - b.createdAt);
  });
  let permissions = $derived(store.pendingPermissions.filter((request) => request.threadId === threadId));
  let permission = $derived(permissions[0] ?? null);
  let waits = $derived(store.pendingPermissions.filter((request) => children.has(request.threadId)));

  function secretPart(request: SecretRequest): Extract<MessagePart, { type: 'secret_request' }> {
    return { type: 'secret_request', requestId: request.id, name: request.name, reason: request.reason, placeholder: request.placeholder, status: request.status, ref: request.ref, expiresAt: request.expiresAt };
  }

  let shownId = $state<string | null>(null);
  let shown = $derived(asked.find((question) => question.id === shownId) ?? asked[0]);
  let at = $derived(shown ? asked.indexOf(shown) : 0);
  let questionOpen = $state(true);
  // The oldest question first. New arrivals keep the one on screen, its picks and its fold; the pager still wins.
  $effect(() => {
    if (!asked.some((question) => question.id === shownId)) { shownId = asked[0]?.id ?? null; questionOpen = true; }
  });
  /** A plain question draws its own head (`QuestionCard`): the fold sits in it, the pager under its choices. */
  const plain = (question: Asked) => !question.secret && !question.setting && !question.agentSetting && !question.team;
  // A card's "Answer in writing" brings that question up.
  $effect(() => {
    const chosen = repliesOf(store).chosen;
    if (chosen && untrack(() => asked.some((question) => question.id === chosen))) { shownId = chosen; questionOpen = true; }
  });
  // A line in the timeline for a waiting question brings that one up (`showDecision`).
  $effect(() => {
    if (decisionTail.nonce === 0 || decisionTail.focus === null) return;
    const focus = decisionTail.focus;
    if (untrack(() => asked.some((question) => question.id === focus))) { shownId = focus; questionOpen = true; }
  });
  // The composer answers the question on screen when the agent stopped for none.
  $effect(() => {
    const replies = repliesOf(store);
    replies.docked = shown?.id ?? null;
    return () => { replies.docked = null; };
  });
  // A question that arrived while the user wrote takes the composer once it is empty and quiet.
  $effect(() => releaseWaiting(store));
  function page(step: -1 | 1) {
    const next = asked[(at + step + asked.length) % asked.length];
    if (!next) return;
    shownId = next.id;
    if (next.allowText && !next.secret && !repliesOf(store).ignored[next.id]) repliesOf(store).chosen = next.id;
  }

  /**
   * The fold is also the way out of answering: folding the question the box
   * answers sets the thread's questions aside, so the box sends an ordinary
   * message. Opened again, the card offers "Answer in writing" (`writeAnswer`).
   */
  function toggleQuestion(id: string): void {
    if (questionOpen && replyOf(store, id).replying) ignoreQuestions(store);
    questionOpen = !questionOpen;
  }
  const foldTitle = (id: string) => !questionOpen ? strings.activity.questionUnfold
    : replyOf(store, id).replying ? strings.activity.questionSetAside : strings.activity.questionFold;

  /** Allow or Deny; while the turn goes on, the card folds to what was decided. */
  async function answer(request: PermissionRequest, decision: 'allow' | 'deny'): Promise<boolean> {
    const working = store.busy;
    const subject = describeTool(request.toolName, request.input).subject || decisionTitle(request.toolName, request.input);
    if (!await store.answer(request.id, decision)) return false;
    if (working) repliesOf(store).receipt = { threadId, text: fill(decision === 'allow' ? strings.chat.allowedReceipt : strings.chat.deniedReceipt, { subject }) };
    return true;
  }
  // The field's Enter and Escape go through the card, so it folds the same way.
  $effect(() => lendAnswer(answer));

  let count = $derived(decisionsWaiting(store, threadId));
  // Its own derived: state made while a derived runs is not tracked by that same derived.
  let held = $derived(repliesOf(store));
  let receipt = $derived(held.receipt);
  let receiptShown = $derived(count === 0 && receipt?.threadId === threadId && store.busy);
  $effect(() => { if (receipt && (receipt.threadId !== threadId || !store.busy)) repliesOf(store).receipt = null; });
  $effect(() => { decisionTail.count = count; });

  /**
   * The keys of the decision on screen while no field has the keyboard: 1 to
   * 9 pick a choice, Enter allows and Escape denies a permission. The field
   * lends them only while it is empty (Composer); a menu, a dialog or a
   * button keeps its own.
   */
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && target !== document.body && (target.isContentEditable || target.closest('input, textarea, select, button, a, summary, [role=dialog], [role=menu], [role=listbox], [role=option]'))) return;
    if (permission && (event.key === 'Escape' || (event.key === 'Enter' && !touchScreen()))) {
      event.preventDefault();
      void answer(permission, event.key === 'Enter' ? 'allow' : 'deny');
      return;
    }
    if (shown && plain(shown) && questionOpen && pickOption(store, shown, event.key)) event.preventDefault();
  }

  /**
   * The card stands whole above the composer: as it arrives and as it grows,
   * the timeline scrolls just enough to show its actions, unless the reader
   * went up the thread, where the strip's pill offers the way back. The room
   * it may take is the timeline's height (`--decision-room`), so its body
   * scrolls inside it rather than pushing its actions out of sight.
   */
  function standsInView(node: HTMLElement): () => void {
    decisionTail.card = node;
    const root = node.closest<HTMLElement>('[data-scroll-root]');
    const show = () => {
      if (!root) return;
      const card = node.getBoundingClientRect(), view = root.getBoundingClientRect();
      const below = card.bottom - (view.bottom - 12);
      if (below > 1) root.scrollTo({ top: root.scrollTop + below, behavior: glides() ? 'smooth' : 'auto' });
    };
    // Kept whole only while the user is at it: a resize after they scrolled
    // up (the strip's pills appearing) must not pull them back down.
    let seen = false, inView = true;
    const look = () => {
      if (!root) return;
      const card = node.getBoundingClientRect(), view = root.getBoundingClientRect();
      inView = card.top < view.bottom - 1 && card.bottom > view.top;
    };
    root?.addEventListener('scroll', look, { passive: true });
    const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (root) node.style.setProperty('--decision-room', `${root.clientHeight}px`);
      if (!seen || inView) show();
      seen = true;
    }) : null;
    sized?.observe(node);
    if (root) sized?.observe(root);
    const sight = typeof IntersectionObserver === 'function' && root ? new IntersectionObserver(([entry]) => {
      decisionTail.away = !!entry && (entry.intersectionRatio < 0.5 && entry.intersectionRect.height < root.clientHeight / 2);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] }) : null;
    sight?.observe(node);
    return () => {
      sized?.disconnect();
      sight?.disconnect();
      root?.removeEventListener('scroll', look);
      if (decisionTail.card === node) { decisionTail.card = null; decisionTail.away = false; decisionTail.count = 0; }
    };
  }
</script>

<svelte:window {onkeydown} />

{#snippet openChild(child: ThreadSummary)}
  {@const hint = fill(strings.activity.openSubagentHint, { title: child.title })}
  <button type="button" class="ghost small open-child" title={hint} aria-label={hint} data-testid="activity-open-subagent" onclick={() => void store.open(child.id)}>{strings.activity.openSubagent}</button>
{/snippet}

{#snippet pager()}
  {#if asked.length > 1}
    <span class="pager">
      <button type="button" class="ghost small icon" aria-label={strings.activity.questionPrev} title={strings.activity.questionPrev} data-testid="activity-question-prev" onclick={() => page(-1)}><ChevronLeft size={16} /></button>
      <span class="meta ui-label" data-testid="activity-question-index">{fill(strings.activity.questionOf, { index: String(at + 1), total: String(asked.length) })}</span>
      <button type="button" class="ghost small icon" aria-label={strings.activity.questionNext} title={strings.activity.questionNext} data-testid="activity-question-next" onclick={() => page(1)}><ChevronRight size={16} /></button>
    </span>
  {/if}
{/snippet}

{#snippet fromChild(child: ThreadSummary, testid: string)}
  <div class="from-child" data-testid={testid}>
    <Bot size={14} />
    <span class="ui-label">{fill(strings.activity.subagentAsks, { title: child.title })}</span>
    {@render openChild(child)}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section class="thread-decision" class:receipt-only={receiptShown} data-testid="thread-decision" aria-label={strings.activity.question} tabindex="-1" {@attach standsInView}>
  {#if receiptShown && receipt}
    <p class="receipt ui-label" data-testid="answer-receipt" role="status"><Check size={14} strokeWidth={2} aria-hidden="true" /><span title={receipt.text}>{receipt.text}</span></p>
  {:else}
  <div class="decision-card">
    {#if permission}
      {#key permission.id}
        <PermissionCard docked toolName={permission.toolName} decision={null} request={permission} answer={(decision) => answer(permission!, decision)} index={1} total={permissions.length} />
      {/key}
    {/if}
    {#if childQuestions.length > 0}
      <div class="child-questions"><SubagentQuestions {store} {threadId} /></div>
    {/if}
    {#if shown}
      <div class="questions" class:plain={plain(shown)} data-testid="activity-questions" data-count={asked.length}>
        {#if !plain(shown)}
        <div class="activity-row question-row">
          {#if shown.secret}<KeyRound size={16} />{:else if shown.setting}<Settings2 size={16} />{:else if shown.agentSetting}<Bot size={16} />{:else if shown.team}<Users size={16} />{:else}<MessageCircleQuestionMark size={16} />{/if}
          <button type="button" class="ghost objective question-toggle" aria-expanded={questionOpen}
            title={foldTitle(shown.id)} data-testid="activity-question-toggle"
            onclick={() => toggleQuestion(shown!.id)}>
            <span class="question-line ui-label">{shown.secret ? shown.secret.name : questionOpen ? (shown.setting ? settingHeading(shown.setting) : shown.agentSetting ? fill(strings.agentSettingRequest.heading, { name: shown.agentSetting.agentName }) : shown.team ? teamHeading(shown.team) : strings.chat.questionAsyncHeading) : shown.text}</span>
            <ChevronDown size={16} class={questionOpen ? 'turned' : ''} />
          </button>
          {#if shown.secret}
            <InfoTip text={strings.secrets.neverShown} topic={strings.secrets.cardLabel} />
          {/if}
          {#if !shown.secret && replyOf(store, shown.id).replying}
            <span data-testid="composer-reply" data-question={shown.id} hidden></span>
          {/if}
          {@render pager()}
        </div>
        {/if}
        <div class="disclosure-fold" class:open={questionOpen || plain(shown)} inert={!questionOpen && !plain(shown)}>
          <div>
            {#each asked as question (question.id)}
              {@const reply = replyOf(store, question.id)}
              {@const child = children.get(question.threadId)}
              <div class="asked" hidden={question.id !== shown.id} data-testid="activity-question" data-question={question.id} data-thread={question.threadId}>
                {#if child}
                  {@render fromChild(child, 'activity-subagent-question')}
                {/if}
                {#if question.secret}
                {@const secret = secretPart(question.secret)}
                <Deferred part={parts.SecretCard}>{#snippet children(SecretCard)}<SecretCard {store} threadId={question.threadId} part={secret} docked />{/snippet}</Deferred>
                {:else if question.agentSetting}
                <AgentSettingCard {store} threadId={question.threadId} questionId={question.id} text={question.text} setting={question.agentSetting} answer={null} pending docked
                  respond={(optionId) => store.answerQuestion(question.threadId, question.id, [optionId])} />
                {:else if question.team}
                {@const team = question.team}
                <Deferred part={parts.TeamCard}>{#snippet children(TeamCard)}<TeamCard {store} questionId={question.id} text={question.text} {team} answer={null} pending docked
                  respond={(optionId) => store.answerQuestion(question.threadId, question.id, [optionId])} />{/snippet}</Deferred>
                {:else if question.setting}
                <SettingRequestCard {store} text={question.text} setting={question.setting} answer={null} pending docked
                  respond={(optionId) => store.answerQuestion(question.threadId, question.id, [optionId])} />
                {:else}
                <Deferred part={parts.QuestionCard}>{#snippet children(QuestionCard)}<QuestionCard
                  text={question.text}
                  options={question.options}
                  allowText={question.allowText}
                  multiple={question.multiple}
                  async={question.async === true}
                  docked
                  folded={!questionOpen}
                  answer={null}
                  pending
                  bind:picked={() => repliesOf(store).picks[question.id] ?? [], (ids) => (repliesOf(store).picks[question.id] = ids)}
                  replying={reply.replying}
                  drafted={reply.drafted}
                  submit={() => sendAnswer(store, question)}
                  skip={() => store.skipQuestion(question.threadId, question.id)}
                  onwrite={child ? undefined : () => writeAnswer(store, question.id)}
                  page={question.open?.url}
                  onopen={() => openQuestionPage(store, question.threadId, question.id)}
                >{#snippet head()}
                  {#if question.id === shown?.id}
                  {#if reply.replying}
                    <!-- The box answers this one: its fold sets it aside. -->
                    <span data-testid="composer-reply" data-question={question.id} hidden></span>
                  {/if}
                  <button type="button" class="ghost small icon fold-toggle" aria-expanded={questionOpen} aria-label={foldTitle(question.id)}
                    title={foldTitle(question.id)} data-testid="activity-question-toggle"
                    onclick={() => toggleQuestion(question.id)}><ChevronDown size={16} class={questionOpen ? 'turned' : ''} /></button>
                  {/if}
                {/snippet}{#snippet foot()}
                  <!-- The pager is a secondary line under the choices: the question keeps the head's width. -->
                  {#if question.id === shown?.id && asked.length > 1}<div class="pager-line">{@render pager()}</div>{/if}
                {/snippet}</QuestionCard>{/snippet}</Deferred>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
    {#if waits.length > 0}
      <div class="waits" data-testid="activity-subagent-permissions">
        {#each waits as request (request.id)}
          {@const child = children.get(request.threadId)}
          {#if child}
            <div class="wait" data-testid="activity-subagent-permission" data-thread={request.threadId}>
              <ShieldQuestion size={16} />
              <span class="wait-text">
                <span>{fill(strings.activity.subagentPermission, { title: child.title })}</span>
                <span class="meta">{decisionTitle(request.toolName, request.input)}</span>
              </span>
              {@render openChild(child)}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  {/if}
</section>

<style>
  /* The end of the turn that asked, in the reading column: one raised card,
     the strongest surface of the thread, its rows inset by the card's own
     padding. `--dock-*` are the row form the decision's head reads. */
  .thread-decision {
    flex: none;
    display: flex;
    flex-direction: column;
    min-width: 0;
    outline: none;
    scroll-margin-bottom: 12px;
    --dock-row: 28px; --dock-icon: 16px; --dock-type: var(--text-base); --dock-inset: 14px;
    --decision-fill: var(--color-surface);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  .thread-decision:focus-visible .decision-card { box-shadow: var(--shadow-e1), 0 0 0 2px var(--color-accent); }
  .decision-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    background: var(--decision-fill);
    box-shadow: var(--shadow-e1);
    overflow: hidden;
  }
  .decision-card > *, .questions > *, .asked > :global(*) { flex: none; }
  .decision-card > .questions, .questions > .disclosure-fold > div, .asked:not([hidden]) { display: flex; flex-direction: column; }
  .questions > .disclosure-fold { display: grid; }
  /* The ask's body scrolls inside the room the timeline gives, so its pair always shows whole. */
  .decision-card > :global(.permission.docked) { max-height: max(200px, calc(var(--decision-room, 70dvh) - 32px)); }
  /* Two kinds of decision in the one card: a hairline parts them. */
  .decision-card > * + * { border-top: 1px solid var(--color-border); }
  .activity-row { display: flex; align-items: center; gap: 8px; min-height: var(--control); min-width: 0; padding: 4px 4px 0 var(--dock-inset); }
  .from-child, .wait { display: flex; align-items: center; gap: 8px; min-height: var(--control); min-width: 0; padding: 4px 4px 0 var(--dock-inset); }
  .wait { padding-block: 4px; }
  .from-child { color: var(--color-muted-foreground); }
  .from-child > :global(svg) { flex: none; margin-inline: 1px; }
  .from-child > .ui-label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .wait > :global(svg) { flex: none; color: var(--color-live); }
  /* Two stacked lines keep their full line boxes: a trimmed `.ui-label` would lay them over each other. */
  .wait-text { display: flex; flex-direction: column; flex: 1; min-width: 0; padding-block: 4px; line-height: 1.35; font-size: var(--text-sm); }
  .wait-text > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .open-child { flex: none; padding-inline: 10px; color: var(--color-accent); }
  .question-row > :global(svg) { flex: none; color: var(--color-live); }
  .question-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; gap: 6px; height: var(--control-sm); padding: 0 6px; font-weight: 400; color: var(--color-foreground); justify-content: flex-start; }
  .question-toggle > :global(svg) { flex: none; color: var(--color-muted-foreground); transition: transform var(--motion-duration) var(--motion-curve); }
  .question-toggle > :global(.turned), .thread-decision :global(.fold-toggle > .turned) { transform: rotate(180deg); }
  .thread-decision :global(.fold-toggle > svg) { transition: transform var(--motion-duration) var(--motion-curve); }
  .question-line { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; }
  .pager { display: inline-flex; align-items: center; gap: 2px; flex: none; }
  .pager .meta { font-variant-numeric: tabular-nums; }
  /* Under the choices, its first arrow under their keycaps. */
  .pager-line { display: flex; margin: -2px 0 0 2px; }
  .meta { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  /* Answered while the agent works: one quiet line where the card stood. */
  .receipt { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0; padding: 0 var(--activity-padding, 8px); min-height: var(--control); color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .receipt span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .receipt :global(svg) { flex: none; color: var(--color-success); }
  @media (max-width: 720px) {
    .thread-decision { --dock-row: 30px; --dock-inset: 12px; }
    .activity-row { gap: 6px; }
    /* The pager's arrows stay a finger tall but narrow, so the question beside them keeps its words. */
    .pager .icon { min-width: 32px; width: 32px; }
  }
  @media (prefers-reduced-motion: reduce) { .thread-decision { animation: none; } }
  :global(html[data-motion='reduced']) .thread-decision { animation: none; }
</style>
