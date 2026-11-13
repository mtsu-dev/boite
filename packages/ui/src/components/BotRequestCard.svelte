<script lang="ts">
  import { Bot } from '@lucide/svelte';
  import type { BotAsk, QuestionAnswer } from '@boite/contracts';
  import { errorText } from '../lib/errors';
  import { keepFocus } from '../lib/focus';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import DecisionActions from './DecisionActions.svelte';

  /**
   * A card asking the owner to let an agent create a bot (`agents.create`
   * where `agentBotCreation` is `ask`). Approve goes through
   * `agents.create.approve`, which creates the bot and settles the card;
   * Decline answers it with `refuse` and nothing is created.
   */
  let {
    store,
    threadId,
    questionId,
    setting,
    answer,
    pending,
    docked = false,
    respond
  }: {
    /** The store of the machine that owns the thread. */
    store: Store;
    threadId: string;
    questionId: string;
    setting: BotAsk;
    answer: QuestionAnswer | null;
    /** False on a card that closed without an answer. */
    pending: boolean;
    /** Drawn inside the dock above the composer, whose own row names it: no frame, no heading. */
    docked?: boolean;
    /** Answers the card with `refuse`. False gives it back. */
    respond: (optionId: 'refuse') => Promise<unknown>;
  } = $props();

  let busy = $state(false);
  const words = $derived(strings.botRequest);
  const rows = $derived([
    { id: 'name', label: words.name, value: setting.bot.name },
    { id: 'role', label: words.role, value: setting.bot.domain || words.none },
    { id: 'projects', label: words.projects, value: setting.projects.length > 0 ? setting.projects.join(', ') : words.none },
    { id: 'model', label: words.model, value: setting.model || words.none },
  ]);

  async function approve(): Promise<void> {
    const client = store.client;
    if (busy || !client) return;
    busy = true;
    try {
      await client.call('agents.create.approve', { threadId, questionId });
      // The core settles the card once the bot exists; it stays busy until then.
    } catch (error) {
      store.error = errorText(error);
      busy = false;
    }
  }

  async function decline(): Promise<void> {
    if (busy) return;
    busy = true;
    if ((await respond('refuse')) === false) busy = false;
  }
</script>

<!-- An answer this client just sent clears the pending list before the card's answer arrives: it stays busy until then. -->
{#if answer !== null || (!pending && !busy)}
  <div class="bot-card resolved" data-testid="bot-request-card" data-state={answer === null ? 'closed' : 'answered'} data-outcome={answer?.optionIds[0]}>
    <span class="glyph"><Bot size={15} strokeWidth={1.75} /></span>
    <span class="verdict ui-label" data-testid="bot-request-verdict">{answer === null ? words.closed : answer.optionIds[0] === 'applied' ? words.created : words.declined}</span>
    <span class="given ui-label">{setting.bot.name}</span>
  </div>
{:else}
  <div class="bot-card" class:docked data-testid="bot-request-card" data-state="pending" role="group" aria-label={words.heading}>
    {#if !docked}
      <div class="head">
        <span class="glyph"><Bot size={15} strokeWidth={1.75} /></span>
        <span class="muted ui-label" data-testid="bot-request-heading">{words.heading}</span>
      </div>
    {/if}
    <p class="reason">{fill(words.asks, { name: setting.bot.name })}</p>
    <dl class="facts">
      {#each rows as row (row.id)}
        <div class="fact"><dt class="ui-label">{row.label}</dt><dd data-testid="bot-request-{row.id}">{row.value}</dd></div>
      {/each}
    </dl>
    <p class="warning" data-testid="bot-request-access">{words.fullAccess}</p>
    {#if !store.owner}
      <p class="hint" data-testid="bot-request-guest-hint">{words.guestHint}</p>
    {/if}

    <!-- The app's one decision pair (DecisionActions.svelte): the outline first, the solid primary last. -->
    <DecisionActions>
      <button type="button" class="secondary" data-testid="bot-request-decline" disabled={busy} onmousedown={keepFocus} onclick={decline}><span class="ui-label">{words.decline}</span></button>
      {#if store.owner}
        <button type="button" class="primary" data-testid="bot-request-approve" disabled={busy} onmousedown={keepFocus} onclick={approve}><span class="ui-label">{words.approve}</span></button>
      {/if}
    </DecisionActions>
  </div>
{/if}

<style>
  .bot-card {
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    padding: 8px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .bot-card.docked {
    border: none;
    background: transparent;
    box-shadow: none;
    padding: 4px 10px 8px;
  }

  .head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .head .muted { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .glyph { display: inline-flex; flex: none; color: var(--color-muted-foreground); }

  .reason { margin: 0; font-weight: 500; overflow-wrap: anywhere; }

  .facts {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    font-size: var(--text-sm);
  }
  .fact { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 2px 12px; min-width: 0; }
  dt { flex: none; color: var(--color-muted-foreground); }
  dd { margin: 0; min-width: 0; font-weight: 600; overflow-wrap: anywhere; text-align: end; }

  .warning { margin: 0; font-size: var(--text-sm); color: var(--color-danger); }
  .hint { margin: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); }

  /* Closed: one quiet row in the timeline, like an answered question. */
  .bot-card.resolved {
    flex-direction: row;
    align-items: center;
    gap: var(--activity-gap);
    border: none;
    background: transparent;
    box-shadow: none;
    min-height: var(--control);
    padding: var(--activity-padding);
    color: var(--color-muted-foreground);
  }
  .resolved .glyph { width: var(--activity-glyph); justify-content: center; color: var(--color-subtle); }
  .verdict { flex: none; font-size: var(--text-sm); }
  .given { min-width: 0; font-size: var(--text-sm); color: var(--color-foreground); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
