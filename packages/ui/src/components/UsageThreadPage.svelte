<script module lang="ts">
  import type { UsageThreadDetail } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';

  /** The last answer per machine, thread and range: going back to a thread shows it at once while it is read again. */
  const seen = new WeakMap<Store, Map<string, UsageThreadDetail>>();
</script>

<script lang="ts">
  import { ArrowLeft, MessageSquare } from '@lucide/svelte';
  import { errorText } from '../lib/errors';
  import { fill, strings } from '../lib/strings';
  import { clockTime, exactTime } from '../lib/format';
  import type { Machine } from '../lib/workspace.svelte';
  import {
    dayEdges,
    formatMetric,
    modelName,
    ownModel,
    priceNote,
    providerColor,
    reportedValue,
    threadView,
    totalTokens,
    type UsageMetric,
    type UsageRange
  } from '../lib/usage';
  import InfoTip from './InfoTip.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import UsageChart from './UsageChart.svelte';

  let {
    machine,
    threadId,
    range,
    metric,
    refresh,
    showMachine,
    providerName,
    modelNames,
    onback,
    onthread,
    onopen
  }: {
    machine: Machine;
    threadId: string;
    range: UsageRange;
    metric: UsageMetric;
    /** Bumped by the page's refresh button. */
    refresh: number;
    showMachine: boolean;
    providerName: (providerId: string) => string;
    modelNames: Map<string, string>;
    onback: () => void;
    onthread: (threadId: string) => void;
    /** Null when the conversation is not in the machine's list any more. */
    onopen: ((threadId: string) => void) | null;
  } = $props();

  const PAGE = 50;
  let detail = $state.raw<UsageThreadDetail | null>(null);
  let edges = $state.raw<number[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let shown = $state(PAGE);
  let latest = 0;

  async function load(days: UsageRange, id: string, from: Machine) {
    const request = ++latest;
    const nextEdges = dayEdges(days);
    const key = `${id}\u0000${days}`;
    const cached = seen.get(from.store)?.get(key);
    if (cached) { detail = cached; edges = nextEdges; }
    loading = true;
    error = null;
    try {
      const client = from.store.client;
      if (!client) throw new Error(strings.usage.offline);
      const result = await client.call('usage.thread', { threadId: id, edges: nextEdges });
      if (request !== latest) return;
      const kept = seen.get(from.store) ?? new Map<string, UsageThreadDetail>();
      kept.set(key, result);
      seen.set(from.store, kept);
      detail = result;
      edges = nextEdges;
    } catch (failure) {
      if (request !== latest) return;
      error = errorText(failure);
    } finally {
      if (request === latest) loading = false;
    }
  }

  $effect(() => {
    void refresh;
    const days = range;
    const id = threadId;
    const from = machine;
    shown = PAGE;
    detail = null;
    void load(days, id, from);
    return () => { latest += 1; };
  });

  let thread = $derived(detail?.thread ?? null);
  let view = $derived(detail === null || thread === null ? null : threadView(edges, detail.turns, metric, thread.providerId));
  let newest = $derived(detail === null ? [] : [...detail.turns].reverse());
  let totals = $derived.by(() => {
    if (detail === null || thread === null) return null;
    const reported = detail.turns.filter((turn) => turn.usage !== null).length;
    const priced = detail.turns.filter((turn) => turn.usage?.costUsdEquivalent != null).length;
    return { turns: thread.turns, reported, priced, usage: thread.usage };
  });
  let perTurn = $derived(totals === null || totals.turns === 0 ? 0 : (metric === 'cost' ? totals.usage.costUsdEquivalent ?? 0 : metric === 'tokens' ? totalTokens(totals.usage) : totals.turns) / totals.turns);
  let colors = $derived(new Map(view?.series.map((serie) => [serie.key, serie.color]) ?? []));
  let title = $derived(thread?.title || strings.usage.untitled);

  function name(model: string | null): string {
    return modelName(model, modelNames, thread?.providerId);
  }

  function money(value: { priced: number; usage: { costUsdEquivalent: number | null } }): string {
    return value.priced === 0 ? strings.usage.noPrice : formatMetric('cost', value.usage.costUsdEquivalent ?? 0);
  }
</script>

<!-- No wrapper: the cards sit in the settings page's own stack, which gives them their padding and titles. -->
<div class="top" data-testid="usage-thread-page">
    <button type="button" class="quiet back" data-testid="usage-thread-back" onclick={onback}>
      <ArrowLeft size={15} strokeWidth={1.75} /><span>{strings.usage.back}</span>
    </button>
    {#if onopen}
      <button type="button" class="outline open" data-testid="usage-thread-open" onclick={() => onopen(threadId)}>
        <MessageSquare size={14} strokeWidth={1.75} /><span>{strings.usage.openConversation}</span>
      </button>
    {/if}
  </div>

  {#if error}
    <p class="failure" role="alert">{fill(strings.usage.threadFailed, { error })}</p>
  {/if}

  {#if detail === null || thread === null || totals === null || view === null}
    {#if !error}<section class="card"><p class="muted">{strings.usage.loading}</p></section>{/if}
  {:else}
    <div class="body settings-stack" class:stale={loading} aria-busy={loading}>
      <section class="card head" data-testid="usage-thread-head">
        <div class="who">
          <span class="logo" style:--tint={providerColor(thread.providerId)}><ProviderLogo providerId={thread.providerId} size={20} /></span>
          <div class="names">
            <h2 data-testid="usage-thread-title">{title}</h2>
            <small>
              {providerName(thread.providerId)}{#if showMachine} · {machine.label}{/if}
              {#if thread.archived}<span class="tag">{strings.usage.archived}</span>{/if}
            </small>
          </div>
        </div>
        <dl class="stats">
          <div class="lead"><dt>{fill(strings.usage.totalOf[metric], { days: String(range) })}</dt><dd data-testid="usage-thread-total">{metric === 'cost' ? money(totals) : reportedValue(metric, metric === 'turns' ? totals.turns : totalTokens(totals.usage), totals)}</dd></div>
          {#if metric !== 'turns'}<div><dt>{strings.usage.turns}</dt><dd>{formatMetric('turns', totals.turns)}</dd></div>{/if}
          {#if metric !== 'tokens'}<div><dt>{strings.usage.tokens}</dt><dd>{reportedValue('tokens', totalTokens(totals.usage), totals)}</dd></div>{/if}
          {#if metric !== 'cost'}<div><dt>{strings.usage.metrics.cost}</dt><dd>{money(totals)}</dd></div>{/if}
          {#if metric !== 'turns' && totals.turns > 0}<div><dt>{strings.usage.threadStats.perTurn}</dt><dd>{formatMetric(metric, perTurn)}</dd></div>{/if}
        </dl>
      </section>

      {#if detail.turns.length === 0}
        <section class="card"><p class="muted" data-testid="usage-empty">{fill(strings.usage.threadEmpty, { days: String(range) })}</p></section>
      {:else}
        <section class="card">
          <h2>{strings.usage.threadChart}</h2>
          {#if (metric === 'cost' && totals.priced === 0) || (metric === 'tokens' && totals.reported === 0)}
            <p class="muted">{metric === 'cost' ? strings.usage.noPrice : strings.usage.noUsage}</p>
          {:else}
            <UsageChart
              buckets={view.buckets}
              series={view.series.map((serie) => ({ key: serie.key, color: serie.color, label: name(serie.key || null) }))}
              {metric}
              days={range}
              label={fill(strings.usage.threadChartLabel, { metric: strings.usage.metrics[metric] })}
            />
          {/if}
          <ul class="models" data-testid="usage-thread-models">
            {#each view.models as row (row.model ?? '')}
              {@const share = totals.turns > 0 && view.models.length > 1 ? row.turns / totals.turns : 1}
              <li>
                <span class="swatch" style:background={colors.get(row.model ?? '')}></span>
                <span class="model-line"><span>{name(row.model)}</span><InfoTip topic={fill(strings.usage.priceOf, { model: name(row.model) })} text={priceNote(row)} testid="usage-price" /></span>
                <span class="muted num">{fill(strings.usage.threadTurns, { turns: formatMetric('turns', row.turns) })}</span>
                <span class="num strong">{metric === 'cost' ? money(row) : reportedValue(metric, row.value, row)}</span>
                <span class="bar" aria-hidden="true"><span style:width="{share * 100}%" style:background={colors.get(row.model ?? '')}></span></span>
              </li>
            {/each}
          </ul>
        </section>

        {#if detail.children.length > 0}
          <section class="card">
            <h2>{strings.usage.subagents}</h2>
            <ul class="children" data-testid="usage-thread-children">
              {#each detail.children as child (child.threadId)}
                <li>
                  <button type="button" class="ghost row" onclick={() => onthread(child.threadId)}>
                    <ProviderLogo providerId={child.providerId} size={16} />
                    <span class="title"><span class="name">{child.title || strings.usage.untitled}</span><small>{fill(strings.usage.threadTurns, { turns: formatMetric('turns', child.turns) })}</small></span>
                    <span class="num strong">{formatMetric(metric, metric === 'cost' ? child.usage.costUsdEquivalent ?? 0 : metric === 'tokens' ? totalTokens(child.usage) : child.turns)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <section class="card turns-card">
          <h2>{strings.usage.threadTurnsList}</h2>
          <div class="table">
            <table data-testid="usage-thread-turns">
              <thead>
                <tr>
                  <th>{strings.usage.day}</th>
                  <th>{strings.usage.model}</th>
                  <th class="num">{strings.usage.tokens}</th>
                  <th class="num wide">{strings.usage.output}</th>
                  <th class="num">{strings.usage.metrics.cost}</th>
                </tr>
              </thead>
              <tbody>
                {#each newest.slice(0, shown) as turn (turn.turnId)}
                  {@const model = ownModel(thread.providerId, turn.model)}
                  <tr>
                    <td title={exactTime(turn.finishedAt)}>{clockTime(turn.finishedAt)}</td>
                    <td><span class="model-cell"><span class="swatch" style:background={colors.get(model ?? '')}></span>{name(model)}</span></td>
                    <td class="num" class:muted={turn.usage === null}>{turn.usage === null ? strings.usage.noUsageTurn : formatMetric('tokens', totalTokens(turn.usage))}</td>
                    <td class="num wide">{turn.usage === null ? '' : formatMetric('tokens', turn.usage.outputTokens)}</td>
                    <td class="num" class:muted={turn.usage?.costUsdEquivalent == null}>{turn.usage?.costUsdEquivalent == null ? strings.usage.noPrice : formatMetric('cost', turn.usage.costUsdEquivalent)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if newest.length > shown}
            <button type="button" class="outline more" data-testid="usage-thread-more" onclick={() => { shown += PAGE; }}>
              {fill(strings.usage.showMore, { count: formatMetric('turns', Math.min(PAGE, newest.length - shown)) })}
            </button>
          {/if}
          {#if detail.truncated}<p class="muted note">{fill(strings.usage.truncated, { count: formatMetric('turns', detail.turns.length) })}</p>{/if}
        </section>
      {/if}
    </div>
  {/if}

<style>
  .top, .failure, .body { max-width: var(--settings-width); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
  .back, .open { display: inline-flex; align-items: center; gap: 6px; }
  .back { padding-left: 4px; color: var(--color-muted-foreground); }
  .back:hover { color: var(--color-foreground); }
  .failure { margin: 0 0 12px; color: var(--color-danger); font-size: var(--text-sm); }
  .body { transition: opacity var(--dur-2) var(--ease-out-quint); }
  .body.stale { opacity: 0.6; }
  .muted { color: var(--color-muted-foreground); font-size: var(--text-sm); }

  .who { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .logo { display: grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: var(--radius-md); background: color-mix(in oklch, var(--tint) 22%, var(--color-surface-2)); }
  .names { display: grid; min-width: 0; gap: 2px; }
  .names h2 { margin: 0; font-size: var(--text-lg); line-height: 1.25; overflow-wrap: anywhere; }
  .names small { color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .tag { margin-left: 6px; padding: 0 5px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: var(--text-xs); }

  .stats { display: flex; flex-wrap: wrap; gap: 14px 28px; margin: 18px 0 0; padding-top: 16px; border-top: 1px solid var(--color-border); }
  .stats div { display: grid; gap: 2px; }
  .stats dt { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .stats dd { margin: 0; font-size: var(--text-md, var(--text-base)); font-weight: 600; font-variant-numeric: tabular-nums; }
  .stats .lead { flex-basis: 100%; }
  .stats .lead dd { font-size: calc(var(--text-lg) * 1.6); line-height: 1.1; letter-spacing: -0.01em; }

  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 600; }
  .models { display: grid; gap: 8px; margin: 14px 0 0; padding: 14px 0 0; list-style: none; border-top: 1px solid var(--color-border); font-size: var(--text-sm); }
  .models li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto minmax(60px, 140px); align-items: center; gap: 10px; }
  .model-line { min-width: 0; overflow-wrap: anywhere; }
  .bar { display: block; height: 4px; border-radius: 2px; background: var(--color-surface-3); overflow: hidden; }
  .bar span { display: block; height: 100%; border-radius: 2px; }

  .children { display: grid; gap: 2px; margin: 0 -8px; padding: 0; list-style: none; }
  .row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; height: auto; min-height: var(--row); padding: 6px 8px; border-radius: var(--radius-md); color: var(--color-foreground); text-align: left; font-weight: 400; }
  .title { display: grid; min-width: 0; }
  .title .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title small { color: var(--color-muted-foreground); font-size: var(--text-xs); }

  .turns-card { container-type: inline-size; }
  .table { overflow-x: auto; max-height: 520px; overflow-y: auto; margin: 0 calc(-1 * var(--settings-padding)); }
  table { font-size: var(--text-sm); }
  th { position: sticky; top: 0; z-index: 1; background: var(--color-surface); }
  th:first-child, td:first-child { padding-left: var(--settings-padding); white-space: nowrap; }
  th:last-child, td:last-child { padding-right: var(--settings-padding); }
  .model-cell { font-variant-numeric: normal; display: inline-flex; align-items: center; gap: 8px; white-space: normal; overflow-wrap: break-word; }
  tbody tr:hover td { background: var(--color-hover); }
  .more { margin-top: 12px; }
  .note { margin: 10px 0 0; }
  /* A phone: the date wraps over its time, so the model and the price keep their room. */
  @container (max-width: 480px) { .wide { display: none; } td:first-child { white-space: normal; } }

  @media (max-width: 720px) {
    .models li { grid-template-columns: 10px minmax(0, 1fr) auto; }
    .models li > .muted { display: none; }
    .models .bar { grid-column: 2 / -1; }
    .stats .lead dd { font-size: calc(var(--text-lg) * 1.4); }
  }
</style>
