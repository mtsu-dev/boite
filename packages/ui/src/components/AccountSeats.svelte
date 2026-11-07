<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import type { Account, ProviderSummary } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import type { Choice } from '../lib/store.svelte';

  /**
   * The accounts of the provider the model picker shows, as a small dropdown
   * beside its name: the account shown, and under it the others when opened.
   * Only drawn when there is more than one to pick from.
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

  function pickSeat(seat: Account) {
    if (!shown || seatOff(seat)) return;
    open = false;
    if (choice?.providerId === shown.id && choice.accountId === seat.id) return;
    onpick(seat);
  }

  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let current = $derived(seats.find((seat) => seat.id === shownAccountId) ?? seats[0]);
  function outside(event: PointerEvent) {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={outside} />

{#if seats.length > 1}
  <div class="seats" bind:this={root} aria-busy={busy}>
    <button type="button" class="current" data-testid="picker-account" aria-haspopup="true" aria-expanded={open} title={strings.accounts.heading} onclick={() => (open = !open)}>
      <span class="ui-label">{current?.label}</span><ChevronDown size={12} strokeWidth={2} />
    </button>
    <!-- Kept in the page while closed, so the list is the same nodes when it opens. -->
    <div class="list" role="group" aria-label={strings.accounts.heading} hidden={!open}>
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
  </div>
{/if}

<style>
  .seats { position: relative; flex: none; min-width: 0; max-width: 50%; }

  .current {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    height: var(--control-sm);
    padding: 0 6px 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .current > .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .current:hover, .current[aria-expanded='true'] { background: var(--color-hover); color: var(--color-foreground); }

  .list:not([hidden]) {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 140px;
    max-width: 220px;
    padding: 4px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    box-shadow: var(--shadow-e2);
  }

  .seat {
    display: block;
    width: 100%;
    height: var(--control-sm);
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .seat:hover:not(:disabled),
  .seat:focus-visible {
    background: var(--color-hover);
    color: var(--color-foreground);
    outline: none;
  }

  .seat[aria-pressed='true'] { color: var(--color-foreground); }

  @media (max-width: 720px) {
    .current, .seat { height: var(--touch-target); }
  }
</style>
