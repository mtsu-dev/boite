<script lang="ts">
  import { ChevronRight, MessageCircleQuestionMark } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import { workspace } from '../lib/workspace.svelte';
  import type { Store } from '../lib/store.svelte';

  let { store, threadId }: { store: Store; threadId: string } = $props();
</script>

{#each store.subagentQuestions(threadId) as child (`${child.machine?.coreId ?? store.machineId}:${child.threadId}`)}
  {@const machine = child.machine ? workspace.machineOf(child.machine.coreId) : workspace.machines.find(entry => entry.store === store)}
  {@const target = child.machine ? machine?.store : store}
  {@const away = child.machine && target?.connection !== 'ready'}
  <button type="button" class="ghost subagent-question" data-testid="subagent-question-alert" data-child-id={child.threadId}
    data-preload-thread={away ? undefined : child.threadId} data-machine-id={machine?.id}
    title={away ? fill(strings.delegation.machineAway, { machine: child.machine!.name }) : fill(strings.delegation.answerQuestion, { title: child.title })}
    disabled={!!away}
    onclick={() => { if (target) { void workspace.select(target, child.threadId); } }}>
    <MessageCircleQuestionMark size={14} />
    <span class="question-label"><span>{strings.delegation.hasQuestion}</span><span class="child-title">{child.title}{child.machine ? ` · ${child.machine.name}` : ''}</span></span>
    <ChevronRight size={12} />
  </button>
{/each}

<style>
  .subagent-question {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: auto;
    min-height: var(--row);
    margin: 0;
    padding: 6px 8px;
    text-align: left;
    color: var(--color-accent);
    border-radius: var(--radius-sm);
  }
  .subagent-question :global(svg) { flex: none; }
  .question-label { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 2px; font-size: var(--text-sm); line-height: 1.35; }
  .question-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .child-title { color: var(--color-muted-foreground); }
  @media (max-width: 720px) { .subagent-question { min-height: 44px; } }
</style>
