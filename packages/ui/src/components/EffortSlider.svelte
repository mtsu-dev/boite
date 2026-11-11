<script lang="ts">
  import { ChevronDown, Zap } from '@lucide/svelte';
  /** The agents' level ids and the cost line each one reads. */
  const LEVEL_COST: Record<string, 'off' | 'low' | 'middle' | 'deeper' | 'high' | 'top' | 'extended'> = {
    off: 'off', none: 'off', minimal: 'off', low: 'low', medium: 'middle', high: 'deeper', xhigh: 'high', max: 'top', ultra: 'extended', ultrathink: 'extended'
  };
  import type { EffortLevel } from '@boite/contracts';
  import { onDestroy } from 'svelte';
  import { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { glides } from '../lib/motion';
  import { fill, strings } from '../lib/strings';
  import { levelName } from '../lib/format';
  import SheetHead from './SheetHead.svelte';

  /**
   * The reasoning chip and its popover: one dot per level of the model's scale,
   * filled up to the active one. A click on a dot or its name, a drag along the
   * track, or the arrows move it, and none of them close the popover: the level
   * is a setting of the model the composer already runs. The filled part glows
   * brighter as the level rises. The heading always names the picked level;
   * the scale's two ends are named under the track. A dot under a mouse gets
   * a hollow ring and its own name under it, and the line under the track
   * reads that level's cost in a lighter ink until a click picks it. A model
   * with a fast mode puts its switch at the top left of the popover (the bolt,
   * its name and a small switch, on or off), and the chip carries a bolt while
   * it is on; switching a speed on sends streaks across the popover, more and
   * faster for the second tier. `readonly` names a bot's level and opens nothing.
   */
  let {
    levels,
    active,
    onpick,
    speeds = [],
    speed = null,
    onspeed = () => {},
    ondefault,
    readonly = false,
    readonlyHint = ''
  }: {
    levels: EffortLevel[];
    /**
     * The level the thread or draft runs, the model's own default when it picked
     * none. Null or a level off the scale reads as the agent's own default: no
     * dot is lit until one is picked.
     */
    active: string | null;
    onpick: (id: string) => void;
    speeds?: { id: string; label: string; description?: string }[];
    speed?: string | null;
    onspeed?: (id: string | null) => void;
    /**
     * Given for a model whose agent picks its own level: a picked level then
     * shows a Default switch that hands the level back to the agent.
     */
    ondefault?: () => void;
    /** The level is set elsewhere (a bot's settings): the chip names it and opens nothing. */
    readonly?: boolean;
    readonlyHint?: string;
  } = $props();

  const popover = new Closing();
  let root = $state<HTMLDivElement | undefined>(undefined);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  let track = $state<HTMLDivElement | undefined>(undefined);
  let panel = $state<HTMLDivElement | undefined>(undefined);
  let line = $state<HTMLDivElement | undefined>(undefined);
  let dragging = $state(false);
  let preview = $state<number | null>(null);
  /** The dot under a hovering pointer: it gets a ring and its name, the heading and the fill stay on the pick. */
  let hovered = $state<number | null>(null);

  /** -1 while the agent keeps its own level: nothing picked and no default known. */
  let index = $derived(preview ?? levels.findIndex((level) => level.id === active));
  let position = $derived(Math.max(0, index));
  let current = $derived(levels[index] ?? null);
  const selectedSpeed = $derived(speeds.find(entry => entry.id === speed));
  const levelLabel = $derived(current ? levelName(current) : levels.length > 0 ? strings.composer.effortDefault : strings.composer.standardSpeed);
  /** A hovered dot other than the picked one: the preview, never the pick. */
  let ghost = $derived(hovered !== null && hovered !== index && !dragging ? hovered : null);
  /** What the line under the track costs: the previewed level, else the live one. */
  let shown = $derived(ghost ?? index);
  /** The fast switch's own name, on or off: the tier that runs, else the first one a click turns on. */
  const fastLabel = $derived(selectedSpeed ?? speeds[0] ? levelName((selectedSpeed ?? speeds[0])!) : '');
  const label = $derived(current || levels.length > 0 ? levelLabel : selectedSpeed ? levelName(selectedSpeed) : strings.composer.standardSpeed);
  /** A scale of levels: the chip names what its word measures ("Effort High"); a speed alone reads as itself. */
  const named = $derived(levels.length > 0);
  // An accent above a leading capital raises the label's visible centre.
  const accentedCap = $derived(!named && /^\p{Lu}[\u0300-\u0314]/u.test(label.normalize('NFD')));
  function cycleSpeed() {
    const next = speeds.findIndex(entry => entry.id === speed) + 1;
    onspeed(next >= speeds.length ? null : speeds[next]!.id);
    if (next < speeds.length) burst(Math.min(2, next + 1));
  }
  let last = $derived(Math.max(0, levels.length - 1));
  /** 0 at the lowest level, 1 at the highest: how much the filled part glows. */
  let glow = $derived(last === 0 ? 1 : position / last);
  /**
   * The trade-off of the hovered or picked level in plain words, by its id:
   * "High" is the third of six on one scale and the last of three on another,
   * and reads the same on both. A level of another name reads its place on the scale.
   */
  let cost = $derived.by(() => {
    if (levels.length === 0) return null;
    if (shown < 0) return strings.composer.effortDefaultHint;
    const ratio = last === 0 ? 0.5 : shown / last;
    const step = LEVEL_COST[levels[shown]?.id ?? ''] ?? (ratio <= 0 ? 'low' : ratio >= 1 ? 'top' : ratio > 0.5 ? 'high' : 'middle');
    // Fast on: one sentence, the level's depth then what the tier adds.
    return selectedSpeed ? fill(strings.composer.effortWithFast, { depth: strings.composer.effortDepth[step], fast: levelName(selectedSpeed) }) : strings.composer.effortCost[step];
  });

  type Streak = { top: number; from: number; length: number; delay: number; duration: number; thick: number; alpha: number };
  /** The streaks of the latest switch to a speed; `power` is 1 for the first tier, 2 past it. */
  let rush = $state<{ id: number; power: number; streaks: Streak[] } | null>(null);
  let rushes = 0;
  let rushTimer: ReturnType<typeof setTimeout> | undefined;
  /** Speed lines running right to left over the popover, as text does when it scrolls by fast. */
  function burst(power: number) {
    if (!glides()) return;
    const strong = power > 1;
    const count = strong ? 22 : 12;
    const streaks = Array.from({ length: count }, (_, at) => ({
      // Spread over the height, jittered so two bursts never draw the same lines.
      top: 3 + ((at + Math.random() * 0.8) / count) * 94,
      // The first lines are already inside the popover, so the burst reads at once.
      from: at % 3 === 0 ? 30 + Math.random() * 60 : 100,
      length: strong ? 60 + Math.random() * 110 : 34 + Math.random() * 56,
      delay: Math.random() * (strong ? 260 : 160),
      duration: strong ? 200 + Math.random() * 140 : 320 + Math.random() * 160,
      thick: strong ? (Math.random() < 0.4 ? 2.5 : 1.5) : 1.5,
      alpha: (strong ? 0.6 : 0.45) + Math.random() * 0.35
    }));
    rush = { id: ++rushes, power, streaks };
    clearTimeout(rushTimer);
    const end = Math.max(...streaks.map(streak => streak.delay + streak.duration));
    rushTimer = setTimeout(() => { rush = null; }, end + 60);
  }
  onDestroy(() => clearTimeout(rushTimer));

  /** The dots are evenly spaced over the line, so a level sits at a plain percentage. */
  function offset(at: number): string {
    return last === 0 ? '50%' : `${(at / last) * 100}%`;
  }

  /** The keyboard lands on the track the moment it is there, so the arrows work at once. */
  $effect(() => {
    if (!popover.open) return;
    track?.focus({ preventScroll: true });
  });

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    popover.toggle();
  }

  function pick(at: number) {
    const level = levels[Math.min(Math.max(at, 0), last)];
    if (!level || level.id === current?.id) return;
    onpick(level.id);
  }

  /** The dot the pointer is nearest, out of the line's own width. */
  function nearest(clientX: number): number {
    const box = line?.getBoundingClientRect();
    if (!box || box.width === 0 || last === 0) return index;
    const ratio = (clientX - box.left) / box.width;
    return Math.round(Math.min(Math.max(ratio, 0), 1) * last);
  }

  function onpointerdown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    track?.focus({ preventScroll: true });
    track?.setPointerCapture(event.pointerId);
    preview = nearest(event.clientX);
  }

  function onpointermove(event: PointerEvent) {
    if (!dragging) {
      // A finger has no hover: only a mouse or a pen previews a level.
      if (event.pointerType !== 'touch') hovered = nearest(event.clientX);
      return;
    }
    preview = nearest(event.clientX);
  }

  function onpointerup(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const chosen = preview;
    preview = null;
    if (chosen !== null) pick(chosen);
    if (track?.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  }

  function ontrackkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') pick(index - 1);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') pick(index + 1);
    else if (event.key === 'Home') pick(0);
    else if (event.key === 'End') pick(last);
    else return;
    event.preventDefault();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (!popover.open) return;
      event.stopPropagation();
      popover.hide();
      trigger?.focus({ preventScroll: true });
      return;
    }
    if (!popover.open && event.key === 'ArrowUp') {
      event.preventDefault();
      popover.show();
    }
  }

  /** Shuts the popover, as when a question about the pick must sit on top of it. */
  export function close() { popover.hide(); }

  function onWindowPointerdown(event: PointerEvent) {
    if (!popover.open) return;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    popover.hide();
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<!--
  The chip's face: the slider's bolt, then what it sets and the level, whole
  ("Effort High"). A fast mode switched on fills the bolt, so it shows with
  the popover shut.
-->
{#snippet face()}
  {@const fast = levels.length > 0 && !!selectedSpeed}
  <span class="bolt-mark" class:fast data-testid={fast ? 'effort-fast-mark' : undefined} title={fast && selectedSpeed ? levelName(selectedSpeed) : undefined}><Zap size={14} strokeWidth={1.75} fill={fast ? 'currentColor' : 'none'} /></span>
  <span class="ui-label" class:accented-cap={accentedCap}>{#if named}<span class="name">{strings.composer.effortTitle}</span>{' '}<span class="level">{label}</span>{:else}{label}{/if}</span>
{/snippet}

<div class="effort" bind:this={root}>
  {#if readonly}
  <span class="ui-chip trigger readonly" data-testid="composer-effort" title={readonlyHint || strings.composer.effortTitle} aria-label={`${strings.composer.effortTitle}: ${label}`}>
    {@render face()}
  </span>
  {:else}
  <button
    type="button"
    class="ui-chip trigger"
    aria-haspopup="dialog"
    aria-expanded={popover.open}
    title={strings.composer.effortTitle}
    data-testid="composer-effort"
    bind:this={trigger}
    onclick={toggle}
    {onkeydown}
  >
    {@render face()}
    <ChevronDown size={12} strokeWidth={2} class="chevron" />
  </button>
  {/if}

  {#if popover.shown && !readonly}
    <div
      class="popover"
      class:closing={popover.closing}
      role="dialog"
      tabindex="-1"
      aria-label={strings.composer.effortTitle}
      data-testid="composer-effort-menu"
      use:popover.attach
      bind:this={panel}
      use:floating={{ anchor: () => trigger ?? null, placement: 'top', dismiss: () => popover.hide() }}
      onanimationend={popover.end}
      {onkeydown}
    >
      {#if rush}
        {#key rush.id}
          <div class="streaks" class:strong={rush.power > 1} aria-hidden="true" data-testid="effort-streaks" data-power={rush.power}>
            {#each rush.streaks as streak, at (at)}
              <span class="streak" style:top={`${streak.top}%`} style:--from={`${streak.from}%`} style:--length={`${streak.length}px`} style:--thick={`${streak.thick}px`} style:--alpha={streak.alpha} style:animation-delay={`${streak.delay}ms`} style:animation-duration={`${streak.duration}ms`}></span>
            {/each}
          </div>
        {/key}
      {/if}
      <SheetHead title={strings.composer.effortTitle} />
      <div class="heading">
        {#if speeds.length > 0}
          <button type="button" class="speed" class:active={!!selectedSpeed} data-testid="effort-speed" aria-label={strings.composer.speed} aria-pressed={!!selectedSpeed} title={selectedSpeed?.description ?? (selectedSpeed ? levelName(selectedSpeed) : strings.composer.standardSpeed)} onclick={cycleSpeed}>
            {#key rush?.id}<span class="bolt" class:dash={!!rush} class:strong={(rush?.power ?? 0) > 1}><Zap size={14} fill={selectedSpeed ? 'currentColor' : 'none'} /></span>{/key}
            <span class="ui-label" data-testid="effort-speed-label">{fastLabel}</span>
            <!-- Off reads as a switch to turn on, not as a missing bolt. -->
            <span class="switch mini" class:on={!!selectedSpeed} aria-hidden="true"></span>
          </button>
        {/if}
        {#key rush?.id}<span class="level ui-label" class:dash={!!rush} class:strong={(rush?.power ?? 0) > 1} data-testid="effort-level">{levelLabel}</span>{/key}
        {#if ondefault && current}
          <button type="button" class="speed agent-default ui-label" data-testid="effort-default" title={strings.composer.effortDefaultHint} onclick={ondefault}>{strings.composer.effortDefault}</button>
        {/if}
      </div>

      {#if levels.length > 0}
      <div
        class="track"
        style:--effort-intensity={`${40 + glow * 60}%`}
        style:--effort-glow={glow}
        style:--effort-halo={`${Math.round(10 + glow * 55)}%`}
        style:--effort-blur={`${Math.round(2 + glow * 16)}px`}
        bind:this={track}
        role="slider"
        tabindex="0"
        aria-label={strings.composer.effortTitle}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={position}
        aria-valuetext={levelLabel}
        data-testid="effort-track"
        onkeydown={ontrackkeydown}
        {onpointerdown}
        {onpointermove}
        {onpointerup}
        onpointercancel={onpointerup}
        onpointerleave={() => { hovered = null; }}
      >
        <div class="line" bind:this={line}>
          {#if current}
            <span class="progress" style="width: calc({offset(index)} + var(--track-pad))"></span>
            <span class="thumb" style="left: {offset(index)}"></span>
          {/if}
          {#each levels as level, at (level.id)}
            <button type="button" class="dot" class:on={at <= index} class:hovered={at === ghost} data-dot={level.id} data-value={level.id} title={levelName(level)} aria-label={levelName(level)} tabindex="-1" style="left: {offset(at)}" onclick={() => pick(at)}></button>
          {/each}
        </div>
      </div>
      {#if levels.length > 1}
        <!-- The scale's two ends by name; a previewed dot's name takes their place under it. -->
        <div class="ends" class:previewing={ghost !== null} aria-hidden="true" data-testid="effort-ends">
          <span class="end" data-end="low" style:--at={0} style:left="0%">{levelName(levels[0]!)}</span>
          <span class="end" data-end="high" style:--at={1} style:left="100%">{levelName(levels[last]!)}</span>
          {#if ghost !== null}<span class="ghost" data-testid="effort-preview" style:--at={last === 0 ? 0.5 : ghost / last} style:left={offset(ghost)}>{levelName(levels[ghost]!)}</span>{/if}
        </div>
      {/if}
      {#if cost}<p class="cost" class:previewing={ghost !== null} data-testid="effort-cost">{cost}</p>{/if}
      {/if}

    </div>
  {/if}
</div>

<style>
.effort { position: relative; display: inline-flex; }
.trigger { cursor: pointer; height: var(--control-sm); }
.trigger.readonly { cursor: default; }
@supports (text-box: trim-both cap alphabetic) {
  .trigger .accented-cap { translate: 0 0.1em; }
}
.trigger[aria-expanded='true'] { background: var(--control-glaze) var(--color-control-hover); color: var(--color-foreground); }
/* A tap leaves :hover behind on a touch screen: the chip would stay pressed once its popover closed. */
@media (hover: hover) { .trigger:not(.readonly):hover { background: var(--control-glaze) var(--color-control-hover); color: var(--color-foreground); } }
.bolt-mark { display: inline-flex; flex: none; }
/* Fast on is a live state: the bolt fills in the accent. */
.bolt-mark.fast { color: var(--color-accent); filter: drop-shadow(0 0 4px var(--color-accent-soft)); }
/* What the chip sets, a tier under the level it reads. */
.name { color: var(--color-subtle); }
.level { color: var(--color-foreground); font-weight: 500; }
/* Every menu's one edge, radius and shadow. */
.popover { --track-pad: 12px; position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 40; width: 288px; padding: 10px 12px 12px; background: var(--overlay-surface); border: 1px solid var(--overlay-edge); border-radius: var(--radius-overlay); box-shadow: var(--shadow-overlay); animation: pop var(--dur-2) var(--ease-out-quint); transform-origin: bottom left; }
.popover.closing { animation-name: pop-out; pointer-events: none; }
/* Three columns: the fast switch on the left, the level in the middle whatever the switch's width. */
.heading { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-height: 24px; margin-bottom: 8px; color: var(--color-foreground); font-size: var(--text-sm); font-weight: 600; }
.level { grid-column: 2; white-space: nowrap; transition: color var(--dur-1); }
.speed { grid-column: 1; justify-self: start; display: inline-flex; align-items: center; gap: 5px; height: 24px; margin-left: -4px; padding: 0 6px; border: none; border-radius: var(--radius-md); background: transparent; font-size: var(--text-xs); font-weight: 500; color: var(--color-muted-foreground); transition: color var(--dur-2), background var(--dur-2), box-shadow var(--dur-2); }
.speed :global(svg) { transition: transform var(--dur-2) var(--ease-out-quint); }
/* The bolt is a live control: the one accent-soft fill (owner's decision), with accent ink and a glow, under the pointer and while on. */
@media (hover: hover) {
  .speed:hover { color: var(--color-accent); background: var(--color-accent-soft); box-shadow: 0 0 12px var(--color-accent-soft); }
  .speed:hover :global(svg) { transform: rotate(-12deg) scale(1.16); }
}
.speed.active { color: var(--color-accent); background: var(--color-accent-soft); }
.speed.active .bolt { filter: drop-shadow(0 0 5px var(--color-accent-soft)); }
/* The app's switch at a chip's scale. */
.switch.mini { --switch-width: 24px; --switch-height: 14px; }
.switch.mini::after { top: 2px; left: 2px; width: 8px; height: 8px; }
.switch.mini.on::after { transform: translateX(10px); }
.agent-default.speed:hover { color: var(--color-foreground); background: var(--color-hover); box-shadow: none; }
.speed:active :global(svg) { transform: scale(.9); }
.agent-default { grid-column: 3; justify-self: end; margin: 0 -4px 0 0; }
.track { padding: 3px var(--track-pad); cursor: pointer; touch-action: none; height: 30px; background: var(--color-edge); border-radius: 999px; box-shadow: inset 0 0 0 1px var(--color-border); }
.track:focus-visible { outline: 1px solid var(--color-reasoning); outline-offset: 3px; }
.line { position: relative; height: 24px; }
/* The filled part lights up with the level: more accent, a brighter end at the thumb and a wider halo. */
.progress {
  position: absolute; inset: 0 auto 0 calc(-1 * var(--track-pad)); border-radius: 999px 0 0 999px;
  background: linear-gradient(90deg, color-mix(in oklch, var(--color-accent) var(--effort-intensity), var(--color-surface-3)), color-mix(in oklch, var(--color-accent) var(--effort-intensity), var(--color-reasoning-on) calc(var(--effort-glow) * 22%)));
  box-shadow: 0 0 var(--effort-blur) color-mix(in oklch, var(--color-accent) var(--effort-halo), transparent);
  transition: background var(--dur-3), box-shadow var(--dur-3);
}
.dot { position: absolute; top: 50%; width: 16px; height: 24px; padding: 0; border: none; background: transparent; transform: translate(-50%, -50%); }
.dot::after { content: ""; display: block; width: 4px; height: 4px; margin: auto; border-radius: 50%; background: var(--color-muted-foreground); }
.dot::after { transition: transform var(--dur-1) var(--ease-out-quint); }
.dot.on::after { background: var(--color-reasoning-on); opacity: calc(.35 + var(--effort-glow) * .4); }
/* The previewed dot: a hollow ring, unlike the filled thumb of the pick. */
.dot.hovered::after { width: 12px; height: 12px; background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-reasoning-on); opacity: 1; }
/* The thumb sits inside the track with an even gap and a hairline edge, so it reads sharp on any surface. */
.thumb { position: absolute; top: 50%; width: 24px; height: 24px; transform: translate(-50%, -50%); border-radius: 50%; background: var(--color-reasoning-on); box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-foreground) 14%, transparent), var(--shadow-e1), 0 0 calc(var(--effort-blur) * .8) color-mix(in oklch, var(--color-accent) var(--effort-halo), transparent); z-index: 1; transition: box-shadow var(--dur-3); }
/* The ends sit under the first and last dots, inside the track's own inset. */
.ends { position: relative; height: 16px; margin: 6px var(--track-pad) 0; color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 16px; }
.ends > span { position: absolute; top: 0; white-space: nowrap; transform: translateX(calc(var(--at) * -100%)); transition: opacity var(--dur-1); }
/* Named per class: reduced motion fades them, never slides their script placement. */
  .end { transition: opacity var(--dur-1); }
  .ends.previewing .end { opacity: 0; }
.ghost { color: var(--color-foreground); font-weight: 500; transition: opacity var(--dur-1); }
.cost.previewing { color: var(--color-subtle); }
.cost { margin: 8px 0 0; color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.35; text-align: center; }
/* Speed lines: each one crosses the whole popover from right to left, its bright head first. */
.streaks { position: absolute; inset: 0; z-index: 2; overflow: hidden; border-radius: inherit; pointer-events: none; }
.streak { position: absolute; left: 0; right: 0; height: var(--thick); transform: translateX(var(--from)); opacity: 0; animation-name: streak; animation-timing-function: cubic-bezier(.3, 0, .7, 1); animation-fill-mode: both;
  /* Placed from script: reduced motion's blanket transition would slide it there. */
  transition-property: none; }
.streak::before { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--length); border-radius: 999px; background: linear-gradient(90deg, var(--color-accent), color-mix(in oklch, var(--color-accent) 40%, transparent) 45%, transparent); }
.strong .streak::before { background: linear-gradient(90deg, color-mix(in oklch, var(--color-accent), var(--color-reasoning-on) 35%), var(--color-accent) 30%, transparent); }
@keyframes streak {
  0% { transform: translateX(var(--from)); opacity: 0; }
  10% { opacity: var(--alpha); }
  80% { opacity: var(--alpha); }
  100% { transform: translateX(-100%); opacity: 0; }
}
/* The words seem to arrive at speed: a short slide from the right with a trail behind them. */
.bolt { display: inline-flex; }
.level.dash { animation: dash 420ms var(--ease-out-quint) both; }
.level.dash.strong { animation: dash-strong 560ms var(--ease-out-quint) both; }
.bolt.dash { animation: bolt 360ms var(--ease-out-quint) both; }
.bolt.dash.strong { animation: bolt-strong 480ms var(--ease-out-quint) both; }
@keyframes dash {
  0% { transform: translateX(10px) skewX(-8deg); text-shadow: 6px 0 2px color-mix(in oklch, var(--color-accent) 45%, transparent), 13px 0 4px color-mix(in oklch, var(--color-accent) 20%, transparent); }
  100% { transform: none; text-shadow: 0 0 0 transparent, 0 0 0 transparent; }
}
@keyframes dash-strong {
  0% { transform: translateX(22px) skewX(-16deg); text-shadow: 8px 0 2px color-mix(in oklch, var(--color-accent) 60%, transparent), 18px 0 4px color-mix(in oklch, var(--color-accent) 35%, transparent), 30px 0 7px color-mix(in oklch, var(--color-accent) 18%, transparent); }
  55% { transform: translateX(-2px) skewX(3deg); }
  100% { transform: none; text-shadow: 0 0 0 transparent, 0 0 0 transparent, 0 0 0 transparent; }
}
@keyframes bolt {
  0% { transform: translateX(6px) skewX(-12deg); filter: drop-shadow(5px 0 1px color-mix(in oklch, var(--color-accent) 50%, transparent)); }
  100% { transform: none; filter: none; }
}
@keyframes bolt-strong {
  0% { transform: translateX(12px) skewX(-20deg) scale(1.2); filter: drop-shadow(6px 0 1px color-mix(in oklch, var(--color-accent) 70%, transparent)) drop-shadow(12px 0 3px color-mix(in oklch, var(--color-accent) 35%, transparent)); }
  60% { transform: translateX(-2px) scale(1.08); }
  100% { transform: none; filter: none; }
}
/* A phone opens the popover as a bottom sheet (lib/floating.ts): every target a finger high. */
@media (max-width: 720px) {
  .popover { padding: 12px 16px 16px; }
  .heading { min-height: var(--touch-target); }
  .speed { height: var(--touch-target); padding: 0 10px; }
  .popover { --track-pad: 18px; }
  .track { height: var(--touch-target); padding-block: 8px; }
  .line { height: 28px; }
  .dot { width: var(--touch-target); height: var(--touch-target); }
  .thumb { width: 28px; height: 28px; }
  .cost { font-size: var(--text-sm); }
  .ends { height: 20px; line-height: 20px; font-size: var(--text-sm); }
  .speed { gap: 8px; }
}
@media (prefers-reduced-motion: reduce) { .streaks { display: none; } .level.dash, .bolt.dash { animation: none; } }
</style>
