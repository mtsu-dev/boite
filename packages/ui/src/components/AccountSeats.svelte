<script lang="ts">
  import { tick } from 'svelte';
  import { Check, ChevronDown } from '@lucide/svelte';
  import type { Account, ProviderSummary } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import { accountName } from '../lib/account-name';
  import type { Choice } from '../lib/store.svelte';

  /**
   * The shown provider's name at the head of the model picker's column. With
   * one account it is the plain name. With several it is a button, "Claude",
   * or "Claude · Second seat" when the column runs on another login than the
   * provider's own (the rule the chip follows, `ModelPicker.svelte`), that
   * opens a small list of the provider's accounts in place.
   */
  let {
    name,
    shown,
    seats,
    shownAccountId,
    choice,
    locked,
    busy = false,
    disabled = false,
    onpick
  }: {
    /** The provider's name, or the column's heading when there is none. */
    name: string;
    shown: ProviderSummary | null;
    seats: Account[];
    shownAccountId: string | null;
    choice: Choice | null;
    locked: boolean;
    /** A pick is on its way: the list waits for it. */
    busy?: boolean;
    disabled?: boolean;
    /** A seat that can be taken and is not the choice already. */
    onpick: (seat: Account) => void;
  } = $props();

  let open = $state(false);
  let button = $state<HTMLButtonElement | undefined>(undefined);
  let list = $state<HTMLDivElement | undefined>(undefined);
  let wrap = $state<HTMLDivElement | undefined>(undefined);

  let several = $derived(seats.length > 1);
  let current = $derived(seats.find((seat) => seat.id === shownAccountId) ?? null);
  /** The provider's own login (no isolation directory) goes unnamed, like on the chip. */
  let other = $derived(several && current && current.isolationDir !== null ? accountName(current) : null);

  // Another provider's column, or one account left: nothing stays open.
  let openFor: string | null = null;
  $effect(() => {
    const id = shown?.id ?? null;
    if (!several || id !== openFor) open = false;
  });

  /** What keeps an account from being picked, or null. */
  function seatReason(seat: Account): string | null {
    if (!shown) return null;
    const hints: string[] = [];
    if (!shown.available) hints.push(strings.composer.unavailable);
    if (seat.status === 'unauthenticated') hints.push(strings.accounts.status.unauthenticated);
    return hints.join(', ') || null;
  }

  /** The quiet second line: a login that cannot run a turn as it is. */
  function seatNote(seat: Account): string | null {
    if (seat.status === 'unauthenticated') return strings.accounts.status.unauthenticated;
    if (seat.status === 'error') return strings.accounts.status.error;
    return null;
  }

  function seatHeld(seat: Account): boolean {
    return locked && !(choice?.providerId === shown?.id && choice?.accountId === seat.id);
  }

  function seatTitle(seat: Account): string {
    if (seatHeld(seat)) return strings.composer.lockedHint;
    const reason = seatReason(seat);
    return reason === null ? accountName(seat) : `${accountName(seat)}, ${reason}`;
  }

  /** A signed-out login cannot run a turn: it signs in again from Providers, not from here. */
  function seatOff(seat: Account): boolean {
    return seatHeld(seat) || !(shown?.available ?? false) || (seat.status === 'unauthenticated' && seat.id !== shownAccountId);
  }

  function items(): HTMLElement[] {
    return Array.from(list?.querySelectorAll<HTMLElement>('[data-seat]:not(:disabled)') ?? []);
  }

  async function show() {
    openFor = shown?.id ?? null;
    open = true;
    await tick();
    const here = items();
    (here.find((item) => item.getAttribute('aria-checked') === 'true') ?? here[0])?.focus();
  }

  function hide(refocus: boolean) {
    open = false;
    if (refocus) button?.focus();
  }

  function pickSeat(seat: Account) {
    if (!shown || seatOff(seat)) return;
    hide(true);
    if (choice?.providerId === shown.id && choice.accountId === seat.id) return;
    onpick(seat);
  }

  /** The list owns its keys: the arrows walk the accounts, Escape closes the list alone. */
  function listKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
      return;
    }
    if (event.key === 'Tab') { open = false; return; }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) {
      // Enter and Space are the focused account's own keys.
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const here = items();
    if (here.length === 0) return;
    const at = here.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? here.length - 1
        : event.key === 'ArrowDown' ? (at + 1) % here.length
          : (at - 1 + here.length) % here.length;
    here[next]?.focus();
  }

  /** Enter and Space click the button; the picker's arrows still walk past it. */
  function buttonKeys(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  }

  /** Focus or a press leaving the line and its list closes the list. */
  function onfocusout(event: FocusEvent) {
    if (!open) return;
    const next = event.relatedTarget;
    if (next instanceof Node && wrap?.contains(next)) return;
    open = false;
  }

  function onWindowPointerdown(event: PointerEvent) {
    if (!open) return;
    if (event.target instanceof Node && wrap?.contains(event.target)) return;
    open = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<div class="account-line" bind:this={wrap} {onfocusout}>
  {#if several}
    <button
      type="button"
      class="name-button"
      data-row
      data-testid="picker-account"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={[name, other, strings.composer.switchAccount].filter(Boolean).join(', ')}
      title={strings.composer.switchAccount}
      {disabled}
      bind:this={button}
      onclick={() => (open ? hide(false) : void show())}
      onkeydown={buttonKeys}
    >
      <span class="provider-name ui-label">{name}</span>
      {#if other}
        <span class="account-sep" aria-hidden="true">·</span>
        <span class="seat-label ui-label" data-testid="picker-account-name">{other}</span>
      {/if}
      <ChevronDown size={14} strokeWidth={2} class="chevron" />
    </button>
    {#if open}
      <div
        class="accounts"
        role="menu"
        tabindex="-1"
        aria-label={strings.composer.switchAccount}
        aria-busy={busy}
        data-testid="picker-accounts"
        bind:this={list}
        onkeydown={listKeys}
      >
        {#each seats as seat (seat.id)}
          {@const note = seatNote(seat)}
          <button
            type="button"
            class="seat"
            role="menuitemradio"
            aria-checked={seat.id === shownAccountId}
            disabled={busy || seatOff(seat)}
            data-seat
            data-instance="{shown?.id}::{seat.id}"
            title={seatTitle(seat)}
            onclick={() => pickSeat(seat)}
          >
            <span class="check" aria-hidden="true">{#if seat.id === shownAccountId}<Check size={14} strokeWidth={2} />{/if}</span>
            <span class="seat-text">
              <span class="seat-name ui-label">{accountName(seat)}</span>
              {#if note}<span class="seat-note ui-label">{note}</span>{/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <span class="provider-name ui-label">{name}</span>
  {/if}
</div>

<style>
  /* One height whether the name is a button or not: the list below never jumps. */
  .account-line {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: var(--control-sm);
  }

  .provider-name {
    font-size: var(--text-base);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* The name stays where the plain one sits: the button's padding hangs into the head's. */
  .name-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: calc(100% + 12px);
    height: var(--control-sm);
    margin: 0 -6px;
    padding: 0 6px;
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
  }
  .name-button:focus-visible,
  .name-button[aria-expanded='true'] { background: var(--color-hover); }
  @media (hover: hover) {
    .name-button:hover:not(:disabled) { background: var(--color-hover); }
  }
  .name-button :global(.chevron) {
    flex: none;
    color: var(--color-muted-foreground);
    transition: transform var(--dur-2) var(--ease-out-quint);
  }
  .name-button[aria-expanded='true'] :global(.chevron) { transform: rotate(180deg); }

  .account-sep,
  .seat-label {
    flex: none;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  .seat-label {
    flex: 0 3 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The provider's name gives way last: the account's name shrinks first. */
  .name-button .provider-name { flex: none; }

  .accounts {
    position: absolute;
    top: calc(100% + 6px);
    left: -6px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: max-content;
    min-width: 180px;
    max-width: min(280px, calc(100vw - 48px));
    padding: 4px;
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    animation: pop var(--dur-2) var(--ease-out-quint);
    transform-origin: top left;
  }

  .seat {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: var(--row);
    padding: 3px 8px 3px 6px;
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
  }
  .seat:focus-visible { background: var(--color-hover); }
  @media (hover: hover) {
    .seat:hover:not(:disabled) { background: var(--color-hover); }
  }
  .seat:disabled { opacity: 1; color: var(--color-muted-foreground); }

  .check {
    display: inline-flex;
    flex: none;
    width: 14px;
    justify-content: center;
  }

  /* Two cap-trimmed labels: the gap is all the room between their lines. */
  .seat-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .seat-name {
    font-size: var(--text-sm);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .seat-note {
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }
</style>
