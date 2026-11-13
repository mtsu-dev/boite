<script lang="ts">
  import { errorText } from '../lib/errors';
  import { Check, ChevronDown, Circle, CircleCheck, CircleDot, Hand, ListChecks, ListTodo, PanelRight, Pause, Play, Repeat, Reply, Target, X } from '@lucide/svelte';
  import { focusComposer } from '../lib/focus';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import GoalChecklist from './GoalChecklistLoader.svelte';

  let { store }: { store: Store } = $props();
  let activity = $derived(store.openThread?.activity);
  let expanded = $state(false);
  let saving = $state(false);

  let visible = $derived(Boolean(activity?.goal && !activity.goal.dismissed || activity?.loop || activity?.tasks.length && !activity.tasksDismissed));
  // Keep completed content mounted during the fade out, without occupying chat space.
  let tasks = $derived(activity?.tasksDismissed && visible ? [] : activity?.tasks ?? []);
  let goal = $derived(activity?.goal?.dismissed && visible ? null : activity?.goal);
  let loop = $derived(activity?.loop);
  /** The agent stopped on a blocker: the user's next message is its answer and resumes the goal. */
  let blocked = $derived(goal?.status === 'paused' && goal.blocked === true);
  let done = $derived(tasks.filter((task) => task.status === 'completed').length);
  let current = $derived(tasks.find((task) => task.status === 'in_progress')?.text ??
    (done === tasks.length ? strings.activity.allTasksDone : strings.activity.waitingTasks));
  let history = $derived([...(loop?.history ?? [])].reverse());
  /** A `/goal2`: its verdicts, newest first in the details, and the review running now. */
  let review = $derived(goal?.review);
  let verdicts = $derived([...(review?.verdicts ?? [])].reverse());
  let reviewing = $derived(review?.phase === 'reviewing' && goal?.status === 'active');
  let reviewLine = $derived.by(() => {
    if (!review) return '';
    if (review.reviewerThreadId) return fill(strings.activity.reviewInProgress, { round: String(review.verdicts.length + 1) });
    const last = review.verdicts.at(-1);
    // Each reply after the five-review stop allows one more, so the round can pass the total.
    return last ? `${fill(strings.activity.reviewRoundOf, { round: String(last.round), total: String(Math.max(review.maxRounds, last.round)) })} · ${strings.activity[last.verdict]}` : '';
  });
  /*
   * A `/goal2`'s checklist takes the bar's task line: the user's requests, not
   * the agent's own plan, which stays in the Tasks panel. Dropped items count
   * for nothing.
   */
  let checklist = $derived(goal?.checklist ?? null);
  let tracked = $derived(!!checklist && (checklist.items.length > 0 || checklist.phase !== 'idle' || checklist.error !== null));
  let listed = $derived(checklist?.items.filter((item) => item.status !== 'cancelled') ?? []);
  let ticked = $derived(listed.filter((item) => item.status === 'done').length);
  /** The owner's app lists the checklist in the side panel's Tasks tab; a paired device, which has no Tasks tab, unfolds it here. */
  let inPanel = $derived(tracked && store.owner);
  let checklistLine = $derived.by(() => {
    if (!checklist) return '';
    if (checklist.phase === 'writing') return checklist.items.length ? strings.activity.checklistUpdating : strings.activity.checklistWriting;
    if (checklist.phase === 'checking') return strings.activity.checklistChecking;
    if (!checklist.items.length) return strings.activity.checklistUnavailable;
    return listed.find((item) => item.status === 'open')?.text ?? strings.activity.checklistAllDone;
  });
  const detailsId = $props.id();

  function interval(ms: number) {
    if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
    if (ms % 60_000 === 0) return `${ms / 60_000}m`;
    return `${ms / 1000}s`;
  }

  function iteration(count: number, total?: number | null) {
    return total ? fill(strings.activity.iterationOf, { count: String(count), total: String(total) })
      : fill(strings.activity.iteration, { count: String(count) });
  }

  async function control(kind: 'goal' | 'loop', action: 'pause' | 'resume' | 'remove' | 'complete') {
    const thread = store.openThread;
    if (!thread || !store.client || saving) return;
    saving = true;
    try {
      const value = await store.client.call('threads.activity.control', { threadId: thread.id, kind, action });
      if (store.openThread?.id === thread.id) store.openThread.activity = value;
    } catch (error) {
      store.error = errorText(error);
    } finally { saving = false; }
  }
</script>

{#if activity}
  <section class="activity" class:hidden={!visible} data-testid="thread-activity" aria-label={strings.activity.tasks} inert={!visible}>
    {#each ['goal', 'loop'] as kind (kind)}
      {@const entry = kind === 'goal' ? goal : loop}
      {@const waiting = kind === 'goal' && blocked}
      {#if entry}
        <div class="entry" class:blocked={waiting}>
        <div class="activity-row" class:finished={entry.status === 'complete'} data-testid="activity-{kind}" data-blocked={waiting || undefined}>
          {#if waiting}<Hand size={16} />{:else if kind === 'goal'}<Target size={16} />{:else}<Repeat size={16} />{/if}
          <!-- A phone keeps the short word: the review line under it already says the goal is reviewed. -->
          <span class="kind ui-label" data-auto={kind === 'goal' && goal?.auto ? '' : undefined}>{#if kind === 'goal' && review}<span class="wide">{goal?.auto ? strings.activity.autoGoal : strings.activity.goal2}</span><span class="narrow">{goal?.auto ? strings.activity.autoGoalShort : strings.activity.goal}</span>{:else}{kind === 'goal' ? strings.activity.goal : strings.activity.loop}{/if}</span>
          <span class="objective" title={'objective' in entry ? entry.objective : entry.prompt}>
            {#if 'objective' in entry}{entry.objective}{:else}{iteration(entry.iterations, entry.maxIterations)}{/if}
          </span>
          {#if !waiting}<span class="meta status ui-label-box" class:live={entry.status === 'active'}><span class="ui-label">{kind === 'goal' && reviewing ? strings.activity.reviewing : strings.activity[entry.status]}</span></span>{/if}
          {#if entry.status !== 'complete'}
            <button type="button" class="ghost small icon" disabled={saving || store.connection !== 'ready'}
              aria-label={entry.status === 'active' ? strings.activity.pause : strings.activity.resume}
              title={entry.status === 'active' ? strings.activity.pause : strings.activity.resume}
              onclick={() => void control(kind as 'goal' | 'loop', entry.status === 'active' ? 'pause' : 'resume')}>
              {#if entry.status === 'active'}<Pause size={16} />{:else}<Play size={16} />{/if}
            </button>
          {/if}
          {#if kind === 'goal' && entry.status !== 'complete'}
            <button type="button" class="ghost small icon" disabled={saving || store.connection !== 'ready'} aria-label={strings.activity.finish} title={strings.activity.finish} onclick={() => void control('goal', 'complete')}><Check size={16} /></button>
          {/if}
          <button type="button" class="ghost small icon" disabled={saving || store.connection !== 'ready'} aria-label={strings.activity.remove} title={strings.activity.remove} onclick={() => void control(kind as 'goal' | 'loop', 'remove')}><X size={16} /></button>
        </div>
        {#if kind === 'goal' && review && reviewLine}
          <div class="review-line" data-testid="activity-goal-reviews">
            <span class="verdicts">
              {#each review.verdicts as verdict (verdict.threadId)}
                {@const label = `${fill(strings.activity.reviewRound, { round: String(verdict.round) })}: ${strings.activity[verdict.verdict]}`}
                <button type="button" class="verdict" data-verdict={verdict.verdict} aria-label={`${label}. ${strings.activity.openReview}`} title={label} onclick={() => void store.open(verdict.threadId)}></button>
              {/each}
              {#if review.reviewerThreadId}
                {@const reviewer = review.reviewerThreadId}
                <button type="button" class="verdict" data-verdict="running" aria-label={`${reviewLine}. ${strings.activity.openReview}`} title={reviewLine} onclick={() => void store.open(reviewer)}></button>
              {/if}
            </span>
            <span class="meta ui-label">{reviewLine}</span>
          </div>
        {/if}
        {#if waiting}
          <div class="blocker" data-testid="activity-goal-blocked">
            <span class="waiting-dot" aria-hidden="true"></span>
            <p><span class="ask">{strings.activity.blocked}</span> <span class="hint">{strings.activity.blockedHint}</span></p>
            <button type="button" class="small reply" onclick={() => focusComposer({ typing: true })}><Reply size={14} />{strings.activity.reply}</button>
          </div>
        {:else if entry.error}<p class="error">{entry.error}</p>{/if}
        </div>
      {/if}
    {/each}
    {#if tracked || tasks.length || loop || verdicts.length}
      <button type="button" class="ghost tasks-toggle" aria-expanded={inPanel ? undefined : expanded} aria-controls={inPanel ? undefined : detailsId}
        title={inPanel ? strings.activity.checklistInPanel : undefined}
        data-testid="activity-tasks-toggle" data-checklist={tracked || undefined} data-panel={inPanel || undefined}
        onclick={() => { if (inPanel) store.panel.openTasks(); else expanded = !expanded; }}
        onkeydown={(event) => { if (event.key === 'Escape') { expanded = false; event.stopPropagation(); } }}>
        <span class="toggle-line">
          {#if tracked}<ListChecks size={16} />{:else}<ListTodo size={16} />{/if}
          <span class="current ui-label" class:busy={tracked && checklist?.phase !== 'idle'}>{tracked ? checklistLine : tasks.length ? current : loop ? strings.activity.history : strings.activity.reviews}</span>
          {#if tracked && listed.length}<span class="count ui-label" data-testid="activity-checklist-count">{fill(strings.activity.checklistCount, { done: String(ticked), total: String(listed.length) })}</span>
          {:else if !tracked && tasks.length}<span class="count ui-label">{fill(strings.activity.taskCount, { done: String(done), total: String(tasks.length) })}</span>{/if}
          {#if inPanel}<PanelRight size={16} />{:else}<ChevronDown size={16} class={expanded ? 'turned' : ''} />{/if}
        </span>
        <!-- Inside the toggle so its hover fill covers the bar and the card's air
             is the same above the first line and under the bar. The count
             already says it in words, the bar only draws it. -->
        {#if tracked && listed.length}<progress max={listed.length} value={ticked} aria-hidden="true"></progress>
        {:else if !tracked && tasks.length}<progress max={tasks.length} value={done} aria-hidden="true"></progress>{/if}
      </button>
      <div class="disclosure-fold" class:open={expanded} inert={!expanded}>
        <div id={detailsId}>
          {#if tracked && checklist && !inPanel}
            <GoalChecklist {store} {checklist} />
          {:else if tasks.length}
            <ul data-testid="activity-tasks">
              {#each tasks as task (task.id)}
                <li class:done={task.status === 'completed'}>
                  <span class="task-mark" data-status={task.status} title={strings.activity[task.status]} role="img" aria-label={strings.activity[task.status]}>
                    {#if task.status === 'completed'}<CircleCheck size={14} />{:else if task.status === 'in_progress'}<CircleDot size={14} />{:else}<Circle size={14} />{/if}
                  </span>
                  <span>{task.text}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if verdicts.length}
            <ol class="history" aria-label={strings.activity.reviews} data-testid="activity-reviews">
              {#each verdicts as verdict (verdict.threadId)}
                <li>
                  <div class="run-heading">
                    <span>{fill(strings.activity.reviewRound, { round: String(verdict.round) })}</span>
                    <span class="verdict-name" data-verdict={verdict.verdict}>{strings.activity[verdict.verdict]}</span>
                  </div>
                  {#if verdict.summary}<p>{verdict.summary}</p>{/if}
                  <button type="button" class="ghost small open-review" onclick={() => void store.open(verdict.threadId)}>{strings.activity.openReview}</button>
                </li>
              {/each}
            </ol>
          {/if}
          {#if loop}
            {#if loop.intervalMs > 0}<p class="meta cadence">{fill(strings.activity.every, { interval: interval(loop.intervalMs) })}</p>{/if}
            <ol class="history" aria-label={strings.activity.history}>
              {#each history as run (run.turnId)}
                <li><div class="run-heading"><span>{iteration(run.iteration)}</span><span class="meta">{strings.activity[run.status]}</span></div>{#if run.summary}<p>{run.summary}</p>{/if}</li>
              {:else}<li class="meta">{strings.activity.noHistory}</li>{/each}
            </ol>
          {/if}
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  /* The head of the composer card, in the flow, so the timeline gives way to
     it: the goal, the loop and the tasks as plain lines. Four pixels around
     every line, so a hover fill sits inset by the same four pixels on every
     side. */
  .activity { display: flex; flex-direction: column; overflow-y: auto; padding: 4px; font-size: var(--text-sm); }
  .activity > * { flex: none; }
  .activity.hidden { display: none; }
  .activity-row { display: flex; align-items: center; gap: 8px; min-height: var(--control); min-width: 0; padding: 0 2px 0 8px; }
  .activity-row > :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .activity-row button { flex: none; }
  .kind { flex: none; white-space: nowrap; font-weight: 600; color: var(--color-foreground); }
  .kind .narrow { display: none; }
  .status { padding: 2px 8px; border-radius: var(--radius-sm); background: var(--color-surface-2); }
  .status.live { color: var(--color-accent); }
  .finished .status { color: var(--color-success); }
  /*
   * A blocked goal waits on the user. The question's yellow marks it in two
   * places, the hand and a slow dot, over a faint wash; the words stay in the
   * text colors so they read in both themes.
   */
  .entry.blocked { border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-live) 6%, transparent); }
  .entry.blocked .activity-row > :global(svg:first-child) { color: var(--color-live); }
  .blocker { display: flex; align-items: center; gap: 8px; min-height: var(--control); padding: 0 4px 4px 13px; }
  .waiting-dot { flex: none; width: 6px; height: 6px; margin-inline: 5px; border-radius: var(--radius-full); background: var(--color-live); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-live) 22%, transparent); animation: pulse 1.8s var(--loop-ease-in-out-54) infinite var(--loops); }
  .blocker p { flex: 1; min-width: 0; margin: 0; line-height: 1.45; overflow-wrap: anywhere; }
  .ask { font-weight: 600; color: var(--color-foreground); }
  .hint { color: var(--color-muted-foreground); }
  .reply { flex: none; gap: 6px; color: var(--color-foreground); }
  .reply:hover { background: var(--color-hover); }
  .objective, .current { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; text-align: left; }
  .meta, .count { color: var(--color-muted-foreground); font-size: var(--text-xs); flex: none; }
  .tasks-toggle { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 6px; width: 100%; height: auto; min-height: var(--control); padding: 6px 8px; font-weight: 400; color: var(--color-foreground); }
  .toggle-line { display: flex; align-items: center; gap: 8px; min-width: 0; line-height: 16px; }
  .toggle-line > :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .toggle-line > :global(svg:last-child) { transition: transform var(--motion-duration) var(--motion-curve); }
  .toggle-line > :global(.turned) { transform: rotate(180deg); }
  progress { display: block; appearance: none; width: 100%; height: 3px; border: none; border-radius: var(--radius-sm); overflow: hidden; background: var(--color-surface-3); }
  progress::-webkit-progress-bar { background: var(--color-surface-3); }
  progress::-webkit-progress-value { background: var(--color-accent); transition: width var(--motion-duration) var(--motion-curve); }
  progress::-moz-progress-bar { background: var(--color-accent); }
  ul, ol { list-style: none; margin: 0; padding: 2px 8px 6px; }
  li { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; line-height: 1.5; overflow-wrap: anywhere; }
  /* The same box as the toggle's icon, so the task text starts under its line. */
  .task-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 1.5em; flex: none; color: var(--color-muted-foreground); }
  .task-mark[data-status='completed'] { color: var(--color-success); }
  .task-mark[data-status='in_progress'] { color: var(--color-live); }
  .done { color: var(--color-muted-foreground); }
  /* The tracker is reading: the line breathes until it answers. */
  .current.busy { animation: pulse 1.8s var(--loop-ease-in-out-54) infinite var(--loops); }
  .history li { display: block; border-top: 1px solid var(--color-border); padding-block: 8px; }
  .run-heading { display: flex; justify-content: space-between; gap: 12px; }
  .history p { margin: 4px 0 0; white-space: pre-wrap; }
  .cadence { margin: 8px 8px 0; }
  /* A reviewed goal's rounds: one dot per verdict, the running review pulsing in the accent. */
  .review-line { display: flex; align-items: center; gap: 8px; min-height: var(--control-sm); padding: 0 8px 4px 32px; min-width: 0; }
  .review-line .meta { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .verdicts { display: inline-flex; align-items: center; flex: none; }
  .verdict { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: none; border-radius: var(--radius-full); background: transparent; cursor: pointer; }
  .verdict::before { content: ''; width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--verdict, var(--color-muted-foreground)); }
  .verdict:hover::before, .verdict:focus-visible::before { box-shadow: 0 0 0 3px color-mix(in srgb, var(--verdict, var(--color-muted-foreground)) 28%, transparent); }
  [data-verdict='pass'] { --verdict: var(--color-success); }
  [data-verdict='partial'] { --verdict: var(--color-live); }
  [data-verdict='fail'], [data-verdict='missing'] { --verdict: var(--color-danger); }
  [data-verdict='running'] { --verdict: var(--color-accent); }
  .verdict[data-verdict='running']::before { animation: pulse 1.8s var(--loop-ease-in-out-54) infinite var(--loops); }
  .verdict-name { color: var(--verdict); font-weight: 600; }
  .open-review { margin-top: 4px; padding-inline: 6px; color: var(--color-accent); }
  .error { margin: 2px 8px 6px; }
  @media (max-width: 720px) {
    .activity-row { gap: 6px; }
    .kind .wide { display: none; }
    .kind .narrow { display: inline; }
    .blocker { align-items: flex-start; }
    .waiting-dot { margin-top: 7px; }
  }
  :global(html[data-motion='reduced']) .waiting-dot, :global(html[data-motion='reduced']) .verdict::before, :global(html[data-motion='reduced']) .current.busy { animation: none; }
  @media (prefers-reduced-motion: reduce) { .waiting-dot, .verdict::before, .current.busy { animation: none; } .activity, progress::-webkit-progress-value, .toggle-line > :global(svg:last-child) { transition: none; } }
</style>
