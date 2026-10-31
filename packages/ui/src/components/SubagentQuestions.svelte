<script lang="ts">
  import { ChevronRight, MessageCircleQuestionMark } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import { workspace, type Machine } from '../lib/workspace.svelte';

  let { machine, threadId, onopen }: { machine: Machine; threadId: string; onopen?: () => void } = $props();
</script>

{#each machine.store.subagentQuestions(threadId) as child (`${child.machine?.coreId ?? machine.id}:${child.threadId}`)}
  {@const target = child.machine ? workspace.machineOf(child.machine.coreId) : machine}
  {@const away = child.machine && target?.store.connection !== 'ready'}
  <button type="button" class="ghost subagent-question" data-testid="subagent-question-alert" data-child-id={child.threadId}
    data-preload-thread={away ? undefined : child.threadId} data-machine-id={target?.id}
    title={away ? fill(strings.delegation.machineAway, { machine: child.machine!.name }) : fill(strings.delegation.answerQuestion, { title: child.title })}
    disabled={!!away}
    onclick={() => { if (target) { onopen?.(); void workspace.select(target.store, child.threadId); } }}>
    <MessageCircleQuestionMark size={14} />
    <span class="question-label"><span class="ui-label">{strings.delegation.hasQuestion}</span><span class="child-title ui-label">{child.title}{child.machine ? ` · ${child.machine.name}` : ''}</span></span>
    <ChevronRight size={12} />
  </button>
{/each}

<style>
  .subagent-question {
    display: flex;
    align-items: center;
    gap: 7px;
    width: calc(100% - 10px);
    height: auto;
    min-height: var(--row);
    margin: 2px 0 4px 10px;
    padding: 6px 8px;
    text-align: left;
    color: var(--color-accent);
    border-left: 2px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    border-radius: var(--radius-sm);
  }
  .subagent-question :global(svg) { flex: none; }
  .question-label { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 3px; font-size: var(--text-xs); }
  .question-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .child-title { color: var(--color-muted-foreground); }
  @media (max-width: 720px) { .subagent-question { min-height: 44px; } }
</style>
