<script module lang="ts">
  import type { UsageHistory, UsageHistoryProject, UsageHistoryThread } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';

  type Answer = Omit<UsageHistory, 'threads' | 'projects'> & { threads: UsageHistoryThread[]; projects?: UsageHistoryProject[] };
  /**
   * The last answer per machine and filters, kept while the app runs: coming
   * back to the page, or to a range already read, draws at once and dims
   * until the fresh read lands. Keyed by the Store, never by a machine's
   * label or address, which two machines can share.
   */
  const answers = new WeakMap<Store, Map<string, Answer>>();
  const ANSWERS_PER_MACHINE = 24;

  function remember(store: Store, key: string, answer: Answer): void {
    const kept = answers.get(store) ?? new Map<string, Answer>();
    kept.delete(key);
    kept.set(key, answer);
    if (kept.size > ANSWERS_PER_MACHINE) kept.delete(kept.keys().next().value!);
    answers.set(store, kept);
  }

  function recalled(store: Store, key: string, firstEdge: number | undefined): Answer | undefined {
    const kept = answers.get(store)?.get(key);
    return kept?.edges[0] === firstEdge ? kept : undefined;
  }
</script>

<script lang="ts">
  import SettingsSection from './SettingsSection.svelte';
  import { errorText } from '../lib/errors';
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { ChevronDown, ChevronRight, RefreshCw, X } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import { formatLocale } from '../lib/i18n.svelte';
  import { relativeTime } from '../lib/format';
  import { titleSlot } from '../lib/title-slot.svelte';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import {
    dayEdges,
    formatMetric,
    mergeHistories,
    modelName,
    priceNote,
    providerColor,
    rankProjects,
    reportedValue,
    seriesFor,
    summarize,
    topThreads,
    totalTokens,
    USAGE_METRICS,
    USAGE_RANGES,
    type UsageMetric,
    type UsageRange,
    type UsageTotals
  } from '../lib/usage';
  import InfoTip from './InfoTip.svelte';
  import SettingsPageHeader from './SettingsPageHeader.svelte';
  import Menu from './Menu.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import UsageChart from './UsageChart.svelte';
  import UsageThreadPage from './UsageThreadPage.svelte';

  let { store, showTitle = true }: { store: Store; showTitle?: boolean } = $props();

  type MachineThread = UsageHistoryThread & { machine: Machine };
  type MachineProject = UsageHistoryProject & { machine: Machine };
  type MachineHistory = Omit<UsageHistory, 'threads' | 'projects'> & { threads: MachineThread[]; projects: MachineProject[] };
  type ProjectChoice = Pick<MachineProject, 'machine' | 'projectId' | 'name' | 'removed'>;
  const ALL = '\u0000all';
  const PROJECTS_SHOWN = 6;

  let range = $state<UsageRange>(30);
  let metric = $state<UsageMetric>('tokens');
  let breakdown = $state<'model' | 'day'>('model');
  let provider = $state<string | null>(null);
  /** `ALL` reads every connected machine, the default; null follows the machine the window is on. */
  let scope = $state<string | null>(ALL);
  /** One project of one machine: its machine alone is read, with the project's filter. */
  let project = $state.raw<ProjectChoice | null>(null);
  /** A thread's own page, opened from the ranking. */
  let detail = $state.raw<{ machine: Machine; threadId: string } | null>(null);
  let refreshes = $state(0);
  let projectsOpen = $state(false);
  let historicalProviders = $state<string[]>([]);
  /** Each machine's answer for the filters on screen; merged into one history. */
  let parts = $state.raw(new Map<Machine, MachineHistory>());
  let failed = $state.raw(new Map<Machine, string>());
  let reading = $state.raw(new Set<Machine>());
  let edges = $state.raw<number[]>([]);
  /** Only the newest request writes, so a slow 90-day answer never lands over a 7-day one. */
  let latest = 0;

  /** The page's own machine, for a store the workspace does not list. */
  let own = $derived<Machine>({ id: store.endpointUrl ?? 'local', label: store.core?.hostname ?? strings.machines.local, store });
  /** The workspace's machine objects are kept, so a derived machine only changes when the choice does. */
  let machines = $derived(workspace.machines.some((machine) => machine.store === store) ? workspace.machines : [own, ...workspace.machines]);
  let current = $derived(machines.find((machine) => machine.store === store) ?? own);
  let chosen = $derived(scope === null || scope === ALL ? current : machines.find((machine) => machine.id === scope) ?? current);
  let all = $derived(scope === ALL && machines.length > 1);
  /** Every machine of the workspace that answers; one still connecting joins once it is ready. */
  let ready = $derived(machines.filter((machine) => machine.store.client !== null && machine.store.connection === 'ready'));
  let scoped = $derived(all ? ready : [chosen]);
  let sources = $derived(project !== null ? [project.machine] : scoped);
  let offline = $derived(project !== null ? (project.machine.store.client ? [] : [project.machine]) : all ? machines.filter((machine) => !ready.includes(machine)) : chosen.store.client ? [] : [chosen]);
  /** Nothing to ask: the page says which machine is missing instead of reading forever. */
  let unreadable = $derived(sources.length === 0 || sources.some((source) => !source.store.client));
  let loading = $derived(reading.size > 0);
  let history = $derived<MachineHistory | null>(parts.size === 0 ? null : mergeHistories(edges, [...parts.values()]));
  let failures = $derived([...failed.values()]);

  function filterKey(days: UsageRange, providerId: string | null, projectId: string | null | undefined): string {
    return `${days}\u0000${providerId ?? ''}\u0000${projectId === undefined ? '*' : projectId ?? ''}`;
  }

  async function read(source: Machine, at: number[], providerId: string | null, projectId: string | null | undefined): Promise<MachineHistory> {
    const client = source.store.client;
    if (!client) throw new Error(strings.usage.offline);
    const result = await client.call('usage.history', { edges: at, ...(providerId === null ? {} : { providerId }), ...(projectId === undefined ? {} : { projectId }) });
    if (providerId !== null && (
      result.rows.some((row) => row.providerId !== providerId) ||
      result.threads.some((thread) => thread.providerId !== providerId)
    )) {
      throw new Error(strings.usage.filterUnsupported);
    }
    if (projectId !== undefined && (result.projects === undefined || result.threads.some((thread) => thread.projectId !== projectId))) {
      throw new Error(strings.usage.filterUnsupported);
    }
    return tag(source, result);
  }

  function tagProjects(source: Machine, projects: UsageHistoryProject[] = []): MachineProject[] {
    return projects.map((entry) => ({ ...entry, machine: source }));
  }

  function tag(source: Machine, result: Answer): MachineHistory {
    return {
      ...result,
      threads: result.threads.map((thread) => ({ ...thread, machine: source })),
      projects: tagProjects(source, result.projects)
    };
  }

  function keepProviders(results: Iterable<Answer>) {
    const ids = new Set(historicalProviders);
    for (const result of results) for (const row of result.rows) ids.add(row.providerId);
    historicalProviders = [...ids];
  }

  /** No result at all rather than totals from machines this read did not count. */
  function clear() {
    latest += 1;
    parts = new Map();
    failed = new Map();
    reading = new Set();
  }

  /**
   * Reads every source at once and draws each answer as it lands, a remembered
   * one standing in meanwhile. `only` reads one machine again (a turn finished
   * there) and keeps the others' answers.
   */
  function load(from: Machine[] = sources, only?: Machine) {
    if (from.length === 0 || from.some((source) => !source.store.client)) {
      clear();
      return;
    }
    const days = range;
    const providerId = provider;
    const scopeProject = project;
    const at = dayEdges(days);
    // Past midnight the days moved: every machine is read again on the new edges.
    if (only !== undefined && at[0] !== edges[0]) only = undefined;
    const request = only === undefined ? ++latest : latest;
    const targets = only === undefined ? from : [only];
    const key = filterKey(days, providerId, scopeProject?.projectId);
    if (only === undefined) {
      edges = at;
      const shown = new Map<Machine, MachineHistory>();
      for (const source of from) {
        const kept = recalled(source.store, key, at[0]);
        if (kept) shown.set(source, tag(source, kept));
      }
      parts = shown;
      failed = new Map();
      keepProviders(shown.values());
    }
    reading = new Set([...(only === undefined ? [] : reading), ...targets]);
    // All machines names each failure, even when only one of them could be asked.
    const named = all && project === null;
    for (const source of targets) {
      read(source, at, providerId, scopeProject?.projectId).then((result) => {
        if (request !== latest) return;
        remember(source.store, key, result);
        parts = new Map(parts).set(source, result);
        if (failed.has(source)) failed = new Map([...failed].filter(([machine]) => machine !== source));
        keepProviders([result]);
      }, (error: unknown) => {
        if (request !== latest) return;
        answers.get(source.store)?.delete(key);
        const next = new Map(parts);
        next.delete(source);
        parts = next;
        const message = errorText(error);
        failed = new Map(failed).set(source, named ? `${source.label}: ${message}` : message);
      }).finally(() => {
        if (request !== latest) return;
        const next = new Set(reading);
        next.delete(source);
        reading = next;
      });
    }
  }

  // Another machine's providers are not this one's. The whole workspace stays the whole workspace.
  $effect(() => {
    void store;
    untrack(() => {
      if (scope === ALL) return;
      provider = null; scope = null; project = null; detail = null; historicalProviders = [];
      clear();
    });
  });

  $effect(() => {
    void range;
    void provider;
    void project;
    void refreshes;
    // One machine reloads on its own client; the whole workspace when a machine joins or leaves it.
    const from = sources;
    for (const source of from) void source.store.client;
    untrack(() => load(from));
    return () => { latest += 1; };
  });

  $effect(() => {
    const watched = sources.flatMap((source) => source.store.client ? [{ source, client: source.store.client }] : []);
    if (watched.length === 0) return;
    const timers = new Map<Machine, ReturnType<typeof setTimeout>>();
    // A finished turn changes today's column on its machine; a burst of them reloads that machine once.
    const offs = watched.map(({ source, client }) => client.on('turn.finished', () => {
      clearTimeout(timers.get(source));
      timers.set(source, setTimeout(() => load(sources, source), 1500));
    }));
    return () => { timers.forEach((timer) => clearTimeout(timer)); offs.forEach((off) => off()); };
  });

  function refresh() {
    refreshes += 1;
  }

  /** Wider than a phone, the band carries the page's title, so the refresh stands in the band's actions. */
  const narrow = new MediaQuery('(max-width: 720px)');
  const inBand = $derived(!narrow.current);
  $effect(() => {
    if (!inBand) return;
    titleSlot.actions = refreshButton;
    return () => { if (titleSlot.actions === refreshButton) titleSlot.actions = null; };
  });

  function pickMachine(id: string) {
    const next = id === ALL ? ALL : id === current.id ? null : id;
    if (next === scope && project === null) return;
    scope = next;
    provider = null;
    project = null;
    historicalProviders = [];
  }

  const projectKey = (machine: Machine, projectId: string | null) => `${machine.id}\u0000${projectId ?? ''}`;

  function pickProject(id: string) {
    if (id === '') { project = null; return; }
    const entry = projectList.find((item) => projectKey(item.machine, item.projectId) === id);
    if (entry) chooseProject(entry);
  }

  function chooseProject({ machine, projectId, name, removed }: ProjectChoice) {
    project = { machine, projectId, name, removed };
  }

  function openDetail(thread: { machine: Machine; threadId: string }) {
    detail = { machine: thread.machine, threadId: thread.threadId };
    document.querySelector('[data-testid=usage-page]')?.scrollIntoView?.({ block: 'start' });
  }

  let providers = $derived(sources.flatMap((source) => source.store.providers));
  let providerIds = $derived([...new Set([...providers.map((entry) => entry.id), ...historicalProviders, ...(provider === null ? [] : [provider])])]);
  let view = $derived(history === null ? null : summarize(history, metric, provider === null ? providerIds : [provider]));
  /** Only the providers that ran a turn in the range: a row of zeros says nothing. */
  let active = $derived(view?.series.filter((serie) => view!.bySeries[serie.key]!.turns > 0) ?? []);
  let names = $derived(new Map(providers.map((provider) => [provider.id, provider.name])));
  let modelNames = $derived(new Map(providers.flatMap((entry) => entry.models.map((model) => [`${entry.id}\u0000${model.id}`, model.name] as const))));
  let providerItems = $derived([
    { id: '', label: strings.usage.allProviders, active: provider === null },
    ...seriesFor(providerIds).series.filter((serie) => serie.key.trim()).map((serie) => ({ id: serie.key, label: providerName(serie.key), active: provider === serie.key }))
  ]);
  let machineItems = $derived([
    { id: ALL, label: strings.usage.allMachines, active: all },
    ...machines.map((machine) => ({ id: machine.id, label: machine.label, active: !all && machine === chosen }))
  ]);
  let projectList = $derived.by(() => {
    const key = filterKey(range, provider, undefined);
    const projects = scoped.flatMap((machine) => {
      const shown = parts.get(machine);
      if (shown) return shown.projects;
      // Selecting a project only queries its machine. Keep the other choices for the same range and provider.
      return project === null ? [] : tagProjects(machine, recalled(machine.store, key, edges[0])?.projects);
    });
    return rankProjects(projects, metric);
  });
  let rankedProjects = $derived(projectList.filter((entry) => entry.value > 0));
  let listedProject = $derived(project === null ? undefined : projectList.find((entry) => entry.machine === project!.machine && entry.projectId === project!.projectId));
  let chosenProject = $derived(listedProject ?? project);
  let menuProjects = $derived(project !== null && listedProject === undefined ? [...projectList, project] : projectList);
  let projectItems = $derived([
    { id: '', label: strings.usage.allProjects, active: project === null },
    ...menuProjects.map((entry) => ({
      id: projectKey(entry.machine, entry.projectId),
      label: `${projectName(entry)}${entry.removed ? ` (${strings.usage.removed})` : ''}${all ? ` · ${entry.machine.label}` : ''}`,
      active: project !== null && project.machine === entry.machine && project.projectId === entry.projectId
    }))
  ]);
  let threads = $derived(history === null ? [] : topThreads(history.threads, metric));
  let threadPeak = $derived(threads[0]?.value ?? 0);
  let projectPeak = $derived(rankedProjects[0]?.value ?? 0);
  let dayRows = $derived(view?.days.filter((day) => day.turns > 0) ?? []);
  let pricing = $derived(history?.pricing ?? null);

  function projectName(entry: ProjectChoice): string {
    if (entry.projectId === null) return strings.usage.noProject;
    return entry.name ?? entry.machine.store.projects.find((item) => item.id === entry.projectId)?.name ?? strings.usage.removedProject;
  }

  function known(machine: Machine, threadId: string): boolean {
    return machine.store.threads.some((entry) => entry.id === threadId);
  }

  function openThread(machine: Machine, threadId: string) {
    // A thread of another machine opens through the workspace, which makes that machine the active one.
    if (machine.store === store) void store.open(threadId);
    else void workspace.select(machine.store, threadId);
  }

  function providerName(providerId: string): string {
    if (!providerId.trim()) return strings.usage.unknownProvider;
    return names.get(providerId) ?? providerId;
  }

  function money(totals: UsageTotals): string {
    return totals.priced === 0 ? strings.usage.noPrice : formatMetric('cost', totals.usage.costUsdEquivalent ?? 0);
  }

  /**
   * The turns the current measure misses: none reported tokens, or none had a price. Zero when every turn
   * counts, and when none does, since the value then says "Not reported" or "No price" itself.
   */
  function gap(totals: UsageTotals): number {
    const counted = metric === 'tokens' ? totals.reported : metric === 'cost' ? totals.priced : totals.turns;
    return counted > 0 ? totals.turns - counted : 0;
  }

  /** The singular or plural form of a line for this count; `{count}` is the count, formatted. */
  function counts(forms: { one: string; many: string }, count: number, values: Record<string, string>): string {
    return fill(count === 1 ? forms.one : forms.many, { count: formatMetric('turns', count), ...values });
  }

  /** A provider's line in plain words: what was counted over the range, then what the measure misses. */
  function counted(totals: UsageTotals): string {
    const line = counts(strings.usage.counted, totals.turns, { turns: formatMetric('turns', totals.turns), days: String(range) });
    const missing = gap(totals);
    return missing > 0 && metric !== 'turns' ? `${line} · ${fill(strings.usage.gaps[metric], { count: formatMetric('turns', missing) })}` : line;
  }

  function valueOf(totals: UsageTotals & { value: number }): string {
    if (metric === 'cost') return money(totals);
    if (metric === 'tokens' && totals.turns > 0 && totals.reported === 0) return strings.usage.noUsage;
    return formatMetric(metric, totals.value);
  }

  /** A share the measure can state: a provider with no count or no price has none. */
  function shareOf(totals: UsageTotals & { value: number }, total: number): number | null {
    if (total <= 0 || totals.turns === 0) return null;
    if (metric !== 'turns' && (metric === 'tokens' ? totals.reported : totals.priced) === 0) return null;
    return totals.value / total;
  }

  // In the language the app speaks, not the system's.
  const dayName = $derived(new Intl.DateTimeFormat(formatLocale(), { weekday: 'short', day: 'numeric', month: 'short' }));
  const calendarDate = $derived(new Intl.DateTimeFormat(formatLocale(), { day: 'numeric', month: 'long', year: 'numeric' }));
  const percent = $derived(new Intl.NumberFormat(formatLocale(), { style: 'percent', maximumFractionDigits: 0 }));
</script>

{#snippet numbers(totals: UsageTotals)}
  <td class="num mid">{formatMetric('turns', totals.turns)}</td>
  <td class="num" class:muted={totals.reported === 0}>{totals.reported === 0 ? strings.usage.noUsage : formatMetric('tokens', totalTokens(totals.usage))}</td>
  <td class="num wide">{reportedValue('tokens', totals.usage.inputTokens, totals)}</td>
  <td class="num wide">{reportedValue('tokens', totals.usage.outputTokens, totals)}</td>
  <td class="num wide">{reportedValue('tokens', totals.usage.cacheReadTokens + totals.usage.cacheWriteTokens, totals)}</td>
  <td class="num" class:muted={totals.priced === 0}>{money(totals)}</td>
{/snippet}

{#snippet heads(first: string)}
  <tr>
    <th>{first}</th>
    <th class="num mid">{strings.usage.turns}</th>
    <th class="num">{strings.usage.tokens}</th>
    <th class="num wide">{strings.usage.input}</th>
    <th class="num wide">{strings.usage.output}</th>
    <th class="num wide">{strings.usage.cache}</th>
    <th class="num">{strings.usage.metrics.cost}</th>
  </tr>
{/snippet}

{#snippet refreshButton()}
  <button type="button" class="quiet icon refresh" aria-label={strings.usage.refresh} title={strings.usage.refresh} data-testid="usage-refresh" onclick={refresh}>
    <RefreshCw size={15} strokeWidth={1.75} class={loading ? 'spinning' : ''} />
  </button>
{/snippet}

<div class="page usage" data-testid="usage-page">
  {#if showTitle || !inBand}
    <header class:quota-actions={!showTitle}>
      {#if showTitle}<SettingsPageHeader title={strings.usage.heading} page="usage" />{/if}
      {#if !inBand}{@render refreshButton()}{/if}
    </header>
  {/if}

  <div class="filters">
    <div class="segmented" role="group" aria-label={strings.usage.range}>
      {#each USAGE_RANGES as days (days)}
        <button type="button" class:on={range === days} aria-pressed={range === days} data-testid="usage-range-{days}" onclick={() => { range = days; }}>
          <span class="ui-label">{fill(strings.usage.days, { days: String(days) })}</span>
        </button>
      {/each}
    </div>
    <div class="segmented" role="group" aria-label={strings.usage.metric}>
      {#each USAGE_METRICS as option (option)}
        <button type="button" class:on={metric === option} aria-pressed={metric === option} data-testid="usage-metric-{option}" onclick={() => { metric = option; }}>
          <span class="ui-label">{strings.usage.metrics[option]}</span>
        </button>
      {/each}
    </div>
    {#if detail === null}
      <div class="menus">
        {#if machines.length > 1}
          <Menu items={machineItems} label={strings.usage.machine} placement="bottom" testid="usage-machine-filter" onpick={pickMachine}>
            <span class="filter-name ui-label">{all ? strings.usage.allMachines : chosen.label}</span><ChevronDown size={13} />
          </Menu>
        {/if}
        {#if projectItems.length > 1 || project !== null}
          <Menu items={projectItems} label={strings.usage.project} placement="bottom" testid="usage-project-filter" onpick={pickProject}>
            <span class="filter-name ui-label">{chosenProject === null ? strings.usage.allProjects : projectName(chosenProject)}</span><ChevronDown size={13} />
          </Menu>
        {/if}
        <Menu items={providerItems} label={strings.usage.provider} placement="bottom" testid="usage-provider-filter" onpick={(id) => { provider = id || null; }}>
          <span class="filter-name ui-label">{provider === null ? strings.usage.allProviders : providerName(provider)}</span><ChevronDown size={13} />
        </Menu>
      </div>
    {/if}
  </div>

  {#if detail !== null}
    <UsageThreadPage
      machine={detail.machine}
      threadId={detail.threadId}
      providerId={provider}
      {range}
      {metric}
      refresh={refreshes}
      showMachine={machines.length > 1}
      {providerName}
      {modelNames}
      onback={() => { detail = null; }}
      onthread={(threadId) => { detail = { machine: detail!.machine, threadId }; }}
      onopen={known(detail.machine, detail.threadId) ? (threadId) => openThread(detail!.machine, threadId) : null}
    />
  {:else}
  {#each failures as failure (failure)}
    <p class="failure" role="alert">{fill(strings.usage.failed, { error: failure })}</p>
  {/each}
  {#if offline.length > 0}
    <p class="failure" role="status" data-testid="usage-offline">{fill(strings.usage.machinesOffline, { machines: offline.map((machine) => machine.label).join(', ') })}</p>
  {/if}

  <div class="body settings-stack" class:stale={loading && view !== null} aria-busy={loading}>
    {#if view === null && failures.length === 0 && !unreadable}
      <section class="card"><p class="muted">{strings.usage.loading}</p></section>
    {:else if view !== null}
      <section class="card overview" id="settings-usage-overview" data-testid="usage-overview">
        {#if chosenProject}
          <div class="scope">
            <span class="scope-name">{projectName(chosenProject)}{#if chosenProject.removed}<span class="tag">{strings.usage.removed}</span>{/if}</span>
            <button type="button" class="quiet icon" aria-label={strings.usage.clearProject} title={strings.usage.clearProject} data-testid="usage-project-clear" onclick={() => { project = null; }}><X size={14} /></button>
          </div>
        {/if}
        <div class="hero">
          <span class="section-label">{fill(strings.usage.totalOf[metric], { days: String(range) })}</span>
          <strong data-testid="usage-total">{valueOf(view.total)}</strong>
          <small>{@render pairs(fill(view.total.turns > 0 && view.total.reported === 0 ? strings.usage.summaryMissing : view.total.priced === 0 ? strings.usage.summaryNoPrice : strings.usage.summary, {
            turns: formatMetric('turns', view.total.turns),
            tokens: formatMetric('tokens', totalTokens(view.total.usage)),
            cost: money(view.total)
          }))}</small>
          {#if gap(view.total) > 0 && metric !== 'turns'}
            <small class="coverage" data-testid="usage-coverage"><span data-testid={metric === 'cost' ? 'usage-partial-cost' : undefined}>{counts(strings.usage.gapsTotal[metric], gap(view.total), {})}</span></small>
          {/if}
        </div>
        {#if active.length > 0}
          {@const shares = active.map((serie) => ({ serie, share: shareOf(view.bySeries[serie.key]!, view.total.value) }))}
          {#if shares.some((entry) => (entry.share ?? 0) > 0)}
            <div class="share-bar" role="img" aria-label={strings.usage.shareBar} data-testid="usage-share-bar">
              {#each shares as { serie, share } (serie.key)}
                {#if share !== null && share > 0}<span style:flex-grow={share} style:background={serie.color} title={`${providerName(serie.key)}: ${percent.format(share)}`}></span>{/if}
              {/each}
            </div>
          {/if}
          <ul class="providers" data-testid="usage-providers">
            {#each shares as { serie, share } (serie.key)}
              {@const totals = view.bySeries[serie.key]!}
              <li data-provider={serie.key}>
                <span class="swatch" style:background={serie.color}></span>
                <span class="provider"><ProviderLogo providerId={serie.key} size={14} /><span>{providerName(serie.key)}<small>{@render pairs(counted(totals))}</small></span></span>
                <span class="value">{valueOf(totals)}</span>
                <span class="share" title={share === null ? undefined : fill(strings.usage.share, { percent: percent.format(share) })}>{share === null ? '' : percent.format(share)}</span>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="chart" id="settings-usage-chart">
          {#if view.total.turns === 0}
            <p class="muted" data-testid="usage-empty">{fill(strings.usage.emptyRange, { days: String(range) })}</p>
          {:else if metric === 'cost' && view.total.priced === 0}
            <p class="muted" data-testid="usage-empty">{strings.usage.noPrice}</p>
          {:else if metric === 'tokens' && view.total.reported === 0}
            <p class="muted" data-testid="usage-empty">{strings.usage.noUsage}</p>
          {:else}
            <UsageChart
              buckets={view.buckets}
              series={active.map((serie) => ({ key: serie.key, color: serie.color, label: providerName(serie.key) }))}
              {metric}
              days={range}
              label={fill(strings.usage.chartLabel, { metric: strings.usage.metrics[metric] })}
            />
          {/if}
          {#if metric === 'cost' && view.unpriced.length > 0}
            <p class="aside" data-testid="usage-unpriced">{fill(strings.usage.unpriced, { providers: view.unpriced.map(providerName).join(', ') })}</p>
          {/if}
        </div>
      </section>

      {#if view.total.turns > 0}
        <SettingsSection id="settings-usage-threads" title={strings.usage.threads}>
          {#if threads.length === 0}<p class="muted">{strings.usage.noRankedThreads}</p>{/if}
          <ol class="threads" data-testid="usage-threads">
            {#each threads as thread, index (`${thread.machine.id}\u0000${thread.threadId}`)}
              <li class:first={index === 0}>
                <button type="button" class="ghost thread" aria-label={fill(strings.usage.openDetails, { thread: thread.title || strings.usage.untitled })} onclick={() => openDetail(thread)}>
                  {@render threadRow(thread, index === 0)}
                </button>
              </li>
            {/each}
          </ol>
        </SettingsSection>

        {#if project === null && rankedProjects.length > 0}
          <SettingsSection id="settings-usage-projects" title={strings.usage.projects}>
            <ol class="projects" data-testid="usage-projects">
              {#each projectsOpen ? rankedProjects : rankedProjects.slice(0, PROJECTS_SHOWN) as entry (projectKey(entry.machine, entry.projectId))}
                <li>
                  <button type="button" class="ghost project" data-removed={entry.removed || undefined} onclick={() => chooseProject(entry)}>
                    <span class="title">
                      <span class="name">{projectName(entry)}{#if entry.removed}<span class="tag">{strings.usage.removed}</span>{/if}</span>
                      <small>{fill(strings.usage.threadTurns, { turns: formatMetric('turns', entry.turns) })}{#if all} · {entry.machine.label}{/if}</small>
                    </span>
                    <span class="amount">
                      <span class="value">{formatMetric(metric, entry.value)}</span>
                      <span class="bar"><span style:width="{projectPeak > 0 ? (entry.value / projectPeak) * 100 : 0}%"></span></span>
                    </span>
                    <ChevronRight size={14} class="chevron" />
                  </button>
                </li>
              {/each}
            </ol>
            {#if rankedProjects.length > PROJECTS_SHOWN}
              <button type="button" class="quiet more" onclick={() => { projectsOpen = !projectsOpen; }}>
                {projectsOpen ? strings.usage.projectsLess : fill(strings.usage.projectsMore, { count: String(rankedProjects.length) })}
              </button>
            {/if}
          </SettingsSection>
        {/if}

        <SettingsSection class="breakdown" id="settings-usage-breakdown" title={strings.usage.breakdown}>
          {#snippet actions()}
            <div class="segmented" role="group" aria-label={strings.usage.breakdown}>
              <button type="button" class:on={breakdown === 'model'} aria-pressed={breakdown === 'model'} data-testid="usage-by-model" onclick={() => { breakdown = 'model'; }}><span class="ui-label">{strings.usage.byModel}</span></button>
              <button type="button" class:on={breakdown === 'day'} aria-pressed={breakdown === 'day'} data-testid="usage-by-day" onclick={() => { breakdown = 'day'; }}><span class="ui-label">{strings.usage.byDay}</span></button>
            </div>
          {/snippet}
          <div class="table" class:scroll={breakdown === 'day'}>
            <table data-testid="usage-breakdown">
              {#if breakdown === 'model'}
                <thead>{@render heads(strings.usage.model)}</thead>
                <tbody>
                  {#each view.models as row (`${row.providerId}:${row.model}`)}
                    <tr>
                      <td class="who">
                        <span class="swatch" style:background={providerColor(row.providerId)}></span>
                        <span>
                          <span class="model-line"><span class="model">{modelName(row.model, modelNames, row.providerId)}</span><InfoTip topic={fill(strings.usage.priceOf, { model: modelName(row.model, modelNames, row.providerId) })} text={priceNote(row)} testid="usage-price" /></span>
                          <small>{providerName(row.providerId)}</small>
                        </span>
                      </td>
                      {@render numbers(row)}
                    </tr>
                  {/each}
                </tbody>
              {:else}
                <thead>{@render heads(strings.usage.day)}</thead>
                <tbody>
                  {#each dayRows as row (row.start)}
                    <tr>
                      <td>{dayName.format(row.start)}</td>
                      {@render numbers(row)}
                    </tr>
                  {/each}
                </tbody>
              {/if}
            </table>
          </div>
          {#if pricing}
            <p class="aside pricing" data-testid="usage-pricing">{pricing.origin === 'live'
              ? fill(strings.usage.pricingLive, { source: pricing.source.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), when: relativeTime(pricing.updatedAt) })
              : fill(strings.usage.pricingBundled, { when: calendarDate.format(pricing.updatedAt) })}</p>
          {/if}
        </SettingsSection>
      {/if}
    {/if}
  </div>
  {/if}
</div>

<!-- A line break falls between the pieces a dot separates, never inside one: "Cost" stays beside its count. -->
{#snippet pairs(text: string)}
  {@const parts = text.split(' · ')}
  {#each parts as part, index (index)}{#if index > 0}{' '}{/if}<span class="pair">{part}{index < parts.length - 1 ? ' ·' : ''}</span>{/each}
{/snippet}

{#snippet threadRow(thread: (typeof threads)[number], first: boolean)}
  <span class="logo" style:--tint={providerColor(thread.providerId)}><ProviderLogo providerId={thread.providerId} size={first ? 20 : 16} /></span>
  <span class="title">
    {#if first}<span class="badge">{strings.usage.top}</span>{/if}
    <span class="name">{thread.title || strings.usage.untitled}</span>
    <small>
      {fill(strings.usage.threadTurns, { turns: formatMetric('turns', thread.turns) })}{#if all} · {thread.machine.label}{/if}
      {#if thread.archived}<span class="tag">{strings.usage.archived}</span>{/if}
    </small>
  </span>
  <span class="amount">
    <span class="value">{formatMetric(metric, thread.value)}</span>
    <span class="bar"><span style:width="{threadPeak > 0 ? (thread.value / threadPeak) * 100 : 0}%" style:background={providerColor(thread.providerId)}></span></span>
  </span>
  <ChevronRight size={14} class="chevron" />
{/snippet}

<style>
  /* On a phone the refresh sits on the title's line; wider, it stands in the band. */
  .usage > header { align-items: center; gap: 8px; max-width: var(--settings-width); }
  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: var(--settings-width); margin-bottom: 20px; }
  .menus { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .refresh { margin-left: auto; width: var(--control); height: var(--control); padding: 0; }
  .filter-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px; }
  .refresh :global(.spinning) { animation: spin 900ms linear infinite var(--loops); }
  .failure { max-width: var(--settings-width); margin: 0 0 12px; color: var(--color-danger); font-size: var(--text-sm); }
  .body { max-width: var(--settings-width); transition: opacity var(--dur-2) var(--ease-out-quint); }
  .body.stale { opacity: 0.6; }

  .scope { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -4px 0 12px; }
  .scope-name { font-weight: 600; overflow-wrap: anywhere; }
  .hero { display: grid; gap: 4px; }
  .hero strong { font-size: calc(var(--text-lg) * 1.9); line-height: 1.05; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .hero small, .aside, .muted { color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .pair { white-space: nowrap; }
  .aside { margin: 10px 0 0; line-height: 1.5; }

  /* One bar for the whole range, each provider its share: the overview at a glance. */
  .share-bar { display: flex; gap: 2px; height: 10px; margin: 16px 0 0; border-radius: 5px; overflow: hidden; background: var(--color-surface-3); }
  .share-bar span { min-width: 3px; transition: flex-grow var(--dur-3) var(--ease-out-quint); }
  .providers { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px 28px; margin: 14px 0 0; padding: 0; list-style: none; font-size: var(--text-sm); }
  .providers li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto 38px; align-items: center; gap: 8px; }
  .swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .provider { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .provider > span { display: grid; min-width: 0; overflow-wrap: anywhere; }
  .provider small { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .value { font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
  .share { font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); text-align: right; }
  .bar { display: block; height: 4px; border-radius: 2px; background: var(--color-surface-3); overflow: hidden; }
  .bar span { transition: width var(--dur-3) var(--ease-out-quint); display: block; height: 100%; border-radius: 2px; }
  .chart { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--color-border); }

  .page :global(.breakdown) { container-type: inline-size; }
  .table { overflow-x: auto; margin: 0 calc(-1 * var(--settings-padding)); }
  /* Ninety days is ninety rows: the day view scrolls under its sticky header. */
  .table.scroll { max-height: 420px; overflow-y: auto; }
  table { font-size: var(--text-sm); }
  th { position: sticky; top: 0; z-index: 1; background: var(--color-surface); }
  th:first-child, td:first-child { padding-left: var(--settings-padding); }
  th:last-child, td:last-child { padding-right: var(--settings-padding); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  td.muted { font-size: var(--text-sm); }
  .who { display: flex; align-items: center; gap: 10px; white-space: normal; }
  .who > span:last-child { display: grid; min-width: 0; }
  /* The "i" flows after the name's last word, so a narrow column keeps the name's width. */
  .model-line { min-width: 0; overflow-wrap: anywhere; }
  .who small { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  tbody tr:hover td { background: var(--color-hover); }
  .pricing { margin-top: 14px; font-size: var(--text-xs); }
  @container (max-width: 560px) { .wide { display: none; } }
  @container (max-width: 420px) { .mid { display: none; } }

  .threads, .projects { display: grid; gap: 2px; margin: 0 -8px; padding: 0; list-style: none; }
  .thread, .project { display: grid; grid-template-columns: 28px minmax(0, 1fr) minmax(88px, 150px) 14px; align-items: center; gap: 10px; width: 100%; height: auto; min-height: var(--row); padding: 6px 8px; border-radius: var(--radius-md); color: var(--color-foreground); text-align: left; font-weight: 400; }
  .project { grid-template-columns: minmax(0, 1fr) minmax(88px, 150px) 14px; }
  .thread :global(.chevron), .project :global(.chevron) { color: var(--color-muted-foreground); opacity: 0; transition: opacity var(--dur-1) var(--ease-out-quint), transform var(--dur-1) var(--ease-out-quint); }
  .thread:hover :global(.chevron), .project:hover :global(.chevron), .thread:focus-visible :global(.chevron), .project:focus-visible :global(.chevron) { opacity: 1; transform: translateX(2px); }
  .logo { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); background: color-mix(in oklch, var(--tint) 20%, transparent); }
  .title { display: grid; min-width: 0; }
  .title .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title small { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .tag { margin-left: 6px; padding: 0 5px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); }
  .amount { display: grid; gap: 4px; justify-items: end; }
  .amount .value { font-weight: 600; }
  .amount .bar { width: 100%; }
  .project .bar span { background: color-mix(in oklch, var(--color-foreground) 45%, transparent); }
  .project[data-removed] .name { color: var(--color-muted-foreground); }
  /* The biggest thread leads the list: larger, on its provider's tint. */
  .threads li.first { margin-bottom: 6px; }
  .threads li.first .thread { grid-template-columns: 40px minmax(0, 1fr) minmax(110px, 180px) 14px; padding: 12px; background: color-mix(in oklch, var(--color-surface-2) 70%, transparent); border: 1px solid var(--color-border); }
  .threads li.first .logo { width: 40px; height: 40px; border-radius: var(--radius-md); }
  .threads li.first .name { font-size: var(--text-base); font-weight: 600; white-space: normal; overflow-wrap: anywhere; }
  .threads li.first .amount .value { font-size: var(--text-lg); }
  .threads li.first .amount .bar { height: 6px; }
  .badge { justify-self: start; margin-bottom: 2px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .more { margin-top: 8px; }

  @media (max-width: 720px) {
    /* Each group of options takes the row, its options sharing it evenly, as on Appearance. */
    .filters .segmented { flex: 1 1 100%; }
    .segmented button { flex: 1; min-width: 0; }
    .hero strong { font-size: calc(var(--text-lg) * 1.5); }
    .providers { grid-template-columns: 1fr; }
    .thread { grid-template-columns: 28px minmax(0, 1fr) 80px; }
    .project { grid-template-columns: minmax(0, 1fr) 80px; }
    .thread :global(.chevron), .project :global(.chevron) { display: none; }
    .threads li.first .thread { grid-template-columns: 40px minmax(0, 1fr); }
    .threads li.first .amount { grid-column: 1 / -1; justify-items: stretch; }
    .threads li.first .amount .value { justify-self: end; }
  }
  @media (prefers-reduced-motion: reduce) { .refresh :global(.spinning) { animation: none; } }
</style>
