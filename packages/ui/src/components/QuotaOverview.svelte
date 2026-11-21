<script lang="ts">
  import PrivateText from './PrivateText.svelte';
  import { ChevronDown, RotateCcw } from '@lucide/svelte';
  import type { AccountQuota, QuotaWindow as Limit } from '@boite/contracts';
  import InfoTip from './InfoTip.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import QuotaExtras from './QuotaExtras.svelte';
  import QuotaWindow from './QuotaWindow.svelte';
  import { fill, strings } from '../lib/strings';
  import { creditBalance, exactTime, quotaResetTime, quotaWindowName, tenth } from '../lib/format';
  import { quotaAccountName, quotaCredits, quotaTone, remainingPercent } from '../lib/quota-reader.svelte';
  import { shownWindows } from '../lib/quota-display';
  import { QuotaReorder } from '../lib/quota-reorder.svelte';

  let { rows, current = null, loading = false, completed = [], connect, order = [], onreorder }: {
    rows: AccountQuota[]; current?: string | null; loading?: boolean; completed?: string[]; connect?: () => void;
    order?: string[]; onreorder?: (order: string[]) => Promise<boolean>;
  } = $props();

  let expanded = $state<string | null>(null);
  /** The priority, dragged by a summary (its name on a touch screen) or moved with the arrow keys: shared with the Limits page. */
  const reorder = new QuotaReorder({
    order: () => order, onreorder: () => onreorder, item: '[data-testid="quota-provider"]', grip: '.name',
    scroller: (root) => root.closest<HTMLElement>('.body')
  });
  let ordered = $derived(reorder.sort(rows));
  const left = (used: number) => fill(strings.quotas.remaining, { percent: tenth(remainingPercent(used)) });
  const miniName = (label: string) => label.includes(' · ') ? label.split(' · ').slice(1).join(' · ') :
    label === 'Weekly' ? strings.quotas.windowWeeklyCompact : label === 'Monthly' ? strings.quotas.windowMonthlyCompact : quotaWindowName(label);
  /** Below 5 points, the account's own rounding and Douane's lag explain the gap: no line. */
  const OUTSIDE_SHOWN = 5;
  const outside = (limit: Limit) => (limit.outsidePercent ?? 0) >= OUTSIDE_SHOWN;
  /** The collapsed row says the largest share once; the expanded one says it under each window. */
  const mostOutside = (windows: Limit[]) => windows.filter(outside).reduce<Limit | null>((most, limit) => most && most.outsidePercent! >= limit.outsidePercent! ? most : limit, null);
</script>

{#snippet outsideLine(limit: Limit)}
  {@const said = fill(strings.quotas.outsideUsed, { percent: tenth(limit.outsidePercent!) })}
  <p class="outside" data-testid="quota-outside" data-window={limit.id}><span class="ui-label">{said}</span><InfoTip topic={said} text={strings.quotas.outsideHint} /></p>
{/snippet}

<div class="overview" class:loading use:reorder.track data-testid="quota-overview">
  {#if rows.length === 0}
    <div class="empty" data-testid="quota-empty">
      <p>{strings.quotas.empty}</p>
      {#if connect}<button class="small" onclick={connect}><span class="ui-label">{strings.settings.connectProvider}</span></button>{/if}
    </div>
  {/if}
  <!-- The headline is the primary window, never the lowest one; credits still take over once any window runs dry. -->
  {#each ordered as row (row.accountId)}
    {@const name = quotaAccountName(row)}
    {@const shown = shownWindows(row)}
    {@const windows = shown.primary ? [shown.primary, ...shown.others] : []}
    {@const used = shown.primary?.usedPercent ?? null}
    {@const drained = row.windows.some((limit) => quotaTone(limit.usedPercent) === 'out')}
    {@const stale = row.status === 'unavailable'}
    {@const reset = shown.primary?.resetsAt ?? null}
    {@const credits = quotaCredits(row)}
    {@const paid = credits !== null && drained}
    {@const outsideMost = mostOutside(windows)}
    {@const percent = credits?.kind === 'budget' ? Math.max(0, Math.min(100, credits.remaining! / credits.limit! * 100)) : null}
    <article data-testid="quota-provider" data-provider={row.providerId} data-account-id={row.accountId} class:current={row.accountId === current} class:expanded={expanded === row.accountId} class:dragging={reorder.dragging === row.accountId}>
      <div class="account-heading">
        <button class="summary ghost" class:reorderable={!!onreorder && !reorder.saving} data-testid={onreorder ? 'quota-reorder' : undefined}
          aria-expanded={expanded === row.accountId} aria-controls={`usage-${row.accountId}`} aria-keyshortcuts={onreorder ? 'ArrowUp ArrowDown Home End' : undefined}
          title={onreorder ? fill(strings.quotas.reorder, { name }) : undefined} disabled={reorder.saving || (windows.length === 0 && !onreorder)}
          onpointerdown={(event) => reorder.start(event, row.accountId)} onkeydown={(event) => reorder.keyboard(event, row.accountId)}
          onclick={() => { if (windows.length) expanded = expanded === row.accountId ? null : row.accountId; }}>
          <span class="logo" title={row.providerName}><ProviderLogo providerId={row.providerId} size={20} /></span>
          <span class="summary-content">
            <span class="headline">
              <span class="name ui-label" title={name}><PrivateText text={name} /></span>
              {#if row.accountId === current}<span class="here" data-testid="quota-current">{strings.quotas.thisThread}</span>{/if}
              {#if !paid}<span class="amount ui-label" class:low={used !== null && quotaTone(used) !== 'ok'} title={shown.primary ? quotaWindowName(shown.primary.label) : undefined} data-testid="quota-headline">{used === null ? strings.quotas.noReading : left(used)}</span>{/if}
              {#if windows.length}<ChevronDown size={12} />{/if}
            </span>
            {#if paid && credits}
              <span class="paid" data-testid="quota-credits">
                <span class="paid-label ui-label">{credits.enabled === true ? strings.quotas.usingCredits : strings.quotas.creditRemaining}</span>
                <strong class="paid-amount ui-label">{credits.kind === 'balance' ? fill(strings.quotas.creditBalance, { count: creditBalance(credits.remaining!) }) : percent! < 0.1 ? `<${tenth(0.1)}%` : `${tenth(percent!)}%`}</strong>
                {#if percent !== null}<span class="track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-busy={loading && !completed.includes(row.accountId)} aria-label={strings.quotas.budgetRemaining}><span class="fill" style:width="{percent}%"></span></span>{/if}
              </span>
            {:else if windows.length && expanded !== row.accountId}
              <span class="meters" class:stale>
                {#each windows as limit, index (limit.id)}
                  <span class="mini-window" class:lead={index === 0 && windows.length > 1} title={`${quotaWindowName(limit.label)}: ${left(limit.usedPercent)}`}>
                    <span class="mini-label ui-label">{miniName(limit.label)}</span>
                    <span class="track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={remainingPercent(limit.usedPercent)} aria-busy={loading && !completed.includes(row.accountId)} data-tone={quotaTone(limit.usedPercent)} aria-label={`${name} ${quotaWindowName(limit.label)}: ${left(limit.usedPercent)}`}><span class="fill" style:width="{remainingPercent(limit.usedPercent)}%"></span></span>
                  </span>
                {/each}
              </span>
            {/if}
            {#if stale}<span class="caption">{strings.quotas.stale}</span>
            {:else if reset !== null && expanded !== row.accountId}
              <span class="caption reset" title={fill(strings.quotas.resets, { time: exactTime(reset) })}><RotateCcw size={12} aria-hidden="true" /><span class="ui-label">{quotaResetTime(reset)}</span></span>
            {/if}
          </span>
        </button>
      </div>
      {#if outsideMost && expanded !== row.accountId}{@render outsideLine(outsideMost)}{/if}
      {#if row.source === 'observation' && row.checkedAt !== null}<p class="caption">{fill(strings.quotas.observed, { time: exactTime(row.checkedAt) })}</p>{/if}
      {#if !paid}<div class="extras"><QuotaExtras {row} compact /></div>{/if}
      {#if row.error}<p class="error" role="status">{row.error}</p>{/if}
      {#if expanded === row.accountId}
        <div class="details" id={`usage-${row.accountId}`}>
          {#each windows as limit (limit.id)}
            <QuotaWindow {limit} owner={name} busy={loading && !completed.includes(row.accountId)} />
            {#if outside(limit)}{@render outsideLine(limit)}{/if}
          {/each}
        </div>
      {/if}
    </article>
  {/each}
</div>

<style>
  .overview { display: grid; grid-template-columns: minmax(0, 1fr); }
  article { min-width: 0; padding: 4px 0; }
  article + article { border-top: 1px solid var(--color-border); }
  /* The open thread's account: a filled row and a tag, so the glance answers "which of these am I spending". */
  article.current { margin-inline: -4px; padding-inline: 4px; border-radius: var(--radius-md); background: var(--color-active); }
  article.current + article, article + article.current { border-top-color: transparent; }
  .here { flex: none; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--color-background); color: var(--color-muted-foreground); font-size: var(--text-min); font-weight: 600; white-space: nowrap; }
  article.dragging { background: var(--color-active); outline: 1px solid var(--color-muted-foreground); }
  .account-heading { display: flex; align-items: stretch; gap: 2px; }
  .summary { flex: 1; min-width: 0; width: 100%; height: auto; min-height: 44px; padding: var(--space-1); line-height: 1.2; display: flex; align-items: start; gap: 8px; text-align: left; border-radius: var(--radius-md); white-space: normal; }
  .summary:disabled { opacity: 1; cursor: default; }
  .logo { flex: none; width: 20px; height: 20px; display: grid; place-items: center; }
  /* Every label here is trimmed to its capitals (`ui-label`), so the gaps are all the room between two lines of letters.
     The name, the window lines and the reset line keep one step: the 20 px headline adds about 5 px around the name. */
  .summary-content { flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
  .headline { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 20px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-base); font-weight: 600; color: var(--color-foreground); }
  .amount { flex: none; color: var(--color-foreground); font-size: var(--text-md); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .amount.low { color: var(--color-caution); }
  .headline > :global(svg) { flex: none; color: var(--color-subtle); transition: transform var(--dur-2); }
  .expanded .headline > :global(svg) { transform: rotate(180deg); }
  .summary.reorderable { cursor: grab; }
  .summary.reorderable .name { touch-action: none; }
  .dragging .summary { cursor: grabbing; }
  /* Two windows per line; a lone window uses the full row. */
  .meters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
  .mini-window { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-2); align-items: center; }
  .mini-window:only-child { grid-column: 1 / -1; }
  .mini-label { width: 4.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 400; }
  .meters.stale { opacity: 0.45; }
  /* The window the headline reads. */
  .mini-window.lead .mini-label { color: var(--color-foreground); font-weight: 500; }
  .track { display: block; width: 100%; min-width: 0; height: 7px; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-surface-3); filter: saturate(1); transition: filter var(--dur-3) var(--ease-out-quint); }
  .fill { display: block; height: 100%; background: var(--color-success); border-radius: var(--radius-sm); transition: width var(--dur-3) var(--ease-out-quint), background-color var(--dur-3) var(--ease-out-quint); }
  .track[data-tone='low'] .fill { background: var(--color-caution); }
  .track[data-tone='out'] { background: color-mix(in srgb, var(--color-danger) 35%, var(--color-surface-3)); }
  .caption { display: block; margin: 0; font-size: var(--text-xs); color: var(--color-muted-foreground); font-weight: 400; overflow-wrap: anywhere; }
  article > .caption { margin: 4px 4px 0 32px; }
  /* With the grid's gap, the same step under the bars as between two window lines. */
  .reset { display: flex; align-items: center; gap: 5px; margin-top: var(--space-1); }
  .reset :global(svg) { flex: none; }
  .paid { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px 8px; }
  .paid-label { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .paid-amount { color: var(--color-success); font-size: var(--text-lg); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .paid .track { grid-column: 1 / -1; }
  .extras { padding: 4px 4px 0 32px; }
  .extras:not(:has(> :global(*))) { display: none; }
  .error { margin: 4px 4px 0 32px; }
  .outside { display: flex; align-items: center; gap: 2px; margin: 2px 4px 0 32px; color: var(--color-danger); font-size: var(--text-xs); font-weight: 500; overflow-wrap: anywhere; }
  .outside > :global(.info-tip) { flex: none; }
  .details > .outside { margin: -6px 0 0; }
  .details { --quota-bar: 7px; margin: 6px 4px 0 32px; display: grid; gap: 10px; animation: rise var(--dur-2) var(--ease-out-quint); }
  .empty { display: grid; justify-items: start; gap: 10px; padding: 16px 4px; }
  .empty p { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  /* The reading on screen is the previous one until the new one lands: grey, breathing. */
  .track[aria-busy='true'] { filter: saturate(0.15); }
  .track[aria-busy='true'] .fill { animation: breathe 1.1s ease-in-out infinite alternate var(--loops); }
  @keyframes rise { from { opacity: 0; transform: translateY(-4px); } }
  @media (prefers-reduced-motion: reduce) { .details, .track[aria-busy='true'] .fill { animation: none; } .track, .fill { transition: none; } }
  :global(html[data-motion='reduced']) .track[aria-busy='true'] .fill { animation: none; }
</style>
