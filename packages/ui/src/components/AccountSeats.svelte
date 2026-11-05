<script lang="ts">
  import type { Account, ProviderSummary } from '@boite/contracts';
  import { fill, strings } from '../lib/strings';
  import type { Choice } from '../lib/store.svelte';

  /**
   * The accounts of the provider the model picker shows, as a segmented control
   * under its name. Only drawn when there is more than one to pick from.
   */
  let {
    shown,
    seats,
    shownAccountId,
    choice,
    locked,
    busy = false,
    onpick
  }: {
    shown: ProviderSummary | null;
    seats: Account[];
    shownAccountId: string | null;
    choice: Choice | null;
    locked: boolean;
    busy?: boolean;
    /** A seat that can be taken and is not the choice already. */
    onpick: (seat: Account) => void;
  } = $props();

  /** What keeps an account chip from being clicked, or null. */
  function seatReason(seat: Account): string | null {
    if (!shown) return null;
    const hints: string[] = [];
    if (!shown.available) hints.push(strings.composer.unavailable);
    if (seat.status === 'unauthenticated') hints.push(strings.accounts.status.unauthenticated);
    return hints.join(', ') || null;
  }

  function seatHeld(seat: Account): boolean {
    return locked && !(choice?.providerId === shown?.id && choice?.accountId === seat.id);
  }

  function seatTitle(seat: Account): string {
    if (seatHeld(seat)) return strings.composer.lockedHint;
    const reason = seatReason(seat);
    return reason === null ? seat.label : `${seat.label}, ${reason}`;
  }

  /** A signed-out login cannot run a turn: it signs in again from Providers, not from here. */
  function seatOff(seat: Account): boolean {
    return seatHeld(seat) || !(shown?.available ?? false) || (seat.status === 'unauthenticated' && seat.id !== shownAccountId);
  }

  /**
   * Why the greyed seats cannot be taken, as the line a phone prints under the
   * control: a phone shows no tooltip, and a disabled button takes no tap.
   */
  let offReasons = $derived.by((): string[] => {
    if (seats.some(seatHeld)) return [strings.composer.lockedHint];
    return seats.flatMap(seat => {
      const reason = seatOff(seat) ? seatReason(seat) : null;
      return reason ? [fill(strings.composer.seatReason, { account: seat.label, reason })] : [];
    });
  });

  function pickSeat(seat: Account) {
    if (!shown || seatOff(seat)) return;
    if (choice?.providerId === shown.id && choice.accountId === seat.id) return;
    onpick(seat);
  }
</script>

{#if seats.length > 1}
  <div class="seats" role="group" aria-label={strings.accounts.heading} aria-busy={busy}>
    {#each seats as seat (seat.id)}
      <button
        type="button"
        class="seat"
        disabled={busy || seatOff(seat)}
        data-seat
        data-instance="{shown?.id}::{seat.id}"
        aria-pressed={seat.id === shownAccountId}
        title={seatTitle(seat)}
        onclick={() => pickSeat(seat)}
      >
        <span class="ui-label">{seat.label}</span>
      </button>
    {/each}
  </div>
  {#if offReasons.length}<p class="reasons" data-testid="seat-reasons">{offReasons.join(' · ')}</p>{/if}
{/if}

<style>
  .seats {
    display: flex;
    gap: 2px;
    align-self: flex-start;
    flex-shrink: 0;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 2px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--color-segment-track);
    min-width: 0;
  }

  .seat {
    height: var(--control-sm);
    min-height: var(--control-sm);
    flex-shrink: 0;
    max-width: 150px;
    padding: 0 7px;
    border: none;
    border-radius: calc(var(--radius-md) - 3px);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    transition:
      background var(--dur-2) var(--ease-out-quint),
      color var(--dur-2) var(--ease-out-quint);
  }

  .seat:hover:not(:disabled):not([aria-pressed='true']),
  .seat:focus-visible:not([aria-pressed='true']) {
    background: var(--color-hover);
    color: var(--color-foreground);
    outline-offset: -2px;
  }

  .seat[aria-pressed='true'] {
    background: var(--color-segment-thumb);
    color: var(--color-foreground);
    box-shadow: var(--shadow-thumb);
  }

  /* The desktop names the reason in each seat's tooltip. */
  .reasons { display: none; }

  @media (max-width: 720px) {
    .seat { height: var(--touch-target); min-height: var(--touch-target); }
    .reasons { display: block; margin: 0; font-size: var(--text-xs); line-height: 1.35; color: var(--color-muted-foreground); }
  }
</style>
