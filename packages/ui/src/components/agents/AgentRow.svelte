<script lang="ts">
  import { tick, type Component, type Snippet } from 'svelte';
  import { ArrowRightLeft, Clock3, Pin } from '@lucide/svelte';
  import { focusOnMount } from '../../lib/actions';
  import { longPress } from '../../lib/long-press';
  import { fill, strings } from '../../lib/strings';
  import { ago, clockTime, elapsed, exactTime } from '../../lib/format';
  import { secondClock } from '../../lib/clock.svelte';
  import type { Machine } from '../../lib/workspace.svelte';
  import MachineIcon from '../MachineIcon.svelte';
  import StatusMark from '../StatusMark.svelte';
  import BuiltinBadge from './BuiltinBadge.svelte';

  /**
   * An agent in the list, the way a messenger draws a chat: its robot in its
   * ring beside two lines, its name over what it does this second while it
   * works, what it waits on, else the last thing it said. The picture spans
   * both lines, so the row holds no gap under it. On the right the time it
   * has worked, the missed answers or the time of the last one, and the next
   * wake as a small clock while it rests. A row with a menu opens it on a
   * right click or a long press, and renames in place like a thread's row.
   * A move waiting for the turn's end adds a line, as on a thread's row.
   */
  let { title, builtin = false, open = false, unread = 0, marked = false, away = false, at, now, detail = '', tone = 'idle', icon, since = null, wake = null, machine, testid, onclick, picture, aside, pinned = false, onmenu, renaming = false, onrename, pending = null }: {
    title: string;
    /** A bot Boite ships: a small badge after its name. */
    builtin?: boolean;
    open?: boolean;
    unread?: number;
    /** Something unread with no count to give, a team's chat: a dot after the time. */
    marked?: boolean;
    /** Its machine is not connected: the machine icon shows its connection state. */
    away?: boolean;
    /** The row's last activity, shown when nothing is missed. */
    at: number;
    now: number;
    detail?: string;
    /** How the line under the name reads: muted while it works, the waiting colour while it waits, danger after a failure, faded asleep. */
    tone?: 'idle' | 'working' | 'waiting' | 'error' | 'asleep';
    /** The glyph before that line: the kind of step it is on, what it waits on, a failure. */
    icon?: Component<{ size?: number; strokeWidth?: number }>;
    /** When its work started, while it works: the right side counts from it. */
    since?: number | null;
    /** When it next wakes on its own, while it rests. */
    wake?: { at: number; label: string } | null;
    /** The machine it runs on, drawn before the picture once there are two, as on a thread's row. */
    machine?: Machine;
    testid?: string;
    onclick: () => void;
    picture: Snippet;
    /** Replaces the state on the right, for a row that is not an agent's. */
    aside?: Snippet;
    /** Kept at the top of the list: the thread list's pin before the time. */
    pinned?: boolean;
    /** The row's context menu, on a right click or a long press. */
    onmenu?: (event: MouseEvent) => void;
    /** The name is a field: Enter or leaving it saves, Escape keeps the old name. */
    renaming?: boolean;
    /** The typed name, or null when the rename was abandoned. */
    onrename?: (name: string | null) => void;
    /** Where it moves once its turn ends, while it waits to. */
    pending?: string | null;
  } = $props();

  const missed = $derived(fill(unread === 1 ? strings.agents.missedOne : strings.agents.missedMany, { count: String(unread) }));
  /** The wake's hour today, its day and hour further out. */
  const wakeText = $derived(wake ? clockTime(wake.at, now) : '');
  /** Counting time reads the second clock, only while it works: the list's clock ticks far slower. */
  const spent = $derived(tone === 'working' && since !== null ? elapsed(Math.max(secondClock.now, now) - since) : null);

  let row = $state<HTMLButtonElement>();
  /** A row without a menu keeps its plain tap: a long press there would swallow the click and open nothing. */
  function press(node: HTMLElement, on: boolean) {
    let held = on ? longPress(node) : null;
    return {
      update(next: boolean) { if (next && !held) held = longPress(node); else if (!next && held) { held.destroy(); held = null; } },
      destroy() { held?.destroy(); }
    };
  }
  /** One answer per rename: the field leaves after Enter, and its blur must not answer again. */
  let answered = false;
  $effect(() => { if (renaming) answered = false; });
  function finish(field: HTMLInputElement, commit: boolean) {
    if (answered) return;
    answered = true;
    onrename?.(commit ? field.value : null);
  }
  /** Enter and Escape hand the keyboard back to the row, never to the page. */
  async function leave(field: HTMLInputElement, commit: boolean) {
    finish(field, commit);
    await tick();
    row?.focus({ preventScroll: true });
  }
</script>

{#snippet body(name: Snippet)}
  {#if machine}
    <span class="machine" class:offline={away} title={`${machine.label} · ${strings.connection[machine.store.connection]}`} aria-label={machine.label}><MachineIcon icon={machine.icon} os={machine.store.core?.os} /></span>
  {/if}
  <span class="picture">{@render picture()}</span>
  <span class="text">
    <span class="headline">
      {@render name()}
      {#if aside}{@render aside()}
      {:else}
        {#if pinned}<span class="pin" data-testid="agent-pinned"><Pin size={12} /></span>{/if}
        {#if spent !== null}<span class="spent" data-testid="agent-row-spent">{spent}</span>
        {:else if unread > 0}<span class="unread-count" role="img" title={missed} aria-label={missed} data-testid="agent-unread-count">{unread}</span>
        {:else if at > 0}<time class="when" datetime={new Date(at).toISOString()} title={exactTime(at)}>{ago(at, now)}</time>{/if}
        {#if marked}<StatusMark tone="unread" label={strings.sidebar.unread} />{/if}
      {/if}
    </span>
    {#if detail || wake}
      <span class="detail-line">
        {#if icon}{@const Glyph = icon}<span class="glyph" data-testid="agent-row-glyph"><Glyph size={13} strokeWidth={2} /></span>{/if}
        <span class="detail" data-testid="agent-row-detail">{detail}</span>
        {#if wake}<span class="wake" title={fill(strings.agents.nextWake, { name: wake.label, when: exactTime(wake.at) })} data-testid="agent-row-wake"><Clock3 size={11} strokeWidth={2} />{wakeText}</span>{/if}
      </span>
    {/if}
    {#if pending}<span class="pending" data-testid="agent-row-pending" title={pending}><ArrowRightLeft size={12} /><span class="ui-label">{pending}</span></span>{/if}
  </span>
{/snippet}

<div class="agent-row" class:open class:unread={unread > 0 || marked} class:on-machine={!!machine} data-machine-id={machine?.id} data-tone={tone}>
  {#if renaming}
    <div class="row">
      {#snippet field()}
        <input class="rename" data-testid="agent-rename" aria-label={strings.common.rename} maxlength="200" value={title} use:focusOnMount
          onblur={event => finish(event.currentTarget, true)}
          onkeydown={event => {
            // Without its keypress: the Enter would reach the row once it holds the focus again, and open the bot.
            if (event.key === 'Enter') { event.preventDefault(); void leave(event.currentTarget, true); }
            if (event.key === 'Escape') { event.stopPropagation(); void leave(event.currentTarget, false); }
          }} />
      {/snippet}
      {@render body(field)}
    </div>
  {:else}
    <button type="button" class="ghost row" bind:this={row} aria-current={open ? 'page' : undefined} title={title} {onclick} oncontextmenu={onmenu} use:press={!!onmenu} data-testid={testid} data-unread={marked ? 'true' : undefined}>
      {#snippet name()}
        {#if builtin}<span class="name"><span class="title">{title}</span><BuiltinBadge /></span>{:else}<span class="title">{title}</span>{/if}
      {/snippet}
      {@render body(name)}
    </button>
  {/if}
</div>

<style>
  .agent-row { position: relative; border-radius: var(--radius-md); transition: background var(--dur-2) var(--ease-out-quint), box-shadow var(--dur-2) var(--ease-out-quint); }
  .agent-row:hover { background: var(--color-hover); }
  /* The open row lifts: the active fill and the card shadow. */
  .agent-row.open { background: var(--color-active); box-shadow: var(--shadow-e1); }
  /* The picture spans both lines, the messenger way: one row tall, nothing under it. */
  .row { display: flex; align-items: center; width: 100%; height: auto; min-height: var(--row); padding: 7px 10px 7px 8px; gap: 10px; background: transparent; text-align: left; }
  .row:hover:not(:disabled) { background: transparent; }
  .row:active:not(:disabled) { transform: none; }
  .picture { display: inline-flex; flex: none; margin: 3px; }
  .machine { display: inline-flex; align-items: center; flex: none; margin-right: -4px; color: var(--color-muted-foreground); }
  .machine.offline { color: var(--color-danger); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .headline { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-foreground); font-weight: 500; }
  .unread .title { font-weight: 600; }
  .unread-count { flex: none; min-width: 18px; height: 18px; padding: 0 5px; display: grid; place-items: center; border-radius: 999px; background: var(--color-foreground); color: var(--color-background); font-size: var(--text-xs); font-weight: 600; }
  /* A built-in bot's name keeps its badge right after it, the time still on the far right. */
  .name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
  .name .title { flex: 0 1 auto; }
  .when { flex: none; color: var(--color-subtle); font-size: var(--text-xs); }
  .spent { flex: none; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
  .detail-line { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .glyph { display: inline-flex; flex: none; }
  .detail { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* An answer not read yet reads like an unread message, in the foreground; a state's own colour wins over it. */
  .unread[data-tone='idle'] .detail { color: var(--color-foreground); font-weight: 500; }
  /* Hue says status: work in muted ink, its glyph breathing; the user's turn in the live colour; a failure in danger. */
  [data-tone='working'] .detail-line { color: var(--color-muted-foreground); }
  [data-tone='working'] .detail { font-weight: 500; }
  [data-tone='working'] .glyph { animation: pulse 1.6s var(--loop-ease-in-out-48) infinite var(--loops); }
  [data-tone='waiting'] .detail-line { color: var(--color-live); }
  [data-tone='waiting'] .detail { font-weight: 500; }
  [data-tone='error'] .detail-line { color: var(--color-danger); }
  /* A failure's line says its cause and the way out: it wraps whole rather than lose the action at a phone's width. */
  [data-tone='error'] .detail-line { align-items: flex-start; }
  [data-tone='error'] .detail-line .glyph { margin-top: 2px; }
  [data-tone='error'] .detail { white-space: normal; overflow-wrap: anywhere; line-height: 1.4; }
  [data-tone='asleep'] .detail-line { color: var(--color-subtle); }
  [data-tone='asleep'] .title { color: var(--color-muted-foreground); }
  .wake { flex: none; display: inline-flex; align-items: center; gap: 3px; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .pin { display: inline-flex; align-items: center; flex: none; color: var(--color-muted-foreground); }
  /* A move waiting for the turn's end, like a thread's. */
  .pending { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .pending span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pending :global(svg) { flex: none; }
  /* The name becomes its field where it stood: the row keeps its height and its picture. */
  .rename { flex: 1; min-width: 0; height: 22px; padding: 0 6px; }
  /* A long press opens the menu, not the system's link and text callout. */
  .row { -webkit-touch-callout: none; }
  @media (prefers-reduced-motion: reduce) { [data-tone='working'] .glyph { animation: none; } }
  :global(html[data-motion='reduced']) [data-tone='working'] .glyph { animation: none; }
</style>
