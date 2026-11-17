<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { Gauge } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { quotaLimitName } from '../lib/format';
  import { quotaReader, shownQuotas } from '../lib/quota-reader.svelte';
  import { countdown, limitsNotice, windowSpan } from '../lib/limits-meter';
  import { outsideNotice } from '../lib/outside-usage';
  import { tenth } from '../lib/format';
  import { work } from '../lib/work-prefs.svelte';
  import { controlMenu } from '../lib/controls';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import type LimitsGlance from './LimitsGlance.svelte';

  /**
   * The limits in the rail's foot, above Settings: one glyph that says nothing
   * until there is something to act on or to wait for (`limitsNotice`). Quiet,
   * the gauge. Running low, a ring of what the best account has left and an
   * amber dot. Out, a red ring that fills as the first account's return comes
   * near, a red dot and the time left under it. The sentence is the rail's
   * name card; a click opens the glance; a right click hides it, like the
   * other list controls (`sidebar.limits`).
   */
  let { store, name }: { store: Store; name?: Snippet<[string, string[]]> } = $props();

  const shown = $derived(work.shows('sidebar.limits'));
  /** The reading every limits view shares: kept from the last run, read once when none is, kept current. */
  const quotas = $derived(quotaReader(store.endpointUrl ?? 'here', store.core));
  const rows = $derived(shown ? shownQuotas(quotas.rows ?? [], store.accounts, store.providers) : []);
  /** The clock the notice reads: a reset that passes drops its stale reading, and the countdown moves. */
  let now = $state(Date.now());
  const meter = $derived(shown ? limitsNotice(rows, now) : null);
  /** An account Douane cannot explain the use of: a red dot on the glyph, whatever the limits say. */
  const leak = $derived(shown ? outsideNotice(rows, now) : null);
  const leakText = $derived(leak ? fill(strings.quotas.outsideNotice, { percent: tenth(leak.percent), account: leak.account, provider: leak.provider }) : null);
  $effect(() => {
    const client = store.client;
    const current = quotas;
    if (!shown || !client || store.connection !== 'ready') return;
    const off = client.on('quotas.updated', value => current.accept(value));
    untrack(() => { if (current.rows === null && !current.loading) void current.read(client, false).catch(() => {}); });
    return off;
  });
  // Out: a tick each 30 s for the countdown. Otherwise one wake at the next reset, the moment the notice or the
  // leak dot can change; that wake moves `now`, which schedules the one after.
  $effect(() => {
    if (meter?.kind === 'out') {
      const timer = setInterval(() => { now = Date.now(); }, 30_000);
      return () => clearInterval(timer);
    }
    const resets = rows.flatMap(row => row.windows.map(window => window.resetsAt)).filter((at): at is number => at !== null && at > now);
    if (resets.length === 0) return;
    const timer = setTimeout(() => { now = Date.now(); }, Math.min(Math.min(...resets) - Date.now() + 1000, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  });

  /** Out: whose limit, every account where several were counted. Low: the best account's, named past one. */
  const text = $derived.by(() => {
    if (!meter) return strings.quotas.glance;
    const values = { percent: String(meter.left), window: quotaLimitName(meter.window), provider: meter.provider, account: meter.account };
    if (meter.kind === 'low') return fill(meter.accounts > 1 ? strings.quotas.lineLeftAccount : strings.quotas.lineLeft, values);
    return fill(meter.accounts > 1 && !meter.scoped ? strings.quotas.lineOutAll : strings.quotas.lineOut, values);
  });
  const left = $derived(meter?.kind === 'out' && meter.until !== null ? countdown(meter.until - now) : null);
  /** Under the sentence: the account when the sentence did not name it, the wait when one is known. */
  const note = $derived(meter?.kind === 'low' ? (meter.accounts > 1 ? null : meter.account)
    : left ? fill(strings.app.rail.limitsBack, { time: left }) : null);
  /**
   * The ring's share, 0 to 1. Low: what is left. Out: how far the wait has gone, from the window's length when its
   * label gives one, full when it does not.
   */
  const share = $derived.by(() => {
    if (!meter) return 0;
    if (meter.kind === 'low') return Math.max(0.04, meter.left / 100);
    const span = meter.untilWindow === null ? null : windowSpan(meter.untilWindow);
    if (meter.until === null || span === null) return 1;
    return Math.min(1, Math.max(0.04, 1 - (meter.until - now) / span));
  });
  const RADIUS = 8;
  const CIRCLE = 2 * Math.PI * RADIUS;
  let button = $state<HTMLButtonElement>();
  let glance = $state<LimitsGlance>();
  /** The name card: the limits' sentence, then a line each for its note and the leak; the leak alone while the limits say nothing. */
  const title = $derived(!meter && leakText ? leakText : text);
  const lines = $derived([note, meter ? leakText : null].filter((line): line is string => !!line));
  const label = $derived([title, ...lines].join(' · '));

  /** The glance is a click-only body in its own chunk: a press before it lands waits for it. */
  async function openGlance() {
    if (!glance) {
      await parts.LimitsGlance.load().catch(() => undefined);
      await tick();
    }
    void glance?.open();
  }
</script>

{#if shown}
  <button type="button" class="ghost icon limits" class:low={meter?.kind === 'low'} class:out={meter?.kind === 'out'} class:leak={leak !== null} bind:this={button} data-testid="nav-limits"
    title={name ? undefined : label} aria-label={label} aria-haspopup="dialog"
    onclick={() => void openGlance()} oncontextmenu={(event) => controlMenu(event, store, 'sidebar.limits')}>
    <span class="glyph">
      {#if meter}
        <svg class="ring" viewBox="0 0 24 24" aria-hidden="true" data-testid="limits-gauge" data-left={meter.left} data-limit={meter.kind} data-share={share.toFixed(2)}>
          <circle class="track" cx="12" cy="12" r={RADIUS} />
          <circle class="arc" cx="12" cy="12" r={RADIUS} stroke-dasharray={`${CIRCLE * share} ${CIRCLE}`} />
        </svg>
        <span class="dot" aria-hidden="true"></span>
      {:else}
        <Gauge size={19} strokeWidth={1.75} aria-hidden="true" />
        {#if leak}<span class="dot" aria-hidden="true" data-testid="limits-leak"></span>{/if}
      {/if}
    </span>
    {#if left}<span class="countdown" aria-hidden="true" data-testid="limits-countdown">{left}</span>{/if}
  </button>
  {@render name?.(title, lines)}
  <Deferred part={parts.LimitsGlance} quiet>{#snippet children(Glance)}<Glance bind:this={glance} {store} side="right" anchor={() => button ?? null} />{/snippet}</Deferred>
{/if}

<style>
  /* The glyph, and out the time left under it, both inside the button's square: nothing hangs past its edge. */
  .limits { position: relative; flex: none; flex-direction: column; gap: 2px; }
  .glyph { position: relative; display: grid; place-items: center; }
  .ring { width: 21px; height: 21px; transform: rotate(-90deg); overflow: visible; }
  .ring circle { fill: none; stroke-width: 2.5; }
  .ring .track { stroke: color-mix(in srgb, currentColor 22%, transparent); }
  .ring .arc { stroke-linecap: round; transition: stroke-dasharray var(--dur-3) var(--ease-out-quint); }
  .limits.low { color: var(--color-caution); }
  .limits.out { color: var(--color-danger); }
  .limits.low .arc { stroke: var(--color-caution); }
  .limits.out .arc { stroke: var(--color-danger); }
  /* On the glyph's shoulder, not the button's corner: the button's hover fill and focus ring stay clear of it. */
  .dot { position: absolute; width: 7px; height: 7px; right: -3px; top: -2px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 2px var(--color-frame); }
  .limits.low .dot { background: var(--color-caution); }
  .limits.out .dot, .limits.leak .dot { background: var(--color-danger); }
  /* The time left, under the ring: the one figure worth reading without a hover. */
  .countdown { color: var(--color-danger); font-family: var(--font-mono); font-size: var(--text-min); font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .ring .arc { transition: none; } }
</style>
