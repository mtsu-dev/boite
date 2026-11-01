<script lang="ts">
  import { Users } from '@lucide/svelte';
  import type { QuestionAnswer, TeamAsk } from '@boite/contracts';
  import { errorText } from '../lib/errors';
  import { keepFocus } from '../lib/focus';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { teamHeading, teamOfAsk } from '../lib/team-requests';

  /**
   * A bot's team card (`boite team propose|invite|leave`). The core offers
   * only Refuse as an option: the owner's Apply is the matching team method
   * with the card (`teams.create`, `teams.members.add`, `teams.members.remove`),
   * which settles it once the team changed.
   */
  let {
    store,
    questionId,
    text,
    team,
    answer,
    pending,
    docked = false,
    respond
  }: {
    /** The store of the machine that owns the thread. */
    store: Store;
    questionId: string;
    /** What the core wrote: the bot, the team, its members and brief. */
    text: string;
    team: TeamAsk;
    answer: QuestionAnswer | null;
    /** False on a card that closed without an answer. */
    pending: boolean;
    /** Drawn inside the dock above the composer, whose own row names it: no frame, no heading. */
    docked?: boolean;
    /** Answers the card with `refuse`. False gives it back. */
    respond: (optionId: 'refuse') => Promise<unknown>;
  } = $props();

  let busy = $state(false);

  const words = $derived(strings.teamRequest);
  const teamName = $derived(teamOfAsk(team));
  const heading = $derived(teamHeading(team));

  async function apply(): Promise<void> {
    const client = store.client;
    if (busy || !client) return;
    busy = true;
    try {
      if (team.kind === 'create') await client.call('teams.create', { name: team.name, brief: team.brief, members: team.members, card: questionId });
      else if (team.kind === 'invite') await client.call('teams.members.add', { teamId: team.teamId, botId: team.botId, card: questionId });
      else await client.call('teams.members.remove', { teamId: team.teamId, botId: team.botId, card: questionId });
      // The core settles the card once the team changed; it stays busy until then.
    } catch (error) {
      store.error = errorText(error);
      busy = false;
    }
  }

  async function refuse(): Promise<void> {
    if (busy) return;
    busy = true;
    if ((await respond('refuse')) === false) busy = false;
  }

  /** The core settles an applied card with its outcome as text and no option; Refuse is the card's one option. */
  function outcome(given: QuestionAnswer): 'applied' | 'refused' {
    return given.optionIds.length === 0 && (given.text ?? '').startsWith('applied') ? 'applied' : 'refused';
  }
</script>

<!-- An answer this client just sent clears the pending list before the card's answer arrives: it stays busy until then. -->
{#if answer !== null || (!pending && !busy)}
  {@const settled = answer === null ? null : outcome(answer)}
  <div class="team-card resolved" data-testid="team-card" data-kind={team.kind} data-state={answer === null ? 'closed' : 'answered'} data-outcome={settled} title={answer?.text ?? text}>
    <span class="glyph"><Users size={15} strokeWidth={1.75} /></span>
    <span class="verdict ui-label" data-testid="team-card-verdict">{settled === null ? words.closed : settled === 'applied' ? words.applied[team.kind] : words.refused}</span>
    <span class="given ui-label" data-testid="team-card-subject">{teamName}</span>
  </div>
{:else}
  <div class="team-card" class:docked data-testid="team-card" data-kind={team.kind} data-state="pending" role="group" aria-label={heading}>
    {#if !docked}
      <div class="head">
        <span class="glyph"><Users size={15} strokeWidth={1.75} /></span>
        <span class="muted ui-label" data-testid="team-card-heading">{heading}</span>
      </div>
    {/if}
    <p class="reason" data-testid="team-card-text">{text}</p>
    {#if !store.owner}
      <p class="hint" data-testid="team-card-guest-hint">{words.guestHint}</p>
    {/if}
    <div class="actions">
      {#if store.owner}
        <button type="button" class="primary" data-testid="team-card-apply" disabled={busy} onmousedown={keepFocus} onclick={apply}><span class="ui-label">{words.apply[team.kind]}</span></button>
      {/if}
      <button type="button" class="ghost" data-testid="team-card-refuse" disabled={busy} onmousedown={keepFocus} onclick={refuse}><span class="ui-label">{words.refuse}</span></button>
    </div>
  </div>
{/if}

<style>
  .team-card {
    border: 1px solid var(--color-edge);
    border-left-style: dashed;
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-e1);
    padding: 8px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .team-card.docked {
    border: none;
    background: transparent;
    box-shadow: none;
    padding: 4px 10px 8px;
  }

  .head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .head .muted { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .glyph { display: inline-flex; flex: none; color: var(--color-accent); }

  .reason { margin: 0; font-weight: 500; white-space: pre-wrap; overflow-wrap: anywhere; }
  .hint { margin: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }

  /* Closed: one quiet row in the timeline, like an answered question. */
  .team-card.resolved {
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
