<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Gauge } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { quotaLimitName, quotaResetTime, quotaWindowName } from '../lib/format';
  import { quotaReader, shownQuotas } from '../lib/quota-reader.svelte';
  import { limitsNotice } from '../lib/limits-meter';
  import { work } from '../lib/work-prefs.svelte';
  import { controlMenu } from '../lib/controls';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import type LimitsGlance from './LimitsGlance.svelte';

  /**
   * The limits at the foot of every list column: one line that speaks only when
   * there is something to act on or to wait for (`limitsNotice`): a provider or
   * a model no account can serve any more, until when, or the little the best
   * account has left. One account spent while another serves says nothing: the
   * line then only names the glance it opens. A right click hides it, like the
   * other list controls (`sidebar.limits`).
   */
  let { store }: { store: Store } = $props();

  const shown = $derived(work.shows('sidebar.limits'));
  /** The reading every limits view shares: kept from the last run, read once when none is, kept current. */
  const quotas = $derived(quotaReader(store.endpointUrl ?? 'here', store.core));
  const meter = $derived(shown ? limitsNotice(shownQuotas(quotas.rows ?? [], store.accounts, store.providers)) : null);
  $effect(() => {
    const client = store.client;
    const current = quotas;
    if (!shown || !client || store.connection !== 'ready') return;
    const off = client.on('quotas.updated', value => current.accept(value));
    untrack(() => { if (current.rows === null && !current.loading) void current.read(client, false).catch(() => {}); });
    return off;
  });

  /** Out: whose limit and until when, every account where several were counted. Low: the best account's, named past one. */
  const text = $derived.by(() => {
    if (!meter) return strings.quotas.glance;
    const values = { percent: String(meter.left), window: quotaLimitName(meter.window), provider: meter.provider, account: meter.account, time: meter.until === null ? '' : quotaResetTime(meter.until) };
    if (meter.kind === 'low') return fill(meter.accounts > 1 ? strings.quotas.lineLeftAccount : strings.quotas.lineLeft, values);
    const every = meter.accounts > 1 && !meter.scoped;
    if (meter.until === null) return fill(every ? strings.quotas.lineOutAll : strings.quotas.lineOut, values);
    return fill(every ? strings.quotas.lineOutAllUntil : strings.quotas.lineOutUntil, values);
  });
  const tip = $derived(meter?.kind === 'low' ? fill(strings.app.rail.limitsLeft, { percent: String(meter.left), window: quotaWindowName(meter.window), account: meter.account }) : text);
  let button = $state<HTMLButtonElement>();
  let glance = $state<LimitsGlance>();

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
  <div class="quota-line">
    <button type="button" class="ghost line" class:low={meter?.kind === 'low'} class:out={meter?.kind === 'out'} class:quiet={!meter} bind:this={button} data-testid="nav-limits" title={tip} aria-label={tip} aria-haspopup="dialog"
      onclick={() => void openGlance()} oncontextmenu={(event) => controlMenu(event, store, 'sidebar.limits')}>
      <Gauge size={14} class={meter ? meter.kind : undefined} aria-hidden="true" />
      <span class="ui-label" data-testid={meter ? 'limits-gauge' : undefined} data-left={meter?.left} data-limit={meter?.kind}>{text}</span>
    </button>
    <Deferred part={parts.LimitsGlance} quiet>{#snippet children(Glance)}<Glance bind:this={glance} {store} anchor={() => button ?? null} />{/snippet}</Deferred>
  </div>
{/if}

<style>
  /* Under the list on the rail's own ground; RailFrame.svelte draws the hairline above it while rows lie below. */
  .quota-line { flex: none; margin: 0 6px; padding: 4px 0 8px; border-top: 1px solid transparent; transition: border-color var(--motion-duration) var(--motion-curve); }
  /* Nothing to say: the glance's name, a step quieter than the rows. Running low, amber; a provider no account can
     serve, the full ink with a red glyph. */
  .line { display: flex; align-items: center; gap: 8px; width: 100%; height: var(--control-sm); padding: 0 var(--pad-x, 8px); justify-content: flex-start;
    color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 500; font-variant-numeric: tabular-nums; }
  .line:hover:not(:disabled) { color: var(--color-foreground); }
  .line .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line :global(svg) { flex: none; }
  /* A notice is read whole: it takes a second line rather than lose the time or the account it ends on. */
  .line:is(.low, .out) { height: auto; min-height: var(--control-sm); padding-block: 5px; text-align: left; }
  .line:is(.low, .out) .ui-label { white-space: normal; line-height: 16px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  .line.quiet { color: var(--color-subtle); }
  .line.low { color: var(--color-caution); }
  .line.out { color: var(--color-foreground); }
  .line :global(svg.out) { color: var(--color-danger); }
</style>
