<script lang="ts">
  import { requestWork, type Message, type Turn } from '@boite/contracts';
  import type { Snippet } from 'svelte';
  import type { Store } from '../lib/store.svelte';
  import TurnSummary, { type SummaryMemory, type SummarySteps } from './TurnSummary.svelte';
  import type { CompactionPart } from '../lib/tool-groups';

  let { store, threadId, turn, turns = [], message, messages, pointed = false, steps, memory, compactions, actions }: {
    store: Store;
    threadId: string;
    turn: Turn;
    /** The shown thread's turns, to count what the request this turn carries on worked before it (`requestWork`). */
    turns?: Turn[];
    message: Message;
    messages: Message[];
    /** The pointer is on one of the turn's answers, maybe not the one this summary closes. */
    pointed?: boolean;
    /** A persistent agent's folded steps, counted on the line and opened from it. */
    steps?: SummarySteps;
    /** The memory pass that followed this turn, as a mark on the line. */
    memory?: SummaryMemory;
    /** The automatic compactions said on this turn's line. */
    compactions?: CompactionPart[];
    actions?: Snippet;
  } = $props();

  const active = $derived(turn.status === 'running' ? messages.filter(current => current.turnId === turn.id && current.role === 'assistant') : []);
  // A steering prompt moves the summary, but the preceding reasoning and tools keep working.
  // Only the last assistant message can be writing visible answer text.
  const activeContent = $derived(active.some(current => {
    const tail = current.parts.at(-1);
    return current.state === 'streaming' && (tail?.type === 'thinking' && tail.finishedAt == null ||
      current.id === message.id && tail?.type === 'text' && tail.complete !== true && tail.text.trim().length > 0);
  }));
  const workedBefore = $derived(requestWork(turns).get(turn.id) ?? 0);
</script>

<TurnSummary
  {turn}
  {workedBefore}
  clockOffset={store.clockOffset}
  progress={store.openThread?.id === threadId ? store.openThread.progress : undefined}
  activeTool={active.some(current => current.parts.some(part => part.type === 'tool' && part.status === 'running'))}
  {activeContent}
  waiting={store.openThread?.status === 'waiting' && turn.status === 'running'}
  background={store.openThread?.turns.at(-1)?.id === turn.id ? store.openThread?.background ?? [] : []}
  stop={() => void store.stop()}
  {pointed}
  {steps}
  {memory}
  {compactions}
  {actions}
/>
