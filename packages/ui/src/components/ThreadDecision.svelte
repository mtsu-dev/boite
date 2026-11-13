<script lang="ts">
  import { untrack } from 'svelte';
  import { Bot, ChevronDown, ChevronLeft, ChevronRight, KeyRound, MessageCircleQuestionMark, Settings2, Users } from '@lucide/svelte';
  import type { MessagePart, QuestionRequest, SecretRequest, ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { decisionTail } from '../lib/decision-tail.svelte';
  import { ignoreQuestions, pickOption, releaseWaiting, replyOf, repliesOf, sendAnswer, writeAnswer } from '../lib/question-reply.svelte';
  import { openQuestionPage } from '../lib/question-page';
  import { settingHeading } from '../lib/setting-requests';
  import { teamHeading } from '../lib/team-requests';
  import { teamsBuilt } from '../lib/teams-entry';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import InfoTip from './InfoTip.svelte';
  import SettingRequestCard from './SettingRequestCardLoader.svelte';
  import AgentSettingCard from './AgentSettingCardLoader.svelte';
  import BotRequestCard from './BotRequestCard.svelte';
  import SubagentQuestions from './SubagentQuestions.svelte';

  /*
   * What the thread asks the user, attached to the top of the composer card:
   * its questions (the ones it stopped for first, then the ones it asked
   * without stopping), its secrets, and its subagents' questions, each titled
   * with the subagent's name. Several stand in one stack behind a pager
   * ("Question 1 of 3", a row of its own over the question); each keeps what
   * was picked while another is on screen. The
   * body scrolls inside a cap (desktop about 45% of the chat's height, phone
   * about half), so Skip and Answer always show whole. Once answered, the
   * question leaves the composer; its receipt stays in the timeline
   * (QuestionCard's answered line). A permission is not here: it waits on
   * its own command row in the timeline (PermissionCard).
   */
  let { store, threadId }: { store: Store; threadId: string } = $props();

  let children = $derived(new Map(store.threads.filter((row) => row.parentThreadId === threadId && !row.archived).map((row) => [row.id, row] as const)));
  type Asked = QuestionRequest & { secret?: SecretRequest };
  let asked: Asked[] = $derived.by(() => {
    // A setting, an agent's setting or a team request the agent stopped for keeps its card in the timeline.
    const questions: Asked[] = store.pendingQuestions.filter((question) => (question.threadId === threadId || children.has(question.threadId))
      && (question.async === true || !(question.setting || question.agentSetting || question.team)));
    const secrets: Asked[] = store.pendingSecrets
      .filter((request) => request.threadId === threadId || children.has(request.threadId))
      .map((secret) => ({ id: secret.id, threadId: secret.threadId, turnId: secret.turnId, text: secret.reason, options: [], allowText: false, multiple: false, createdAt: secret.createdAt, secret }));
    // The thread's own before its subagents', what stopped it before what did not, then oldest first.
    const rank = (ask: Asked) => (ask.threadId === threadId ? 0 : 2) + Number(ask.async === true || !!ask.secret);
    return [...questions, ...secrets].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
  });
  /** Subagents whose question this machine does not hold (another machine, a list not read yet): a way into their conversation. */
  let unread = $derived(store.subagentQuestions(threadId).filter((child) => !asked.some((ask) => ask.threadId === child.threadId)));

  function secretPart(request: SecretRequest): Extract<MessagePart, { type: 'secret_request' }> {
    return { type: 'secret_request', requestId: request.id, name: request.name, reason: request.reason, placeholder: request.placeholder, status: request.status, ref: request.ref, expiresAt: request.expiresAt };
  }

  let shownId = $state<string | null>(null);
  let shown = $derived(asked.find((question) => question.id === shownId) ?? asked[0]);
  let at = $derived(shown ? asked.indexOf(shown) : 0);
  let questionOpen = $state(true);
  // The first one in order. New arrivals keep the one on screen, its picks and its fold; the pager still wins.
  $effect(() => {
    if (!asked.some((question) => question.id === shownId)) { shownId = asked[0]?.id ?? null; questionOpen = true; }
  });
  /** A plain question draws its own head (`QuestionCard`): the fold sits in it, the pager on its own row over it. */
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
  // The composer answers the question on screen when the agent stopped for none; its 1 to 9 pick it.
  $effect(() => {
    const replies = repliesOf(store);
    replies.docked = shown?.id ?? null;
    return () => { replies.docked = null; };
  });
  // A question that arrived while the user wrote takes the composer once it is empty and quiet.
  $effect(() => releaseWaiting(store));
  function page(step: -1 | 1) {
    const next = asked[(at + step + asked.length) % asked.length];
    if (next) show(next);
  }
  /** The question on screen; one the box can answer becomes the box's, unless the user set the thread's questions aside. */
  function show(next: Asked): void {
    shownId = next.id;
    if (next.allowText && !next.secret && next.threadId === threadId && !repliesOf(store).ignored[next.id]) repliesOf(store).chosen = next.id;
  }

  /** The card's own Answer sends the question on screen, then shows the one after it rather than the first left. */
  async function answerAndPage(question: Asked): Promise<boolean> {
    const after = asked[asked.indexOf(question) + 1];
    const sent = await sendAnswer(store, question);
    if (sent && after && asked.includes(after)) show(after);
    return sent;
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

  /**
   * 1 to 9 pick a choice of the question on screen while no field has the
   * keyboard. The field lends them only while it is empty (Composer); a menu,
   * a dialog or a button keeps its own.
   */
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && target !== document.body && (target.isContentEditable || target.closest('input, textarea, select, button, a, summary, [role=dialog], [role=menu], [role=listbox], [role=option]'))) return;
    if (shown && plain(shown) && questionOpen && pickOption(store, shown, event.key)) event.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

{#snippet pager()}
  {#if asked.length > 1}
    <!-- "Question 1 of 2" between the family's icon buttons, in the secondary ink: a line the eye reads, not a caption. -->
    <span class="pager">
      <button type="button" class="icon-button" aria-label={strings.activity.questionPrev} title={strings.activity.questionPrev} data-testid="activity-question-prev" onclick={() => page(-1)}><ChevronLeft size={16} /></button>
      <span class="index ui-label" data-testid="activity-question-index">{fill(strings.activity.questionOf, { index: String(at + 1), total: String(asked.length) })}</span>
      <button type="button" class="icon-button" aria-label={strings.activity.questionNext} title={strings.activity.questionNext} data-testid="activity-question-next" onclick={() => page(1)}><ChevronRight size={16} /></button>
    </span>
  {/if}
{/snippet}

{#snippet fromChild(child: ThreadSummary)}
  {@const hint = fill(strings.activity.openSubagentHint, { title: child.title })}
  <div class="from-child" data-testid="activity-subagent-question">
    <Bot size={14} />
    <span class="ui-label" title={child.title}>{fill(strings.activity.subagentAsks, { title: child.title })}</span>
    <button type="button" class="ghost small open-child" title={hint} aria-label={hint} data-testid="activity-open-subagent" onclick={() => void store.open(child.id)}>{strings.activity.openSubagent}</button>
  </div>
{/snippet}

{#if shown || unread.length > 0}
<section class="thread-decision" data-testid="thread-decision" aria-label={strings.activity.question}>
  {#if unread.length > 0}
    <div class="child-questions"><SubagentQuestions {store} {threadId} only={unread.map((child) => child.threadId)} /></div>
  {/if}
  {#if shown}
    <div class="questions" data-testid="activity-questions" data-count={asked.length}>
      {#if plain(shown) && asked.length > 1}
        {@const upNext = asked[at + 1]}
        <!-- The pager, a row of its own over the question: where this one stands, and which comes next. -->
        <div class="pager-line">{@render pager()}{#if upNext}<span class="up-next ui-label" title={upNext.text} data-testid="activity-question-up-next">{fill(strings.chat.questionUpNext, { title: upNext.text })}</span>{/if}</div>
      {/if}
      {#if !plain(shown)}
      <div class="activity-row question-row">
        {#if shown.secret}<KeyRound size={16} />{:else if shown.setting?.kind === 'bot'}<Bot size={16} />{:else if shown.setting}<Settings2 size={16} />{:else if shown.agentSetting}<Bot size={16} />{:else if shown.team}<Users size={16} />{:else}<MessageCircleQuestionMark size={16} />{/if}
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
      {#each asked as question (question.id)}
        {@const reply = replyOf(store, question.id)}
        {@const child = children.get(question.threadId)}
        <div class="asked" hidden={question.id !== shown.id} inert={!plain(question) && !questionOpen} data-testid="activity-question" data-question={question.id} data-thread={question.threadId}>
          {#if child}
            {@render fromChild(child)}
          {/if}
          {#if !plain(question)}
          <!-- Folded, the head row above holds its line: the card stays mounted, so a key typed into it waits there. -->
          <div class="held" hidden={!questionOpen}>
          {#if question.secret}
          {@const secret = secretPart(question.secret)}
          <Deferred part={parts.SecretCard}>{#snippet children(SecretCard)}<SecretCard {store} threadId={question.threadId} part={secret} docked />{/snippet}</Deferred>
          {:else if question.agentSetting}
          <AgentSettingCard {store} threadId={question.threadId} questionId={question.id} text={question.text} setting={question.agentSetting} answer={null} pending docked
            respond={(optionId) => store.answerQuestion(question.threadId, question.id, [optionId])} />
          {:else if question.team && teamsBuilt()}
          {@const team = question.team}
          <Deferred part={parts.TeamCard}>{#snippet children(TeamCard)}<TeamCard {store} questionId={question.id} text={question.text} {team} answer={null} pending docked
            respond={(optionId) => store.answerQuestion(question.threadId, question.id, [optionId])} />{/snippet}</Deferred>
          {:else if question.setting?.kind === 'bot'}
          <BotRequestCard {store} threadId={question.threadId} questionId={question.id} setting={question.setting} answer={null} pending docked
            respond={(optionId) => store.answerQuestion(question.threadId, question.id, [optionId])} />
          {:else if question.setting}
          <SettingRequestCard {store} text={question.text} setting={question.setting} answer={null} pending docked
            respond={(optionId) => store.answerQuestion(question.threadId, question.id, [optionId])} />
          {/if}
          </div>
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
            next={question.id === shown?.id && at < asked.length - 1}
            submit={() => answerAndPage(question)}
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
          {/snippet}</QuestionCard>{/snippet}</Deferred>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
{/if}

<style>
  /* The top of the composer card, on the card's own surface: the field
     follows under a hairline (ComposerDeck). Its height is capped; inside
     it, only the choices give way and scroll, so the head, the pager and the
     pair under them stay whole. `--dock-*` are the row form the head reads. */
  .thread-decision {
    flex: none;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    max-height: var(--question-cap);
    overflow: hidden;
    --question-cap: max(220px, calc(45dvh - 24px));
    /* The question is the card's title: one step over the body its choices read in (app.css `--text-title`). */
    --dock-row: 28px; --dock-icon: 16px; --dock-type: var(--text-title); --dock-inset: 14px;
    --decision-fill: var(--color-composer-surface);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  .thread-decision > *, .questions > * { flex: none; min-width: 0; }
  .thread-decision > .questions, .questions > .asked:not([hidden]) { display: flex; flex-direction: column; flex: 0 1 auto; min-height: 0; }
  .asked:not([hidden]) > :global(*) { flex: none; }
  /* The card under a folded head: out of the layout, still mounted. */
  .held:not([hidden]) { display: contents; }
  .asked:not([hidden]) > :global(.question.docked) { flex: 0 1 auto; min-height: 0; }
  /* A subagent's alert and a question: a hairline parts them. */
  .thread-decision > * + * { border-top: 1px solid var(--color-border); }
  .activity-row { display: flex; align-items: center; gap: 8px; min-height: var(--control); min-width: 0; padding: 4px 4px 0 var(--dock-inset); }
  .from-child { display: flex; align-items: center; gap: 8px; min-height: var(--control); min-width: 0; padding: 4px 4px 0 var(--dock-inset); color: var(--color-muted-foreground); }
  .from-child > :global(svg) { flex: none; margin-inline: 1px; }
  .from-child > .ui-label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .open-child { flex: none; padding-inline: 10px; color: var(--color-accent); }
  .question-row > :global(svg) { flex: none; color: var(--color-live); }
  .question-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; gap: 6px; height: var(--control-sm); padding: 0 6px; font-weight: 400; color: var(--color-foreground); justify-content: flex-start; }
  .question-toggle > :global(svg) { flex: none; color: var(--color-muted-foreground); transition: transform var(--motion-duration) var(--motion-curve); }
  .question-toggle > :global(.turned), .thread-decision :global(.fold-toggle > .turned) { transform: rotate(180deg); }
  .thread-decision :global(.fold-toggle > svg) { transition: transform var(--motion-duration) var(--motion-curve); }
  .question-line { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; }
  .pager { display: inline-flex; align-items: center; gap: 4px; flex: none; }
  .index { color: var(--color-muted-foreground); font-size: var(--text-sm); font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* The pager's own row over the question, its arrows full targets; the next question's title takes what room is left, adding none of its own (`contain`). */
  .pager { --icon-button: var(--control); }
  .pager-line { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px 0 calc(var(--dock-inset) - 8px); }
  .up-next { flex: 1 1 auto; min-width: 0; contain: inline-size; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--color-subtle); font-size: var(--text-sm); }
  @media (max-width: 720px) {
    .thread-decision { --dock-row: 30px; --dock-inset: 12px; --question-cap: max(200px, calc(50dvh - 40px)); }
    .activity-row { gap: 6px; }
    /* A finger's arrows; the next title waits for a wider screen. */
    .pager { --icon-button: 40px; gap: 2px; }
    .pager-line { padding-left: calc(var(--dock-inset) - 12px); }
    .up-next { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .thread-decision { animation: none; } }
  :global(html[data-motion='reduced']) .thread-decision { animation: none; }
</style>
