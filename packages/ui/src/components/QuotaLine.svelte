<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Gauge } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { quotaLimitName, quotaWindowName } from '../lib/format';
  import { quotaReader, shownQuotas } from '../lib/quota-reader.svelte';
  import { lowestLimit } from '../lib/limits-meter';
  import { work } from '../lib/work-prefs.svelte';
  import { controlMenu } from '../lib/controls';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import type LimitsGlance from './LimitsGlance.svelte';

  /**
   * The limits at the foot of every list column: one line in words, what the
   * least-off account has left in its tightest window and whose it is, which opens the
   * glance. Before anything is read it names the glance. A right click hides
   * it, like the other list controls (`sidebar.limits`).
   */
  let { store }: { store: Store } = $props();

  const shown = $derived(work.shows('sidebar.limits'));
  /** The reading every limits view shares: kept from the last run, read once when none is, kept current. */
  const quotas = $derived(quotaReader(store.endpointUrl ?? 'here', store.core));
  const meter = $derived(shown ? lowestLimit(shownQuotas(quotas.rows ?? [], store.accounts, store.providers)) : null);
  $effect(() => {
    const client = store.client;
    const current = quotas;
    if (!shown || !client || store.connection !== 'ready') return;
    const off = client.on('quotas.updated', value => current.accept(value));
    untrack(() => { if (current.rows === null && !current.loading) void current.read(client, false).catch(() => {}); });
    return off;
  });

  /** Whose limit the line reads: the provider's, and the account's where that provider shows several. */
  const text = $derived(meter ? fill(meter.several ? strings.quotas.lineLeftAccount : strings.quotas.lineLeft, { percent: String(meter.left), window: quotaLimitName(meter.window), provider: meter.provider, account: meter.account }) : strings.quotas.glance);
  const tip = $derived(meter ? fill(strings.app.rail.limitsLeft, { percent: String(meter.left), window: quotaWindowName(meter.window), account: meter.account }) : strings.quotas.glance);
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
    <button type="button" class="ghost line" class:low={meter?.tone === 'low'} bind:this={button} data-testid="nav-limits" title={tip} aria-label={tip} aria-haspopup="dialog"
      onclick={() => void openGlance()} oncontextmenu={(event) => controlMenu(event, store, 'sidebar.limits')}>
      <Gauge size={14} class={meter ? meter.tone : undefined} aria-hidden="true" />
      <span class="ui-label" data-testid={meter ? 'limits-gauge' : undefined} data-left={meter?.left}>{text}</span>
    </button>
    <Deferred part={parts.LimitsGlance} quiet>{#snippet children(Glance)}<Glance bind:this={glance} {store} anchor={() => button ?? null} />{/snippet}</Deferred>
  </div>
{/if}

<style>
  .quota-line { flex: none; padding: 4px 6px 8px; }
  /* A quiet line, the rows' grey. Running low, the line takes the full ink (amber is only for what needs the user);
     run out, its glyph turns red. */
  .line { display: flex; align-items: center; gap: 8px; width: 100%; height: var(--control-sm); padding: 0 var(--pad-x, 8px); justify-content: flex-start;
    color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 500; font-variant-numeric: tabular-nums; }
  .line:hover:not(:disabled) { color: var(--color-foreground); }
  .line .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line :global(svg) { flex: none; }
  .line.low { color: var(--color-caution); }
  .line :global(svg.out) { color: var(--color-danger); }
</style>
