<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import { workspace } from '../lib/workspace.svelte';
  import type { Store } from '../lib/store.svelte';
  import DecisionHead from './DecisionHead.svelte';

  /** `only` keeps these children: the composer draws the questions it holds itself (`ThreadDecision`). */
  let { store, threadId, only }: { store: Store; threadId: string; only?: string[] } = $props();
  let listed = $derived(store.subagentQuestions(threadId).filter((child) => !only || only.includes(child.threadId)));
</script>

{#each listed as child (`${child.machine?.coreId ?? store.machineId}:${child.threadId}`)}
  {@const machine = child.machine ? workspace.machineOf(child.machine.coreId) : workspace.machines.find(entry => entry.store === store)}
  {@const target = child.machine ? machine?.store : store}
  {@const away = child.machine && target?.connection !== 'ready'}
  <DecisionHead as="button" class="ghost subagent-question" data-testid="subagent-question-alert" data-child-id={child.threadId}
    data-preload-thread={away ? undefined : child.threadId} data-machine-id={machine?.id}
    title={away ? fill(strings.delegation.machineAway, { machine: child.machine!.name }) : fill(strings.delegation.answerQuestion, { title: child.title })}
    disabled={!!away}
    onclick={() => { if (target) { void workspace.select(target, child.threadId); } }}>
    <span class="question-label"><span>{strings.delegation.hasQuestion}</span><span class="child-title">{child.title}{child.machine ? ` · ${child.machine.name}` : ''}</span></span>
    {#snippet end()}<ChevronRight size={16} />{/snippet}
  </DecisionHead>
{/each}

<style>
  /* The decisions' one head, the whole of it the way into the subagent's thread. */
  :global(button.decision-head.subagent-question) { height: auto; padding: 10px var(--dock-inset, 12px); border-radius: 0; justify-content: flex-start; }
  :global(button.decision-head.subagent-question:disabled) { opacity: .6; }
  .question-label { display: flex; flex-direction: column; flex: 1; min-width: 0; padding-block: calc((var(--control) - 22px) / 2); }
  .question-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .child-title { color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; line-height: 20px; }
</style>
