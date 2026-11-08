<script lang="ts">
  import { CircleCheck, CircleX, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquare, X } from '@lucide/svelte';
  import type { AgentWatch, Project } from '@boite/contracts';
  import { deskState, deskTone } from '../../lib/agent-desk';
  import { workedTime } from '../../lib/agent-turns';
  import { ago, exactTime } from '../../lib/format';
  import type { Store } from '../../lib/store.svelte';
  import { fill, strings } from '../../lib/strings';
  import Elapsed from '../Elapsed.svelte';
  import Spinner from '../Spinner.svelte';
  import ProjectTile from '../ProjectTile.svelte';

  /**
   * One thread a bot handles, as a row of its column: its project's mark, its
   * title, when it last moved (a live timer while it runs), and a second line
   * only when it has something to say: a silent turn, a queued one, its
   * machine when out of reach, its pull request and checks. Its state takes
   * the lists' one slot after the title: an amber dot when it needs the user,
   * a red one when it failed, the still arc at work, each named in its tooltip.
   * A thread that asks the user carries the question and its options, answered
   * here. The row opens its thread; the cross, on hover and focus, takes it off
   * the desk. A thread of a machine this client does not reach opens nowhere.
   */
  let { watch, project, store, now, runningSince = null, done = false, onopen, ondrop, onanswer }: {
    watch: AgentWatch;
    project: Project | null;
    store: Store;
    now: number;
    /** When its running turn started, for the live timer: this client's own threads only. */
    runningSince?: number | null;
    /** In the Done section: drawn dimmer. */
    done?: boolean;
    /** Absent for a thread of a machine this client does not reach. */
    onopen?: () => void;
    /** Absent for a device that may not change the desk. */
    ondrop?: () => void;
    /** Absent for a device that may not answer. */
    onanswer?: (option: string) => Promise<void>;
  } = $props();
  const t = $derived(strings.agents.deskPanel);
  const standing = $derived(deskState(watch));
  const tone = $derived(deskTone(standing));
  const pr = $derived(watch.pullRequest);
  /** The states that earn words on the second line; the others read from the mark and the time. */
  const said = $derived(standing === 'stalled' || standing === 'queued');
  const meta = $derived(said || !!pr || !!watch.unreachable || (!!watch.machine && !project));
  let answering = $state<string | null>(null);

  async function answer(option: string) {
    if (!onanswer || answering) return;
    answering = option;
    try { await onanswer(option); } finally { answering = null; }
  }
</script>

<article class="desk-row" class:done data-state={standing} data-tone={tone} data-testid="desk-card" data-thread={watch.threadId}>
  {#if onopen}<button type="button" class="desk-card-open" onclick={onopen} aria-label={fill(t.open, { title: watch.title })} title={fill(t.open, { title: watch.title })}></button>{/if}
  <span class="desk-row-tile" title={t.origin[watch.origin]}>
    {#if project}<ProjectTile {project} {store} size={16} />{:else}<span class="desk-row-blank"><MessageSquare size={10} strokeWidth={2} /></span>{/if}
  </span>
  <div class="desk-row-text">
    <div class="desk-row-head">
      <strong class="desk-card-title">{watch.title}</strong>
      {#if standing === 'working' || standing === 'queued'}<span class="desk-row-work" data-testid="desk-row-mark" role="img" title={t.state[standing]} aria-label={t.state[standing]}></span>
      {:else if standing === 'needs-you' || standing === 'failed'}<span class="desk-row-mark" data-testid="desk-row-mark" data-tone={tone} role="img" title={t.state[standing]} aria-label={t.state[standing]}></span>{/if}
      <span class="desk-card-when" title={exactTime(watch.lastActivityAt)}>
        {#if standing === 'working' && runningSince !== null}<Elapsed startedAt={runningSince} finishedAt={null} active />{:else}{ago(watch.lastActivityAt, now)}{/if}
      </span>
      {#if ondrop}
        <button type="button" class="ghost small icon desk-card-drop" aria-label={fill(t.drop, { title: watch.title })} title={fill(t.drop, { title: watch.title })} onclick={ondrop} data-testid="desk-card-drop"><X size={12} strokeWidth={1.75} /></button>
      {/if}
    </div>
    {#if meta}
      <p class="desk-card-meta">
        {#if said}{#key standing}<span class="desk-chip" data-testid="desk-chip">{standing === 'stalled' && watch.stalledSince !== null ? fill(t.silent, { time: workedTime(now - watch.stalledSince) }) : t.state[standing]}</span>{/key}{/if}
        {#if watch.machine && (watch.unreachable || !project)}<span class="desk-card-machine" data-testid="desk-card-machine">{watch.machine}</span>{/if}
        {#if watch.unreachable}<span class="desk-card-unreachable" title={watch.unreachable} data-testid="desk-card-unreachable"><span class="desk-card-off" aria-hidden="true"></span>{t.unreachable}</span>{/if}
        {#if pr}
          <span class="desk-card-pr" data-pr={pr.state} data-checks={pr.checks ?? 'none'} data-testid="desk-card-pr">
            {#if pr.state === 'merged'}<GitMerge size={12} strokeWidth={1.75} />{:else if pr.state === 'closed'}<GitPullRequestClosed size={12} strokeWidth={1.75} />{:else}<GitPullRequest size={12} strokeWidth={1.75} />{/if}
            <span>{fill(t.pr[pr.state], { number: String(pr.number) })}</span>
            {#if pr.checks && pr.state !== 'merged' && pr.state !== 'closed'}
              {#if pr.checks === 'pending'}<Spinner size={10} />{:else if pr.checks === 'passing'}<CircleCheck size={11} strokeWidth={2} />{:else}<CircleX size={11} strokeWidth={2} />{/if}
              <span>{t.checks[pr.checks]}</span>
            {/if}
          </span>
        {/if}
      </p>
    {/if}
    {#if watch.question}
      <div class="desk-question" data-testid="desk-question">
        <p>{watch.question.text}</p>
        {#if onanswer && watch.question.options.length}
          <div class="desk-options">
            {#each watch.question.options as option (option)}
              <button type="button" class="small" class:primary={answering === option} disabled={answering !== null} onclick={() => void answer(option)} data-testid="desk-answer">{option}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</article>
