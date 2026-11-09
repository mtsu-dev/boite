<script lang="ts">
  import type { AgentWatch } from '@boite/contracts';
  import { splitDesk } from '../../lib/agent-desk';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { minuteClock } from '../../lib/clock.svelte';
  import { errorText } from '../../lib/errors';
  import { GroupLinks } from '../../lib/group-links.svelte';
  import { strings } from '../../lib/strings';
  import { workspace } from '../../lib/workspace.svelte';
  import { awaitsFirstTask } from '../../lib/bot-first-task';
  import DeskCard from './DeskCard.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import { avatarLit } from '../../lib/avatar-lit';

  /**
   * The threads a bot started, was handed or follows, from its desk: Handling,
   * the ones still open with what needs the user first, then Done, the ones
   * finished, merged or archived, dimmer. A row opens its thread on the
   * machine that holds it, answers its question in place, and its cross takes
   * it off the desk. The snapshot carries the open bot's desk only.
   */
  /**
   * `onstart`: the column's empty desk, one prompt in its middle, the conversation with the composer ready.
   * `ontask`: the Desk panel's, the composer beside it; without `onstart` an empty list is a line under its heading.
   */
  let { view, agentId, onstart, ontask }: { view: AgentsView; agentId: string; onstart?: () => void; ontask?: () => void } = $props();
  const store = $derived(view.store);
  const t = $derived(strings.agents.deskPanel);
  const now = $derived(minuteClock.now);
  const sections = $derived(splitDesk(view.snapshot?.watches.filter(w => w.agentId === agentId) ?? []));
  /** The column beside the chat (`onstart`) leaves a bot with nothing yet to the prompt over the chat; the desk sheet keeps its line. */
  const first = $derived(!!onstart && awaitsFirstTask(store, view, agentId));
  const profile = $derived(view.snapshot?.profiles.find(agent => agent.id === agentId));

  /** A thread of another machine of the group opens there, when this client reaches that machine. */
  function remoteOf(watch: AgentWatch) {
    return watch.coreId === undefined ? undefined : workspace.machines.find(machine => GroupLinks.coreOf(machine) === watch.coreId);
  }
  const reachable = (watch: AgentWatch) => watch.coreId === undefined || !!remoteOf(watch);
  function open(watch: AgentWatch) {
    if (watch.coreId === undefined) { void store.open(watch.threadId); return; }
    const machine = remoteOf(watch);
    if (machine) void workspace.select(machine.store, watch.threadId);
  }
  async function answer(watch: AgentWatch, option: string) {
    const question = watch.question;
    if (!question) return;
    // A question of another machine is answered through that machine's store.
    const owning = watch.coreId === undefined ? store : remoteOf(watch)?.store;
    if (!owning) return;
    // The desk names options by their label; the card the store holds names their ids.
    const held = owning.pendingQuestions.find(q => q.id === question.id);
    const picked = held?.options.find(o => o.label === option);
    try {
      if (picked) await owning.answerQuestion(watch.threadId, question.id, [picked.id]);
      else await owning.answerQuestion(watch.threadId, question.id, [], option);
      await view.refresh();
    } catch (error) { view.error = errorText(error); }
  }
  async function drop(watch: AgentWatch) {
    await view.call('agents.watch', { agentId: watch.agentId, watchThreadId: watch.threadId, watched: false, ...(watch.machine ? { machine: watch.machine } : {}) });
  }
  /** The live timer of a running thread this client holds. */
  function since(watch: AgentWatch): number | null {
    if (watch.coreId !== undefined) return null;
    const thread = store.threads.find(row => row.id === watch.threadId);
    return thread?.status === 'running' ? thread.runningSince ?? null : null;
  }
</script>

{#snippet rows(list: AgentWatch[], done: boolean)}
  {#each list as watch (`${watch.coreId ?? ''}/${watch.threadId}`)}
    <DeskCard {watch} {store} {now} {done} runningSince={since(watch)}
      project={watch.coreId === undefined ? store.projects.find(p => p.id === watch.projectId) ?? null : null}
      onopen={reachable(watch) ? () => open(watch) : undefined}
      ondrop={store.owner ? () => void drop(watch) : undefined}
      onanswer={reachable(watch) ? option => answer(watch, option) : undefined} />
  {/each}
{/snippet}

<div class="bot-work" class:idle={!!onstart && !sections.handling.length && !sections.done.length} data-testid="desk-work">
  {#if sections.handling.length || sections.done.length}
    {#if sections.handling.length}
      <h3 class="bot-section" data-testid="bot-handling">{t.handling} <span class="bot-section-count">{sections.handling.length}</span></h3>
      {@render rows(sections.handling, false)}
    {/if}
    {#if sections.done.length}
      <h3 class="bot-section" data-testid="bot-done">{t.done} <span class="bot-section-count">{sections.done.length}</span></h3>
      {@render rows(sections.done, true)}
    {/if}
  {:else if !onstart}
    <!-- On the Desk panel the empty line sits under the heading it describes, its action beside it (round 20). -->
    <h3 class="bot-section">{t.handling}</h3>
    <p class="desk-empty desk-empty-row"><span>{t.workEmpty}</span>{#if ontask && store.owner}<button type="button" class="ghost small" data-testid="desk-work-start" onclick={ontask}><span class="ui-label">{t.workStart}</span></button>{/if}</p>
  {:else if !first}
    <!-- An empty desk is one prompt in the column's middle; with no conversation either it moves over the chat (AgentsPage). -->
    <!-- Its face over the line, the open bot's so in its colours: an empty desk reads as this bot's, not a blank. -->
    {#if profile}<span class="bot-work-face" aria-hidden="true"><AgentAvatar kind="profile" id={profile.id} name={profile.name} avatar={profile.avatar} size={40} lit={avatarLit({ open: true })} /></span>{/if}
    <p class="bot-work-empty">{t.workEmpty}</p>
    {#if onstart && store.owner}<button type="button" class="small bot-work-start" data-testid="desk-work-start" onclick={onstart}><span class="ui-label">{t.workStart}</span></button>{/if}
  {/if}
</div>
