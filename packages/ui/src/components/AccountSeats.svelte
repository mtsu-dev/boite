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
   * unfolds the provider's accounts right under it as a section of their own,
   * headed "Account", in the menu's flow: the search and the models move down
   * below the head's hairline, nothing is covered.
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
    onpick,
    onsignin
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
    /** Where a signed-out login signs in again; absent, its row offers no button. */
    onsignin?: (seat: Account) => void;
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

  /** The muted words beside the name: a login that cannot run a turn as it is. */
  function seatNote(seat: Account): string | null {
    if (seat.status === 'unauthenticated') return strings.providerSettings.step['sign-in'];
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
    return Array.from(list?.querySelectorAll<HTMLElement>('[data-seat]:not(:disabled), [data-sign-in]') ?? []);
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
        <span class="section-head ui-label" aria-hidden="true">{strings.accounts.pickerSection}</span>
        {#each seats as seat (seat.id)}
          {@const note = seatNote(seat)}
          <div class="seat-row">
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
              <span class="seat-name ui-label">{accountName(seat)}</span>
              {#if note}<span class="seat-note ui-label">{note}</span>{/if}
            </button>
            {#if onsignin && seat.status === 'unauthenticated'}
              <button type="button" class="text sign-in" role="menuitem" data-sign-in data-testid="picker-account-sign-in" onclick={() => { open = false; onsignin(seat); }}>
                <span class="ui-label">{strings.accounts.login}</span>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <span class="provider-name ui-label">{name}</span>
  {/if}
</div>

<style>
  /* The name line keeps one height whether it is a button or not; the accounts unfold under it, in the flow. */
  .account-line {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    min-height: var(--control-sm);
    justify-content: center;
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

  /* The menu's own rows, hung into the head's padding like the name button, so their checks line up with it. */
  .accounts {
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-self: stretch;
    margin: var(--space-3) -6px 0;
    animation: unfold var(--dur-2) var(--ease-out-quint);
  }
  /* Every overlay's section head (Menu.svelte): the accounts read as their own group, apart from the models. */
  .section-head {
    padding: 0 6px var(--space-1);
    color: var(--color-subtle);
    font-size: var(--text-xs);
    font-weight: 500;
  }
  @keyframes unfold { from { opacity: 0; transform: translateY(-4px); } }
  @media (prefers-reduced-motion: reduce) { .accounts { animation: none; } }

  .seat-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .seat {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
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
  .seat:disabled { opacity: 1; }

  /* The menus' selection mark (Menu.svelte): the accent check. */
  .check {
    display: inline-flex;
    flex: none;
    width: 14px;
    justify-content: center;
    color: var(--color-accent);
  }

  .seat-name {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .seat-note {
    flex: none;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }

  /* The family's text button, a row tall so a finger takes it; underlined so it reads as the row's action. */
  .sign-in {
    flex: none;
    min-height: var(--row);
    padding: 0 8px;
    border-radius: var(--radius-overlay-row);
    font-size: var(--text-sm);
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: var(--color-edge);
    text-underline-offset: 3px;
  }
  .sign-in:focus-visible { background: var(--color-hover); }
  @media (hover: hover) {
    .sign-in:hover { background: var(--color-hover); text-decoration-color: currentColor; }
  }
</style>
