<script lang="ts">
  import type { Account, MemoryEvent, Message, Turn } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import type { AgentMailGroup } from '../lib/agent-mail';
  import { summaryMarks, type ShapedTimeline, type TurnFold } from '../lib/agent-turns';
  import type { TeamLaunch } from '../lib/delegation-progress';
  import { isSending } from '../lib/composer-queue';
  import { movedBy, startedFrom, turnAnswer } from '../lib/message-display';
  import type { TimelineRow } from '../lib/timeline-rows';
  import type { TimelineTurns } from '../lib/timeline-turns.svelte';
  import MessageTurnSummary from './MessageTurnSummary.svelte';
  import TurnFiles from './TurnFilesLoader.svelte';
  import AgentMessageGroup from './AgentMessageGroup.svelte';
  import WakeMarker, { wakeKind } from './WakeMarker.svelte';
  import TurnFoldRow from './TurnFoldRow.svelte';
  import DayDivider from './DayDivider.svelte';
  import DelegationActivity from './DelegationActivity.svelte';
  import UserMessage from './UserMessage.svelte';
  import AssistantMessage from './AssistantMessage.svelte';
  import FailedAttempts from './FailedAttempts.svelte';
  import MoveMarker from './MoveMarker.svelte';
  import SpawnMarker from './SpawnMarker.svelte';
  import MemoryRow from './MemoryRow.svelte';
  import MessageActions from './MessageActions.svelte';
  import WorkflowActivity from './WorkflowActivity.svelte';

  /** What one row of the message list draws inside its `<article>`: the list keeps the row's place, measure and seam. */
  let { store, threadId, messages, row, group, turn, source, quietFold, closes, days, turns, facts, shaped, launches, workflowRows, notices, memoryInline, views, newestTurnAt, signedOut, narrow, failureTarget, oninspect, pointed }: {
    store: Store; threadId: string; messages: Message[]; row: TimelineRow;
    group: AgentMailGroup | undefined; turn: Turn | undefined; source: Message | undefined; quietFold: TurnFold | undefined; closes: boolean;
    days: ReadonlyMap<string, number>; turns: Turn[]; facts: TimelineTurns; shaped: ShapedTimeline;
    launches: ReadonlyMap<string, TeamLaunch>; workflowRows: ReadonlyMap<string, ReturnType<Store['workflowsOf']>[number]>;
    notices: ReadonlyMap<string, MemoryEvent[]>; memoryInline: ReadonlyMap<string, MemoryEvent[]>; views: ReadonlyMap<string, Message[]>;
    newestTurnAt: number; signedOut: Account | null; narrow: boolean; failureTarget: { id: string } | null;
    oninspect: (opening: boolean) => void; pointed: string | null;
  } = $props();
  const message = $derived(row.message);
</script>

{#if row.first && days.has(message.id)}<DayDivider at={days.get(message.id)!} />{/if}
{#if row.failures}
  <FailedAttempts {store} {threadId} messages={row.failures} {turns} {signedOut} canFork={!narrow && facts.forkable && !store.openThread?.incognito} reveal={failureTarget} {oninspect} />
{:else if quietFold}
  <TurnFoldRow fold={quietFold} at={message.createdAt} compactions={shaped.compactions.get(quietFold.turnId)} />
{:else if launches.has(message.id)}
  <DelegationActivity {store} agents={launches.get(message.id)!.agents} past={message.createdAt < newestTurnAt} />
{:else if workflowRows.has(message.id)}
  <WorkflowActivity {store} run={workflowRows.get(message.id)!} past={message.createdAt < newestTurnAt} />
{:else if group}
  <AgentMessageGroup {store} {group} />
{:else if notices.has(message.id)}
  {@const events = notices.get(message.id)!}
  <MemoryRow event={events[0]!} {events} onconfigure={store.owner ? () => store.showSettings('resources', 'limits') : undefined} />
{:else if movedBy(message)}
  <MoveMarker notice={movedBy(message)!} />
{:else if startedFrom(message)}
  <SpawnMarker {store} link={startedFrom(message)!} direction="to" />
{:else if message.role !== 'assistant' && facts.first.get(message.turnId) === message.id && wakeKind(turn) && (message.role === 'system' || turn?.execution?.operation === 'routine' || turn?.execution?.operation === 'event')}
  <WakeMarker {message} kind={wakeKind(turn)!} />
{:else if message.role === 'user'}
  <UserMessage {store} {message} {turn} accepted={!!turn} responded={facts.progress.responded(message.turnId)} edit={facts.atRest && !isSending(message) ? () => void facts.edit(message) : undefined} />
{:else}
  <AssistantMessage {store} {threadId} {message} from={row.from} to={row.to} {signedOut} showModel={row.first && facts.firstAssistant.get(message.turnId) === message.id}
    latestInTurn={facts.last.get(message.turnId) === message.id} memoryEvents={memoryInline.get(message.id) ?? []} views={views.get(message.turnId)} />
{/if}
{#if turn && closes}
  {@const files = facts.filesOf(turn)}
  {#if files}<TurnFiles {store} {...files} loadDiffs={() => Promise.all(files.deferred.map(source => store.loadToolOutput(threadId, source.messageId, source.toolId))).then(() => {})} />{/if}
  <MessageTurnSummary {store} {threadId} {turn} {turns} message={source ?? message} {messages} pointed={pointed === turn.id}
    {...summaryMarks(shaped, turn.id, () => store.panel.open('desk'))}>
    {#snippet actions()}
      <MessageActions
        text={() => turnAnswer(messages, turn.id)}
        retry={facts.atRest && store.openThread?.turns.at(-1)?.id === turn.id ? () => void facts.retry(turn.id) : undefined}
        fork={!narrow && facts.forkable && !store.openThread?.incognito && source && source.state !== 'streaming' ? (worktree) => void store.fork(source.id, { worktree }) : undefined}
      />
    {/snippet}
  </MessageTurnSummary>
{/if}
